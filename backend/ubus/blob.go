// Package ubus speaks the wire protocol of ubusd, OpenWrt's message bus, so the
// backend can publish an object of its own and notify its subscribers without
// libubus. LuCI reaches that object through uhttpd (/ubus: calls as JSON-RPC,
// notifications as an event stream), with rpcd's access lists in between.
//
// This file is the encoding: libubox's blob attributes, which carry the
// protocol's own fields, and blobmsg, the JSON-like values inside them. It
// owns no socket; conn.go does.
package ubus

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
)

// A blob attribute is a 4-byte big-endian word (flag, 7 bits of id, 24 bits of
// length counted from the word itself) and its payload, padded to 4 bytes.
const (
	attrHeader   = 4
	attrExtended = 0x80000000
	attrIDMask   = 0x7f000000
	attrIDShift  = 24
	attrLenMask  = 0x00ffffff
)

// The types of a blobmsg value (the id of an extended attribute).
const (
	msgNull   = 0
	msgArray  = 1
	msgTable  = 2
	msgString = 3
	msgInt64  = 4
	msgInt32  = 5
	msgInt16  = 6
	msgBool   = 7
	msgDouble = 8
)

var errTruncated = errors.New("ubus: truncated attribute")

func pad4(n int) int { return (n + 3) &^ 3 }

// open starts an attribute and returns where its header is, for closeAttr.
func open(b []byte) ([]byte, int) {
	at := len(b)
	return append(b, 0, 0, 0, 0), at
}

// closeAttr writes the header word of the attribute opened at `at` (`word` is
// its flag and id, the length is added here) and pads it.
func closeAttr(b []byte, at int, word uint32) []byte {
	binary.BigEndian.PutUint32(b[at:], word|uint32(len(b)-at))
	for len(b)%4 != 0 {
		b = append(b, 0)
	}
	return b
}

func putBytes(b []byte, id uint32, p []byte) []byte {
	b, at := open(b)
	b = append(b, p...)
	return closeAttr(b, at, id<<attrIDShift)
}

func putString(b []byte, id uint32, s string) []byte {
	b, at := open(b)
	b = append(b, s...)
	b = append(b, 0)
	return closeAttr(b, at, id<<attrIDShift)
}

func putUint32(b []byte, id uint32, v uint32) []byte {
	b, at := open(b)
	b = binary.BigEndian.AppendUint32(b, v)
	return closeAttr(b, at, id<<attrIDShift)
}

func putUint8(b []byte, id uint32, v uint8) []byte {
	b, at := open(b)
	b = append(b, v)
	return closeAttr(b, at, id<<attrIDShift)
}

// attr is one parsed attribute: its id, whether it is a blobmsg value, and its
// payload without the padding.
type attr struct {
	id       uint32
	extended bool
	data     []byte
}

// next takes the first attribute off b. The lengths come from the other side
// of a socket: every one is checked against what is there.
func next(b []byte) (attr, []byte, error) {
	if len(b) < attrHeader {
		return attr{}, nil, errTruncated
	}
	w := binary.BigEndian.Uint32(b)
	n := int(w & attrLenMask)
	if n < attrHeader || n > len(b) {
		return attr{}, nil, errTruncated
	}
	a := attr{id: (w & attrIDMask) >> attrIDShift, extended: w&attrExtended != 0, data: b[attrHeader:n]}
	rest := pad4(n)
	if rest > len(b) {
		rest = len(b)
	}
	return a, b[rest:], nil
}

// each calls fn for every attribute in b.
func each(b []byte, fn func(attr) error) error {
	for len(b) > 0 {
		a, rest, err := next(b)
		if err != nil {
			return err
		}
		if err := fn(a); err != nil {
			return err
		}
		b = rest
	}
	return nil
}

/* ---------- blobmsg: values ---------- */

// putValue appends one named blobmsg value. Values are what encoding/json
// makes of a document (nil, bool, float64, json.Number, string, []any,
// map[string]any) and Go's integers; anything else goes through encoding/json
// first, so a struct with json tags is sent the way it would be marshalled.
// Table keys are sorted: the same value always makes the same bytes.
func putValue(b []byte, name string, v any) ([]byte, error) {
	switch x := v.(type) {
	case nil:
		b, at := putName(b, name)
		return closeAttr(b, at, attrExtended|msgNull<<attrIDShift), nil
	case bool:
		b, at := putName(b, name)
		if x {
			b = append(b, 1)
		} else {
			b = append(b, 0)
		}
		return closeAttr(b, at, attrExtended|msgBool<<attrIDShift), nil
	case string:
		b, at := putName(b, name)
		b = append(b, x...)
		b = append(b, 0)
		return closeAttr(b, at, attrExtended|msgString<<attrIDShift), nil
	case int:
		return putInt(b, name, int64(x)), nil
	case int32:
		return putInt(b, name, int64(x)), nil
	case int64:
		return putInt(b, name, x), nil
	case uint32:
		return putInt(b, name, int64(x)), nil
	case uint64:
		if x > math.MaxInt64 {
			return putDouble(b, name, float64(x)), nil
		}
		return putInt(b, name, int64(x)), nil
	case float64:
		// A whole number is an integer on the bus, as it is in the JSON it came from.
		if x == math.Trunc(x) && math.Abs(x) < 1<<53 {
			return putInt(b, name, int64(x)), nil
		}
		return putDouble(b, name, x), nil
	case json.Number:
		if i, err := x.Int64(); err == nil {
			return putInt(b, name, i), nil
		}
		f, err := x.Float64()
		if err != nil {
			return nil, fmt.Errorf("ubus: %q is not a number", string(x))
		}
		return putDouble(b, name, f), nil
	case []any:
		b, at := putName(b, name)
		var err error
		for _, e := range x {
			if b, err = putValue(b, "", e); err != nil {
				return nil, err
			}
		}
		return closeAttr(b, at, attrExtended|msgArray<<attrIDShift), nil
	case map[string]any:
		b, at := putName(b, name)
		var err error
		if b, err = putFields(b, x); err != nil {
			return nil, err
		}
		return closeAttr(b, at, attrExtended|msgTable<<attrIDShift), nil
	}
	raw, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("ubus: cannot encode %T: %w", v, err)
	}
	var plain any
	if err := json.Unmarshal(raw, &plain); err != nil {
		return nil, err
	}
	return putValue(b, name, plain)
}

// putName starts a blobmsg attribute: the header word (written by closeAttr),
// then the length of the name, the name and its NUL, padded to 4.
func putName(b []byte, name string) ([]byte, int) {
	b, at := open(b)
	b = binary.BigEndian.AppendUint16(b, uint16(len(name)))
	b = append(b, name...)
	b = append(b, 0)
	for (len(b)-at)%4 != 0 {
		b = append(b, 0)
	}
	return b, at
}

func putInt(b []byte, name string, v int64) []byte {
	b, at := putName(b, name)
	if v >= math.MinInt32 && v <= math.MaxInt32 {
		b = binary.BigEndian.AppendUint32(b, uint32(int32(v)))
		return closeAttr(b, at, attrExtended|msgInt32<<attrIDShift)
	}
	b = binary.BigEndian.AppendUint64(b, uint64(v))
	return closeAttr(b, at, attrExtended|msgInt64<<attrIDShift)
}

func putDouble(b []byte, name string, v float64) []byte {
	b, at := putName(b, name)
	b = binary.BigEndian.AppendUint64(b, math.Float64bits(v))
	return closeAttr(b, at, attrExtended|msgDouble<<attrIDShift)
}

// putFields appends the fields of a table, sorted by name.
func putFields(b []byte, m map[string]any) ([]byte, error) {
	names := make([]string, 0, len(m))
	for k := range m {
		// The name's length is 16 bits on the wire.
		if len(k) > math.MaxUint16 {
			return nil, fmt.Errorf("ubus: field name of %d bytes", len(k))
		}
		names = append(names, k)
	}
	sort.Strings(names)
	var err error
	for _, k := range names {
		if b, err = putValue(b, k, m[k]); err != nil {
			return nil, err
		}
	}
	return b, nil
}

// encodeTable is a table's fields as they sit inside a message's data attribute.
func encodeTable(m map[string]any) ([]byte, error) {
	return putFields(make([]byte, 0, 256), m)
}

// A value nested deeper than this is refused: the bus carries documents, and a
// peer that sends tables inside tables without end is not sending one.
const maxDepth = 32

// decodeTable reads the fields of a table. Integers come back as int64,
// whatever their width on the wire.
func decodeTable(b []byte, depth int) (map[string]any, error) {
	out := map[string]any{}
	err := each(b, func(a attr) error {
		name, v, err := decodeValue(a, depth)
		if err != nil {
			return err
		}
		out[name] = v
		return nil
	})
	return out, err
}

func decodeValue(a attr, depth int) (string, any, error) {
	if !a.extended || len(a.data) < 2 {
		return "", nil, errors.New("ubus: not a blobmsg value")
	}
	n := int(binary.BigEndian.Uint16(a.data))
	hdr := pad4(2 + n + 1)
	if 2+n > len(a.data) {
		return "", nil, errTruncated
	}
	name := string(a.data[2 : 2+n])
	var d []byte
	if hdr <= len(a.data) {
		d = a.data[hdr:]
	}
	switch a.id {
	case msgNull:
		return name, nil, nil
	case msgBool:
		if len(d) < 1 {
			return "", nil, errTruncated
		}
		return name, d[0] != 0, nil
	case msgInt16:
		if len(d) < 2 {
			return "", nil, errTruncated
		}
		return name, int64(int16(binary.BigEndian.Uint16(d))), nil
	case msgInt32:
		if len(d) < 4 {
			return "", nil, errTruncated
		}
		return name, int64(int32(binary.BigEndian.Uint32(d))), nil
	case msgInt64:
		if len(d) < 8 {
			return "", nil, errTruncated
		}
		return name, int64(binary.BigEndian.Uint64(d)), nil
	case msgDouble:
		if len(d) < 8 {
			return "", nil, errTruncated
		}
		return name, math.Float64frombits(binary.BigEndian.Uint64(d)), nil
	case msgString:
		// The NUL that ends it is part of the length.
		for i, c := range d {
			if c == 0 {
				d = d[:i]
				break
			}
		}
		return name, string(d), nil
	case msgTable:
		if depth >= maxDepth {
			return "", nil, errors.New("ubus: value nested too deep")
		}
		t, err := decodeTable(d, depth+1)
		return name, t, err
	case msgArray:
		if depth >= maxDepth {
			return "", nil, errors.New("ubus: value nested too deep")
		}
		list := []any{}
		err := each(d, func(e attr) error {
			_, v, err := decodeValue(e, depth+1)
			if err != nil {
				return err
			}
			list = append(list, v)
			return nil
		})
		return name, list, err
	}
	return "", nil, fmt.Errorf("ubus: unknown blobmsg type %d", a.id)
}
