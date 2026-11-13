package methods

import (
	"fmt"
	"math/rand/v2"
	"os"
	"os/exec"
	"sort"
	"strings"

	"github.com/tickcount/luci-app-dawnline/backend/awg"
	"github.com/tickcount/luci-app-dawnline/backend/i18n"
	"github.com/tickcount/luci-app-dawnline/backend/ipnet"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/roster"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
	"github.com/tickcount/luci-app-dawnline/backend/view"
)

// DefaultPort is the usual AmneziaWG port.
const DefaultPort = 4500

// ReservedIDs may name nothing in the settings; portalPaths are the portal's own, which a server's id (the
// first part of nothing else) must not be either.
var (
	ReservedIDs = []string{"settings", "main", "global", "defaults"}
	portalPaths = []string{"api", "assets", "cgi-bin"}
)

func within(taken []map[string]any, p int) bool {
	for _, t := range taken {
		if t["from"].(int) <= p && p <= t["to"].(int) {
			return true
		}
	}
	return false
}

// randPort draws a high port. A test puts its own in its place.
var randPort = func() int { return 40000 + rand.IntN(20001) }

// freePort is the usual port when free, otherwise a random high one.
func freePort(taken []map[string]any) int {
	if !within(taken, DefaultPort) {
		return DefaultPort
	}
	for i := 0; i < 50; i++ {
		if p := randPort(); !within(taken, p) {
			return p
		}
	}
	return 51830
}

// freeSubnet is a /24 that overlaps none of the networks taken: 10.x first, past 200 tries the 172.16-31 range.
func freeSubnet(taken []string) string {
	for i := 0; i < 300; i++ {
		cand := fmt.Sprintf("10.%d.%d.0/24", 60+rand.IntN(191), rand.IntN(251))
		if i >= 200 {
			cand = fmt.Sprintf("172.%d.%d.0/24", 16+rand.IntN(16), rand.IntN(251))
		}
		c, _ := ipnet.Subnet(cand)
		bad := false
		for _, t := range taken {
			if n, ok := ipnet.Subnet(t); ok && uint64(c.Base) < uint64(n.Base)+n.Size() && uint64(n.Base) < uint64(c.Base)+c.Size() {
				bad = true
				break
			}
		}
		if !bad {
			return c.String()
		}
	}
	return "10.77.0.0/24"
}

// freePortalPort is a portal port free together with the next one (plain HTTP for IP links): first (the
// server's UDP number) before the usual ones.
func freePortalPort(first, cur int, taken []map[string]any) int {
	if cur == 0 {
		cur = 8443
	}
	for _, p := range []int{first, cur, 8443, 9443, 10443, 7443, 4443} {
		if !within(taken, p) && !within(taken, p+1) {
			return p
		}
	}
	return 9443
}

func idTaken(m *model.Model, id string) bool {
	for _, r := range append(append([]string{}, ReservedIDs...), portalPaths...) {
		if r == id {
			return true
		}
	}
	return m.Servers[id] != nil || m.People[id] != nil || m.Devices[id] != nil || m.Services[id] != nil || m.Circles[id] != nil
}

// freeServerID is home, then server2, server3, … (never an id anything else has).
func freeServerID(m *model.Model) string {
	if !idTaken(m, "home") {
		return "home"
	}
	for n := 2; ; n++ {
		if id := fmt.Sprintf("server%d", n); !idTaken(m, id) {
			return id
		}
	}
}

// freeIfname is a network section name nothing uses: not the router's, not Dawnline's own links, not another server's.
func freeIfname(m *model.Model, network *uci.Config) string {
	for i := 0; i < 10; i++ {
		n := fmt.Sprintf("dawn%d", i)
		free := network == nil || network.Section(n) == nil
		for _, s := range m.Servers {
			free = free && s.Ifname != n
		}
		if free {
			return n
		}
	}
	return "dawnx"
}

// wanKind is what kind of IPv4 the WAN has: public, cgnat (100.64/10), private (behind another router), none.
func wanKind(wan string) string {
	n, ok := ipnet.IP(wan)
	if !ok {
		return "none"
	}
	for i, p := range []string{"100.64.0.0/10", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"} {
		if r, _ := ipnet.Any(p); r.Holds(n) {
			if i == 0 {
				return "cgnat"
			}
			return "private"
		}
	}
	return "public"
}

// setupDefaults is what a new server starts from (dawnline.rpc.servers setup_defaults): a free id, name,
// interface, port and network, the address to reach the router by and where it came from, the zones.
func setupDefaults(w *view.World, t *i18n.Catalog, d Deps) map[string]any {
	m := w.M
	var addrs []Address
	if d.Addresses != nil {
		addrs = d.Addresses()
	}
	networks := takenNetworks(m, addrs)
	fw := parseFile("/etc/config/firewall")
	zones := []any{}
	names := []string{}
	if fw != nil {
		for _, z := range fw.OfType("zone") {
			// as ucode lists them: a zone with no name is a null in the list
			if n, ok := z.Get("name"); ok {
				zones = append(zones, n)
				names = append(names, n)
			} else {
				zones = append(zones, nil)
				names = append(names, "")
			}
		}
	}
	has := func(n string) bool {
		for _, z := range names {
			if z == n {
				return true
			}
		}
		return false
	}
	snap := d.Snapshot()
	wanIP := ""
	if dev := snap.Devices[snap.WAN]; dev != nil && len(dev.Addrs) > 0 {
		wanIP = strings.SplitN(dev.Addrs[0], "/", 2)[0]
	}
	kind := wanKind(wanIP)
	host, from := m.Settings.PortalHost, ""
	if host != "" {
		from = "portal"
	} else {
		// a DDNS name, then an ACME certificate's, then the WAN address, but never a private or CGNAT one
		if ddns := parseFile("/etc/config/ddns"); ddns != nil {
			for _, s := range ddns.OfType("service") {
				lookup, _ := s.Get("lookup_host")
				if on, _ := s.Get("enabled"); host == "" && lookup != "" && on == "1" {
					host, from = lookup, "ddns"
				}
			}
		}
		if host == "" {
			entries, _ := os.ReadDir("/etc/ssl/acme")
			var certs []string
			for _, e := range entries {
				if base, is := strings.CutSuffix(e.Name(), ".fullchain.crt"); is {
					certs = append(certs, base)
				}
			}
			sort.Strings(certs)
			if len(certs) > 0 && certs[0] != "" {
				host, from = certs[0], "cert"
			}
		}
		if host == "" && kind == "public" {
			host, from = wanIP, "wan"
		}
	}
	// the zones the WAN and LAN devices are in, whatever they are called
	zoneOf := func(dev, usual string, fallback int) any {
		if x := snap.Devices[dev]; x != nil && x.Zone != "" {
			return x.Zone
		}
		if has(usual) {
			return usual
		}
		if fallback < len(zones) {
			return zones[fallback]
		}
		return nil
	}
	wanZone, lanZone := zoneOf(snap.WAN, "wan", 1), zoneOf(snap.LAN, "lan", 0)
	network := parseFile("/etc/config/network")
	udp, _ := os.ReadFile("/proc/net/udp")
	udp6, _ := os.ReadFile("/proc/net/udp6")
	// no server is being edited: every server's port counts
	wz, _ := wanZone.(string)
	udpHeld := udpTaken(m, &model.Server{WanZone: wz}, t, network, fw, udpBound(string(udp), string(udp6)), listening("udp"))
	tcpHeld := tcpTaken(m, t, listening("tcp"), fw)
	port := freePort(udpHeld)
	name := t.T("Home")
	if n := len(m.Servers); n > 0 {
		name = fmt.Sprintf(t.T("Server %d"), n+1)
	}
	cidrs := []string{}
	for _, n := range networks {
		cidrs = append(cidrs, n["cidr"].(string))
	}
	portal := m.Settings.PortalPort
	if !m.Settings.PortalEnabled {
		portal = freePortalPort(port, m.Settings.PortalPort, tcpHeld)
	}
	// an installed module that is not loaded yet is loaded: nothing loads it before the first tunnel comes up
	state := roster.AwgState(d.Handler)
	if state["kmod"] == true && state["loaded"] == false {
		exec.Command("modprobe", "amneziawg").Run()
		state = roster.AwgState(d.Handler)
	}
	return map[string]any{
		"id": freeServerID(m), "name": name, "ifname": freeIfname(m, network), "port": port, "subnet": freeSubnet(cidrs),
		"endpoint": host, "endpoint_from": from, "wan_kind": kind, "wan_ip": orNull(wanIP), "mtu": 0,
		"zones": zones, "lan_zone": lanZone, "wan_zone": wanZone, "portal_port": portal,
		"awg": awg.SystemCaps(d.DataDir), "awg_state": state, "networks": networks, "udp_taken": udpHeld, "tcp_taken": tcpHeld,
	}
}
