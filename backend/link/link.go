// Package link tells how each device's link behaves, from the counters read off its tunnel every second:
// a device that knocks but never finishes connecting, one whose configuration is in use on two devices,
// one whose traffic the router drops, one whose connection keeps breaking. It is dawnline.link in Go, rule
// for rule; testdata holds the two to each other on the same reads (scripts/ucode-golden.sh).
//
// One History per device: a few events of the last ten minutes, not an entry per second. Classify reads it
// (pure); a state is shown only once it held for Hold seconds (Settle). The same history tells the set-up
// sheet, at once and without the hold, what a device being set up does right now (SetupState).
//
// What the counters mean (kmod 3.1, receive.c and send.c):
//   - an accepted handshake initiation adds exactly Initiation bytes to the peer's rx. The router answers
//     it; its own handshake time moves only when the first packet under the new keys arrives.
//   - a keepalive adds Keepalive plus its content padding; a handshake response (the router initiated)
//     Response; data 32 plus its padded length. Plain data is a multiple of 16, so 148, 296 and 444 never
//     are data.
//   - a data packet the router then drops (its source is not the device's address: an old configuration
//     after renumbering) adds nothing to rx, but the router still answers it with a keepalive within
//     about 10 s.
package link

import (
	"strconv"
	"strings"

	"github.com/tickcount/luci-app-dawnline/backend/model"
)

const (
	// History is the seconds of events kept per device.
	HistorySpan = 600
	// Hold: a state is shown once it held this long (a flapping mobile link passes).
	Hold = 180
	// CheckEvery: a device is classified at least this often when nothing happened (its spans age).
	CheckEvery = 15

	// Initiation is the bytes an accepted initiation adds to rx.
	Initiation = 148
	// Response is the bytes a handshake response adds to rx (the router initiated).
	Response = 92
	// Keepalive is the bytes an empty data packet adds to rx, before content padding.
	Keepalive = 32
	// Random trailers without content padding: a keepalive grows up to a full packet.
	trailerMax = 1500
	// Initiations a device sends at most in one second (retries are 5 s apart).
	knocksPerTick = 3

	// trying: at least tryKnocks accepted initiations within trySpan seconds while not online.
	trySpan   = 120
	tryKnocks = 3
	// Churning: at least churnCount handshakes within churnSpan seconds, with churnCount-1 of the gaps
	// under churnGap seconds. A device that is there renews its keys every 100-120 s, more only when its
	// packets get nothing back.
	churnSpan  = 300
	churnCount = 4
	churnGap   = 45
	// shared: while churning, the endpoint went back to an earlier one this often.
	shareReturns = 2
	// dropped: online with a handshake within dropHS seconds, nothing but handshakes and keepalives
	// received for dropSpan seconds, and the router sent something at least dropAnswers times in that span
	// with nothing coming in, under dropTx bytes in all (a real download is far more).
	dropSpan    = 180
	dropHS      = 240
	dropAnswers = 6
	dropTx      = 65536

	// The set-up sheet's trying: at least setupKnocks accepted initiations within setupSpan seconds, none
	// of them followed by a handshake.
	setupSpan   = 20
	setupKnocks = 2
	// nodata: online for setupQuiet seconds since the handshake its session began with, nothing but
	// handshakes and keepalives in since, and the router answered at least once with nothing coming in.
	setupQuiet = 15

	// Per list, the newest entries kept (a device whose endpoint flips every second).
	keepEntries = 64
)

// The states a link can be shown in; "" is nothing wrong, or nothing to tell.
const (
	Trying   = "trying"
	Shared   = "shared"
	Dropped  = "dropped"
	Unstable = "unstable"
	// The set-up sheet's own.
	Flowing = "flowing"
	NoData  = "nodata"
)

// Read is a device's peer as its tunnel shows it at one look.
type Read struct {
	Endpoint  string
	Handshake int64
	Rx, Tx    int64
}

// Shown is a state and when it began.
type Shown struct {
	State string `json:"state"`
	Since int64  `json:"since"`
}

type move struct {
	at       int64
	to, from string
}

type answer struct {
	at, bytes int64
}

// History is what is kept of one device's link.
type History struct {
	start int64
	// The counters last read; counted is false before the first read and after the peer was gone.
	rx, tx  int64
	counted bool
	// The newest handshake, the endpoint (seen: one was read), and when rx last carried data.
	hs   int64
	ep   string
	seen bool
	data int64
	// Handshake times, endpoint changes, accepted initiations, and what the router sent with nothing received.
	shakes []int64
	moves  []move
	knocks []int64
	answer []answer

	// What is shown (State, "" for nothing), a state waiting for Hold, the last classification and when
	// it was made.
	State   string
	Since   int64
	pending *Shown
	// Raw is the last classification, before the hold.
	Raw     string
	checked int64

	// For the set-up sheet: online at the last read, the handshake its online stretch began with (0 while
	// away), what the sheet is told, and when that may change with time alone (0 for never).
	on    bool
	sess  int64
	Setup *Shown
	due   int64
}

// Fresh is a new, empty history for a device first seen at now.
func Fresh(now int64) *History { return &History{start: now} }

// Change is what Settle changed in what is shown; either may be "".
type Change struct {
	From, To string
}

// KeepaliveMax is the largest rx a keepalive adds for a server's disguise: Keepalive plus the top of its
// ContentPaddingAddition, or a full packet with random trailers and no content padding.
func KeepaliveMax(srv *model.Server) int64 {
	if srv == nil {
		return Keepalive
	}
	if cpa := srv.Obf["content_padding_addition"]; cpa != "" {
		parts := strings.Split(cpa, "-")
		if hi, err := strconv.ParseFloat(strings.TrimSpace(parts[len(parts)-1]), 64); err == nil && hi > 0 {
			return Keepalive + int64(hi)
		}
	}
	if t := srv.Obf["random_trailers"]; t == "on" || t == "1" {
		return Keepalive + trailerMax
	}
	return Keepalive
}

// knock tells an rx increment made of accepted initiations only.
func knock(drx int64) bool {
	return drx > 0 && drx%Initiation == 0 && drx <= knocksPerTick*Initiation
}

// bare tells an rx increment that carried no data: nothing, or one keepalive of up to ka bytes; in the
// second a handshake completed (shook) also the handshake messages that came with it. Outside that second
// a handshake message is never counted in: with a padded keepalive their sums would cover every small
// packet up to some 670 bytes, and a device with light traffic would look like one whose data never comes
// through.
func bare(drx, ka int64, shook bool) bool {
	if drx <= 0 {
		return true
	}
	if !shook {
		return drx >= Keepalive && drx <= ka
	}
	if drx > knocksPerTick*Initiation+Response+ka {
		return false
	}
	for k := int64(0); k <= knocksPerTick; k++ {
		for r := int64(0); r <= 1; r++ {
			rest := drx - k*Initiation - r*Response
			if rest == 0 || (rest >= Keepalive && rest <= ka) {
				return true
			}
		}
	}
	return false
}

func keep[T any](list []T, entry T) []T {
	list = append(list, entry)
	if len(list) > keepEntries {
		list = list[1:]
	}
	return list
}

// Observe folds one read of the device's peer into its history; ka is its KeepaliveMax. It returns true
// when something worth classifying again happened (a handshake, a new endpoint, a knock, an answer, data
// after a quiet span). Counters that went down (the peer added again, its tunnel set up again) start a new
// baseline.
func (h *History) Observe(p Read, now, ka int64) bool {
	changed := false
	shook := p.Handshake > h.hs
	if shook {
		h.shakes = keep(h.shakes, p.Handshake)
		h.hs = p.Handshake
		changed = true
	}
	if !h.seen || p.Endpoint != h.ep {
		if h.seen && p.Endpoint != "" {
			h.moves = keep(h.moves, move{at: now, to: p.Endpoint, from: h.ep})
			changed = true
		}
		h.ep, h.seen = p.Endpoint, true
	}
	if !h.counted || p.Rx < h.rx || p.Tx < h.tx {
		h.rx, h.tx, h.counted = p.Rx, p.Tx, true
		return changed
	}
	drx, dtx := p.Rx-h.rx, p.Tx-h.tx
	h.rx, h.tx = p.Rx, p.Tx
	switch {
	case drx > 0 && !shook && knock(drx):
		h.knocks = keep(h.knocks, now)
		changed = true
	case drx > 0 && !bare(drx, ka, shook):
		if now-h.data >= dropSpan {
			changed = true
		}
		h.data = now
	case drx <= 0 && dtx > 0:
		h.answer = keep(h.answer, answer{at: now, bytes: dtx})
		changed = true
	}
	return changed
}

// Gone: the device's peer is not in its tunnel; the next read starts a new baseline.
func (h *History) Gone() { h.counted = false }

// prune forgets events older than HistorySpan seconds.
func (h *History) prune(now int64) {
	cut := now - HistorySpan
	h.shakes = after(h.shakes, func(t int64) bool { return t > cut })
	h.knocks = after(h.knocks, func(t int64) bool { return t > cut })
	h.moves = after(h.moves, func(e move) bool { return e.at > cut })
	h.answer = after(h.answer, func(e answer) bool { return e.at > cut })
}

func after[T any](list []T, keep func(T) bool) []T {
	out := list[:0:0]
	for _, e := range list {
		if keep(e) {
			out = append(out, e)
		}
	}
	return out
}

// returns counts endpoint changes within the span that went back to an endpoint seen before in it
// (A → B → A → B: 2).
func (h *History) returns(now int64) int {
	var seen map[string]bool
	n := 0
	for _, e := range h.moves {
		if now-e.at >= churnSpan {
			continue
		}
		if seen == nil {
			seen = map[string]bool{e.from: true}
		}
		if seen[e.to] {
			n++
		}
		seen[e.to] = true
	}
	return n
}

func (h *History) churning(now int64) bool {
	var hs []int64
	for _, t := range h.shakes {
		if now-t < churnSpan {
			hs = append(hs, t)
		}
	}
	if len(hs) < churnCount {
		return false
	}
	short := 0
	for i := 1; i < len(hs); i++ {
		if hs[i]-hs[i-1] < churnGap {
			short++
		}
	}
	return short >= churnCount-1
}

func (h *History) dropped(now int64) bool {
	if now-h.start < dropSpan || now-h.data < dropSpan || !(h.hs > 0 && now-h.hs < dropHS) {
		return false
	}
	var n, bytes int64
	for _, a := range h.answer {
		if now-a.at < dropSpan {
			n++
			bytes += a.bytes
		}
	}
	return n >= dropAnswers && bytes < dropTx
}

// Classify is what the history says about the device at now (on: it is online, as presence decides it):
//
//	""        nothing wrong, or nothing to tell
//	trying    not online, but its initiations reach the router and are answered, and it never finishes
//	          connecting (the network may block it, or its configuration is out of date)
//	shared    connecting over and over from two or more alternating endpoints: one configuration on two devices
//	unstable  connecting over and over from one place: the connection keeps breaking
//	dropped   connected, but nothing it sends gets through: the router drops it (an old address in its
//	          configuration)
func (h *History) Classify(now int64, on bool) string {
	if !on {
		n := 0
		for _, t := range h.knocks {
			if now-t < trySpan {
				n++
			}
		}
		if n >= tryKnocks {
			return Trying
		}
		return ""
	}
	if h.churning(now) {
		if h.returns(now) >= shareReturns {
			return Shared
		}
		return Unstable
	}
	if h.dropped(now) {
		return Dropped
	}
	return ""
}

// Settle turns a classification into what is shown: a state, or a change of state, shows once Classify
// gave it for Hold seconds (Since: when it began); nothing wrong shows at once when the device is online
// (it works), else after Hold as well. It returns the change, or nil when what is shown stays.
func (h *History) Settle(raw string, now int64, on bool) *Change {
	if raw == h.State {
		h.pending = nil
		return nil
	}
	since := now
	if raw != "" || !on {
		if h.pending == nil || h.pending.State != raw {
			h.pending = &Shown{State: raw, Since: now}
			return nil
		}
		if now-h.pending.Since < Hold {
			return nil
		}
		since = h.pending.Since
	}
	c := &Change{From: h.State, To: raw}
	h.State = raw
	h.Since = 0
	if raw != "" {
		h.Since = since
	}
	h.pending = nil
	return c
}

// SetupState is what the device's link does at now for the set-up sheet (pure), and when that may change
// with time alone (0 for never: anything else comes with a read):
//
//	trying   its initiations reach the router and are answered, and no handshake follows
//	flowing  online, and data came in during this session
//	nodata   online for a while, nothing but handshakes and keepalives came in, and the router answered
//	         packets it dropped: an old address in the configuration
//	""       none of these (waiting, idle, or away)
func (h *History) SetupState(now int64, on bool) (state string, due int64) {
	n := 0
	for i := len(h.knocks) - 1; i >= 0; i-- {
		t := h.knocks[i]
		if t <= h.hs || now-t >= setupSpan {
			break
		}
		if n++; n == setupKnocks {
			return Trying, t + setupSpan
		}
	}
	if !on || h.sess == 0 {
		return "", 0
	}
	if h.data >= h.sess {
		return Flowing, 0
	}
	if now-h.sess < setupQuiet {
		return "", h.sess + setupQuiet
	}
	if len(h.answer) > 0 && h.answer[len(h.answer)-1].at >= h.sess {
		return NoData, 0
	}
	return "", 0
}

// setup brings Setup to SetupState after a read (moved: what Observe returned). Most reads cost a few
// compares: the state is worked out again only when something happened, the device came or went, data
// came in while it is not flowing, or its due time came. It returns true when Setup changed.
func (h *History) setup(now int64, on, moved bool) bool {
	// A session begins with the handshake that brought the device online.
	if !on {
		h.sess = 0
	} else if h.sess == 0 {
		h.sess = h.hs
	}
	came := on != h.on
	h.on = on
	cur := ""
	if h.Setup != nil {
		cur = h.Setup.State
	}
	if !moved && !came && !(h.due != 0 && now >= h.due) && !(h.data == now && cur != Flowing) {
		return false
	}
	state, due := h.SetupState(now, on)
	h.due = due
	if state == cur {
		return false
	}
	h.Setup = nil
	if state != "" {
		h.Setup = &Shown{State: state, Since: now}
	}
	return true
}

// Step is one look at the device: its read folded in (nil: its peer is not in its tunnel), the set-up
// state brought up to date, and, when something happened or CheckEvery passed, the link classified again
// and settled. It returns the change in what is shown (nil for none) and whether Setup changed.
func (h *History) Step(p *Read, now int64, on bool, ka int64) (change *Change, setupChanged bool) {
	moved := false
	if p != nil {
		moved = h.Observe(*p, now, ka)
	} else {
		h.Gone()
	}
	setupChanged = h.setup(now, on, moved)
	if !moved && now-h.checked < CheckEvery {
		return nil, setupChanged
	}
	h.checked = now
	h.prune(now)
	h.Raw = h.Classify(now, on)
	return h.Settle(h.Raw, now, on), setupChanged
}

// ShownOf is what is shown for every device, devices with nothing to show left out (link.json).
func ShownOf(hist map[string]*History) map[string]Shown {
	out := map[string]Shown{}
	for id, h := range hist {
		if h.State != "" {
			out[id] = Shown{State: h.State, Since: h.Since}
		}
	}
	return out
}

// SetupsOf is the set-up sheet's state of every device, devices with none left out (setup.json).
func SetupsOf(hist map[string]*History) map[string]Shown {
	out := map[string]Shown{}
	for id, h := range hist {
		if h.Setup != nil {
			out[id] = *h.Setup
		}
	}
	return out
}

// Event is what the activity log is told of a change: device_failing (the new state) when a state shows,
// device_recovered (the state it had) when it clears while the device is online. One that clears while the
// device is away (it stopped trying, it was paused) logs nothing: nobody saw it work. kind is "" for none.
func Event(c *Change, on bool) (kind, detail string) {
	switch {
	case c == nil:
		return "", ""
	case c.To != "":
		return "device_failing", c.To
	case on && c.From != "":
		return "device_recovered", c.From
	}
	return "", ""
}
