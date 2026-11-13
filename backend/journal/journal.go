// Package journal is the activity log: what happened to people and their devices (a connect, a leave, a
// move, a link's trouble, a change someone made), kept in events.json. It is the writing half of
// dawnline.live's events in Go, on the same file under the same lock: the ucode that still runs (rpcd's
// own changes, the page that reads and clears the log) shares it.
//
// An event is kept as the file has it (a JSON object: ts, type, person, device, detail, where, the names
// at the time), so one written by a newer or older version passes through unchanged.
//
// The log lives in tmpfs (<run>/events.json) and is copied to flash as often as Settings says; this
// package writes the tmpfs copy and makes the flash one when asked.
package journal

import (
	"os"
	"regexp"
	"strconv"
	"strings"

	"github.com/tickcount/luci-app-dawnline/backend/files"
	"github.com/tickcount/luci-app-dawnline/backend/model"
)

// Event is one line of the log.
type Event = map[string]any

// Categories are what Settings lets the admin switch off or clear.
var Categories = []string{"connections", "people", "problems"}

var category = map[string]string{
	"connect": "connections", "disconnect": "connections", "roam": "connections",
	// People and their devices: one category (devices used to have their own).
	"device_added": "people", "device_removed": "people",
	"device_changed": "people", "device_keys": "people", "link_changed": "people",
	"person_added": "people", "person_removed": "people", "person_changed": "people",
	"paused": "people", "resumed": "people", "expiring": "people",
	"quota_reached": "people", "quota_restored": "people",
	"server_down": "problems", "server_up": "problems", "portal_blocked": "problems",
	// A device's link: failing in a named way, and working again.
	"device_failing": "problems", "device_recovered": "problems",
}

// CategoryOf is an event type's category; what is not known is a problem.
func CategoryOf(kind string) string {
	if c, ok := category[kind]; ok {
		return c
	}
	return "problems"
}

// Policy is what the log keeps.
type Policy struct {
	// KeepDays of activity (0: until Max), Max events at most, the Categories that are recorded, and how
	// often the log is copied to flash: 10min | hourly | off.
	KeepDays   int
	Max        int
	Categories []string
	Persist    string
}

var (
	whole     = regexp.MustCompile(`^-?[0-9]{1,9}$`)
	listSplit = regexp.MustCompile(`[ ,]+`)
)

func ranged(v any, dflt, lo, hi int) int {
	s, _ := v.(string)
	s = strings.TrimSpace(s)
	if !whole.MatchString(s) {
		return dflt
	}
	n, _ := strconv.Atoi(s)
	if n < lo || n > hi {
		return dflt
	}
	return n
}

// PolicyOf reads the retention settings as dawnline.live policy() does.
func PolicyOf(r model.Retention) Policy {
	var cats []string
	switch c := r.LogCategory.(type) {
	case nil:
		cats = Categories
		// older settings: only whether connections are logged
		if r.LogConnections == "0" {
			cats = []string{"people", "problems"}
		}
	case []string:
		cats = c
	case string:
		cats = listSplit.Split(c, -1)
	}
	var kept []string
	seen := map[string]bool{}
	for _, c := range cats {
		if c == "devices" {
			c = "people"
		}
		known := false
		for _, k := range Categories {
			known = known || k == c
		}
		if known && !seen[c] {
			seen[c] = true
			kept = append(kept, c)
		}
	}
	persist := "hourly"
	if p, _ := r.LogPersist.(string); p == "10min" || p == "hourly" || p == "off" {
		persist = p
	}
	return Policy{KeepDays: ranged(r.LogKeepDays, 30, 0, 9999), Max: ranged(r.LogMax, 2000, 100, 20000), Categories: kept, Persist: persist}
}

func (p Policy) records(kind string) bool {
	c := CategoryOf(kind)
	for _, k := range p.Categories {
		if k == c {
			return true
		}
	}
	return false
}

func tsOf(e Event) float64 {
	t, _ := e["ts"].(float64)
	return t
}

// trim drops events older than KeepDays and beyond Max.
func trim(ev []Event, pol Policy, now int64) []Event {
	if pol.KeepDays > 0 {
		cut := float64(now - int64(pol.KeepDays)*86400)
		kept := ev[:0:0]
		for _, e := range ev {
			if tsOf(e) >= cut {
				kept = append(kept, e)
			}
		}
		ev = kept
	}
	if len(ev) > pol.Max {
		ev = ev[len(ev)-pol.Max:]
	}
	return ev
}

// Log is the activity log of one router: Run is its tmpfs directory, Data its flash one.
type Log struct {
	Run, Data string
}

func (l Log) live() string  { return l.Run + "/events.json" }
func (l Log) flash() string { return l.Data + "/events.json" }

// load is the log as it is now: the tmpfs copy, else what flash holds.
func (l Log) load() []Event {
	var ev []Event
	if files.ReadJSON(l.live(), &ev) {
		return ev
	}
	ev = nil
	files.ReadJSON(l.flash(), &ev)
	return ev
}

// Names gives the names an event carries, so the log still reads well once the person or the device is
// gone: a person's name, a device's name and kind, each "" when the settings have none.
type Names func(person, device string) (pname, dname, dkind string)

// NamesOf reads the names from the settings.
func NamesOf(m *model.Model) Names {
	return func(person, device string) (string, string, string) {
		var pname, dname, dkind string
		if p := m.People[person]; p != nil {
			pname = p.Name
		}
		if d := m.Devices[device]; d != nil {
			dname, dkind = d.Name, d.Kind
		}
		return pname, dname, dkind
	}
}

func named(e Event, names Names) Event {
	person, _ := e["person"].(string)
	device, _ := e["device"].(string)
	pname, dname, dkind := names(person, device)
	set := func(key, v string) {
		if _, has := e[key]; !has && v != "" {
			e[key] = v
		}
	}
	if person != "" {
		set("pname", pname)
	}
	if device != "" {
		set("dname", dname)
		set("dkind", dkind)
	}
	return e
}

// Add writes events at the log's end: those whose category is recorded, each with the moment (unless it
// brings its own) and the names as they are now.
func (l Log) Add(list []Event, pol Policy, names Names, now int64) error {
	var keep []Event
	for _, e := range list {
		if kind, _ := e["type"].(string); pol.records(kind) {
			keep = append(keep, e)
		}
	}
	if len(keep) == 0 {
		return nil
	}
	defer files.Lock(l.Run, "events")()
	ev := l.load()
	for _, e := range keep {
		if _, has := e["ts"]; !has {
			e["ts"] = float64(now)
		}
		ev = append(ev, named(e, names))
	}
	return files.WriteJSON(l.live(), trim(ev, pol, now), 0o600)
}

// AddMerged is Add for one event that folds into the log's last one when that is of the same kind, person
// and device and no older than `window` seconds: a link that keeps failing and coming back is one line.
func (l Log) AddMerged(e Event, window int64, pol Policy, names Names, now int64) error {
	kind, _ := e["type"].(string)
	if !pol.records(kind) {
		return nil
	}
	defer files.Lock(l.Run, "events")()
	ev := l.load()
	if n := len(ev); n > 0 {
		last := ev[n-1]
		if last["type"] == e["type"] && last["person"] == e["person"] && last["device"] == e["device"] && float64(now)-tsOf(last) < float64(window) {
			old, _ := last["detail"].(string)
			add, _ := e["detail"].(string)
			var parts []string
			seen := map[string]bool{}
			for _, p := range append(strings.Split(old, ", "), strings.Split(add, ", ")...) {
				if p != "" && !seen[p] {
					seen[p] = true
					parts = append(parts, p)
				}
			}
			last["detail"] = strings.Join(parts, ", ")
			last["ts"] = float64(now)
			return files.WriteJSON(l.live(), trim(ev, pol, now), 0o600)
		}
	}
	e["ts"] = float64(now)
	ev = append(ev, named(e, names))
	return files.WriteJSON(l.live(), trim(ev, pol, now), 0o600)
}

// Persist copies the log to flash, or drops the flash copy when it is kept in memory only. Only when
// something was logged since the last copy: flash is written rarely.
func (l Log) Persist(pol Policy, now int64) error {
	if pol.Persist == "off" {
		os.Remove(l.flash())
		return nil
	}
	live, err := os.Stat(l.live())
	if err != nil {
		return nil
	}
	if kept, err := os.Stat(l.flash()); err == nil && !live.ModTime().After(kept.ModTime()) {
		return nil
	}
	var ev []Event
	if !files.ReadJSON(l.live(), &ev) {
		return nil
	}
	os.MkdirAll(l.Data, 0o700)
	return files.WriteJSON(l.flash(), trim(ev, pol, now), 0o600)
}

// Filter says which events to remove: a person's, a device's, a category's, those older than Before (a
// moment, 0: any age). Every one given must match; none given matches everything.
type Filter struct {
	Person, Device, Category string
	Before                   int64
}

func (f Filter) hits(e Event) bool {
	person, _ := e["person"].(string)
	device, _ := e["device"].(string)
	kind, _ := e["type"].(string)
	return (f.Person == "" || person == f.Person) && (f.Device == "" || device == f.Device) &&
		(f.Category == "" || CategoryOf(kind) == f.Category) && (f.Before == 0 || tsOf(e) < float64(f.Before))
}

// Clear removes the events a filter matches from the live copy and the one on flash, and returns how many
// went (dawnline.live clear_events).
func (l Log) Clear(f Filter) int {
	defer files.Lock(l.Run, "events")()
	removed := 0
	for i, path := range []string{l.live(), l.flash()} {
		var ev []Event
		if !files.ReadJSON(path, &ev) {
			continue
		}
		keep := []Event{}
		for _, e := range ev {
			if !f.hits(e) {
				keep = append(keep, e)
			}
		}
		if n := len(ev) - len(keep); (i == 0 || removed == 0) && n > removed {
			removed = n
		}
		files.WriteJSON(path, keep, 0o600)
	}
	return removed
}

// Events about someone's connection, not about the system: they stay out of syslog (the activity log has them).
var notSystem = map[string]bool{"connect": true, "disconnect": true, "roam": true, "device_failing": true, "device_recovered": true}

// Level is an event's syslog level, or "" when it stays out of syslog (a connection: syslog says what the
// system does). People and their devices are info, problems warn and their end ("…_up") info.
func Level(e Event) string {
	kind, _ := e["type"].(string)
	cat := CategoryOf(kind)
	if cat == "connections" || notSystem[kind] {
		return ""
	}
	if cat == "problems" && !strings.HasSuffix(kind, "_up") {
		return "warn"
	}
	return "info"
}

// Line is an event as a syslog line: "Myata · Phone device changed · kind=phone, lan_bypass=on (portal)".
func Line(e Event) string {
	str := func(keys ...string) string {
		for _, k := range keys {
			if s, _ := e[k].(string); s != "" {
				return s
			}
		}
		return ""
	}
	var who []string
	for _, w := range []string{str("pname", "person"), str("dname", "device")} {
		if w != "" {
			who = append(who, w)
		}
	}
	kind := str("type")
	if kind == "" {
		kind = "event"
	}
	parts := []string{}
	if len(who) > 0 {
		parts = append(parts, strings.Join(who, " · "))
	}
	parts = append(parts, strings.ReplaceAll(kind, "_", " "))
	if d := str("detail"); d != "" {
		parts = append(parts, "· "+d)
	}
	if by := str("by"); by != "" {
		parts = append(parts, "("+by+")")
	}
	return strings.Join(parts, " ")
}

// Named is an event with the names it carries, as the log keeps it.
func Named(e Event, names Names) Event { return named(e, names) }

// SetPlaces gives a place to connections logged before their address was located (the lookup ends after
// the event): connect events since `since` from an address in where ("City · ISP" by address) that have
// none yet. Written only when something changed; whether it did.
func (l Log) SetPlaces(where map[string]string, since int64) bool {
	defer files.Lock(l.Run, "events")()
	ev := l.load()
	changed := false
	for i := len(ev) - 1; i >= 0 && tsOf(ev[i]) >= float64(since); i-- {
		e := ev[i]
		detail, _ := e["detail"].(string)
		if had, _ := e["where"].(string); e["type"] == "connect" && had == "" && where[detail] != "" {
			e["where"] = where[detail]
			changed = true
		}
	}
	if changed {
		os.MkdirAll(l.Run, 0o755)
		files.WriteJSON(l.live(), ev, 0o600)
	}
	return changed
}
