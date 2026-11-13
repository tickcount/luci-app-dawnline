// Package netview is the router's own networks: which interfaces there are, which is the WAN, which the
// LAN, and what a server's and a person's "home" reaches. As dawnline.net (snapshot, server_net) and
// dawnline.core (person_home) work them out: a device's configuration lists these networks, so the two
// backends must name the same ones.
//
// What it reads of the system comes through Sources, so a test hands in what a router said.
package netview

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/tickcount/luci-app-dawnline/backend/ipnet"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
)

// Links Dawnline makes itself: never interfaces to offer.
const transit, inner = "dlx0", "dll0"

var (
	vpnProtos   = []string{"amneziawg", "wireguard", "openvpn", "openconnect", "vpnc", "pptp", "l2tp", "gre", "gretap", "vti", "xfrm"}
	vpnNames    = regexp.MustCompile(`^(wg|awg|tun|tap|ovpn|ipsec|vti|xfrm)`)
	notWanProto = []string{"amneziawg", "wireguard", "openvpn", "openconnect", "vpnc"}
	notWanNames = regexp.MustCompile(`^(wg|awg|tun|tap|ovpn)`)
	noise       = regexp.MustCompile(`^(ifb|teql|sit|ip6tnl|gre|gretap|erspan|ip6gre|ip6gretap|ip_vti|ip6_vti|tunl|bond)[0-9]*$`)
	private     = []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10"}
)

// Link is what the system says of one interface.
type Link struct {
	Flags  int64  `json:"flags"`
	Type   int    `json:"type"`
	Master string `json:"master"`
	Bridge bool   `json:"bridge"`
	Wifi   bool   `json:"wifi"`
}

// Logical is a netifd interface on a device.
type Logical struct {
	Name  string `json:"name"`
	Proto string `json:"proto"`
}

// Sources is where a snapshot reads the system.
type Sources struct {
	// Routes is `ip -j -4 route show table main`'s answer.
	Routes func() []byte
	// Addrs is `ip -j -4 addr show`'s answer (nil: no addresses are read).
	Addrs func() []byte
	// Links is every interface by name; Logical the netifd interface on each device.
	Links   func() map[string]Link
	Logical func() map[string]Logical
	// Zones is the firewall's zones (nil: none are read).
	Zones func() Zones
}

// Device is an interface as Dawnline sees it.
type Device struct {
	Name string `json:"name"`
	// Category is what it is to the admin: wan (the one the default route leaves by), wifi, vpn, ethernet,
	// other. Kind is the same but for a bridge, which is "bridge", and for the WAN, which keeps its own.
	Category string `json:"category"`
	Kind     string `json:"kind"`
	Up       bool   `json:"up"`
	// Master is the bridge it is a port of; Members a bridge's ports.
	Master  string   `json:"master"`
	Members []string `json:"members"`
	Nets    []string `json:"nets"`
	// Addrs is its IPv4 addresses ("192.0.2.7/24"), when they were read.
	Addrs []string `json:"addrs"`
	// Logical is the netifd interface on it and Proto that one's protocol; Zone its firewall zone ("": none).
	Logical string `json:"logical"`
	Proto   string `json:"proto"`
	Zone    string `json:"zone"`
}

// Zones is the firewall's zones: every name, and the zone of each network and each device named in one.
type Zones struct {
	Names        []string
	ByNet, ByDev map[string]string
}

// ZonesOf reads the zones of a firewall configuration, the first zone that names a network or device winning.
func ZonesOf(fw *uci.Config) Zones {
	z := Zones{ByNet: map[string]string{}, ByDev: map[string]string{}}
	if fw == nil {
		return z
	}
	for _, s := range fw.OfType("zone") {
		name, _ := s.Get("name")
		if name == "" {
			continue
		}
		z.Names = append(z.Names, name)
		for key, into := range map[string]map[string]string{"network": z.ByNet, "device": z.ByDev} {
			v := s.Values[key]
			list := v.List
			if !v.IsList {
				list = strings.Fields(v.Str)
			}
			for _, n := range list {
				if _, has := into[n]; n != "" && !has {
					into[n] = name
				}
			}
		}
	}
	return z
}

// Snapshot is one consistent look at the router's interfaces.
type Snapshot struct {
	Devices map[string]*Device
	WAN     string
	LAN     string
	// Zones is every firewall zone's name.
	Zones []string
}

// Names is the interfaces' names, sorted: the order ucode lists them in.
func (s *Snapshot) Names() []string {
	out := make([]string, 0, len(s.Devices))
	for n := range s.Devices {
		out = append(out, n)
	}
	sort.Strings(out)
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

func isPrivate(cidr string) bool {
	n, ok := ipnet.Any(cidr)
	if !ok || n.Prefix < 1 {
		return false
	}
	for _, p := range private {
		if r, _ := ipnet.Any(p); r.Holds(n.Base) {
			return true
		}
	}
	return false
}

// Take looks at the router.
func Take(src Sources) *Snapshot {
	var routes []struct {
		Dst    string `json:"dst"`
		Dev    string `json:"dev"`
		Metric *int   `json:"metric"`
	}
	json.Unmarshal(src.Routes(), &routes)
	logical := map[string]Logical{}
	if src.Logical != nil {
		logical = src.Logical()
	}
	byDev := map[string][]string{}
	vpn := func(dev string) bool { return has(notWanProto, logical[dev].Proto) || notWanNames.MatchString(dev) }
	// The WAN: the default route with the lowest metric that does not go into a VPN client; only VPN
	// routes: the lowest of them.
	wan, wanMetric, wanVPN := "", 0, true
	for _, r := range routes {
		if r.Dev == "" {
			continue
		}
		if r.Dst != "default" {
			byDev[r.Dev] = append(byDev[r.Dev], r.Dst)
			continue
		}
		v, metric := vpn(r.Dev), 0
		if r.Metric != nil {
			metric = *r.Metric
		}
		if wan == "" || (wanVPN && !v) || (wanVPN == v && metric < wanMetric) {
			wan, wanMetric, wanVPN = r.Dev, metric, v
		}
	}
	addrs := map[string][]string{}
	if src.Addrs != nil {
		var list []struct {
			Ifname string `json:"ifname"`
			Info   []struct {
				Family string `json:"family"`
				Local  string `json:"local"`
				Prefix int    `json:"prefixlen"`
			} `json:"addr_info"`
		}
		json.Unmarshal(src.Addrs(), &list)
		for _, l := range list {
			for _, a := range l.Info {
				if a.Family == "inet" {
					addrs[l.Ifname] = append(addrs[l.Ifname], a.Local+"/"+strconv.Itoa(a.Prefix))
				}
			}
		}
	}
	links := src.Links()
	names := make([]string, 0, len(links))
	for n := range links {
		names = append(names, n)
	}
	sort.Strings(names)
	zones := Zones{}
	if src.Zones != nil {
		zones = src.Zones()
	}
	s := &Snapshot{Devices: map[string]*Device{}, WAN: wan, Zones: zones.Names}
	if s.Zones == nil {
		s.Zones = []string{}
	}
	var order []string
	for _, dev := range names {
		if dev == "lo" || dev == transit || dev == inner {
			continue
		}
		l := links[dev]
		nets := []string{}
		if byDev[dev] != nil {
			nets = ipnet.Collapse(byDev[dev])
		}
		if noise.MatchString(dev) && len(nets) == 0 {
			continue
		}
		lg, known := logical[dev]
		cat := "other"
		switch {
		case l.Wifi:
			cat = "wifi"
		case (known && has(vpnProtos, lg.Proto)) || l.Type == 65534 || (l.Flags&0x10 != 0 && l.Type != 1) || vpnNames.MatchString(dev):
			cat = "vpn"
		case l.Type == 1 || l.Bridge:
			cat = "ethernet"
		}
		d := &Device{Name: dev, Category: cat, Kind: cat, Up: l.Flags&1 != 0, Master: l.Master, Members: []string{}, Nets: nets, Addrs: addrs[dev],
			Logical: lg.Name, Proto: lg.Proto, Zone: zones.ByDev[dev]}
		if l.Bridge {
			d.Kind = "bridge"
		}
		if dev == wan {
			d.Category = "wan"
		}
		if d.Addrs == nil {
			d.Addrs = []string{}
		}
		if d.Zone == "" && known {
			d.Zone = zones.ByNet[lg.Name]
		}
		s.Devices[dev] = d
		order = append(order, dev)
	}
	for _, dev := range order {
		if m := s.Devices[s.Devices[dev].Master]; m != nil {
			m.Members = append(m.Members, dev)
		}
	}
	// The LAN: netifd's "lan" if present, otherwise the first bridge (then ethernet device) carrying a
	// private network.
	for dev, lg := range logical {
		if lg.Name == "lan" && s.Devices[dev] != nil {
			s.LAN = dev
		}
	}
	for _, pass := range []string{"bridge", "ethernet"} {
		for _, dev := range order {
			d := s.Devices[dev]
			if s.LAN != "" || dev == wan || d.Kind != pass || d.Master != "" {
				continue
			}
			for _, n := range d.Nets {
				if isPrivate(n) {
					s.LAN = dev
					break
				}
			}
		}
	}
	return s
}

// WanAddress is the address of the interface a server's devices come in on, or "".
func (s *Snapshot) WanAddress(srv *model.Server) string {
	wan := srv.WanDevice
	if srv.AutoWan {
		wan = s.WAN
		if wan == "" {
			wan = srv.DetectedWan
		}
	}
	if d := s.Devices[wan]; d != nil && len(d.Addrs) > 0 {
		return strings.SplitN(d.Addrs[0], "/", 2)[0]
	}
	return ""
}

// Home is one interface of a server's home network.
type Home struct {
	Dev  string
	Nets []string
}

// ServerHome is the interfaces that make up a server's home network and what they reach together.
func (s *Snapshot) ServerHome(srv *model.Server) (home []Home, nets []string) {
	wan := srv.WanDevice
	if srv.AutoWan {
		wan = s.WAN
		if wan == "" {
			wan = srv.DetectedWan
		}
	}
	var picked []string
	auto := ""
	if srv.AutoLan {
		auto = s.LAN
		if auto == "" {
			auto = srv.DetectedLan
		}
	}
	if auto != "" {
		picked = append(picked, auto)
	}
	for _, d := range srv.LanDevices {
		if d != auto {
			picked = append(picked, d)
		}
	}
	var all []string
	for _, dev := range picked {
		d := s.Devices[dev]
		// Never the WAN, the tunnel itself, or a bridge port (routing only sees the bridge).
		if dev == wan || dev == srv.Ifname || (d != nil && d.Master != "") {
			continue
		}
		h := Home{Dev: dev, Nets: []string{}}
		if d != nil {
			h.Nets = d.Nets
		}
		home = append(home, h)
		all = append(all, h.Nets...)
	}
	return home, ipnet.Collapse(all)
}

// PersonHome is the home networks a person reaches: all of the server's, or only the interfaces ticked on
// their page.
func (s *Snapshot) PersonHome(srv *model.Server, p *model.Person) []string {
	home, nets := s.ServerHome(srv)
	if p == nil || len(p.HomeNets) == 0 {
		return nets
	}
	var picked []string
	for _, h := range home {
		if has(p.HomeNets, h.Dev) {
			picked = append(picked, h.Nets...)
		}
	}
	return ipnet.Collapse(picked)
}

// System reads the router itself: `ip` for the routes, /sys/class/net for the interfaces. logical is asked
// of netifd by the caller (it holds the bus).
func System(logical func() map[string]Logical) Sources {
	const sys = "/sys/class/net"
	read := func(dev, f string) string {
		b, _ := os.ReadFile(filepath.Join(sys, dev, f))
		return strings.TrimSpace(string(b))
	}
	return Sources{
		Routes: func() []byte {
			out, _ := exec.Command("ip", "-j", "-4", "route", "show", "table", "main").Output()
			return out
		},
		Addrs: func() []byte {
			out, _ := exec.Command("ip", "-j", "-4", "addr", "show").Output()
			return out
		},
		Links: func() map[string]Link {
			out := map[string]Link{}
			entries, _ := os.ReadDir(sys)
			for _, e := range entries {
				dev := e.Name()
				l := Link{}
				l.Flags, _ = strconv.ParseInt(strings.TrimPrefix(read(dev, "flags"), "0x"), 16, 64)
				l.Type, _ = strconv.Atoi(read(dev, "type"))
				if m, err := os.Readlink(filepath.Join(sys, dev, "master")); err == nil {
					l.Master = filepath.Base(m)
				}
				_, err := os.Stat(filepath.Join(sys, dev, "bridge"))
				l.Bridge = err == nil
				_, e1 := os.Stat(filepath.Join(sys, dev, "phy80211"))
				_, e2 := os.Stat(filepath.Join(sys, dev, "wireless"))
				l.Wifi = e1 == nil || e2 == nil
				out[dev] = l
			}
			return out
		},
		Logical: logical,
		Zones: func() Zones {
			raw, err := os.ReadFile("/etc/config/firewall")
			if err != nil {
				return Zones{}
			}
			fw, _ := uci.Parse(string(raw))
			return ZonesOf(fw)
		},
	}
}

// Wan is the interface a server's devices come in on; HomeOf one interface of its home network.
type Wan struct {
	Dev     string
	Auto    bool
	Zone    string
	Missing bool
}

type HomeOf struct {
	Dev     string
	Auto    bool
	Nets    []string
	Zone    string
	Missing bool
}

// ServerNet is what a server uses right now (dawnline.net server_net): its WAN, the interfaces of its home
// Own is the router's own networks: every route of its main table but the ones through Dawnline's own
// tunnels, which Dawnline puts there itself (a tunnel's subnet, the networks behind people's routers).
func (s *Snapshot) Own(m *model.Model) []string {
	ours := map[string]bool{}
	for _, srv := range m.Servers {
		ours[srv.Ifname] = true
	}
	var nets []string
	for _, name := range s.Names() {
		if !ours[name] {
			nets = append(nets, s.Devices[name].Nets...)
		}
	}
	return ipnet.Collapse(nets)
}

// Behind is the networks behind each router that are in effect on this router, by the device's id: none
// that shares addresses with a network the router has itself.
func (s *Snapshot) Behind(m *model.Model) map[string][]string { return m.BehindOf(s.Own(m)) }

// network, what those reach together, and their firewall zones.
func (s *Snapshot) ServerNet(srv *model.Server) (wan Wan, home []HomeOf, nets, zones []string) {
	wan = Wan{Dev: srv.WanDevice, Auto: srv.AutoWan}
	if srv.AutoWan {
		if wan.Dev = s.WAN; wan.Dev == "" {
			wan.Dev = srv.DetectedWan
		}
	}
	wan.Zone = srv.WanZone
	if d := s.Devices[wan.Dev]; d != nil && d.Zone != "" {
		wan.Zone = d.Zone
	}
	if wan.Zone == "" {
		wan.Zone = "wan"
	}
	wan.Missing = wan.Dev != "" && s.Devices[wan.Dev] == nil
	type pick struct {
		dev  string
		auto bool
	}
	var picked []pick
	auto := ""
	if srv.AutoLan {
		if auto = s.LAN; auto == "" {
			auto = srv.DetectedLan
		}
	}
	if auto != "" {
		picked = append(picked, pick{auto, true})
	}
	for _, d := range srv.LanDevices {
		if d != auto {
			picked = append(picked, pick{d, false})
		}
	}
	home, zones = []HomeOf{}, []string{}
	var all []string
	zone := func(z string) {
		if z != "" && !has(zones, z) {
			zones = append(zones, z)
		}
	}
	for _, p := range picked {
		d := s.Devices[p.dev]
		// Never the WAN, the tunnel itself, or a bridge port (routing only sees the bridge).
		if p.dev == wan.Dev || p.dev == srv.Ifname || (d != nil && d.Master != "") {
			continue
		}
		// The detected LAN missing for a moment (bridge recreated) keeps its zone.
		h := HomeOf{Dev: p.dev, Auto: p.auto, Nets: []string{}, Missing: d == nil}
		if d != nil {
			h.Nets, h.Zone = d.Nets, d.Zone
		}
		if h.Zone == "" && p.auto {
			h.Zone = srv.LanZone
		}
		home = append(home, h)
		all = append(all, h.Nets...)
		zone(h.Zone)
	}
	// Older configs and routers where nothing could be resolved: the zone set at setup.
	if len(home) == 0 && srv.AutoLan {
		zone(srv.LanZone)
	}
	return wan, home, ipnet.Collapse(all), zones
}
