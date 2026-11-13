// Package bridge has the backend's topics told again when they may have moved without an event of their
// own: the settings or what was handed out changed on disk, somebody starts to look, or the minute passed
// (the counters and the clock move by themselves). It also gives the topics their shape on the stream
// (Split). The name is from the time it carried the ucode backend's answers over; nothing is asked of
// anyone now.
package bridge

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/hub"
)

// Refresh is how old what is published may get while nothing on disk moved: traffic totals and uptimes
// change without an event.
const Refresh = 30 * time.Second

// MeterKeep is how many points of the live meter are kept, one a second.
const MeterKeep = 120

// Audience tells whether anyone looks.
type Audience interface {
	Present() bool
	Wants(topic string) bool
}

// Bridge has the topics told again.
type Bridge struct {
	Hub      *hub.Hub
	Audience Audience
	// Watch lists the files whose change means the topics changed (the settings, the configurations handed
	// out, the servers kept down).
	Watch []string
	// Tell puts the topics again, as the router is at that moment, and says whether it could: false while
	// there is nothing to make them from (the settings were not read yet). nil: nobody makes them here, a
	// test stand.
	Tell func() bool
	// Log gets a line for the system log.
	Log func(format string, args ...any)

	asks      chan chan struct{}
	sig       string
	told      time.Time
	wasAbsent bool
}

// New makes a bridge ready to be asked (Look) before it runs.
func New(b Bridge) *Bridge {
	b.asks = make(chan chan struct{})
	return &b
}

// Look has the topics told now instead of at the next second, and returns once they hold what is on disk
// (or ctx ended). A page asks after its own edit, to read what it wrote.
func (b *Bridge) Look(ctx context.Context) {
	done := make(chan struct{})
	select {
	case b.asks <- done:
	case <-ctx.Done():
		return
	}
	select {
	case <-done:
	case <-ctx.Done():
	}
}

// Run works until ctx ends.
func (b *Bridge) Run(ctx context.Context) {
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	b.wasAbsent = true
	for {
		var asked chan struct{}
		select {
		case <-ctx.Done():
			return
		case asked = <-b.asks:
		case <-tick.C:
		}
		if asked != nil {
			// whoever asks is told at once
			b.wasAbsent = true
			b.status()
			close(asked)
			continue
		}
		if !b.Audience.Present() {
			b.wasAbsent = true
			continue
		}
		b.status()
	}
}

// status has the topics told when they are due: the first look after nobody looked, a change on disk, or
// Refresh since the last time. Topics that could not be made stay due, and the backend's own topic does not
// say they were: a page that asked in the backend's first second is told with the next one, not after
// Refresh.
func (b *Bridge) status() {
	if b.Tell == nil {
		return
	}
	sig := signature(b.Watch)
	if !b.wasAbsent && sig == b.sig && time.Since(b.told) < Refresh {
		return
	}
	if !b.Tell() {
		return
	}
	b.sig, b.told, b.wasAbsent = sig, time.Now(), false
	// `at`: when the topics were last made, so a page that opens on documents kept from an hour ago
	// knows to wait for this instead of showing them
	b.Hub.Put("backend", map[string]any{"ok": true, "at": time.Now().Unix()})
}

// signature is the files' identity: a commit of the settings replaces the
// file (a new inode within the same second), a counter is rewritten in place.
func signature(paths []string) string {
	s := ""
	for _, p := range paths {
		st, err := os.Stat(p)
		if err != nil {
			s += "-;"
			continue
		}
		s += fmt.Sprintf("%d/%d/%d;", st.ModTime().UnixNano(), st.Size(), inode(st))
	}
	return s
}
