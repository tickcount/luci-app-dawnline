// Package presence tells who is online: from one look at the tunnels to the next, which devices connected,
// left or moved to another address. It is the agent's watcher (libexec/agent watch(), dawnline.live) in Go,
// rule for rule.
//
// Online means the device's WireGuard session lives: a handshake within its online window
// (model.OnlineWindowOf). Traffic silence is no signal; a phone asleep is silent too.
//
// A Watcher holds what it saw last; Look is pure given that: the settings, a look at the tunnels and the
// clock go in, the events and who they concern come out. Whoever runs it publishes them.
package presence

import (
	"regexp"

	"github.com/tickcount/luci-app-dawnline/backend/awg"
	"github.com/tickcount/luci-app-dawnline/backend/model"
)

// The events of a look.
const (
	Connect    = "connect"
	Disconnect = "disconnect"
	Roam       = "roam"
)

// RestartGrace is how long a device missing from a tunnel that was just set up again keeps what was known
// of it (seconds). netifd deletes and adds a tunnel's link each time it sets it up: the devices come back
// only with the sync its hotplug starts, and then with no handshake until each makes a new one. Without
// the grace, that is a burst of disconnects and connects for everyone online.
const RestartGrace = 45

// Event is a device connecting, leaving or moving.
type Event struct {
	Type   string `json:"type"`
	Person string `json:"person"`
	Device string `json:"device"`
	// Detail is the address it connected from, or "old → new" for a move.
	Detail string `json:"detail,omitempty"`
}

// Watcher is who was online at the last look.
type Watcher struct {
	// Online and Endpoint are what a page is shown: a device's state and the address it last spoke from.
	Online   map[string]bool
	Endpoint map[string]string

	// Per device: its latest real handshake, kept when the tunnel adds the peer again (its counters and
	// handshake restart from zero), and the key it was seen with (new keys end the old session, whatever
	// its handshake said).
	handshake map[string]int64
	key       map[string]string
	// Per tunnel: the link last seen (0 while it is down), and until when its grace lasts.
	link  map[string]int
	grace map[string]int64
}

// New starts from what was kept of the last run (nil for nothing), so a restart does not swallow the
// connects that happened in between.
func New(online map[string]bool, endpoint map[string]string) *Watcher {
	w := &Watcher{Online: map[string]bool{}, Endpoint: map[string]string{},
		handshake: map[string]int64{}, key: map[string]string{}, link: map[string]int{}, grace: map[string]int64{}}
	for k, v := range online {
		w.Online[k] = v
	}
	for k, v := range endpoint {
		w.Endpoint[k] = v
	}
	return w
}

// Seen is what a look found.
type Seen struct {
	Events []Event
	// People are those whose pages changed (someone's device came, went or moved), in the order found.
	People []string
	// Addresses are those to locate: a connect's and a move's new one.
	Addresses []string
	// Rekeyed are the devices whose key changed since the last look: what was known of their link is void.
	Rekeyed []string
}

// Link is called for every device of a look, once it is known whether the device is online and before
// anything is concluded from its address: with its peer (nil when it is not in its tunnel) and whether its
// key changed since the last look. It is where the link's history is kept (package link); it returns true
// for a device whose address goes back and forth all the time (one configuration on two devices): that is
// no roaming, nor a reason to tell anyone.
type Link func(device string, peer *awg.Peer, online, rekeyed bool) (shared bool)

// Look takes one look at the tunnels (link may be nil). A tunnel that could not be read says nothing about
// its devices, which stay as they were.
func (w *Watcher) Look(m *model.Model, d awg.Dump, now int64, link Link) Seen {
	var s Seen
	told := map[string]bool{}
	tell := func(person string) {
		if !told[person] {
			told[person] = true
			s.People = append(s.People, person)
		}
	}
	for ifname, read := range d.Reads {
		if read == awg.Failed {
			continue
		}
		index := 0
		if ifc, ok := d.Ifaces[ifname]; ok {
			index = ifc.Ifindex
		}
		if was, seen := w.link[ifname]; seen && was != index {
			w.grace[ifname] = now + RestartGrace
		}
		w.link[ifname] = index
	}
	for ifname := range w.link {
		if _, asked := d.Reads[ifname]; !asked {
			delete(w.link, ifname)
			delete(w.grace, ifname)
		}
	}
	for _, id := range m.DeviceIDs() {
		dev := m.Devices[id]
		var srv *model.Server
		ifname := ""
		if p := m.People[dev.Person]; p != nil {
			if srv = m.Servers[p.Server]; srv != nil {
				ifname = srv.Ifname
			}
		}
		if d.Reads[ifname] == awg.Failed {
			continue
		}
		// New keys: offline until they shake hands.
		rekeyed := false
		if was, known := w.key[id]; !known || was != dev.PublicKey {
			if known {
				w.handshake[id] = 0
				s.Rekeyed = append(s.Rekeyed, id)
				rekeyed = true
			}
			w.key[id] = dev.PublicKey
		}
		endpoint := ""
		peer, there := d.Peers[dev.PublicKey]
		if there {
			w.handshake[id] = max(w.handshake[id], peer.Handshake)
			endpoint = EndpointIP(peer.Endpoint)
		} else if !(w.grace[ifname] > now) {
			// Not in the tunnel (turned off, paused, out of time or data): offline now, and online again
			// only with a new handshake, not the one remembered from before. Unless its tunnel was just
			// set up again and the sync has not brought it back yet.
			w.handshake[id] = 0
		}
		on := w.handshake[id] > 0 && now-w.handshake[id] < int64(model.OnlineWindowOf(srv, dev))
		was := w.Online[id]
		last := w.Endpoint[id]
		shared := false
		if link != nil {
			var p *awg.Peer
			if there {
				p = &peer
			}
			shared = link(id, p, on, rekeyed)
		}
		switch {
		case on && !was:
			s.Events = append(s.Events, Event{Type: Connect, Person: dev.Person, Device: id, Detail: endpoint})
			s.Addresses = append(s.Addresses, endpoint)
		case !on && was:
			s.Events = append(s.Events, Event{Type: Disconnect, Person: dev.Person, Device: id})
		case on && endpoint != "" && last != "" && endpoint != last && !shared:
			s.Events = append(s.Events, Event{Type: Roam, Person: dev.Person, Device: id, Detail: last + " → " + endpoint})
			s.Addresses = append(s.Addresses, endpoint)
		}
		if on != was || (endpoint != "" && endpoint != last && !shared) {
			tell(dev.Person)
		}
		w.Online[id] = on
		if endpoint != "" {
			w.Endpoint[id] = endpoint
		}
	}
	for id := range w.Online {
		if m.Devices[id] == nil {
			delete(w.Online, id)
			delete(w.Endpoint, id)
			delete(w.handshake, id)
			delete(w.key, id)
		}
	}
	return s
}

// "203.0.113.7:41821", "[2001:db8::1]:41821".
var endpoint = regexp.MustCompile(`^\[?([^\]]+)\]?:[0-9]+$`)

// EndpointIP is the address of an endpoint, without its port.
func EndpointIP(ep string) string {
	if g := endpoint.FindStringSubmatch(ep); g != nil {
		return g[1]
	}
	return ep
}
