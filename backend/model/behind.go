// The networks behind people's routers (site to site): a router that connects as a device may have a
// network of its own behind it, which the tunnel then carries both ways. The settings keep them on the
// device (`list behind_net`); what may be one and which of them are in effect is decided here, for the
// methods that take them and for everything that is made from them. Pure.

package model

import "github.com/tickcount/luci-app-dawnline/backend/ipnet"

const (
	// BehindMost is how many networks one router may have behind it.
	BehindMost = 8
	// BehindWidest is the shortest prefix one may have: a site's own network, never a whole private range.
	BehindWidest = 16
)

// Only private ranges stand behind a router: a public one would take that part of the internet away from
// everyone who reaches the network.
var behindRanges = []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"}

// BehindNet reads a network as one may stand behind a router: "a.b.c.d/len" inside a private range, from
// /16 to /30. It is told from its first address ("192.168.2.7/24" is 192.168.2.0/24). why is "" for one
// that will do, else what is wrong with it: "form" (no network written out), "wide" (wider than /16) or
// "public" (outside the private ranges).
func BehindNet(s string) (n ipnet.Net, why string) {
	n, ok := ipnet.Subnet(s)
	if !ok {
		return ipnet.Net{}, "form"
	}
	if n.Prefix < BehindWidest {
		return ipnet.Net{}, "wide"
	}
	for _, r := range behindRanges {
		if in, _ := ipnet.Any(r); in.Holds(n.Base) {
			return n, ""
		}
	}
	return ipnet.Net{}, "public"
}

// Clash is what a network behind a device runs into: Net is the other network, which is a server's own
// subnet (Server), one of the router's own networks (neither), or behind another device (Device).
type Clash struct {
	Net            string
	Server, Device string
}

// BehindClash is what a network behind a device shares addresses with, or nil: a tunnel's subnet, one of
// the router's own networks (own: nil when they are not known) or a network behind another device. Two
// ends of a tunnel with the same addresses reach neither.
func (m *Model) BehindClash(n ipnet.Net, device string, own []string) *Clash {
	for _, id := range m.serverIDs {
		if s, ok := ipnet.Subnet(m.Servers[id].Subnet); ok && s.Overlaps(n) {
			return &Clash{Net: s.String(), Server: id}
		}
	}
	for _, o := range own {
		if x, ok := ipnet.Any(o); ok && x.Prefix >= 1 && x.Overlaps(n) {
			return &Clash{Net: x.String()}
		}
	}
	for _, id := range m.deviceIDs {
		if id == device {
			continue
		}
		for _, o := range m.Devices[id].Behind {
			if x, why := BehindNet(o); why == "" && x.Overlaps(n) {
				return &Clash{Net: x.String(), Device: id}
			}
		}
	}
	return nil
}

// BehindOf is the networks behind each router that are in effect, by the device's id: what the tunnels'
// peers, the routes, the access rules and other devices' configurations are made from. Only a router has
// any. A line that is no such network, one over BehindMost, and one that shares addresses with a tunnel,
// with the router's own networks (own: nil when they are not known) or with a network already counted (an
// earlier device's in the settings' order, or an earlier one of its own) is left out: a bad line in the
// file never takes a route away from the router or from another site. What is asked for and not answered
// is in effect nowhere.
func (m *Model) BehindOf(own []string) map[string][]string {
	out := map[string][]string{}
	var counted []ipnet.Net
	for _, id := range m.deviceIDs {
		d := m.Devices[id]
		// a router that waits for the admin's answer is no device of the tunnel yet
		if d.Kind != "router" || d.Waiting {
			continue
		}
		for _, s := range d.Behind {
			n, why := BehindNet(s)
			if why != "" || len(out[id]) >= BehindMost {
				continue
			}
			taken := false
			for _, c := range counted {
				taken = taken || c.Overlaps(n)
			}
			if c := m.BehindClash(n, id, own); taken || (c != nil && c.Device == "") {
				continue
			}
			counted = append(counted, n)
			out[id] = append(out[id], n.String())
		}
	}
	return out
}

// HomeAccess tells whether a person is part of home: all of it or the networks picked for them, and the
// devices the server lets reach each other. Not someone held to a few home services.
func (p *Person) HomeAccess() bool {
	return p.Access == "both" || (p.Access == "lan" && len(p.Services) == 0)
}

// MeshGroup is whom a person's devices reach directly where the server keeps devices within circles: the
// person's circle on that server, else the person's own devices.
func (m *Model) MeshGroup(p *Person) string {
	if c := m.Circles[p.Circle]; c != nil && c.Server == p.Server {
		return "c:" + c.ID
	}
	return "p:" + p.ID
}

// BehindReach is the networks behind other routers that a person's device reaches through the tunnel, in
// the settings' order: those of the devices it reaches itself (everyone's on the server, or its circle's,
// where their owners are part of home too). behind is the networks in effect (BehindOf); device is the
// device's id, "" for a configuration that is nobody's yet.
func (m *Model) BehindReach(p *Person, device string, behind map[string][]string) []string {
	srv := m.Servers[p.Server]
	if srv == nil || srv.Mesh == "off" || !p.HomeAccess() {
		return nil
	}
	var out []string
	for _, id := range m.deviceIDs {
		q := m.People[m.Devices[id].Person]
		if id == device || len(behind[id]) == 0 || q == nil || q.Server != p.Server || !q.HomeAccess() {
			continue
		}
		if srv.Mesh == "circles" && m.MeshGroup(p) != m.MeshGroup(q) {
			continue
		}
		out = append(out, behind[id]...)
	}
	return out
}
