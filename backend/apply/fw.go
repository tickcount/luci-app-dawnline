package apply

import (
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"

	"github.com/tickcount/luci-app-dawnline/backend/ipnet"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
	"github.com/tickcount/luci-app-dawnline/backend/view"
)

// fw4 around the tunnels (dawnline.fw): each tunnel's zone, its forwardings to home and WAN, the WAN rules
// for the tunnels and the portal. Only sections named dawnline_* are ever changed.

const loopZone = "dl_loop"

var notWord = regexp.MustCompile(`[^A-Za-z0-9_]`)

// portalPortOK: never SSH, DNS or the LuCI web server's ports for the portal, whatever the settings say.
func portalPortOK(p int) bool {
	return p >= 1 && p <= 65535 && p != 22 && p != 53 && p != 80 && p != 443
}

// portalHTTP tells whether the portal also answers plain HTTP: IP addresses have no certificate.
func portalHTTP(m *model.Model) bool {
	for _, h := range view.PortalHosts(m) {
		if _, is := ipnet.IP(h); is {
			return true
		}
	}
	return false
}

// firewall brings a firewall configuration in line with the servers and the portal; whether it changed,
// and what changed section by section (level, line) for the log.
func (r *Router) firewall(c *uci.Config, m *model.Model) (changed bool, notes [][2]string) {
	want := map[string]bool{}
	sec := func(name, kind string, opts ...opt) {
		want[name] = true
		created := false
		if s := c.Section(name); s == nil || s.Type != kind {
			c.DeleteSection(name)
			c.Add(kind, name)
			created = true
		}
		var diff []opt
		for _, o := range opts {
			if put(c, name, o) {
				diff = append(diff, o)
			}
		}
		switch {
		case created:
			changed = true
			notes = append(notes, [2]string{"info", fmt.Sprintf("%s %s: created · %s", kind, name, optsText(opts))})
		case len(diff) > 0:
			changed = true
			notes = append(notes, [2]string{"info", fmt.Sprintf("%s %s: updated · %s", kind, name, optsText(diff))})
		default:
			notes = append(notes, [2]string{"debug", fmt.Sprintf("%s %s: unchanged", kind, name)})
		}
	}
	snap := r.Snapshot()
	portalZone := ""
	wantLoop, anyLoop := false, false
	// Where tunnel DNS is sent (dawnline.nft): into the netns for home names while any server runs "like a
	// home device", and to the LAN's DNS for everyone else. A server that does not forward to those zones on
	// its own gets a rule for port 53 alone.
	for _, srv := range m.Servers {
		anyLoop = anyLoop || (srv.LanLike && tunnelOK(srv))
	}
	_, _, known, _ := r.likeHome()
	lanDNS := r.lanDNS(snap, known)
	lanDNSZone := ""
	if ip, ok := ipnet.IP(lanDNS); ok {
		for _, name := range snap.Names() {
			d := snap.Devices[name]
			if d.Zone == "" || lanDNSZone != "" {
				continue
			}
			for _, n := range d.Nets {
				if c, ok := ipnet.Any(n); ok && c.Holds(ip) {
					lanDNSZone = d.Zone
					break
				}
			}
		}
	}
	for _, id := range m.ServerIDs() {
		srv := m.Servers[id]
		if !tunnelOK(srv) {
			continue
		}
		z := "dawnline_" + id
		wan, _, _, zones := snap.ServerNet(srv)
		if portalZone == "" {
			portalZone = wan.Zone
		}
		if !srv.LanLike && anyLoop {
			sec(z+"_loopdns", "rule", opt{key: "name", val: "Dawnline-" + srv.Ifname + "-names"}, opt{key: "src", val: srv.Ifname}, opt{key: "dest", val: loopZone},
				opt{key: "proto", val: "tcp udp"}, opt{key: "dest_port", val: "53"}, opt{key: "target", val: "ACCEPT"})
		}
		reaches := false
		for _, zone := range zones {
			reaches = reaches || zone == lanDNSZone
		}
		if lanDNSZone != "" && lanDNSZone != srv.Ifname && !reaches {
			sec(z+"_landns", "rule", opt{key: "name", val: "Dawnline-" + srv.Ifname + "-dns"}, opt{key: "src", val: srv.Ifname}, opt{key: "dest", val: lanDNSZone},
				opt{key: "dest_ip", val: lanDNS}, opt{key: "proto", val: "tcp udp"}, opt{key: "dest_port", val: "53"}, opt{key: "target", val: "ACCEPT"})
		}
		// forward within the zone (device to device) is decided by the inet dawnline table
		sec(z+"_zone", "zone", opt{key: "name", val: srv.Ifname}, opt{key: "network", list: []string{srv.Ifname}},
			opt{key: "input", val: "ACCEPT"}, opt{key: "output", val: "ACCEPT"}, opt{key: "forward", val: "ACCEPT"})
		// Access per person is enforced by the inet dawnline table; the zone only needs to be allowed to reach
		// each home-network zone and WAN. The home network may open connections to the devices too (a router
		// or a NAS on the tunnel); their answers pass the table as established.
		for i, zone := range zones {
			if zone == wan.Zone || zone == srv.Ifname {
				continue
			}
			sfx := ""
			if i > 0 {
				sfx = "_" + notWord.ReplaceAllString(zone, "_")
			}
			sec(z+"_lan"+sfx, "forwarding", opt{key: "src", val: srv.Ifname}, opt{key: "dest", val: zone})
			sec(z+"_from_lan"+sfx, "forwarding", opt{key: "src", val: zone}, opt{key: "dest", val: srv.Ifname})
		}
		sec(z+"_wan", "forwarding", opt{key: "src", val: srv.Ifname}, opt{key: "dest", val: wan.Zone})
		if srv.LanLike {
			sec(z+"_loop", "forwarding", opt{key: "src", val: srv.Ifname}, opt{key: "dest", val: loopZone})
			wantLoop = true
		}
		off := opt{key: "enabled"}
		if !srv.Enabled {
			off.val = "0"
		}
		sec(z+"_port", "rule", opt{key: "name", val: "Dawnline-" + srv.Ifname}, opt{key: "src", val: wan.Zone}, opt{key: "proto", val: "udp"},
			opt{key: "dest_port", val: strconv.Itoa(srv.Port)}, opt{key: "target", val: "ACCEPT"}, off)
	}
	outside := portalZone
	if outside == "" {
		outside = "wan"
	}
	// the link into the netns that re-enters the router from the LAN
	if wantLoop {
		sec("dawnline_loop", "zone", opt{key: "name", val: loopZone}, opt{key: "device", list: []string{"dlx0"}},
			opt{key: "input", val: "REJECT"}, opt{key: "output", val: "ACCEPT"}, opt{key: "forward", val: "REJECT"})
		// the Home-only resolver in the netns reaches its upstream DNS this way
		sec("dawnline_loop_wan", "forwarding", opt{key: "src", val: loopZone}, opt{key: "dest", val: outside})
	}
	if s := m.Settings; s.PortalEnabled && portalPortOK(s.PortalPort) {
		sec("dawnline_portal", "rule", opt{key: "name", val: "Dawnline-Portal"}, opt{key: "src", val: outside}, opt{key: "proto", val: "tcp"},
			opt{key: "dest_port", val: strconv.Itoa(s.PortalPort)}, opt{key: "target", val: "ACCEPT"})
		// IP addresses in links: plain HTTP next to the HTTPS port (80 and 443 stay with the LuCI web server)
		if portalHTTP(m) && portalPortOK(s.PortalPort+1) {
			sec("dawnline_portal_http", "rule", opt{key: "name", val: "Dawnline-Portal-HTTP"}, opt{key: "src", val: outside}, opt{key: "proto", val: "tcp"},
				opt{key: "dest_port", val: strconv.Itoa(s.PortalPort + 1)}, opt{key: "target", val: "ACCEPT"})
		}
	}
	var stale [][2]string
	for _, s := range c.Sections {
		if strings.HasPrefix(s.Name, "dawnline_") && !want[s.Name] {
			stale = append(stale, [2]string{s.Name, s.Type})
		}
	}
	for _, s := range stale {
		notes = append(notes, [2]string{"info", fmt.Sprintf("%s %s: removed", s[1], s[0])})
		c.DeleteSection(s[0])
		changed = true
	}
	return changed, notes
}

func (r *Router) firewallConfig() (*uci.Config, bool) {
	text, _ := os.ReadFile(r.Firewall)
	c, err := uci.Parse(string(text))
	if err != nil {
		r.say("error", "firewall", r.Firewall+" does not parse: nothing was changed · "+err.Error())
		return nil, false
	}
	return c, true
}

// FirewallDiffers tells whether the firewall configuration differs from what Dawnline wants; nothing is
// written (the watchdog's question).
func (r *Router) FirewallDiffers(m *model.Model) bool {
	c, ok := r.firewallConfig()
	if !ok {
		return false
	}
	changed, _ := r.firewall(c, m)
	return changed
}

// Fw brings fw4's configuration in line with the servers and the portal, and reloads fw4 when it
// changed; true when it did.
func (r *Router) Fw(m *model.Model) bool {
	c, ok := r.firewallConfig()
	if !ok {
		return false
	}
	changed, notes := r.firewall(c, m)
	for _, n := range notes {
		r.say(n[0], "firewall", n[1])
	}
	if !changed {
		return false
	}
	if err := commit(r.Firewall, c); err != nil {
		r.say("error", "firewall", r.Firewall+" could not be written · "+err.Error())
		return false
	}
	r.ack("firewall")
	r.say("info", "firewall", "fw4 -q reload")
	r.Exec("fw4", "-q", "reload")
	return true
}

// FirewallDrift is what is wrong with Dawnline's firewall, for the watchdog (dawnline.fw drift): "" when
// nothing is; "off": fw4 is not running at all (not ours to start); "changed": the configuration lost or
// changed Dawnline's sections; "not loaded": fw4 runs without them.
func (r *Router) FirewallDrift(m *model.Model) string {
	table, code := r.Exec("nft", "-t", "list", "table", "inet", "fw4")
	if code != 0 || strings.Trim(table, " \t\r\n\v\f") == "" {
		return "off"
	}
	if r.FirewallDiffers(m) {
		return "changed"
	}
	// named rules show up in fw4's ruleset as comments
	var names []string
	for _, id := range m.ServerIDs() {
		if srv := m.Servers[id]; srv.Enabled && tunnelOK(srv) {
			names = append(names, "Dawnline-"+srv.Ifname)
		}
	}
	if m.Settings.PortalEnabled {
		names = append(names, "Dawnline-Portal")
	}
	for _, n := range names {
		if !strings.Contains(table, n+`"`) {
			return "not loaded"
		}
	}
	return ""
}
