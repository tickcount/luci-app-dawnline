// Package hub is the live state the backend shows its pages: named documents
// (topics) and the ordered stream of their changes.
//
// A producer puts a whole document; the hub works out what changed and
// publishes only that (a JSON Merge Patch), numbered. A page takes a snapshot
// once, then follows the stream; one that fell behind (a tab that slept, a
// connection that dropped) asks with the number it last saw and gets what it
// missed, or a new snapshot when that is no longer kept. Nothing is published
// for a document that did not change, so a producer may put as often as it
// likes.
//
// The hub knows no transport: api serves it over ubus, portal over HTTP. It
// owns no data of its own either: what a topic holds is its producer's.
package hub

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"sync"
)

// The operations of an event.
const (
	OpPut    = "put"    // data is the whole document
	OpPatch  = "patch"  // data is a merge patch to the document
	OpAppend = "append" // data is { items, keep }: new entries of a list, and how many it holds at most
	OpDrop   = "drop"   // the topic is gone
)

// Event is one change of one topic. Seq grows by one with every event of the
// hub, whatever its topic: a reader that sees a number skipped has missed one.
type Event struct {
	Seq   uint64 `json:"seq"`
	Topic string `json:"topic"`
	Op    string `json:"op"`
	Data  any    `json:"data,omitempty"`
}

// Answer is what a reader gets when it asks where the hub is: the documents
// (Docs, a snapshot) or the events since the number it gave (Events), and the
// number it is at after applying them. Epoch names this run of the hub: a
// number from another run means nothing.
type Answer struct {
	Epoch  string         `json:"epoch"`
	Seq    uint64         `json:"seq"`
	Docs   map[string]any `json:"docs,omitempty"`
	Events []Event        `json:"events,omitempty"`
}

// journalSize is how many events are kept for readers that fell behind. A
// reader further back gets a snapshot, which is always right, only larger.
const journalSize = 512

// Hub holds the documents and publishes their changes.
type Hub struct {
	mu      sync.Mutex
	epoch   string
	seq     uint64
	docs    map[string]any
	journal []Event
	wake    chan struct{}
	subs    map[*Sub]struct{}
}

// New makes an empty hub with an epoch of its own.
func New() *Hub {
	var b [6]byte
	rand.Read(b[:])
	return &Hub{
		epoch: hex.EncodeToString(b[:]),
		docs:  map[string]any{},
		wake:  make(chan struct{}),
		subs:  map[*Sub]struct{}{},
	}
}

// Epoch names this run of the hub.
func (h *Hub) Epoch() string { return h.epoch }

// Put sets a topic's document and publishes what changed in it, if anything.
// The value goes through encoding/json: a struct is published as its JSON.
func (h *Hub) Put(topic string, doc any) error {
	next, err := plain(doc)
	if err != nil {
		return err
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	prev, had := h.docs[topic]
	if !had {
		h.docs[topic] = next
		h.publish(Event{Topic: topic, Op: OpPut, Data: next})
		return nil
	}
	patch, changed := Diff(prev, next)
	if !changed {
		return nil
	}
	h.docs[topic] = next
	// Only an object can be patched; anything else is sent whole.
	if _, object := next.(map[string]any); object {
		if _, was := prev.(map[string]any); was {
			h.publish(Event{Topic: topic, Op: OpPatch, Data: patch})
			return nil
		}
	}
	h.publish(Event{Topic: topic, Op: OpPut, Data: next})
	return nil
}

// Append adds entries to a topic that is a list (a log, the points of a
// meter) and publishes them; the list keeps its newest `keep` entries.
func (h *Hub) Append(topic string, keep int, items ...any) error {
	if len(items) == 0 {
		return nil
	}
	added, err := plain(items)
	if err != nil {
		return err
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	old, _ := h.docs[topic].([]any)
	// A new slice every time: a snapshot handed out earlier is never written to.
	list := make([]any, 0, len(old)+len(items))
	list = append(append(list, old...), added.([]any)...)
	if keep > 0 && len(list) > keep {
		list = list[len(list)-keep:]
	}
	h.docs[topic] = list
	h.publish(Event{Topic: topic, Op: OpAppend, Data: map[string]any{"items": added, "keep": float64(keep)}})
	return nil
}

// Drop removes a topic and tells its readers.
func (h *Hub) Drop(topic string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, had := h.docs[topic]; !had {
		return
	}
	delete(h.docs, topic)
	h.publish(Event{Topic: topic, Op: OpDrop})
}

// publish numbers an event, keeps it and hands it to whoever follows. Called
// with the lock held.
func (h *Hub) publish(e Event) {
	h.seq++
	e.Seq = h.seq
	h.journal = append(h.journal, e)
	if len(h.journal) > journalSize {
		h.journal = append([]Event(nil), h.journal[len(h.journal)-journalSize:]...)
	}
	close(h.wake)
	h.wake = make(chan struct{})
	for s := range h.subs {
		select {
		case s.c <- e:
		default:
			// A follower that does not keep up is let go; it asks again with Sync.
			delete(h.subs, s)
			close(s.c)
		}
	}
}

// Sync answers a reader that is at (epoch, seq) and wants the topics `want`
// accepts (nil: all): the events it missed when they are still kept, a
// snapshot otherwise (another epoch, too far behind, or its first time: no epoch).
func (h *Hub) Sync(epoch string, seq uint64, want func(topic string) bool) Answer {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.sync(epoch, seq, want)
}

func (h *Hub) sync(epoch string, seq uint64, want func(string) bool) Answer {
	a := Answer{Epoch: h.epoch, Seq: h.seq}
	// A reader of this run that is not ahead of it, and whose next event is
	// still kept. Zero is a number like any other: a reader that took its
	// snapshot before anything was published follows from the first event.
	if epoch == h.epoch && seq <= h.seq && (seq == h.seq || (len(h.journal) > 0 && h.journal[0].Seq <= seq+1)) {
		a.Events = []Event{}
		for _, e := range h.journal {
			if e.Seq > seq && (want == nil || want(e.Topic)) {
				a.Events = append(a.Events, e)
			}
		}
		return a
	}
	a.Docs = make(map[string]any, len(h.docs))
	for topic, doc := range h.docs {
		if want == nil || want(topic) {
			a.Docs[topic] = doc
		}
	}
	return a
}

// Wait is Sync that does not answer "nothing new": it waits until there is an
// event the reader wants, or ctx ends (then the answer has no events, and the
// reader asks again). A reader that needs a snapshot gets it at once.
func (h *Hub) Wait(ctx context.Context, epoch string, seq uint64, want func(topic string) bool) Answer {
	for {
		h.mu.Lock()
		a := h.sync(epoch, seq, want)
		wake := h.wake
		h.mu.Unlock()
		if a.Docs != nil || len(a.Events) > 0 {
			return a
		}
		// Events of other topics moved the number: the reader is told, so its
		// next question is not answered from the start of the journal.
		seq = a.Seq
		select {
		case <-ctx.Done():
			return a
		case <-wake:
		}
	}
}

// Sub follows the hub: every event from the moment it subscribed, in order.
type Sub struct {
	h *Hub
	c chan Event
}

// Follow subscribes. The channel is closed when the follower did not keep up
// (its buffer of 256 events filled) or called Close.
func (h *Hub) Follow() *Sub {
	s := &Sub{h: h, c: make(chan Event, 256)}
	h.mu.Lock()
	h.subs[s] = struct{}{}
	h.mu.Unlock()
	return s
}

// Events is the follower's channel.
func (s *Sub) Events() <-chan Event { return s.c }

// Close ends the subscription.
func (s *Sub) Close() {
	s.h.mu.Lock()
	if _, on := s.h.subs[s]; on {
		delete(s.h.subs, s)
		close(s.c)
	}
	s.h.mu.Unlock()
}
