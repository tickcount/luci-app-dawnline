// Bus keeps the backend's objects on ubus for as long as the backend runs.
// ubusd restarts (a package upgrade, a crash): the connection ends, and the
// objects are put back on the next one. Until then notifications are dropped
// and calls fail; nothing waits for the bus.
package ubus

import (
	"context"
	"sync"
	"time"
)

// Bus is the backend's place on ubus, reconnected when it is lost.
type Bus struct {
	path    string
	objects []*Object
	// Log is told why a connection was not made or ended, once per change.
	Log func(format string, args ...any)

	mu   sync.Mutex
	conn *Conn
}

// NewBus prepares a bus at path (Socket on a router) with these objects.
func NewBus(path string, objects ...*Object) *Bus {
	return &Bus{path: path, objects: objects, Log: func(string, ...any) {}}
}

// Run keeps the connection until ctx ends. Between tries it waits a little
// longer each time, up to 5 s: ubusd comes back within a second or two.
func (b *Bus) Run(ctx context.Context) {
	wait := 200 * time.Millisecond
	said := ""
	for ctx.Err() == nil {
		err := b.session(ctx)
		if ctx.Err() != nil {
			return
		}
		// The same reason is not repeated on every try.
		if msg := err.Error(); msg != said {
			b.Log("ubus: %s; trying again", msg)
			said = msg
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
		if wait < 5*time.Second {
			wait *= 2
		}
	}
}

// session is one connection: dial, add the objects, stay until it ends.
func (b *Bus) session(ctx context.Context) error {
	c, err := Dial(b.path)
	if err != nil {
		return err
	}
	defer c.Close()
	for _, o := range b.objects {
		actx, cancel := context.WithTimeout(ctx, 10*time.Second)
		err := c.Add(actx, o)
		cancel()
		if err != nil {
			return err
		}
	}
	b.mu.Lock()
	b.conn = c
	b.mu.Unlock()
	defer func() {
		b.mu.Lock()
		b.conn = nil
		b.mu.Unlock()
		// Whoever watched is gone with the connection.
		for _, o := range b.objects {
			if o.Watched != nil {
				o.Watched(false)
			}
		}
	}()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-c.Done():
		c.mu.Lock()
		err := c.err
		c.mu.Unlock()
		return err
	}
}

// Notify sends a notification to the object's subscribers; without a
// connection it is dropped (a subscriber that comes back asks for what it missed).
func (b *Bus) Notify(o *Object, kind string, data map[string]any) error {
	b.mu.Lock()
	c := b.conn
	b.mu.Unlock()
	if c == nil {
		return ErrClosed
	}
	return c.Notify(o, kind, data)
}

// Call invokes a method of another object on the bus.
func (b *Bus) Call(ctx context.Context, object, method string, args map[string]any) (map[string]any, error) {
	b.mu.Lock()
	c := b.conn
	b.mu.Unlock()
	if c == nil {
		return nil, ErrClosed
	}
	return c.Call(ctx, object, method, args)
}
