// One connection to ubusd: the hello, objects added with the signature of
// their methods, the answers to calls made on them, notifications to their
// subscribers, and calls this side makes on other objects.
//
// A Conn lives as long as its socket. ubusd going away (a restart) ends it;
// Bus (bus.go) dials again and puts the objects back. One goroutine reads; a
// call on an object runs in its own goroutine, so a slow answer holds up
// neither the reader nor the other callers.
package ubus

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
)

// Socket is where ubusd listens on OpenWrt.
const Socket = "/var/run/ubus/ubus.sock"

// The types of a message (ubusmsg.h).
const (
	typeHello     = 0
	typeStatus    = 1
	typeData      = 2
	typeLookup    = 4
	typeInvoke    = 5
	typeAddObject = 6
	typeNotify    = 10
)

// The fields of a message (ubusmsg.h).
const (
	fieldStatus    = 1
	fieldObjPath   = 2
	fieldObjID     = 3
	fieldMethod    = 4
	fieldSignature = 6
	fieldData      = 7
	fieldActive    = 9
	fieldNoReply   = 10
	fieldMax       = 14
)

// maxMessage is the largest message ubusd takes (UBUS_MAX_MSGLEN); a larger
// one makes it drop the client.
const maxMessage = 1 << 20

// Status is how a call ended, as ubus counts it. Zero is success.
type Status int

// The statuses a handler may return (as an error) and a call may fail with.
const (
	StatusInvalidCommand   Status = 1
	StatusInvalidArgument  Status = 2
	StatusMethodNotFound   Status = 3
	StatusNotFound         Status = 4
	StatusNoData           Status = 5
	StatusPermissionDenied Status = 6
	StatusTimeout          Status = 7
	StatusNotSupported     Status = 8
	StatusUnknownError     Status = 9
	StatusConnectionFailed Status = 10
)

var statusText = map[Status]string{
	StatusInvalidCommand: "invalid command", StatusInvalidArgument: "invalid argument",
	StatusMethodNotFound: "method not found", StatusNotFound: "not found", StatusNoData: "no data",
	StatusPermissionDenied: "permission denied", StatusTimeout: "timeout", StatusNotSupported: "not supported",
	StatusUnknownError: "unknown error", StatusConnectionFailed: "connection failed",
}

func (s Status) Error() string {
	if t, ok := statusText[s]; ok {
		return "ubus: " + t
	}
	return fmt.Sprintf("ubus: status %d", int(s))
}

// ErrClosed is what calls return once the connection to ubusd has ended.
var ErrClosed = errors.New("ubus: connection closed")

// Handler answers a call. The arguments are the caller's table (through
// uhttpd, with its session id in "ubus_rpc_session"). A nil table answers with
// nothing; an error that is a Status ends the call with it, any other with
// StatusUnknownError.
type Handler func(ctx context.Context, args map[string]any) (map[string]any, error)

// Kind is the type of an argument in a method's signature (`ubus -v list`).
type Kind uint32

// The kinds of argument a signature names.
const (
	Array  Kind = msgArray
	Table  Kind = msgTable
	String Kind = msgString
	Int    Kind = msgInt32
	Bool   Kind = msgBool
)

// Method is one method of an object.
type Method struct {
	Name   string
	Params map[string]Kind
	Handle Handler
	// Waits marks a method that holds its answer until it has something to say
	// (a long poll). Such calls are counted apart from the quick ones, which
	// they would otherwise keep out, and one too many is refused at once.
	Waits bool
}

// Object is what the backend publishes on the bus.
type Object struct {
	Name    string
	Methods []Method
	// Watched is called when the object's first subscriber comes and when its
	// last one leaves, from the reader's goroutine: it must not block.
	Watched func(active bool)
}

type message struct {
	kind uint8
	seq  uint16
	peer uint32
	body []byte
}

// fields is a message's attributes by id; nil where one is absent.
type fields [fieldMax + 1][]byte

func (m *message) fields() (fields, error) {
	var f fields
	err := each(m.body, func(a attr) error {
		if a.id <= fieldMax {
			// An attribute that is there with no payload still counts as present.
			if a.data == nil {
				a.data = []byte{}
			}
			f[a.id] = a.data
		}
		return nil
	})
	return f, err
}

func (f *fields) uint32(id int) (uint32, bool) {
	if len(f[id]) < 4 {
		return 0, false
	}
	return binary.BigEndian.Uint32(f[id]), true
}

func (f *fields) string(id int) string {
	d := f[id]
	for i, c := range d {
		if c == 0 {
			return string(d[:i])
		}
	}
	return string(d)
}

// reply is what a request this side made has received so far.
type reply struct {
	data   [][]byte
	status Status
}

// Conn is a connection to ubusd.
type Conn struct {
	c      net.Conn
	ctx    context.Context
	cancel context.CancelFunc

	wmu sync.Mutex // one message at a time on the socket

	mu      sync.Mutex
	seq     uint16
	pending map[uint16]chan reply
	partial map[uint16]*reply
	objects map[uint32]*Object
	ids     map[*Object]uint32
	looked  map[string]uint32
	err     error

	// Calls on our objects that run now: at most this many, the rest wait in
	// the reader, which is how a caller that floods the bus is slowed down.
	slots chan struct{}
	// Calls that wait (Method.Waits) and may each take most of a minute.
	waits chan struct{}
}

// Dial connects to ubusd at path and waits for its hello.
func Dial(path string) (*Conn, error) {
	c, err := net.Dial("unix", path)
	if err != nil {
		return nil, err
	}
	conn := &Conn{
		c:       c,
		pending: map[uint16]chan reply{},
		partial: map[uint16]*reply{},
		objects: map[uint32]*Object{},
		ids:     map[*Object]uint32{},
		looked:  map[string]uint32{},
		slots:   make(chan struct{}, 8),
		waits:   make(chan struct{}, 64),
	}
	conn.ctx, conn.cancel = context.WithCancel(context.Background())
	m, err := conn.read()
	if err == nil && m.kind != typeHello {
		err = fmt.Errorf("ubus: expected a hello, got message type %d", m.kind)
	}
	if err != nil {
		c.Close()
		return nil, err
	}
	go conn.loop()
	return conn, nil
}

// Close ends the connection; everything waiting on it returns ErrClosed.
func (c *Conn) Close() error {
	c.fail(ErrClosed)
	return nil
}

// Done is closed when the connection has ended.
func (c *Conn) Done() <-chan struct{} { return c.ctx.Done() }

func (c *Conn) fail(err error) {
	c.mu.Lock()
	if c.err == nil {
		c.err = err
		for seq, ch := range c.pending {
			close(ch)
			delete(c.pending, seq)
		}
	}
	c.mu.Unlock()
	c.cancel()
	c.c.Close()
}

func (c *Conn) read() (message, error) {
	var h [12]byte
	if _, err := io.ReadFull(c.c, h[:]); err != nil {
		return message{}, err
	}
	if h[0] != 0 {
		return message{}, fmt.Errorf("ubus: protocol version %d", h[0])
	}
	n := int(binary.BigEndian.Uint32(h[8:]) & attrLenMask)
	if n < attrHeader || n > maxMessage {
		return message{}, fmt.Errorf("ubus: message of %d bytes", n)
	}
	m := message{kind: h[1], seq: binary.BigEndian.Uint16(h[2:]), peer: binary.BigEndian.Uint32(h[4:])}
	m.body = make([]byte, n-attrHeader)
	if _, err := io.ReadFull(c.c, m.body); err != nil {
		return message{}, err
	}
	return m, nil
}

func (c *Conn) write(kind uint8, seq uint16, peer uint32, body []byte) error {
	n := attrHeader + len(body)
	if n > maxMessage {
		return fmt.Errorf("ubus: message of %d bytes is over the bus's limit", n)
	}
	b := make([]byte, 12, 12+len(body))
	b[1] = kind
	binary.BigEndian.PutUint16(b[2:], seq)
	binary.BigEndian.PutUint32(b[4:], peer)
	binary.BigEndian.PutUint32(b[8:], uint32(n))
	b = append(b, body...)
	c.wmu.Lock()
	_, err := c.c.Write(b)
	c.wmu.Unlock()
	if err != nil {
		c.fail(err)
	}
	return err
}

// request sends a message and waits for the status that ends its answer.
func (c *Conn) request(ctx context.Context, kind uint8, peer uint32, body []byte) (reply, error) {
	ch := make(chan reply, 1)
	c.mu.Lock()
	if c.err != nil {
		c.mu.Unlock()
		return reply{}, ErrClosed
	}
	// A sequence number still waited for is not given out again.
	for {
		c.seq++
		if _, busy := c.pending[c.seq]; !busy {
			break
		}
	}
	seq := c.seq
	c.pending[seq] = ch
	c.mu.Unlock()

	if err := c.write(kind, seq, peer, body); err != nil {
		c.forget(seq)
		return reply{}, err
	}
	select {
	case r, ok := <-ch:
		if !ok {
			return reply{}, ErrClosed
		}
		if r.status != 0 {
			return r, r.status
		}
		return r, nil
	case <-ctx.Done():
		c.forget(seq)
		return reply{}, ctx.Err()
	}
}

func (c *Conn) forget(seq uint16) {
	c.mu.Lock()
	delete(c.pending, seq)
	delete(c.partial, seq)
	c.mu.Unlock()
}

func (c *Conn) loop() {
	for {
		m, err := c.read()
		if err != nil {
			c.fail(err)
			return
		}
		f, err := m.fields()
		if err != nil {
			c.fail(err)
			return
		}
		switch m.kind {
		case typeData, typeStatus:
			c.answered(m, &f)
		case typeInvoke:
			c.invoked(m, &f)
		case typeNotify:
			// From ubusd: the object got its first subscriber or lost its last.
			id, _ := f.uint32(fieldObjID)
			c.mu.Lock()
			o := c.objects[id]
			c.mu.Unlock()
			if o != nil && o.Watched != nil && f[fieldActive] != nil {
				o.Watched(len(f[fieldActive]) > 0 && f[fieldActive][0] != 0)
			}
		}
	}
}

// answered takes a part of the answer to a request of ours: its data, or the
// status that ends it.
func (c *Conn) answered(m message, f *fields) {
	c.mu.Lock()
	defer c.mu.Unlock()
	ch, ok := c.pending[m.seq]
	if !ok {
		return
	}
	r := c.partial[m.seq]
	if r == nil {
		r = &reply{}
		c.partial[m.seq] = r
	}
	if m.kind == typeData {
		// An answer to a lookup or to adding an object is the message itself; a
		// method's answer sits in its data field.
		r.data = append(r.data, m.body)
		return
	}
	st, _ := f.uint32(fieldStatus)
	r.status = Status(st)
	delete(c.pending, m.seq)
	delete(c.partial, m.seq)
	ch <- *r
}

// invoked runs a call on one of our objects and answers it.
func (c *Conn) invoked(m message, f *fields) {
	id, _ := f.uint32(fieldObjID)
	name := f.string(fieldMethod)
	silent := len(f[fieldNoReply]) > 0 && f[fieldNoReply][0] != 0
	c.mu.Lock()
	o := c.objects[id]
	c.mu.Unlock()
	end := func(st Status) {
		if silent {
			return
		}
		b := putUint32(nil, fieldStatus, uint32(st))
		b = putUint32(b, fieldObjID, id)
		c.write(typeStatus, m.seq, m.peer, b)
	}
	var handle Handler
	slots := c.slots
	if o != nil {
		for i := range o.Methods {
			if o.Methods[i].Name == name {
				handle = o.Methods[i].Handle
				if o.Methods[i].Waits {
					slots = c.waits
				}
			}
		}
	}
	if handle == nil {
		end(StatusMethodNotFound)
		return
	}
	args, err := decodeTable(f[fieldData], 0)
	if err != nil {
		end(StatusInvalidArgument)
		return
	}
	if slots == c.waits {
		select {
		case slots <- struct{}{}:
		default:
			// The caller asks again later, by its own clock.
			end(StatusTimeout)
			return
		}
	} else {
		select {
		case slots <- struct{}{}:
		case <-c.ctx.Done():
			return
		}
	}
	go func() {
		defer func() { <-slots }()
		out, err := handle(c.ctx, args)
		var st Status
		if err != nil && !errors.As(err, &st) {
			st = StatusUnknownError
		}
		if err == nil && out != nil && !silent {
			data, eerr := encodeTable(out)
			if eerr != nil {
				st = StatusUnknownError
			} else {
				b := putUint32(nil, fieldObjID, id)
				b = putBytes(b, fieldData, data)
				if c.write(typeData, m.seq, m.peer, b) != nil {
					return
				}
			}
		}
		end(st)
	}()
}

// Add publishes an object. Its methods can be called as soon as this returns.
func (c *Conn) Add(ctx context.Context, o *Object) error {
	b := putString(nil, fieldObjPath, o.Name)
	b, at := open(b)
	var err error
	for _, m := range o.Methods {
		sig := make(map[string]any, len(m.Params))
		for k, v := range m.Params {
			sig[k] = int64(v)
		}
		if b, err = putValue(b, m.Name, sig); err != nil {
			return err
		}
	}
	b = closeAttr(b, at, fieldSignature<<attrIDShift)
	r, err := c.request(ctx, typeAddObject, 0, b)
	if err != nil {
		return fmt.Errorf("ubus: adding %s: %w", o.Name, err)
	}
	for _, d := range r.data {
		f, err := (&message{body: d}).fields()
		if err != nil {
			return err
		}
		if id, ok := f.uint32(fieldObjID); ok {
			c.mu.Lock()
			c.objects[id] = o
			c.ids[o] = id
			c.mu.Unlock()
			return nil
		}
	}
	return fmt.Errorf("ubus: adding %s: no object id in the answer", o.Name)
}

// Notify sends a notification of this type to the object's subscribers and
// does not wait for them. With no subscriber ubusd drops it.
func (c *Conn) Notify(o *Object, kind string, data map[string]any) error {
	c.mu.Lock()
	id, ok := c.ids[o]
	c.mu.Unlock()
	if !ok {
		return fmt.Errorf("ubus: %s is not on the bus", o.Name)
	}
	payload, err := encodeTable(data)
	if err != nil {
		return err
	}
	b := putUint32(nil, fieldObjID, id)
	b = putString(b, fieldMethod, kind)
	b = putUint8(b, fieldNoReply, 1)
	b = putBytes(b, fieldData, payload)
	return c.write(typeNotify, 0, id, b)
}

// Call invokes a method of another object and returns the table it answers
// with (empty when it answers with nothing).
func (c *Conn) Call(ctx context.Context, object, method string, args map[string]any) (map[string]any, error) {
	id, err := c.lookup(ctx, object)
	if err != nil {
		return nil, err
	}
	payload, err := encodeTable(args)
	if err != nil {
		return nil, err
	}
	b := putUint32(nil, fieldObjID, id)
	b = putString(b, fieldMethod, method)
	b = putBytes(b, fieldData, payload)
	r, err := c.request(ctx, typeInvoke, id, b)
	if err != nil {
		// The object may have come back under another id (its owner restarted).
		if errors.Is(err, StatusNotFound) {
			c.mu.Lock()
			delete(c.looked, object)
			c.mu.Unlock()
		}
		return nil, fmt.Errorf("ubus: %s.%s: %w", object, method, err)
	}
	out := map[string]any{}
	for _, d := range r.data {
		f, err := (&message{body: d}).fields()
		if err != nil {
			return nil, err
		}
		t, err := decodeTable(f[fieldData], 0)
		if err != nil {
			return nil, err
		}
		for k, v := range t {
			out[k] = v
		}
	}
	return out, nil
}

func (c *Conn) lookup(ctx context.Context, object string) (uint32, error) {
	c.mu.Lock()
	id, ok := c.looked[object]
	c.mu.Unlock()
	if ok {
		return id, nil
	}
	r, err := c.request(ctx, typeLookup, 0, putString(nil, fieldObjPath, object))
	if err != nil {
		return 0, fmt.Errorf("ubus: looking up %s: %w", object, err)
	}
	for _, d := range r.data {
		f, err := (&message{body: d}).fields()
		if err != nil {
			return 0, err
		}
		if id, ok := f.uint32(fieldObjID); ok && f.string(fieldObjPath) == object {
			c.mu.Lock()
			c.looked[object] = id
			c.mu.Unlock()
			return id, nil
		}
	}
	return 0, fmt.Errorf("ubus: looking up %s: %w", object, StatusNotFound)
}
