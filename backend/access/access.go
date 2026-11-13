// Package access is "Check access": it walks the same rules the access table and a device's configuration
// apply, and says in words where a connection stops, each step a whole sentence in the reader's language
// (dawnline.access). Held to ucode's own output on a made-up household (testdata, scripts/ucode-golden.sh).
package access

import (
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/tickcount/luci-app-dawnline/backend/awg"
	"github.com/tickcount/luci-app-dawnline/backend/handout"
	"github.com/tickcount/luci-app-dawnline/backend/i18n"
	"github.com/tickcount/luci-app-dawnline/backend/ipnet"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/netview"
)

// Step is one step of the walk.
type Step struct {
	OK     bool   `json:"ok"`
	Title  string `json:"title"`
	Detail string `json:"detail"`
}

// Ctx is what the walk reads besides the settings: each person's state, the tunnels' peers, who is online
// and the router's interfaces.
type Ctx struct {
	States map[string]string
	Peers  map[string]awg.Peer
	Online func(d *model.Device, peer awg.Peer) bool
	Snap   *netview.Snapshot
	T      *i18n.Catalog
}

// Said is a refusal to check at all, as a sentence to translate and what goes into it.
type Said struct {
	Msg  string
	Args []any
}

func (s Said) Error() string { return fmt.Sprintf(s.Msg, s.Args...) }

type walk struct {
	Ctx
	m *model.Model
}

func (w *walk) f(msg string, args ...any) string { return fmt.Sprintf(w.T.T(msg), args...) }

// inNets is the first of nets that holds ip, or "".
func inNets(ip string, nets []string) string {
	n, ok := ipnet.IP(ip)
	if !ok {
		return ""
	}
	for _, s := range nets {
		if c, ok := ipnet.Any(s); ok && c.Holds(n) {
			return s
		}
	}
	return ""
}

func (w *walk) cantConnect(name, st string) string {
	switch st {
	case "no_server":
		return w.f("%s can't connect: they have no server", name)
	case "server_off":
		return w.f("%s can't connect: their server is turned off", name)
	case "paused":
		return w.f("%s can't connect: they are paused", name)
	case "expired":
		return w.f("%s can't connect: their access has ended", name)
	case "quota":
		return w.f("%s can't connect: they used up their data", name)
	}
	return w.f("%s can't connect: %s", name, st)
}

func (w *walk) cantReach(who string, disabled bool, st string) string {
	switch {
	case disabled:
		return w.f("%s can't be reached: it is turned off", who)
	case st == "no_server":
		return w.f("%s can't be reached: they have no server", who)
	case st == "server_off":
		return w.f("%s can't be reached: their server is turned off", who)
	case st == "paused":
		return w.f("%s can't be reached: they are paused", who)
	case st == "expired":
		return w.f("%s can't be reached: their access has ended", who)
	case st == "quota":
		return w.f("%s can't be reached: they used up their data", who)
	}
	return w.f("%s can't be reached: %s", who, st)
}

func (w *walk) accessText(a string) string {
	switch a {
	case "lan":
		return w.T.T("Home only")
	case "internet":
		return w.T.T("Internet only")
	case "both":
		return w.T.T("Home and Internet")
	}
	return a
}

func (w *walk) hasAccess(name, a string) string {
	switch a {
	case "lan":
		return w.f("%s has Home only", name)
	case "internet":
		return w.f("%s has Internet only", name)
	}
	return w.f("%s has Home and Internet", name)
}

func (w *walk) reaches(name string, devs []string) string {
	if len(devs) > 0 {
		return w.f("%s reaches %s.", name, strings.Join(devs, ", "))
	}
	return w.f("%s reaches no home network.", name)
}

// tunnelOf is a server's tunnel network when it runs one of Dawnline's own, else "".
func tunnelOf(srv *model.Server) string {
	if srv == nil || srv.PrivateKey == "" || srv.Blocked != nil || !model.ValidIfname(srv.Ifname) {
		return ""
	}
	if _, ok := ipnet.Subnet(srv.Subnet); !ok {
		return ""
	}
	return srv.Subnet
}

// inTunnels is the tunnel network (of any server) that holds ip: never home, whatever routes cover it.
func (w *walk) inTunnels(ip string) string {
	var nets []string
	for _, id := range w.m.ServerIDs() {
		if t := tunnelOf(w.m.Servers[id]); t != "" {
			nets = append(nets, t)
		}
	}
	return inNets(ip, nets)
}

type target struct {
	dev  *model.Device
	ip   string
	port int // 0: none
	// net: the address is a host in this network behind dev (a router): the rules see it as they see the router
	net string
}

var address = regexp.MustCompile(`^([0-9.]+)(:([0-9]{1,5}))?$`)

// parse reads "10.0.1.20:445" or a device id.
func (w *walk) parse(s string) (target, bool) {
	s = strings.Trim(s, " \t\r\n\v\f")
	if d := w.m.Devices[s]; d != nil {
		return target{dev: d, ip: d.Address}, true
	}
	mm := address.FindStringSubmatch(s)
	if mm == nil {
		return target{}, false
	}
	if _, ok := ipnet.IP(mm[1]); !ok {
		return target{}, false
	}
	t := target{ip: mm[1]}
	if mm[3] != "" {
		t.port, _ = strconv.Atoi(mm[3])
	}
	for _, id := range w.m.DeviceIDs() {
		if d := w.m.Devices[id]; d.Address == t.ip {
			t.dev = d
			break
		}
	}
	// a host behind someone's router: the networks in effect on this router, as the access table has them
	if t.dev == nil {
		behind := w.Snap.Behind(w.m)
		for _, id := range w.m.DeviceIDs() {
			if n := inNets(t.ip, behind[id]); n != "" {
				t.dev, t.net = w.m.Devices[id], n
				break
			}
		}
	}
	return t, true
}

// behindStep says that an address is a host behind a router, which the rest of the walk is then about.
func (w *walk) behindStep(t target) Step {
	who := t.dev.Name
	if p := w.m.People[t.dev.Person]; p != nil {
		who = p.Name + " · " + t.dev.Name
	}
	return Step{true, w.f("%s is behind %s", t.ip, who), w.f("%s: the tunnel carries this network, and the rules see a host there as they see the router.", t.net)}
}

// personHome is the home networks a person reaches: all of the server's, or the interfaces ticked on their page.
func (w *walk) personHome(srv *model.Server, p *model.Person) (all bool, nets, devs []string) {
	_, home, every, _ := w.Snap.ServerNet(srv)
	if len(p.HomeNets) == 0 {
		for _, h := range home {
			devs = append(devs, h.Dev)
		}
		return true, every, devs
	}
	var picked []string
	for _, h := range home {
		for _, want := range p.HomeNets {
			if want == h.Dev {
				picked = append(picked, h.Nets...)
				devs = append(devs, h.Dev)
				break
			}
		}
	}
	return false, ipnet.Collapse(picked), devs
}

// homeDevOf is the home network (interface) of a server that holds an address.
func (w *walk) homeDevOf(srv *model.Server, ip string) string {
	_, home, _, _ := w.Snap.ServerNet(srv)
	for _, h := range home {
		if inNets(ip, h.Nets) != "" {
			return h.Dev
		}
	}
	return ""
}

func (w *walk) routerHas(ip string) bool {
	for _, d := range w.Snap.Devices {
		for _, a := range d.Addrs {
			if strings.SplitN(a, "/", 2)[0] == ip {
				return true
			}
		}
	}
	return false
}

func (w *walk) state(p *model.Person) string {
	if st := w.States[p.ID]; st != "" {
		return st
	}
	return "active"
}

func (w *walk) personOK(p *model.Person, d *model.Device) Step {
	if d.Disabled {
		return Step{false, w.f("%s is turned off", d.Name), w.T.T("Turn the device on again on its page.")}
	}
	if st := w.state(p); st != "active" {
		return Step{false, w.cantConnect(p.Name, st), ""}
	}
	return Step{true, w.f("%s is active", p.Name), w.accessText(p.Access)}
}

func (w *walk) connected(d *model.Device, who string) Step {
	peer, has := w.Peers[d.PublicKey]
	if !has || peer.Handshake <= 0 {
		return Step{false, w.f("%s has never connected", who), w.T.T("There is no session the router could reach.")}
	}
	if w.Online == nil || !w.Online(d, peer) {
		return Step{false, w.f("%s isn't connected right now", who), w.T.T("The router reaches it only while its VPN is on.")}
	}
	return Step{true, w.f("%s is connected", who), ""}
}

func (w *walk) circle(p *model.Person) *model.Circle {
	if c := w.m.Circles[p.Circle]; c != nil && c.Server == p.Server {
		return c
	}
	return nil
}

// fromDevice: a device to somewhere, the router, home, another device or the internet.
func (w *walk) fromDevice(d *model.Device, t target) []Step {
	m, T := w.m, w.T
	p := m.People[d.Person]
	var srv *model.Server
	if p != nil {
		srv = m.Servers[p.Server]
	}
	if p == nil || srv == nil {
		return []Step{{false, w.f("%s has no server", d.Name), ""}}
	}
	steps := []Step{w.personOK(p, d)}
	if !steps[0].OK {
		return steps
	}
	all, homeNets, homeDevs := w.personHome(srv, p)
	allowed := handout.AllowedIPs(m, srv, p, d, homeNets)
	via := func(ip string) Step {
		// the configuration's own words: the option and its value
		var v4 []string
		for _, x := range allowed {
			if !strings.Contains(x, ":") {
				v4 = append(v4, x)
			}
		}
		what := "AllowedIPs " + strings.Join(v4, ", ")
		if inNets(ip, allowed) != "" {
			return Step{true, T.T("Its configuration sends it to the router"), what}
		}
		return Step{false, T.T("Its configuration doesn't send it to the router"), w.f("%s: the device's own network handles it.", what)}
	}
	// another device
	if t.dev != nil {
		q := m.People[t.dev.Person]
		qname := "?"
		if q != nil {
			qname = q.Name
		}
		who := qname + " · " + t.dev.Name
		if t.dev.ID == d.ID {
			// its own network: a router reaches what is behind it without the tunnel
			if t.net != "" {
				return []Step{{false, w.f("%s is behind this device", t.ip), T.T("A router reaches its own network without the tunnel.")}}
			}
			return []Step{{false, T.T("That is the same device"), ""}}
		}
		if q == nil || q.Server != p.Server {
			return append(steps, Step{false, w.f("%s is on another server", who), T.T("Devices of different servers never reach each other.")})
		}
		if !p.HomeAccess() {
			return append(steps, Step{false, w.hasAccess(p.Name, p.Access), T.T("Only people with home access reach other devices.")})
		}
		if !q.HomeAccess() {
			return append(steps, Step{false, w.hasAccess(q.Name, q.Access), T.T("Only devices of people with home access can be reached.")})
		}
		if srv.Mesh == "off" {
			return append(steps, Step{false, w.f(`"Devices reach each other" is off on %s`, srv.Name), T.T("Server → Access → Home network.")})
		}
		if srv.Mesh == "circles" && q.ID != p.ID {
			a, b := w.circle(p), w.circle(q)
			if a == nil || b == nil || a.ID != b.ID {
				name := func(c *model.Circle) string {
					if c == nil {
						return T.T("no circle")
					}
					return c.Name
				}
				return append(steps, Step{false, w.f("%s and %s are not in one circle", p.Name, q.Name), p.Name + ": " + name(a) + " · " + q.Name + ": " + name(b)})
			}
			steps = append(steps, Step{true, w.f("Both are in %s", a.Name), T.T("Devices in one circle reach each other.")})
		} else if q.ID == p.ID {
			steps = append(steps, Step{true, w.f("Both are %s's devices", p.Name), ""})
		} else {
			steps = append(steps, Step{true, T.T("Devices reach each other on this server"), ""})
		}
		if st := w.state(q); st != "active" || t.dev.Disabled {
			return append(steps, Step{false, w.cantReach(who, t.dev.Disabled, st), ""})
		}
		return append(steps, via(t.ip), w.connected(t.dev, who))
	}
	// a device that keeps its own local network out of the tunnel sends a private address there, router or
	// home address alike: it never reaches this router's rules
	if d.LanBypass && p.Access != "lan" && inNets(t.ip, allowed) == "" {
		return append(steps, via(t.ip))
	}
	// the router itself
	if w.routerHas(t.ip) {
		s := m.Settings
		plain := false
		for _, h := range append([]string{s.PortalHost}, s.PortalAlt...) {
			if _, ip := ipnet.IP(h); ip {
				plain = true
			}
		}
		portal := s.PortalEnabled && t.port != 0 && (t.port == s.PortalPort || (plain && t.port == s.PortalPort+1))
		switch {
		case t.port == 53:
			steps = append(steps, Step{true, w.f("%s is this router: DNS is open to everyone", t.ip), ""})
		case portal:
			steps = append(steps, Step{true, w.f("%s is this router: the personal portal is open to everyone", t.ip), ""})
		case !p.HomeAccess():
			detail := w.f("%s has Internet only: only DNS and the portal on the router.", p.Name)
			if p.Access == "lan" {
				detail = w.f("%s has Home only: only DNS and the portal on the router.", p.Name)
			}
			return append(steps, Step{false, w.f("%s is this router", t.ip), detail})
		default:
			// like any home address: only on the networks the person reaches
			if !all && inNets(t.ip, homeNets) == "" {
				return append(steps, Step{false, w.f("%s is this router on a network %s doesn't reach", t.ip, p.Name), w.reaches(p.Name, homeDevs)})
			}
			detail := w.f("On one of the networks %s reaches.", p.Name)
			if all {
				detail = T.T("Home access includes the router.")
			}
			steps = append(steps, Step{true, w.f("%s is this router", t.ip), detail})
		}
		return append(steps, via(t.ip))
	}
	// a tunnel address no device has
	if tn := w.inTunnels(t.ip); tn != "" {
		return append(steps, Step{false, w.f("No device uses %s", t.ip), w.f("It is in the tunnel network %s.", tn)})
	}
	// home
	wan, _, _, zones := w.Snap.ServerNet(srv)
	if hdev := w.homeDevOf(srv, t.ip); hdev != "" {
		if p.Access == "internet" {
			return append(steps, Step{false, w.f("%s is at home (%s)", t.ip, hdev), w.f("%s has Internet only.", p.Name)})
		}
		if p.Access == "lan" && len(p.Services) > 0 {
			var hit *model.Service
			var names []string
			for _, sid := range p.Services {
				s := m.Services[sid]
				if s == nil {
					continue
				}
				names = append(names, s.Name)
				open := len(s.Ports) == 0 || t.port == 0
				for _, port := range s.Ports {
					open = open || port == strconv.Itoa(t.port)
				}
				if s.Address == t.ip && open {
					hit = s
				}
			}
			if hit == nil {
				what := t.ip
				if t.port != 0 {
					what += ":" + strconv.Itoa(t.port)
				}
				return append(steps, Step{false, w.f("%s is not one of %s's home services", what, p.Name), w.f("Allowed: %s", strings.Join(names, ", "))})
			}
			detail := T.T("All ports")
			if len(hit.Ports) > 0 {
				detail = w.f("Ports %s", strings.Join(hit.Ports, ", "))
			}
			steps = append(steps, Step{true, w.f("%s is %s, one of %s's home services", t.ip, hit.Name, p.Name), detail})
		} else {
			if inNets(t.ip, homeNets) == "" {
				return append(steps, Step{false, w.f("%s is in %s, which %s doesn't reach", t.ip, hdev, p.Name), w.reaches(p.Name, homeDevs)})
			}
			detail := w.f("One of the networks %s reaches.", p.Name)
			if all {
				detail = T.T("Home access reaches every home network.")
			}
			steps = append(steps, Step{true, w.f("%s is in home network %s", t.ip, hdev), detail})
		}
		to := strings.Join(zones, ", ")
		if to == "" {
			to = T.T("home")
		}
		return append(steps, via(t.ip), Step{true, T.T("The firewall lets it through"), srv.Ifname + " → " + to})
	}
	// another private address, or the internet
	if inNets(t.ip, []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "169.254.0.0/16"}) != "" {
		return append(steps, Step{false, w.f("%s isn't in %s's home network", t.ip, srv.Name), T.T("Private addresses outside the home network are blocked.")})
	}
	if p.Access == "lan" {
		return append(steps, Step{true, w.f("%s is on the internet", t.ip), w.f("%s has Home only: their device's own internet reaches it, not the tunnel.", p.Name)})
	}
	leaves := T.T("It leaves through the WAN.")
	if srv.LanLike {
		leaves = T.T("It leaves like a home device would.")
	} else if wan.Dev != "" {
		leaves = w.f("It leaves through %s.", wan.Dev)
	}
	return append(steps, via(t.ip), Step{true, w.f("%s is on the internet", t.ip), leaves})
}

// toDevice: a home address to a device.
func (w *walk) toDevice(ip string, d *model.Device) []Step {
	m, T := w.m, w.T
	p := m.People[d.Person]
	var srv *model.Server
	if p != nil {
		srv = m.Servers[p.Server]
	}
	if p == nil || srv == nil {
		return []Step{{false, w.f("%s has no server", d.Name), ""}}
	}
	who := p.Name + " · " + d.Name
	hdev := ""
	if w.inTunnels(ip) == "" {
		hdev = w.homeDevOf(srv, ip)
	}
	if hdev == "" {
		return []Step{{false, w.f("%s isn't in %s's home network", ip, srv.Name), T.T("Only home devices reach people's devices.")}}
	}
	steps := []Step{{true, w.f("%s is at home (%s)", ip, hdev), ""}}
	if !p.HomeAccess() {
		title := w.hasAccess(p.Name, p.Access)
		if p.Access == "lan" {
			title = w.f("%s has only some home services", p.Name)
		}
		return append(steps, Step{false, title, T.T("Home devices reach only people with home access.")})
	}
	if _, nets, _ := w.personHome(srv, p); inNets(ip, nets) == "" {
		return append(steps, Step{false, w.f("%s doesn't reach %s", p.Name, hdev), T.T("Networks a person does not reach cannot reach them either.")})
	}
	steps = append(steps, w.personOK(p, d))
	if !steps[len(steps)-1].OK {
		return steps
	}
	_, _, _, zones := w.Snap.ServerNet(srv)
	from := strings.Join(zones, ", ")
	if from == "" {
		from = T.T("home")
	}
	return append(steps, Step{true, T.T("The firewall lets it through"), from + " → " + srv.Ifname}, w.connected(d, who))
}

// Check walks from one side to the other: each a device's id, or an IPv4 address (with a port when given).
// ok tells whether every step passed.
func Check(m *model.Model, from, to string, ctx Ctx) (ok bool, steps []Step, err error) {
	w := &walk{ctx, m}
	a, aok := w.parse(from)
	if !aok {
		return false, nil, Said{`"%s" is not a device or an IPv4 address.`, []any{from}}
	}
	b, bok := w.parse(to)
	if !bok {
		return false, nil, Said{`"%s" is not a device or an IPv4 address.`, []any{to}}
	}
	switch {
	case a.dev != nil:
		steps = w.fromDevice(a.dev, b)
	case b.dev != nil:
		steps = w.toDevice(a.ip, b.dev)
	default:
		return false, nil, errors.New("Choose a device on at least one side.")
	}
	// a side that is a host behind a router: said first, for each such side
	var lead []Step
	for _, t := range []target{a, b} {
		if t.net != "" {
			lead = append(lead, w.behindStep(t))
		}
	}
	steps = append(lead, steps...)
	ok = true
	for _, s := range steps {
		ok = ok && s.OK
	}
	return ok, steps, nil
}
