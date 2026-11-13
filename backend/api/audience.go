// Who is looking: producers of live state work only while a page shows it.
// A page that follows the stream says which topics it shows (with every
// question it asks, and a `watch` call for the ones it keeps open); each such
// word holds for a short while. Nothing asked, nobody subscribed: nothing is
// read from the tunnels for the pages, as before the stream existed.
package api

import (
	"sync"
	"time"
)

// Lease is how long a page's interest in a topic holds after it said so.
// Pages renew it at about a third of that.
const Lease = 30 * time.Second

// Audience remembers who looks at what.
type Audience struct {
	mu     sync.Mutex
	until  map[string]time.Time
	stream bool
	now    func() time.Time
}

// NewAudience makes an empty audience.
func NewAudience() *Audience {
	return &Audience{until: map[string]time.Time{}, now: time.Now}
}

// everything stands for a page that named no topic: it follows them all.
const everything = "*"

// Touch notes that someone looks at these topics now (none named: at all of
// them, which keeps the audience present but wakes no topic that must be
// asked for by name, like the meter).
func (a *Audience) Touch(topics []string) {
	end := a.now().Add(Lease)
	a.mu.Lock()
	if len(topics) == 0 {
		a.until[everything] = end
	}
	for _, t := range topics {
		a.until[t] = end
	}
	a.mu.Unlock()
}

// Streaming notes whether the event stream has subscribers (ubusd tells).
func (a *Audience) Streaming(on bool) {
	a.mu.Lock()
	a.stream = on
	a.mu.Unlock()
}

// Wants tells whether someone looked at the topic within the lease.
func (a *Audience) Wants(topic string) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.now().Before(a.until[topic])
}

// Present tells whether any page is there at all: one that follows the
// stream, or one that asked for anything within the lease.
func (a *Audience) Present() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.stream {
		return true
	}
	now := a.now()
	for t, end := range a.until {
		if now.Before(end) {
			return true
		}
		delete(a.until, t)
	}
	return false
}
