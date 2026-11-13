package portal

import (
	"context"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/files"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
)

// What rang.
type What int

const (
	// Changed: something the page shows changed (a device came or went, the admin changed something).
	Changed What = iota
	// Counters: only the traffic counters moved, as they do every minute.
	Counters
)

// Sub is one stream's ear.
type Sub struct {
	C      chan What
	person string
}

func (s *Sub) drain() {
	for {
		select {
		case <-s.C:
		default:
			return
		}
	}
}

// Bell tells the streams that something changed for their person.
type Bell struct {
	mu   sync.Mutex
	subs map[*Sub]struct{}
}

// Listen gives an ear for one person's changes.
func (b *Bell) Listen(person string) *Sub {
	s := &Sub{C: make(chan What, 4), person: person}
	b.mu.Lock()
	if b.subs == nil {
		b.subs = map[*Sub]struct{}{}
	}
	b.subs[s] = struct{}{}
	b.mu.Unlock()
	return s
}

// Forget takes an ear away.
func (b *Bell) Forget(s *Sub) {
	b.mu.Lock()
	delete(b.subs, s)
	b.mu.Unlock()
}

// Ring tells a person's streams (everyone's for ""). A stream that has not heard its last rings yet
// misses nothing: it asks for the whole state when it does.
func (b *Bell) Ring(person string, what What) {
	b.mu.Lock()
	for s := range b.subs {
		if person == "" || s.person == person {
			select {
			case s.C <- what:
			default:
			}
		}
	}
	b.mu.Unlock()
}

// Heard tells whether anyone listens.
func (b *Bell) Heard() bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	return len(b.subs) > 0
}

// Watch rings the bell from the files the state is made of, looked at every second while someone listens:
// presence.json holds each person's revision (it moves with their devices' connections, their links'
// trouble and what the agent tells of them); the settings, the configurations handed out and a set-up's
// state concern whoever they show for; the counters move for everyone.
func Watch(ctx context.Context, b *Bell, run, data, config string) {
	sig := func(path string) string {
		st, err := os.Stat(path)
		if err != nil {
			return "-"
		}
		return fmt.Sprintf("%d/%d", st.ModTime().UnixNano(), st.Size())
	}
	everyone := []string{config, data + "/issued.json", run + "/setup.json", run + "/link.json", run + "/netifd-blocked.json"}
	last := map[string]string{}
	revs := map[string]int64{}
	idle := true
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
		}
		if !b.Heard() {
			idle = true
			continue
		}
		// what changed while nobody listened is no news: a stream opens on the whole state
		quiet := idle
		idle = false
		all := false
		for _, p := range everyone {
			if s := sig(p); s != last[p] {
				last[p] = s
				all = true
			}
		}
		presence := run + "/presence.json"
		if s := sig(presence); s != last[presence] {
			last[presence] = s
			var kept struct {
				People map[string]int64 `json:"people"`
			}
			files.ReadJSON(presence, &kept)
			for id, rev := range kept.People {
				if revs[id] != rev && !quiet && !all {
					b.Ring(id, Changed)
				}
			}
			revs = kept.People
			if revs == nil {
				revs = map[string]int64{}
			}
		}
		usage := run + "/usage.json"
		counters := false
		if s := sig(usage); s != last[usage] {
			last[usage] = s
			counters = true
		}
		if quiet {
			continue
		}
		if all {
			b.Ring("", Changed)
		} else if counters {
			b.Ring("", Counters)
		}
	}
}

// Settings reads the settings file for the server, again when it changed.
type Settings struct {
	Path string

	mu       sync.Mutex
	sig      string
	codes    map[string]string
	redirect string
}

func (s *Settings) load() {
	sig := "-"
	if st, err := os.Stat(s.Path); err == nil {
		sig = fmt.Sprintf("%d/%d", st.ModTime().UnixNano(), st.Size())
	}
	if sig == s.sig && s.codes != nil {
		return
	}
	text, err := os.ReadFile(s.Path)
	if err != nil {
		return
	}
	c, err := uci.Parse(string(text))
	if err != nil {
		return
	}
	m := model.Load(c, nil)
	s.codes = map[string]string{}
	for id, p := range m.People {
		if p.Code != "" {
			s.codes[p.Code] = id
		}
	}
	s.redirect, s.sig = m.Settings.PortalRedirect, sig
}

// PersonByCode is the id of the person a code is the link of, or "".
func (s *Settings) PersonByCode(code string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.load()
	return s.codes[code]
}

// Redirect is where a path that is no link is sent.
func (s *Settings) Redirect() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.load()
	return s.redirect
}
