// Package roster makes the stream's topics from what the watcher knows (package view): the people and their
// devices, the servers, the router's own facts, the traffic, the places and the newest of the activity
// log. Publish puts them on the hub, whole; the hub tells the pages only what changed.
package roster

import (
	"encoding/json"
	"sort"

	"github.com/tickcount/luci-app-dawnline/backend/files"
	"github.com/tickcount/luci-app-dawnline/backend/hub"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/usage"
	"github.com/tickcount/luci-app-dawnline/backend/view"
)

// RecentKept is how many of the log's newest entries a status carries.
const RecentKept = 60

// Days is how long the router's daily series is.
const Days = 60

// Roster makes the topics.
type Roster struct {
	// World is the watcher's (nil until it has looked); Home the home networks a person reaches.
	World func() *view.World
	Home  func(srv *model.Server, p *model.Person) []string
	// DataDir holds what was handed out and who was set up again (issued.json, reconnect.json).
	DataDir string
	Hub     *hub.Hub
	Log     func(format string, args ...any)

	// RunDir holds the agent's last minutes of speed by person (rate_people.json), which a person's view carries.
	RunDir string
	// Own is the router's own addresses, which are no place people connect from.
	Own func(m *model.Model) map[string]bool
	// Iface is a netifd interface's state; Homes a server's home interfaces.
	Iface func(ifname string) (bool, int64)
	Homes func(srv *model.Server) []view.HomeNet
	// Handler tells whether netifd lists the amneziawg protocol; WAN is the router's WAN address.
	Handler func() bool
	WAN     func(m *model.Model) string
	// Recent is the newest entries of the activity log as a page is shown them (the watcher's).
	Recent func(n int) []map[string]any
	// Keyed makes a list of the status into the stream's keyed form (bridge.Split's own, so both write one shape).
	Keyed func(status map[string]any) map[string]any
}

// Publish puts Go's own people on the stream now: called the moment the watcher saw something change, so a
// page is told at once and ucode is not asked for it. False: nothing was put, because the watcher has no
// world yet (it has not read the settings); whoever needs the topics asks again.
func (r *Roster) Publish() bool {
	if r.Keyed == nil {
		return false
	}
	w := r.world()
	if w == nil {
		return false
	}
	var rates map[string]any
	files.ReadJSON(r.RunDir+"/rate_people.json", &rates)
	people := make([]view.Person, 0, len(w.M.People))
	for _, p := range w.M.People {
		people = append(people, w.PersonOf(p, true))
	}
	// as the status sorts them: who is online first, then who was seen last, then by name
	sort.SliceStable(people, func(i, j int) bool {
		a, b := people[i], people[j]
		if a.Online != b.Online {
			return a.Online > b.Online
		}
		if a.LastSeen != b.LastSeen {
			return a.LastSeen > b.LastSeen
		}
		return a.Name < b.Name
	})
	raw, _ := json.Marshal(people)
	var list []any
	json.Unmarshal(raw, &list)
	for _, p := range list {
		m := p.(map[string]any)
		m["rate"] = []any{}
		if rate, ok := rates[m["id"].(string)].([]any); ok && len(rate) > 0 {
			if _, isList := rate[0].([]any); isList {
				m["rate"] = rate
			}
		}
	}
	// the router's sums, its days (as long as the bridge asks ucode for) and its last 24 hours
	recs := make([]*usage.Record, 0, len(w.Usage.People))
	for _, rec := range w.Usage.People {
		recs = append(recs, rec)
	}
	traffic := map[string]any{"totals": w.TotalsOf(people), "series": view.Series(recs, Days, w.Now), "hours": view.LastHours(w.Usage.Hours, w.Now)}
	raw, _ = json.Marshal(traffic)
	var plain map[string]any
	json.Unmarshal(raw, &plain)
	plain["people"] = list
	// the services and the circles, in the order the settings list them
	var services, circles []any
	for _, id := range w.M.ServiceIDs() {
		services = append(services, w.M.Services[id])
	}
	for _, id := range w.M.CircleIDs() {
		circles = append(circles, w.M.Circles[id])
	}
	raw, _ = json.Marshal(map[string]any{"services": services, "circles": circles})
	var lists map[string]any
	json.Unmarshal(raw, &lists)
	for _, k := range []string{"services", "circles"} {
		if lists[k] == nil {
			lists[k] = []any{}
		}
		plain[k] = lists[k]
	}
	if r.Recent != nil {
		raw, _ = json.Marshal(r.Recent(RecentKept))
		var events any
		json.Unmarshal(raw, &events)
		plain["events"] = events
	}
	if r.Own != nil {
		raw, _ = json.Marshal(r.places(w))
		var geo any
		json.Unmarshal(raw, &geo)
		plain["geo"] = geo
	}
	owned := []string{"people", "traffic", "services", "circles", "recent", "places"}
	if r.Iface != nil && r.Own != nil {
		var rates map[string]any
		files.ReadJSON(r.RunDir+"/rate.json", &rates)
		router := r.router(w)
		var servers []any
		for _, id := range w.M.ServerIDs() {
			raw, _ := json.Marshal(w.ServerOf(w.M.Servers[id], Days, router))
			var sv map[string]any
			json.Unmarshal(raw, &sv)
			// why it is kept down, if it is (Owns: a reason Go can word), and its last minutes of speed (the agent's file)
			text, worded := blockedText(w.M.Servers[id])
			if !worded {
				// a reason kept in a shape nobody here knows: still said, in the plainest words
				text = w.M.Servers[id].Name + " is kept down."
			}
			sv["blocked"] = text
			sv["rate"] = []any{}
			if rate, ok := rates[id].([]any); ok {
				sv["rate"] = rate
			}
			servers = append(servers, sv)
		}
		if servers == nil {
			servers = []any{}
		}
		plain["servers"] = servers
		owned = append(owned, "servers")
	}
	if r.Iface != nil && r.Own != nil {
		// what could be told is told: a fact that could not be read is better missing than the whole router
		if facts, _ := r.routerOf(w.M, w.Now); true {
			raw, _ = json.Marshal(facts)
			var m map[string]any
			json.Unmarshal(raw, &m)
			tz := m["tz"]
			for k, v := range m {
				plain[k] = v
			}
			plain["now"], plain["tz"] = w.Now, tz
			owned = append(owned, "router", "clock")
		}
	}
	docs := r.Keyed(plain)
	for _, topic := range owned {
		if doc, ok := docs[topic]; ok {
			r.Hub.Put(topic, doc)
		}
	}
	return true
}

// router is what a server's view asks of the router, or nil when nobody answers for it.
func (r *Roster) router(w *view.World) *view.Router {
	if r.Own == nil || r.Iface == nil {
		return nil
	}
	return &view.Router{Own: r.Own(w.M), Iface: r.Iface, Homes: r.Homes}
}

// places is the map's data as Go makes it.
func (r *Roster) places(w *view.World) view.Places {
	var cache view.PlaceCache
	if !files.ReadJSON(r.RunDir+"/geo.json", &cache) {
		files.ReadJSON(r.DataDir+"/geo.json", &cache)
	}
	return w.PlacesOf(&cache, r.Own(w.M))
}

// world is the watcher's world with what the watcher does not hold.
func (r *Roster) world() *view.World {
	return Complete(r.World(), r.Home, r.DataDir)
}

// Complete gives the watcher's world what a view needs besides: the home networks a person reaches, what
// each device was last given and when each was set up again. nil stays nil.
func Complete(w *view.World, home func(srv *model.Server, p *model.Person) []string, dataDir string) *view.World {
	if w == nil {
		return nil
	}
	w.Home = home
	w.Issued = issued(dataDir + "/issued.json")
	files.ReadJSON(dataDir+"/reconnect.json", &w.Reconnect)
	return w
}

// issued reads issued.json as dawnline.awg issued() does: an entry is { fp, ts }, or from before
// timestamps were kept the fingerprint alone.
func issued(path string) map[string]view.Issued {
	var raw map[string]json.RawMessage
	files.ReadJSON(path, &raw)
	out := map[string]view.Issued{}
	for id, v := range raw {
		var fp string
		var e view.Issued
		if json.Unmarshal(v, &fp) == nil {
			if fp != "" {
				out[id] = view.Issued{FP: fp}
			}
		} else if json.Unmarshal(v, &e) == nil && e.FP != "" {
			if e.TS < 0 {
				e.TS = 0
			}
			out[id] = e
		}
	}
	return out
}
