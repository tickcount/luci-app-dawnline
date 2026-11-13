// Package nft makes the table `inet dawnline` as dawnline.nft does: each person's access, enforced on the
// tunnel interfaces before anything else on the router sees the traffic, and where tunnel DNS goes. Its
// shape follows the servers and their home networks (Render); who is in which set follows people's state
// and changes often (Sets, Update: one atomic transaction).
//
// What is loaded decides who reaches what, so the text is held to ucode's byte for byte on a household made
// up for it (testdata/trace.uc, scripts/ucode-golden.sh).
package nft

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/tickcount/luci-app-dawnline/backend/ipnet"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/netview"
)

// Private4 is the private IPv4 ranges: internet people never reach them.
var Private4 = []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "169.254.0.0/16", "224.0.0.0/3"}

// Names is the sets whose members change at run time (Update replaces them together), in the table's order.
var Names = []string{"lan_ok", "lan_all", "lan_part", "mesh_pairs", "inet_ok", "svc_ok", "svc_host", "dns_real"}

// Sets is the members of each run-time set.
type Sets map[string][]string

func ip4(a string) bool {
	_, ok := ipnet.IP(a)
	return ok
}

var digits = regexp.MustCompile(`^[0-9]+$`)

// tunnel is a server's own link: its interface, its network and the router's address in it. ok is false
// for a server without keys, kept down, or with an interface name or a network that will not do.
func tunnel(srv *model.Server) (ifname, subnet, address string, ok bool) {
	if srv == nil || srv.PrivateKey == "" || srv.Blocked != nil || !model.ValidIfname(srv.Ifname) {
		return "", "", "", false
	}
	n, isNet := ipnet.Subnet(srv.Subnet)
	if !isNet {
		return "", "", "", false
	}
	return srv.Ifname, srv.Subnet, ipnet.String(n.First()), true
}

// AccessSets is who is in which set: which tunnel addresses may reach what, by each person's state. A
// router stands for the networks behind it: wherever its address is, they are too, so a host there has
// exactly its owner's access and is reached by exactly those who reach the router.
//
//	lan_ok     home access (the router itself, the mesh)
//	lan_all    every home network
//	lan_part   device . network for people limited to some networks
//	mesh_pairs device . device within a circle (or one person's own devices)
//	inet_ok    the internet
//	svc_ok     device . service . port; svc_host: device . service with no ports (all of them)
//	dns_real   home names from the plain resolver
func AccessSets(m *model.Model, states map[string]string, snap *netview.Snapshot) Sets {
	sets := Sets{}
	for _, k := range Names {
		sets[k] = []string{}
	}
	homes := map[string]home{}
	// a circle's (or one person's) devices, each with the networks behind it
	groups := map[string][][]string{}
	var order []string
	behind := snap.Behind(m)
	for _, id := range m.DeviceIDs() {
		d := m.Devices[id]
		p := m.People[d.Person]
		// off: paused, ended or over quota, or a router that waits for the admin's answer; addresses go into
		// nft as they are: IPv4 only
		if p == nil || d.Disabled || d.Waiting || !ip4(d.Address) || states[p.ID] != "active" {
			continue
		}
		// the device as the rules see it: its address, then the networks behind it
		for _, from := range append([]string{d.Address}, behind[id]...) {
			member(sets, m, p, from, homes, snap)
		}
		if p.HomeAccess() {
			srv := m.Servers[p.Server]
			// who this device may reach directly: its circle, or at least its owner's devices
			if srv != nil && srv.Mesh == "circles" {
				g := m.MeshGroup(p)
				if _, seen := groups[g]; !seen {
					order = append(order, g)
				}
				groups[g] = append(groups[g], append([]string{d.Address}, behind[id]...))
			}
		}
	}
	// every device of a group with every other, never with itself (what is behind a router reaches the
	// router without the tunnel)
	for _, g := range order {
		for i, one := range groups[g] {
			for j, other := range groups[g] {
				if i == j || one[0] == other[0] {
					continue
				}
				for _, a := range one {
					for _, b := range other {
						sets["mesh_pairs"] = append(sets["mesh_pairs"], a+" . "+b)
					}
				}
			}
		}
	}
	return sets
}

type home struct {
	all  bool
	nets []string
}

// member puts one source of a person's (a device's address, or a network behind their router) into the
// sets the person's access names; homes keeps what each person's home is from one device to the next.
func member(sets Sets, m *model.Model, p *model.Person, from string, homes map[string]home, snap *netview.Snapshot) {
	if p.Access == "lan" && p.DNSMode == "home" {
		sets["dns_real"] = append(sets["dns_real"], from)
	}
	if p.Access == "internet" || p.Access == "both" {
		sets["inet_ok"] = append(sets["inet_ok"], from)
	}
	if p.HomeAccess() {
		sets["lan_ok"] = append(sets["lan_ok"], from)
		h, known := homes[p.ID]
		if !known {
			h = home{all: true}
			if srv := m.Servers[p.Server]; srv != nil {
				h = home{all: len(p.HomeNets) == 0, nets: snap.PersonHome(srv, p)}
			}
			homes[p.ID] = h
		}
		if h.all {
			sets["lan_all"] = append(sets["lan_all"], from)
			return
		}
		for _, n := range h.nets {
			sets["lan_part"] = append(sets["lan_part"], from+" . "+n)
		}
		return
	}
	if p.Access != "lan" {
		return
	}
	for _, sid := range p.Services {
		s := m.Services[sid]
		if s == nil || !ip4(s.Address) {
			continue
		}
		if len(s.Ports) == 0 {
			sets["svc_host"] = append(sets["svc_host"], from+" . "+s.Address)
		}
		for _, port := range s.Ports {
			if digits.MatchString(port) {
				sets["svc_ok"] = append(sets["svc_ok"], from+" . "+s.Address+" . "+port)
			}
		}
	}
}

func uniq(list []string) []string {
	out := make([]string, 0, len(list))
	seen := map[string]bool{}
	for _, x := range list {
		if !seen[x] {
			seen[x] = true
			out = append(out, x)
		}
	}
	return out
}

// elems is a set's members as its declaration holds them; duplicate members (two devices with one address)
// would make the whole load fail.
func elems(list []string) string {
	if list = uniq(list); len(list) > 0 {
		return "elements = { " + strings.Join(list, ", ") + " }"
	}
	return ""
}

// Ctx is what the table is made from besides the settings, read from the router: the netns's DNS address
// ("" none), where the Home-only resolver runs (in the netns at an address on port 53, or on the router at
// a port), the LAN's DNS ("" none) and the interfaces.
type Ctx struct {
	DNSAddr      string
	ResolverNS   string
	ResolverPort int
	LanDNS       string
	Snap         *netview.Snapshot
}

// Render is the table as text.
func Render(m *model.Model, sets Sets, ctx Ctx) string {
	var ifs, tun []string
	dnsAddr := ctx.DNSAddr
	if !ip4(dnsAddr) {
		dnsAddr = ""
	}
	// each server's home networks are its own: with several servers, "all home" on one never reaches the
	// other's networks (set home_<id>)
	type served struct {
		id, ifname, address string
		nets                []string
	}
	var homes []served
	for _, id := range m.ServerIDs() {
		srv := m.Servers[id]
		ifname, subnet, address, ok := tunnel(srv)
		if !ok {
			continue
		}
		ifs = append(ifs, `"`+ifname+`"`)
		tun = append(tun, subnet)
		_, _, nets, _ := ctx.Snap.ServerNet(srv)
		homes = append(homes, served{id, ifname, address, ipnet.Collapse(nets)})
	}
	tun = ipnet.Collapse(tun)
	var t []string
	add := func(format string, args ...any) { t = append(t, fmt.Sprintf(format, args...)) }
	add("table inet dawnline {")
	for _, h := range homes {
		add("\tset home_%s { type ipv4_addr; flags interval; %s }", h.id, elems(h.nets))
	}
	// tunnel subnets are never "home", even inside a wider route to the LAN
	add("\tset tun_nets { type ipv4_addr; flags interval; %s }", elems(tun))
	// who is in a set is an address or, for a router, a network behind it: every one takes intervals
	add("\tset lan_ok { type ipv4_addr; flags interval; %s }", elems(sets["lan_ok"]))
	add("\tset lan_all { type ipv4_addr; flags interval; %s }", elems(sets["lan_all"]))
	add("\tset lan_part { type ipv4_addr . ipv4_addr; flags interval; %s }", elems(sets["lan_part"]))
	add("\tset mesh_pairs { type ipv4_addr . ipv4_addr; flags interval; %s }", elems(sets["mesh_pairs"]))
	add("\tset inet_ok { type ipv4_addr; flags interval; %s }", elems(sets["inet_ok"]))
	add("\tset svc_ok { type ipv4_addr . ipv4_addr . inet_service; flags interval; %s }", elems(sets["svc_ok"]))
	add("\tset svc_host { type ipv4_addr . ipv4_addr; flags interval; %s }", elems(sets["svc_host"]))
	add("\tset dns_real { type ipv4_addr; flags interval; %s }", elems(sets["dns_real"]))
	add("\tchain pre {")
	// ahead of mangle-priority hooks (transparent proxies mark at -150)
	add("\t\ttype filter hook prerouting priority -160; policy accept;")
	if len(ifs) > 0 {
		add("\t\tiifname { %s } jump guard", strings.Join(ifs, ", "))
	}
	add("\t}")
	add("\tchain guard {")
	add("\t\tmeta nfproto ipv6 drop")
	// Every packet is judged by the rules below, not only the first of a connection: a change of access cuts
	// open connections too. Only what has no rule of its own passes on its connection: errors and the like,
	// answers to the admin's port forwards, and the router's own pings.
	add("\t\tct state related accept")
	add("\t\tct status dnat accept")
	add("\t\ticmp type { echo-request, echo-reply } fib daddr type local accept")
	add("\t\tfib daddr type local meta l4proto { tcp, udp } th dport 53 accept")
	if pp := portalPorts(m); len(pp) > 0 {
		// their own portal, also with the VPN on (the address may be this router's)
		add("\t\tfib daddr type local tcp dport { %s } accept", strings.Join(pp, ", "))
	}
	// the router itself is part of home: for everyone with all of it, and for people limited to some
	// networks only on the addresses in those
	add("\t\tfib daddr type local ip saddr @lan_all accept")
	add("\t\tfib daddr type local ip saddr . ip daddr @lan_part accept")
	add("\t\tfib daddr type local counter drop")
	if dnsAddr != "" {
		// DNS through the netns (it forwards to the LAN's DNS), for everyone
		add("\t\tip daddr %s meta l4proto { tcp, udp } th dport 53 accept", dnsAddr)
	}
	for _, h := range homes {
		add("\t\tiifname \"%s\" ip daddr @home_%s ip daddr != @tun_nets ip saddr @lan_all accept", h.ifname, h.id)
	}
	add("\t\tip saddr . ip daddr @lan_part ip daddr != @tun_nets accept")
	// Devices with home access are part of home: they reach each other, where the server allows it
	// (everyone, or within circles). Within one server: the firewall has no forwarding between servers' zones.
	for _, h := range homes {
		switch m.Servers[h.id].Mesh {
		case "all":
			add("\t\tiifname \"%s\" ip saddr @lan_ok ip daddr @lan_ok accept", h.ifname)
		case "circles":
			add("\t\tiifname \"%s\" ip saddr . ip daddr @mesh_pairs accept", h.ifname)
		}
	}
	add("\t\tmeta l4proto { tcp, udp } ip saddr . ip daddr . th dport @svc_ok accept")
	add("\t\tip saddr . ip daddr @svc_host accept")
	add("\t\tip daddr { %s } counter drop", strings.Join(Private4, ", "))
	add("\t\tip saddr @inet_ok accept")
	add("\t\tcounter drop")
	add("\t}")
	// The other way: fw4 lets the server's home zones reach the tunnel; here only connections from its home
	// networks to people with home access pass. The admin's own port forwards (DNAT) stay with fw4.
	add("\tchain inbound {")
	add("\t\ttype filter hook forward priority filter - 5; policy accept;")
	if len(ifs) > 0 {
		add("\t\toifname { %s } iifname != { %s } ct state new jump to_device", strings.Join(ifs, ", "), strings.Join(ifs, ", "))
	}
	add("\t}")
	add("\tchain to_device {")
	add("\t\tmeta nfproto ipv6 drop")
	add("\t\tct status dnat accept")
	for _, h := range homes {
		add("\t\toifname \"%s\" ip saddr @home_%s ip saddr != @tun_nets ip daddr @lan_all accept", h.ifname, h.id)
	}
	add("\t\tip daddr . ip saddr @lan_part ip saddr != @tun_nets accept")
	add("\t\tcounter reject with icmpx admin-prohibited")
	add("\t}")
	// devices ask the tunnel address; send each query where it belongs
	toResolver := fmt.Sprintf("redirect to :%d", ctx.ResolverPort)
	if ip4(ctx.ResolverNS) {
		toResolver = "dnat ip to " + ctx.ResolverNS + ":53"
	}
	lanDNS := ctx.LanDNS
	if !ip4(lanDNS) {
		lanDNS = ""
	}
	add("\tchain dns {")
	add("\t\ttype nat hook prerouting priority dstnat - 5; policy accept;")
	if len(ifs) > 0 {
		// home names (and no LAN DNS at all): the plain resolver, whatever address was asked
		add("\t\tiifname { %s } ip saddr @dns_real meta l4proto { tcp, udp } th dport 53 %s", strings.Join(ifs, ", "), toResolver)
	}
	add("\t}")
	// After the LAN's own DNS interceptors (transparent proxies redirect port 53 at dstnat - 1): only the
	// first NAT of a connection counts. When none of them takes the tunnel, this sends it to the LAN's DNS.
	add("\tchain dns_lan {")
	add("\t\ttype nat hook prerouting priority dstnat + 5; policy accept;")
	for _, h := range homes {
		// everyone else: the LAN's DNS, through the netns (from the LAN side) when internet goes that way
		target := toResolver
		if m.Servers[h.id].LanLike && dnsAddr != "" {
			target = "dnat ip to " + dnsAddr + ":53"
		} else if lanDNS != "" {
			target = "dnat ip to " + lanDNS + ":53"
		}
		add("\t\tiifname \"%s\" ip daddr %s meta l4proto { tcp, udp } th dport 53 %s", h.ifname, h.address, target)
	}
	add("\t}")
	add("}")
	return strings.Join(t, "\n") + "\n"
}

// portalPorts is the portal's TCP ports people may reach through the tunnel (never SSH, DNS or LuCI,
// whatever is stored).
func portalPorts(m *model.Model) []string {
	s := m.Settings
	if !s.PortalEnabled {
		return nil
	}
	ok := func(p int) bool { return p >= 1 && p <= 65535 && p != 22 && p != 53 && p != 80 && p != 443 }
	var out []string
	if ok(s.PortalPort) {
		out = append(out, fmt.Sprint(s.PortalPort))
	}
	plain := false
	for _, h := range append([]string{s.PortalHost}, s.PortalAlt...) {
		plain = plain || ip4(h)
	}
	if plain && ok(s.PortalPort+1) {
		out = append(out, fmt.Sprint(s.PortalPort+1))
	}
	return out
}

// Rebuild is the script that puts a whole table in place of the one there (one transaction).
func Rebuild(table string) string {
	return "table inet dawnline\ndelete table inet dawnline\n" + table
}

// Update is the script that replaces the members of every run-time set at once. It fails as a whole when
// the table or one of its sets is missing: the caller then rebuilds.
func Update(sets Sets) string {
	var b strings.Builder
	for _, name := range Names {
		b.WriteString("flush set inet dawnline " + name + "\n")
		if members := uniq(sets[name]); len(members) > 0 {
			b.WriteString("add element inet dawnline " + name + " { " + strings.Join(members, ", ") + " }\n")
		}
	}
	return b.String()
}

// Shape counts what a table's text holds: its chains, its sets and the rules in its chains (for a log line).
func Shape(table string) (chains, sets, rules int) {
	in := false
	for _, l := range strings.Split(table, "\n") {
		l = strings.TrimSpace(l)
		switch {
		case strings.HasPrefix(l, "chain "):
			chains++
			in = true
		case strings.HasPrefix(l, "set "):
			sets++
		case in && l == "}":
			in = false
		case in && l != "" && !strings.HasPrefix(l, "type ") && !strings.HasPrefix(l, "policy ") && !strings.HasPrefix(l, "#"):
			rules++
		}
	}
	return
}
