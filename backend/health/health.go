// Package health is Health's checks, as dawnline.health health() makes them: each named for the healthy
// state ("Clock is set"), a failed one also with the problem in words for notices, in the reader's
// language. Pure: Inputs is everything read on the router, gathered by the caller, so every check can be
// made up in a test. A check whose input is not given yet (nil) is left out.
package health

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/tickcount/luci-app-dawnline/backend/endpoint"
	"github.com/tickcount/luci-app-dawnline/backend/i18n"
	"github.com/tickcount/luci-app-dawnline/backend/ipnet"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
)

// Check is one result. Fix names an action (apply, sync, restart, netrestart, ifup:<name>, install:<feature>,
// updates) or is nil; Problem is the failed check in words, nil for one that passed.
type Check struct {
	ID      string  `json:"id"`
	Title   string  `json:"title"`
	Status  string  `json:"status"`
	Detail  string  `json:"detail"`
	Fix     *string `json:"fix"`
	Problem *string `json:"problem"`
}

func check(id, title, status, detail, fix, problem string) Check {
	c := Check{ID: id, Title: title, Status: status, Detail: detail}
	if fix != "" {
		c.Fix = &fix
	}
	if status == "warn" || status == "error" {
		if problem == "" {
			problem = title
		}
		c.Problem = &problem
	}
	return c
}

// Iface is what netifd says of an interface.
type Iface struct {
	Exists, Up bool
	// Errors is its error codes (INVALID_PROTO).
	Errors []string
}

// Peers is how a tunnel's loaded devices stand against those it should hold.
type Peers struct {
	Expected, Missing, Extra, Loaded int
}

// Replies: whether answers from our ports go straight out, and the proxies' diverts that would swallow them.
type Replies struct {
	OK      bool
	Diverts []string
}

// Subnet is an IPv4 network of a netifd interface.
type Subnet struct {
	Iface, CIDR string
}

// Portal is what was read for the portal's checks.
type Portal struct {
	Owners    []string
	Listening bool
	// IPs is where its address points; WAN the router's.
	IPs []string
	WAN string
	// Cert is the certificate in use; Valid: for more than 14 days; Names: the DNS names it covers.
	Cert       string
	SelfSigned bool
	Valid      bool
	Names      []string
}

// Inputs is everything the checks are made from.
type Inputs struct {
	M *model.Model
	T *i18n.Catalog
	// AmneziaWG: its state after trying to load the module (missing packages, loaded, handler), the firmware
	// the installed build was for when that is not this one, why the module does not load, an update that
	// waits for a reboot.
	Missing             []string
	Loaded, Handler     bool
	KernelWas, KernelIs string
	WhyNotLoaded        string
	WaitsForReboot      bool
	Year                int
	AgentRunning        bool
	// FreeKB is the overlay's free space (nil: unknown).
	FreeKB        *int64
	NftLoaded     bool
	PolicyRouting []string
	// ModelErrors is what is wrong with people and devices (nil: not checked yet).
	ModelErrors       func() []string
	Firewall, Network *uci.Config
	Iface             func(ifname string) Iface
	// Unread tells a tunnel that could not be read; Peers how its devices stand (nil: not checked yet).
	Unread  func(ifname string) bool
	Peers   func(srv *model.Server) Peers
	Replies *Replies
	// Subnets is the router's networks; HomeNets a server's home networks; Endpoint what its public address reads as.
	Subnets  []Subnet
	HomeNets func(srv *model.Server) []string
	Endpoint func(srv *model.Server, host string) endpoint.Reads
	// LikeHome is the home-like path's state (dawnline.loop status); Needs the packages each feature misses.
	LikeHome map[string]any
	Needs    map[string][]string
	// The resolver for Home-only devices: its configuration's age in seconds (nil: none), whether it runs.
	ResolverConfAge *int64
	ResolverRunning bool
	Portal          func() Portal
	// The networks behind people's routers: Behind, those in effect on this router by device (nil: not
	// checked); Own, the router's own networks, to name what a network shares addresses with; RouteError,
	// what the last sync said of a route that would not go in ("": none).
	Behind     map[string][]string
	Own        []string
	RouteError string
}

// The /24s home routers come with out of the box: a home network on one of them is very likely the same as
// the network a person connects from.
var commonHome = []string{"192.168.0.0/24", "192.168.1.0/24", "192.168.2.0/24", "192.168.3.0/24", "192.168.8.0/24", "192.168.10.0/24", "192.168.31.0/24",
	"192.168.50.0/24", "192.168.88.0/24", "192.168.100.0/24", "192.168.178.0/24", "10.0.0.0/24", "10.1.1.0/24"}

func overlap(a, b ipnet.Net) bool {
	return uint64(a.Base) < uint64(b.Base)+b.Size() && uint64(b.Base) < uint64(a.Base)+a.Size()
}

// CommonHome is the home networks that overlap a common out-of-the-box subnet.
func CommonHome(nets []string) []string {
	out := []string{}
	for _, n := range nets {
		a, ok := ipnet.Subnet(n)
		if !ok {
			continue
		}
		for _, c := range commonHome {
			if b, _ := ipnet.Subnet(c); overlap(a, b) {
				out = append(out, n)
				break
			}
		}
	}
	return out
}

func has(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func (in *Inputs) noProto() string {
	return in.T.T("netifd doesn't know the amneziawg protocol (AmneziaWG missing, or the network wasn't restarted after installing it).")
}

func (in *Inputs) awg() Check {
	t := in.T
	title := t.T("AmneziaWG installed")
	if n := len(in.Missing); n > 0 {
		// the module was built for the kernel of the firmware it was installed on
		if in.KernelWas != "" && has(in.Missing, "kmod-amneziawg") {
			return check("awg", title, "error",
				fmt.Sprintf(t.T("The firmware changed (kernel %s → %s): the AmneziaWG build installed for it is gone. Install the build for this firmware."), in.KernelWas, in.KernelIs),
				"install:awg", t.T("AmneziaWG needs a build for the new firmware"))
		}
		return check("awg", title, "error", fmt.Sprintf(t.N(int64(n), "%s is missing.", "%s are missing."), strings.Join(in.Missing, ", ")), "install:awg", t.T("AmneziaWG isn’t installed"))
	}
	if !in.Loaded {
		detail := t.T("The kernel module doesn't load. Reinstall a build for this kernel in Components.")
		if in.WhyNotLoaded != "" {
			detail = fmt.Sprintf(t.T("The kernel module doesn't load: %s Reinstall a build for this kernel in Components."), in.WhyNotLoaded)
		}
		return check("awg", title, "error", detail, "updates", t.T("AmneziaWG’s kernel module doesn’t load"))
	}
	if !in.Handler {
		return check("awg", title, "error", in.noProto(), "netrestart", t.T("The network doesn’t know AmneziaWG yet"))
	}
	if in.WaitsForReboot {
		return check("awg", title, "warn", t.T("The AmneziaWG update is installed and starts after a reboot."), "", t.T("The AmneziaWG update waits for a reboot"))
	}
	return check("awg", title, "ok", t.T("Kernel module, awg tool and the netifd protocol are present."), "", "")
}

func (in *Inputs) reply(id, title, problem, proto string, port int) (Check, bool) {
	r := in.Replies
	if r == nil {
		return Check{}, false
	}
	t := in.T
	via, from := strings.Join(r.Diverts, ", "), strings.ToUpper(proto)+" "+strconv.Itoa(port)
	switch {
	case !r.OK:
		return check(id, title, "error", fmt.Sprintf(t.T("Answers from %s are swallowed by a proxy on the router (%s): clients get no reply."), from, via), "apply", problem), true
	case len(r.Diverts) > 0:
		return check(id, title, "ok", fmt.Sprintf(t.T("Answers from %s go straight out. A proxy on the router diverts its own traffic (%s); these answers skip it."), from, via), "", problem), true
	}
	return check(id, title, "ok", fmt.Sprintf(t.T("Answers from %s go straight out."), from), "", problem), true
}

func sectionIs(c *uci.Config, name, kind string) bool {
	if c == nil {
		return false
	}
	s := c.Section(name)
	return s != nil && s.Type == kind
}

// server is the checks of one server's tunnel.
func (in *Inputs) server(id string, srv *model.Server, label string) []Check {
	t, m := in.T, in.M
	out := []Check{}
	st := in.Iface(srv.Ifname)
	running, down := t.T("Tunnel running")+label, t.T("AmneziaWG is down")+label
	switch {
	case !st.Up && has(st.Errors, "INVALID_PROTO"):
		out = append(out, check("up_"+id, running, "error", in.noProto(), "netrestart", down))
	case st.Up:
		out = append(out, check("up_"+id, running, "ok", fmt.Sprintf(t.T("%s is up, listening on UDP %d."), srv.Ifname, srv.Port), "", down))
	case !st.Exists:
		out = append(out, check("up_"+id, running, "error", fmt.Sprintf(t.T("%s does not exist."), srv.Ifname), "apply", down))
	case len(st.Errors) > 0:
		out = append(out, check("up_"+id, running, "error", fmt.Sprintf(t.T("%s is down: %s."), srv.Ifname, strings.Join(st.Errors, ", ")), "ifup:"+srv.Ifname, down))
	default:
		out = append(out, check("up_"+id, running, "error", fmt.Sprintf(t.T("%s is down."), srv.Ifname), "ifup:"+srv.Ifname, down))
	}
	// the devices the sync loads, by the same choice the agent compares with every minute
	loaded := t.T("Devices loaded") + label
	if st.Up && in.Unread != nil && in.Unread(srv.Ifname) {
		out = append(out, check("peers_"+id, loaded, "warn", t.T("The tunnel could not be read, so its devices could not be checked."), "",
			t.T("The devices in AmneziaWG could not be checked")+label))
	} else if st.Up && in.Peers != nil {
		p := in.Peers(srv)
		bad := t.T("Not every device is loaded into AmneziaWG") + label
		switch {
		case p.Missing == 0 && p.Extra == 0:
			out = append(out, check("peers_"+id, loaded, "ok", fmt.Sprintf(t.N(int64(p.Loaded), "%d device is loaded in the tunnel.", "%d devices are loaded in the tunnel."), p.Loaded), "", bad))
		case p.Extra != 0:
			out = append(out, check("peers_"+id, loaded, "warn", fmt.Sprintf(t.N(int64(p.Expected), "%d of %d device missing, %d loaded that should not be.",
				"%d of %d devices missing, %d loaded that should not be."), p.Missing, p.Expected, p.Extra), "sync", bad))
		default:
			out = append(out, check("peers_"+id, loaded, "warn", fmt.Sprintf(t.N(int64(p.Expected), "%d of %d device missing.", "%d of %d devices missing."), p.Missing, p.Expected), "sync", bad))
		}
	}
	rules := sectionIs(in.Firewall, "dawnline_"+id+"_port", "rule") && sectionIs(in.Firewall, "dawnline_"+id+"_zone", "zone")
	if rules {
		out = append(out, check("fw_"+id, t.T("Firewall rules")+label, "ok", fmt.Sprintf(t.T("Zone %s and the WAN rule for UDP %d exist."), srv.Ifname, srv.Port), "", ""))
	} else {
		out = append(out, check("fw_"+id, t.T("Firewall rules")+label, "error", t.T("Firewall zone or WAN rule is missing."), "apply", t.T("AmneziaWG firewall rules are missing")+label))
	}
	if c, ok := in.reply("reply_"+id, t.T("Answers reach devices")+label, t.T("AmneziaWG answers may not reach devices")+label, "udp", srv.Port); ok {
		out = append(out, c)
	}
	// port collisions with other tunnels
	var clash []string
	if in.Network != nil {
		for _, s := range in.Network.OfType("interface") {
			proto, _ := s.Get("proto")
			lp, _ := s.Get("listen_port")
			if n, _ := strconv.Atoi(strings.TrimSpace(lp)); s.Name != srv.Ifname && (proto == "amneziawg" || proto == "wireguard") && n == srv.Port {
				clash = append(clash, s.Name)
			}
		}
	}
	if len(clash) > 0 {
		out = append(out, check("port_"+id, t.T("Port is free")+label, "error", fmt.Sprintf(t.T("UDP %d is also used by %s."), srv.Port, strings.Join(clash, ", ")), "", t.T("AmneziaWG port is taken")+label))
	}
	var overlaps []string
	if sc, ok := ipnet.Subnet(srv.Subnet); ok {
		for _, o := range in.Subnets {
			// every network of the router but this server's own tunnel's
			if o.Iface == srv.Ifname {
				continue
			}
			if oc, ok := ipnet.Subnet(o.CIDR); ok && overlap(sc, oc) {
				overlaps = append(overlaps, o.Iface+" ("+o.CIDR+")")
			}
		}
	}
	if len(overlaps) > 0 {
		out = append(out, check("subnet_"+id, t.T("Subnet is unique")+label, "error", fmt.Sprintf(t.T("%s overlaps %s."), srv.Subnet, strings.Join(overlaps, ", ")), "", t.T("AmneziaWG subnet overlaps another network")+label))
	} else {
		out = append(out, check("subnet_"+id, t.T("Subnet is unique")+label, "ok", fmt.Sprintf(t.T("%s does not overlap other networks."), srv.Subnet), "", ""))
	}
	// whether the home networks are on a common subnet, while anyone on the server has home access
	reach := false
	for _, p := range m.People {
		reach = reach || (p.Server == id && (p.Access == "lan" || p.Access == "both"))
	}
	if nets := in.HomeNets(srv); reach && len(nets) > 0 {
		c := check("homenet_"+id, t.T("Home network addresses")+label, "ok",
			fmt.Sprintf(t.T("%s is not a common home subnet: the networks people connect from rarely use the same addresses."), strings.Join(nets, ", ")), "", "")
		if bad := CommonHome(nets); len(bad) > 0 {
			c.Status = "warn"
			c.Detail = fmt.Sprintf(t.T("%s is one of the most common home subnets. On a network with the same addresses, people with home access reach your home instead of their own: their printer or TV there is out of reach while connected, with LAN Bypass too. A rarer subnet for your home network avoids it, for example 10.37.12.0/24."), strings.Join(bad, ", "))
		}
		// advice, not a fault: no notice elsewhere
		out = append(out, c)
	}
	if c, has := in.behind(id, label); has {
		out = append(out, c)
	}
	return out
}

// behind is the check of the networks behind a server's routers, when any router has one written: each is
// in effect (a peer of the tunnel, a route, a place in the access table), or the check says which is not
// and what it shares addresses with; a route the router would not take is said in its own words.
func (in *Inputs) behind(id, label string) (Check, bool) {
	m, t := in.M, in.T
	if in.Behind == nil {
		return Check{}, false
	}
	title := t.T("Networks behind routers") + label
	var bad []string
	written, routed := 0, 0
	for _, did := range m.DeviceIDs() {
		d := m.Devices[did]
		p := m.People[d.Person]
		if p == nil || p.Server != id || d.Kind != "router" || d.Waiting || len(d.Behind) == 0 {
			continue
		}
		written += len(d.Behind)
		routed += len(in.Behind[did])
		who := p.Name + " · " + d.Name
		for _, s := range d.Behind {
			n, why := model.BehindNet(s)
			switch {
			case why != "":
				bad = append(bad, fmt.Sprintf(t.T("%s behind %s is not a network a router may have behind it."), s, who))
			case has(in.Behind[did], n.String()):
			default:
				c := m.BehindClash(n, did, in.Own)
				switch {
				case c == nil:
					bad = append(bad, fmt.Sprintf(t.T("%s behind %s is written twice, or is one more than a router may have."), n.String(), who))
				case c.Server != "":
					bad = append(bad, fmt.Sprintf(t.T("%s behind %s shares addresses with the tunnel network of %s (%s)."), n.String(), who, m.Servers[c.Server].Name, c.Net))
				case c.Device != "":
					bad = append(bad, fmt.Sprintf(t.T("%s behind %s shares addresses with %s behind %s."), n.String(), who, c.Net, m.Devices[c.Device].Name))
				default:
					bad = append(bad, fmt.Sprintf(t.T("%s behind %s shares addresses with %s, which the router has itself."), n.String(), who, c.Net))
				}
			}
		}
	}
	switch {
	case written == 0:
		return Check{}, false
	case len(bad) > 0:
		return check("sites_"+id, title, "warn", strings.Join(bad, " ")+" "+t.T("Such a network is not in effect: change it in the server's Network settings."), "",
			t.T("A network behind a router isn’t in effect")+label), true
	case in.RouteError != "":
		return check("sites_"+id, title, "error", fmt.Sprintf(t.T("A route to a network behind a router couldn't be set: %s."), in.RouteError), "sync",
			t.T("A network behind a router has no route")+label), true
	}
	return check("sites_"+id, title, "ok",
		fmt.Sprintf(t.N(int64(routed), "%d network behind routers is carried by the tunnel.", "%d networks behind routers are carried by the tunnel."), routed), "", ""), true
}

func (in *Inputs) portal() []Check {
	t, s := in.T, in.M.Settings
	portal, bad := t.T("Personal portal"), t.T("Personal portal isn’t working")
	if need := in.Needs["https"]; len(need) > 0 {
		return []Check{check("portal", portal, "error", fmt.Sprintf(t.T("HTTPS isn't available on this router: install %s."), strings.Join(need, ", ")), "install:https", bad)}
	}
	p := in.Portal()
	out := []Check{}
	switch {
	case len(p.Owners) > 0:
		out = append(out, check("portal", portal, "error", fmt.Sprintf(t.T("TCP %d is already used by %s. Choose another port in Settings."), s.PortalPort, strings.Join(p.Owners, ", ")), "", bad))
	case p.Listening:
		out = append(out, check("portal", portal, "ok", fmt.Sprintf(t.T("Listening on TCP %d."), s.PortalPort), "", bad))
	default:
		out = append(out, check("portal", portal, "error", fmt.Sprintf(t.T("Nothing listens on TCP %d."), s.PortalPort), "restart", bad))
	}
	if h := s.PortalHost; h == "" {
		out = append(out, check("portal_host", t.T("Portal address"), "error", t.T("Set the public hostname in Settings so links can be generated."), "", t.T("Portal address isn’t set")))
	} else {
		cf := false
		for _, ip := range p.IPs {
			cf = cf || endpoint.Cloudflare(ip)
		}
		ips := strings.Join(p.IPs, ", ")
		title, problem := t.T("Portal address points here"), t.T("Portal address doesn’t point here")
		switch {
		case len(p.IPs) == 0:
			out = append(out, check("portal_dns", title, "error", fmt.Sprintf(t.T("%s does not resolve."), h), "", problem))
		case cf:
			out = append(out, check("portal_dns", title, "ok", fmt.Sprintf(t.T("%s goes through Cloudflare; in Russia such connections often stall after ~16 KB."), h), "", problem))
		case p.WAN != "" && !has(p.IPs, p.WAN):
			out = append(out, check("portal_dns", title, "warn", fmt.Sprintf(t.T("%s points at %s, not this router (%s)."), h, ips, p.WAN), "", problem))
		case p.WAN != "":
			out = append(out, check("portal_dns", title, "ok", fmt.Sprintf(t.T("%s → %s (this router)."), h, ips), "", problem))
		default:
			out = append(out, check("portal_dns", title, "ok", h+" → "+ips+".", "", problem))
		}
	}
	if c, ok := in.reply("portal_reply", t.T("Portal answers reach visitors"), t.T("Portal answers may not reach visitors"), "tcp", s.PortalPort); ok {
		out = append(out, c)
	}
	// IP addresses have no certificate: the portal also answers plain HTTP for them
	var plain []string
	hosts := append([]string{s.PortalHost}, s.PortalAlt...)
	for i, h := range hosts {
		if _, ip := ipnet.IP(h); ip && h != "" && !has(hosts[:i], h) {
			plain = append(plain, h)
		}
	}
	if len(plain) > 0 {
		out = append(out, check("portal_http", t.T("Plain HTTP links"), "warn",
			fmt.Sprintf(t.T("Links on %s use plain HTTP: the link and the VPN keys in configurations travel unencrypted."), strings.Join(plain, ", ")), "", t.T("Portal links use plain HTTP")))
	}
	title := t.T("Portal certificate")
	if _, ip := ipnet.IP(s.PortalHost); ip {
		return append(out, check("cert", title, "skip", t.T("The main address is an IP: its links use plain HTTP."), "", ""))
	}
	covers := s.PortalHost == "" || p.SelfSigned
	for _, n := range p.Names {
		covers = covers || endpoint.Covers(n, s.PortalHost)
	}
	problem := t.T("Portal certificate needs attention")
	switch {
	case p.SelfSigned && len(in.Needs["acme"]) > 0:
		out = append(out, check("cert", title, "warn", t.T("Using a self-signed certificate: browsers will show a warning. ACME can get a free Let’s Encrypt one."), "", problem))
	case p.SelfSigned:
		out = append(out, check("cert", title, "warn", t.T("Using a self-signed certificate: browsers will show a warning."), "", problem))
	case !covers:
		out = append(out, check("cert", title, "warn", fmt.Sprintf(t.T("%s does not cover %s (it has %s): browsers will warn."), p.Cert, s.PortalHost, strings.Join(p.Names, ", ")), "", problem))
	case p.Valid:
		out = append(out, check("cert", title, "ok", fmt.Sprintf(t.T("%s covers %s and is valid for more than 14 days."), p.Cert, s.PortalHost), "", problem))
	default:
		out = append(out, check("cert", title, "warn", fmt.Sprintf(t.T("%s expires within 14 days."), p.Cert), "", problem))
	}
	return out
}

// Run makes every check.
func Run(in Inputs) []Check {
	t, m := in.T, in.M
	out := []Check{}
	ids := m.ServerIDs()
	if len(ids) > 0 {
		out = append(out, in.awg())
	}
	if in.Year >= 2025 {
		out = append(out, check("clock", t.T("Clock is set"), "ok", t.T("End dates and quotas use the router clock."), "", ""))
	} else {
		out = append(out, check("clock", t.T("Clock is set"), "error", t.T("The router clock looks wrong; end dates will misbehave. Check NTP."), "", t.T("Clock isn’t set")))
	}
	fix := "restart"
	status := "error"
	if in.AgentRunning {
		fix, status = "", "ok"
	}
	out = append(out, check("agent", t.T("Background agent running"), status, t.T("Counts traffic and enforces end dates and quotas."), fix, t.T("Background agent isn’t running")))
	// a full overlay fails every config write on the router
	if in.FreeKB != nil {
		free := *in.FreeKB
		problem := t.T("The router is running out of flash")
		switch {
		case free < 2048:
			status := "warn"
			if free < 512 {
				status = "error"
			}
			mb := strconv.FormatFloat(float64(int64(float64(free)/1024*10))/10, 'g', -1, 64)
			out = append(out, check("flash", t.T("Free space on the router"), status,
				fmt.Sprintf(t.T("%s MB free: settings may stop saving. Remove old backups (Settings → Backups) or shorten the history."), mb), "", problem))
		default:
			out = append(out, check("flash", t.T("Free space on the router"), "ok", fmt.Sprintf(t.T("%d MB free on the overlay."), free/1024), "", problem))
		}
	}
	if len(ids) == 0 {
		return append(out, check("server", t.T("Server configured"), "warn", t.T("Set a server up in Settings."), "", t.T("No server yet")))
	}
	if in.NftLoaded {
		out = append(out, check("nft", t.T("Access rules loaded"), "ok", t.T("Table inet dawnline enforces who may reach LAN and the internet."), "", ""))
	} else {
		out = append(out, check("nft", t.T("Access rules loaded"), "error", t.T("Table inet dawnline is missing: no device is loaded into the tunnels until it is back."), "apply", t.T("Access rules aren’t loaded")))
	}
	likeHome := false
	for _, id := range ids {
		likeHome = likeHome || (m.Servers[id].LanLike && m.Servers[id].Enabled)
	}
	if likeHome {
		if pr := in.PolicyRouting; len(pr) > 0 {
			out = append(out, check("policy", t.T("Internet like a home device not bypassed"), "warn",
				fmt.Sprintf(t.T("Policy routing on the router (%s) sends marked traffic straight out, past the home-device path: tunnel traffic it matches skips your LAN's proxies and filters."), strings.Join(pr, "; ")),
				"", t.T("Other policy routing bypasses the home-device path")))
		} else {
			out = append(out, check("policy", t.T("Internet like a home device not bypassed"), "ok", t.T("No other policy routing ahead of the tunnel rules."), "", ""))
		}
	}
	// a device the sync has to leave out: its sentences, how many more, then what it means
	if in.ModelErrors != nil {
		if data := in.ModelErrors(); len(data) > 0 {
			parts := []string{strings.Join(data[:min(len(data), 4)], " ")}
			if len(data) > 4 {
				parts = append(parts, fmt.Sprintf(t.T("(%d more)"), len(data)-4))
			}
			parts = append(parts, t.T("Such devices are left out of the tunnels: fix or remove them."))
			out = append(out, check("data", t.T("People and devices consistent"), "error", strings.Join(parts, " "), "", t.T("People and devices are inconsistent")))
		} else {
			out = append(out, check("data", t.T("People and devices consistent"), "ok", t.T("Every device has a key and an address of its own inside its server."), "", ""))
		}
	}
	keyed := false
	for _, id := range ids {
		srv := m.Servers[id]
		keyed = keyed || (srv.Enabled && srv.PrivateKey != "")
		label := ""
		if len(ids) > 1 {
			label = " (" + srv.Name + ")"
		}
		if !srv.Enabled {
			out = append(out, check("srv_"+id, t.T("Server")+label, "skip", t.T("Server is disabled."), "", ""))
			continue
		}
		out = append(out, in.server(id, srv, label)...)
		host := m.EndpointHost(srv)
		status, text := endpoint.Words(endpoint.Of(host, in.Endpoint(srv, host)), "UDP "+strconv.Itoa(srv.Port), t)
		out = append(out, check("ep_"+id, t.T("Public address")+label, status, text, "", t.T("Public address needs attention")+label))
		if srv.LanLike {
			ls := in.LikeHome
			active, bridged := ls["active"] == true, ls["bridged"] == true
			title, problem := t.T("Internet like a home device")+label, t.T("Internet like a home device isn’t working")+label
			nh := in.Needs["home"]
			switch {
			case active && bridged:
				out = append(out, check("home_"+id, title, "ok", fmt.Sprintf(t.T("Traffic enters %s as %s, so it is handled like any device on your LAN."), ls["dev"], ls["address"]), "", problem))
			case len(nh) > 0:
				out = append(out, check("home_"+id, title, "warn", fmt.Sprintf(t.T("Needs %s. Internet traffic leaves through WAN directly until then."), strings.Join(nh, ", ")), "install:home", problem))
			case active:
				out = append(out, check("home_"+id, title, "warn", fmt.Sprintf(t.T("The link is up but not attached to %s."), ls["dev"]), "apply", problem))
			default:
				// the path's own sentence, then what it means
				why, _ := ls["error"].(string)
				if ls["error"] == nil {
					why = t.T("Not set up.")
				}
				out = append(out, check("home_"+id, title, "warn", why+" "+t.T("Internet traffic leaves through WAN directly."), "apply", problem))
			}
		}
	}
	// while every server is off the resolver only idles on loopback: nothing to check
	if keyed {
		running := in.ResolverConfAge != nil && in.ResolverRunning
		// a new config (a server turned on, the home link up) restarts it: give it a few seconds
		restarting := !running && in.ResolverConfAge != nil && *in.ResolverConfAge < 10
		title, problem := t.T("DNS for Home-only devices"), t.T("DNS for Home-only devices isn’t working")
		switch {
		case restarting:
			out = append(out, check("resolver", title, "ok", t.T("Restarting with the new settings."), "", problem))
		case running && in.LikeHome["active"] == true && in.LikeHome["transit"] != nil && in.LikeHome["transit"] != "":
			out = append(out, check("resolver", title, "ok", fmt.Sprintf(t.T("Plain resolver running next to the LAN (%s)."), in.LikeHome["transit"]), "", problem))
		case running:
			out = append(out, check("resolver", title, "ok", fmt.Sprintf(t.T("Plain resolver on port %d."), 5354), "", problem))
		default:
			out = append(out, check("resolver", title, "warn", t.T("The resolver is not running; Home-only devices cannot resolve names."), "apply", problem))
		}
	}
	if m.Settings.PortalEnabled {
		out = append(out, in.portal()...)
	}
	return out
}
