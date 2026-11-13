// Package watch is the watcher: every second it looks at the tunnels and, the moment a device connects,
// leaves, moves or its link fails in a named way, logs it, folds the counters and tells the pages. It is
// the agent's watcher (libexec/agent watch() and what its tick did for the counters) in Go, with the same
// outcome on disk, because the ucode that still runs reads it there:
//
//	presence.json  who is online, each device's last address, and the revisions pages and the portal follow
//	link.json      a device's link trouble once it held; setup.json what its link does right now
//	usage.json     the counters (tmpfs; flash hourly and on a stop)
//	meter.json     the live meter's points, while someone asked for them (meter.want)
//	events.json    the activity log, under the `events` lock
//	backend.beat   this watcher runs: the agent's own watcher stands by while it is fresh
//
// and as topics of the stream: `presence`, `link`, `meter`.
//
// What the agent keeps: its minute tick (access rules, the home path, the watchdog, backups, updates) and
// the places' lookups. It asks for a revision's move by writing presence.poke (the people it concerns),
// and is asked to locate the addresses that just connected by geo.poke.
//
// One goroutine does everything, one look after another.
package watch

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/awg"
	"github.com/tickcount/luci-app-dawnline/backend/files"
	"github.com/tickcount/luci-app-dawnline/backend/hub"
	"github.com/tickcount/luci-app-dawnline/backend/journal"
	"github.com/tickcount/luci-app-dawnline/backend/link"
	"github.com/tickcount/luci-app-dawnline/backend/meter"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/presence"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
	"github.com/tickcount/luci-app-dawnline/backend/usage"
	"github.com/tickcount/luci-app-dawnline/backend/view"
	"github.com/tickcount/luci-app-dawnline/backend/zone"
)

const (
	// The counters are folded this often when nothing happens, and put on flash this often (seconds).
	collectEvery = 60
	flushEvery   = 3600
	// The meter is written for this long after it was last asked for (dawnline.meter WANT_FOR).
	meterWantFor = 10
	// A link that keeps failing and coming back is one line of the log within this long.
	failingWindow = 3600
)

// Wants tells whether a page shows a topic now (api.Audience).
type Wants interface {
	Wants(topic string) bool
}

// Watcher is the router's watcher.
type Watcher struct {
	// Config is the settings file; RunDir and DataDir the state directories (tmpfs and flash); DHCP the router's
	// DHCP settings and Leases its leases, for the names of addresses at home.
	Config, RunDir, DataDir string
	DHCP, Leases            string
	// Zone is the file that holds the router's time zone (package zone); empty: the zone is left as it is.
	Zone     string
	Tunnels  awg.Reader
	Hub      *hub.Hub
	Audience Wants
	Log      func(format string, args ...any)
	// Changed is called when a look found something to tell (someone came, left or moved, a link's state).
	Changed func()
	// Now and Mono are the clocks (a test's own): the router's time, and seconds that only go forward.
	Now  func() time.Time
	Mono func() float64

	mu    sync.Mutex
	peers map[string]awg.Peer
	reads map[string]string
	m     *model.Model
	sig   string
	zone  string
	ka    map[string]int64
	pres  *presence.Watcher
	// The revision pages follow, and each person's.
	rev       int64
	personRev map[string]int64
	links     map[string]*link.History
	// Whether what link.json and setup.json show changed since they were written.
	linkDirty, setupDirty bool
	touched               map[string]bool
	failing               []journal.Event

	usage       *usage.Usage
	lastCollect int64
	lastFlush   int64

	prev     *meter.Sample
	ring     []meter.Point
	meterOut bool
	// meterTold: the stream has the points kept so far.
	meterTold bool
}

// World is what a view of people and devices is made from, as the watcher knows it at this moment
// (package view): the settings, the counters, the tunnels' last word, who is online and how their links do.
// What the watcher does not hold (what was handed out, the home networks) is the caller's to add. nil
// before the first look.
func (w *Watcher) World() *view.World {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.m == nil {
		return nil
	}
	online := map[string]bool{}
	for id, on := range w.pres.Online {
		online[id] = on
	}
	shown, setup := map[string]any{}, map[string]any{}
	for id, s := range link.ShownOf(w.links) {
		shown[id] = map[string]any{"state": s.State, "since": s.Since}
	}
	for id, s := range link.SetupsOf(w.links) {
		setup[id] = map[string]any{"state": s.State, "since": s.Since}
	}
	raw, _ := json.Marshal(w.usage)
	u := usage.Empty()
	json.Unmarshal(raw, u)
	return &view.World{M: w.m, Usage: u, Peers: w.peers, Reads: w.reads, Online: online, Link: shown, Setup: setup, Now: w.Now().Unix()}
}

// Run watches until ctx ends, then saves what it holds.
func (w *Watcher) Run(ctx context.Context) {
	w.Start()
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			w.Stop()
			return
		case <-tick.C:
			w.Look()
		}
	}
}

// Start takes up where the last watcher (this one's earlier run, or the agent's) left: who was online, the
// revisions, the counters. What a link showed comes from the watcher's memory, which starts empty: a state
// shows again once it held, a set-up state with the next read that tells it.
func (w *Watcher) Start() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.Now == nil {
		w.Now = time.Now
	}
	if w.Mono == nil {
		began := time.Now()
		w.Mono = func() float64 { return time.Since(began).Seconds() }
	}
	if w.Log == nil {
		w.Log = func(string, ...any) {}
	}
	os.MkdirAll(w.RunDir, 0o755)
	var kept struct {
		Online   map[string]bool   `json:"online"`
		Endpoint map[string]string `json:"endpoint"`
		Rev      int64             `json:"rev"`
		People   map[string]int64  `json:"people"`
	}
	files.ReadJSON(w.RunDir+"/presence.json", &kept)
	w.pres = presence.New(kept.Online, kept.Endpoint)
	w.rev, w.personRev = kept.Rev, kept.People
	if w.personRev == nil {
		w.personRev = map[string]int64{}
	}
	w.links = map[string]*link.History{}
	files.WriteJSON(w.RunDir+"/link.json", map[string]any{}, 0o600)
	files.WriteJSON(w.RunDir+"/setup.json", map[string]any{}, 0o600)
	os.Remove(w.RunDir + "/meter.json")
	w.usage = usage.Load(w.RunDir, w.DataDir, false)
	now := w.Now().Unix()
	w.lastCollect, w.lastFlush = now, now
}

// Stop saves the counters to flash and takes the meter's file and the beat away: a stopped watcher's
// points are no speed now, and the agent's watcher takes over at once.
func (w *Watcher) Stop() {
	now := w.Now().Unix()
	if w.m != nil {
		usage.Collect(w.m, w.usage, w.Tunnels.Dump(w.m.TunnelIfnames()), now)
	}
	if err := usage.Save(w.usage, w.RunDir, w.DataDir, true, now); err != nil {
		w.Log("watch: the counters were not saved: %v", err)
	}
	os.Remove(w.RunDir + "/meter.json")
	os.Remove(w.RunDir + "/backend.beat")
}

// timeZone takes the router's zone again when its file changed (the admin set another): the days and
// hours counted from then on are that zone's.
func (w *Watcher) timeZone() {
	if w.Zone == "" {
		return
	}
	sig := "-"
	if st, err := os.Stat(w.Zone); err == nil {
		sig = fmt.Sprintf("%d/%d", st.ModTime().UnixNano(), st.Size())
	}
	if sig == w.zone {
		return
	}
	w.zone = sig
	if zone.Load(w.Zone) {
		w.Log("watch: the router's time zone is %s", zone.Local())
	}
}

// load reads the settings again when their file, or which servers are kept down, changed.
func (w *Watcher) load() bool {
	sig := ""
	for _, p := range []string{w.Config, w.RunDir + "/netifd-blocked.json"} {
		if st, err := os.Stat(p); err == nil {
			sig += fmt.Sprintf("%d/%d;", st.ModTime().UnixNano(), st.Size())
		} else {
			sig += "-;"
		}
	}
	if w.m != nil && sig == w.sig {
		return true
	}
	text, err := os.ReadFile(w.Config)
	if err != nil {
		return w.m != nil
	}
	c, err := uci.Parse(string(text))
	if err != nil {
		w.Log("watch: the settings do not parse, the last ones stay: %v", err)
		return w.m != nil
	}
	var blocked map[string]any
	files.ReadJSON(w.RunDir+"/netifd-blocked.json", &blocked)
	w.m, w.sig = model.Load(c, blocked), sig
	// the largest keepalive each device's server makes (its disguise): what a bare packet may weigh
	w.ka = map[string]int64{}
	for _, id := range w.m.DeviceIDs() {
		var srv *model.Server
		if p := w.m.People[w.m.Devices[id].Person]; p != nil {
			srv = w.m.Servers[p.Server]
		}
		w.ka[id] = link.KeepaliveMax(srv)
	}
	return true
}

// Look is one look at the tunnels. Besides the watcher's own second, whoever tells the topics asks for one
// first; before Start there is nothing to look with, and it does nothing.
func (w *Watcher) Look() {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.pres == nil {
		return
	}
	now := w.Now().Unix()
	files.Write(w.RunDir+"/backend.beat", []byte(fmt.Sprint(now)), 0o644)
	w.timeZone()
	if !w.load() {
		return
	}
	m := w.m
	d := w.Tunnels.Dump(m.TunnelIfnames())
	w.peers, w.reads = d.Peers, d.Reads
	w.touched = map[string]bool{}
	w.failing = nil
	seen := w.pres.Look(m, d, now, func(id string, peer *awg.Peer, on, rekeyed bool) bool {
		return w.link(id, peer, now, on, rekeyed)
	})
	for id, h := range w.links {
		if m.Devices[id] == nil {
			w.linkDirty = w.linkDirty || h.State != ""
			w.setupDirty = w.setupDirty || h.Setup != nil
			delete(w.links, id)
		}
	}
	if w.linkDirty {
		files.WriteJSON(w.RunDir+"/link.json", link.ShownOf(w.links), 0o600)
	}
	// The portal's set-up sheet asks for it: no revision moves with it.
	if w.setupDirty {
		files.WriteJSON(w.RunDir+"/setup.json", link.SetupsOf(w.links), 0o600)
	}
	if w.linkDirty || w.setupDirty {
		w.Hub.Put("link", map[string]any{"shown": link.ShownOf(w.links), "setup": link.SetupsOf(w.links)})
		w.linkDirty, w.setupDirty = false, false
	}
	pol := journal.PolicyOf(m.Settings.Retention)
	log := journal.Log{Run: w.RunDir, Data: w.DataDir}
	for _, e := range w.failing {
		log.AddMerged(e, failingWindow, pol, journal.NamesOf(m), now)
	}
	w.meter(d, now)
	w.minute(d, now)

	people := seen.People
	for _, p := range w.poked() {
		w.touched[p] = true
	}
	for p := range w.touched {
		known := false
		for _, q := range people {
			known = known || q == p
		}
		if !known {
			people = append(people, p)
		}
	}
	if len(people) == 0 {
		return
	}
	w.save(people)
	if len(seen.Events) == 0 {
		return
	}
	usage.Collect(m, w.usage, d, now)
	usage.Save(w.usage, w.RunDir, w.DataDir, false, now)
	w.lastCollect = now
	names := w.homeNames()
	events := make([]journal.Event, 0, len(seen.Events))
	for _, e := range seen.Events {
		ev := journal.Event{"type": e.Type, "person": e.Person, "device": e.Device}
		if e.Detail != "" {
			ev["detail"] = e.Detail
		}
		// The event carries the place when the cache already knows it; a new address is located by the
		// agent within the minute, and its place goes onto this event then.
		if e.Type == presence.Connect {
			if where := w.place(e.Detail); where != "" {
				ev["where"] = where
			}
		}
		// Connections from home: the DHCP name of the address, as it is now.
		if e.Type != presence.Disconnect {
			if hosts := hostsIn(e.Detail, names); hosts != nil {
				ev["hosts"] = hosts
			}
		}
		events = append(events, ev)
	}
	if err := log.Add(events, pol, journal.NamesOf(m), now); err != nil {
		w.Log("watch: the activity log was not written: %v", err)
	}
	w.save(people)
	if m.Settings.GeoEnabled && len(seen.Addresses) > 0 {
		w.locate(seen.Addresses)
	}
}

// locate asks the agent to find the places of these addresses now (it keeps the lookups: they wait on the
// network in a child of its own). What an earlier look asked for and the agent has not taken yet is kept.
func (w *Watcher) locate(ips []string) {
	path := w.RunDir + "/geo.poke"
	var waiting []string
	files.ReadJSON(path, &waiting)
	for _, ip := range ips {
		known := false
		for _, q := range waiting {
			known = known || q == ip
		}
		if !known {
			waiting = append(waiting, ip)
		}
	}
	files.WriteJSON(path, waiting, 0o600)
}

// link keeps a device's link history through a look and tells whether its configuration is shared.
func (w *Watcher) link(id string, peer *awg.Peer, now int64, on, rekeyed bool) bool {
	dev := w.m.Devices[id]
	h := w.links[id]
	// New keys: a new link history. The old one's set-up session and its answers would otherwise be
	// taken for the new configuration's.
	if rekeyed && h != nil {
		if h.State != "" {
			w.linkDirty = true
			w.touched[dev.Person] = true
		}
		w.setupDirty = w.setupDirty || h.Setup != nil
		h = nil
	}
	if h == nil {
		h = link.Fresh(now)
		w.links[id] = h
	}
	var read *link.Read
	if peer != nil {
		read = &link.Read{Endpoint: peer.Endpoint, Handshake: peer.Handshake, Rx: peer.Rx, Tx: peer.Tx}
	}
	ka := w.ka[id]
	if ka == 0 {
		ka = link.Keepalive
	}
	change, setupChanged := h.Step(read, now, on, ka)
	w.setupDirty = w.setupDirty || setupChanged
	// What is shown changed: the person's pages read it again, also when it cleared without an event
	// (the device stopped trying, or was paused).
	if change != nil {
		w.linkDirty = true
		w.touched[dev.Person] = true
		if kind, detail := link.Event(change, on); kind != "" {
			w.failing = append(w.failing, journal.Event{"type": kind, "person": dev.Person, "device": id, "detail": detail})
		}
	}
	return h.Raw == link.Shared || h.State == link.Shared
}

// save moves the revisions (all, and these people's) and writes who is online.
func (w *Watcher) save(people []string) {
	w.rev++
	for _, p := range people {
		w.personRev[p] = w.rev
	}
	err := files.WriteJSON(w.RunDir+"/presence.json", map[string]any{
		"online": w.pres.Online, "endpoint": w.pres.Endpoint, "rev": w.rev, "people": w.personRev,
	}, 0o600)
	if err != nil {
		w.Log("watch: presence was not written: %v", err)
	}
	w.Hub.Put("presence", map[string]any{"online": w.pres.Online, "endpoint": w.pres.Endpoint})
	if w.Changed != nil {
		w.Changed()
	}
}

// poked reads and takes away the agent's word that something changed for these people (a state that moved
// on its own, a place that was found): their revisions move with this look.
func (w *Watcher) poked() []string {
	path := w.RunDir + "/presence.poke"
	var people []string
	if !files.ReadJSON(path, &people) {
		return nil
	}
	os.Remove(path)
	return people
}

// meter makes a point of this look and keeps it. The stream has the two minutes always, each new point as it
// is made: a page that starts looking has them in the answer that starts its look, so its line is drawn with
// the rest of the page and not a second later (the owner, 2026-11-12: the charts «появляются в разное время»).
// Only those who asked for the topic are told. The file (meter.json, for the page that asks the old way) is
// written while someone looks: all the points the first second of a look, then with each new one; once nobody
// does, it goes.
func (w *Watcher) meter(d awg.Dump, now int64) {
	s := meter.Take(w.m, d, w.Mono(), now)
	var p *meter.Point
	cut := false
	if w.prev != nil {
		if point, ok := meter.Between(*w.prev, s); ok {
			p = &point
			w.ring, cut = meter.Keep(w.ring, point)
		}
	}
	w.prev = &s
	points := w.ring
	if points == nil {
		points = []meter.Point{}
	}
	if w.meterTold && p != nil && !cut {
		w.Hub.Append("meter", meter.Points, *p)
	} else if p != nil || !w.meterTold {
		w.Hub.Put("meter", points)
	}
	w.meterTold = true
	wanted := w.Audience != nil && w.Audience.Wants("meter")
	if st, err := os.Stat(w.RunDir + "/meter.want"); err == nil {
		age := now - st.ModTime().Unix()
		wanted = wanted || (age < meterWantFor && -age < meterWantFor)
	}
	if !wanted {
		if w.meterOut {
			os.Remove(w.RunDir + "/meter.json")
		}
		w.meterOut = false
		return
	}
	if p == nil && w.meterOut {
		return
	}
	ts := int64(0)
	if n := len(w.ring); n > 0 {
		ts = w.ring[n-1].TS
	}
	files.WriteJSON(w.RunDir+"/meter.json", map[string]any{"ts": ts, "points": points}, 0o644)
	w.meterOut = true
}

// minute does what is due once a minute: a reset or a restore of the counters someone asked for, the
// counters folded and saved (to flash hourly, and at once after a reset).
func (w *Watcher) minute(d awg.Dump, now int64) {
	if now-w.lastCollect < collectEvery {
		return
	}
	w.lastCollect = now
	// A restore or an import put other counters on flash (dawnline.backup leaves a marker): start over
	// from them, whatever was written since.
	if _, err := os.Stat(w.RunDir + "/usage.reload"); err == nil {
		os.Remove(w.RunDir + "/usage.reload")
		w.usage = usage.Load(w.RunDir, w.DataDir, true)
	}
	reset := w.resets()
	usage.Collect(w.m, w.usage, d, now)
	persist := reset || now-w.lastFlush >= flushEvery
	if err := usage.Save(w.usage, w.RunDir, w.DataDir, persist, now); err != nil {
		w.Log("watch: the counters were not saved: %v", err)
	}
	if persist {
		w.lastFlush = now
	}
}

// ResetUsage forgets traffic history now (usage.Reset's scopes) and puts the counters on flash at once: the
// admin asked for it, and the pages show it without waiting for the minute. False before the first look.
func (w *Watcher) ResetUsage(scope, id string) bool {
	w.mu.Lock()
	if w.m == nil || w.usage == nil {
		w.mu.Unlock()
		return false
	}
	usage.Reset(w.usage, w.m, scope, id)
	now := w.Now().Unix()
	if err := usage.Save(w.usage, w.RunDir, w.DataDir, true, now); err != nil {
		w.Log("watch: the counters were not saved: %v", err)
	}
	w.lastFlush = now
	w.mu.Unlock()
	if w.Changed != nil {
		w.Changed()
	}
	return true
}

// resets applies the traffic history resets asked for from the admin (usage.reset: one, or a list).
func (w *Watcher) resets() bool {
	path := w.RunDir + "/usage.reset"
	raw, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	os.Remove(path)
	type request struct {
		Scope string `json:"scope"`
		ID    string `json:"id"`
	}
	var list []request
	if json.Unmarshal(raw, &list) != nil {
		var one request
		if json.Unmarshal(raw, &one) != nil {
			return false
		}
		list = []request{one}
	}
	for _, r := range list {
		usage.Reset(w.usage, w.m, r.Scope, r.ID)
	}
	return true
}

// place is "City · ISP" for an address the places' cache knows, else "".
func (w *Watcher) place(ip string) string {
	var cache struct {
		IPs map[string]struct {
			City string `json:"city"`
			Org  string `json:"org"`
			Fail any    `json:"fail"`
		} `json:"ips"`
	}
	if !files.ReadJSON(w.RunDir+"/geo.json", &cache) && !files.ReadJSON(w.DataDir+"/geo.json", &cache) {
		return ""
	}
	c, ok := cache.IPs[ip]
	if !ok || (c.Fail != nil && c.Fail != false && c.Fail != float64(0)) {
		return ""
	}
	var parts []string
	for _, x := range []string{c.City, c.Org} {
		if x != "" {
			parts = append(parts, x)
		}
	}
	return strings.Join(parts, " · ")
}

// homeNames is the names of addresses at home: the DHCP leases, then the hosts the admin named.
// Recent is the newest `n` entries of the activity log as a page is shown them: an older connection from
// home gets the DHCP name its address has now (rpc/status.uc with_hosts).
func (w *Watcher) Recent(n int) []map[string]any {
	var events []map[string]any
	if !files.ReadJSON(w.RunDir+"/events.json", &events) {
		files.ReadJSON(w.DataDir+"/events.json", &events)
	}
	if n > 0 && len(events) > n {
		events = events[len(events)-n:]
	}
	var names map[string]string
	for _, e := range events {
		t, _ := e["type"].(string)
		if _, has := e["hosts"]; has || (t != "connect" && t != "roam") {
			continue
		}
		if names == nil {
			names = w.homeNames()
		}
		detail, _ := e["detail"].(string)
		if h := hostsIn(detail, names); h != nil {
			e["hosts"] = h
		}
	}
	if events == nil {
		events = []map[string]any{}
	}
	return events
}

func (w *Watcher) homeNames() map[string]string {
	out := map[string]string{}
	if raw, err := os.ReadFile(w.Leases); err == nil {
		for _, line := range strings.Split(string(raw), "\n") {
			if f := strings.Split(line, " "); len(f) >= 4 && f[3] != "*" {
				out[f[2]] = f[3]
			}
		}
	}
	if raw, err := os.ReadFile(w.DHCP); err == nil {
		if c, err := uci.Parse(string(raw)); err == nil {
			for _, h := range c.OfType("host") {
				ip, _ := h.Get("ip")
				name, _ := h.Get("name")
				if ip != "" && name != "" {
					if _, leased := out[ip]; !leased {
						out[ip] = name
					}
				}
			}
		}
	}
	return out
}

var ipv4 = regexp.MustCompile(`[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+`)

// hostsIn is the addresses in an event's detail that belong to devices at home, with their names.
func hostsIn(detail string, names map[string]string) map[string]string {
	var out map[string]string
	for _, ip := range ipv4.FindAllString(detail, -1) {
		if name := names[ip]; name != "" {
			if out == nil {
				out = map[string]string{}
			}
			out[ip] = name
		}
	}
	return out
}
