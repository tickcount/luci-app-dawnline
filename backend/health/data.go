package health

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/tickcount/luci-app-dawnline/backend/awg"
	"github.com/tickcount/luci-app-dawnline/backend/disguise"
	"github.com/tickcount/luci-app-dawnline/backend/endpoint"
	"github.com/tickcount/luci-app-dawnline/backend/i18n"
	"github.com/tickcount/luci-app-dawnline/backend/ipnet"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
)

// ModelErrors is what is wrong with people and devices, as sentences in t's language (dawnline.core
// model_errors): what the sync would have to leave out, or what points at something that does not exist.
// Empty when the settings are consistent.
func ModelErrors(m *model.Model, t *i18n.Catalog) []string {
	errs := []string{}
	codes := map[string]string{}
	for _, id := range m.PersonIDs() {
		p := m.People[id]
		if p.Server != "" && m.Servers[p.Server] == nil {
			errs = append(errs, fmt.Sprintf(t.T("Person %s: server %s does not exist."), p.Name, p.Server))
		}
		if p.Circle != "" && m.Circles[p.Circle] == nil {
			errs = append(errs, fmt.Sprintf(t.T("Person %s: circle %s does not exist."), p.Name, p.Circle))
		}
		for _, sid := range p.Services {
			if m.Services[sid] == nil {
				errs = append(errs, fmt.Sprintf(t.T("Person %s: home service %s does not exist."), p.Name, sid))
			}
		}
		if p.Code != "" {
			if other, twice := codes[p.Code]; twice {
				errs = append(errs, fmt.Sprintf(t.T("Person %s: has the same personal link as %s."), p.Name, other))
			}
			codes[p.Code] = p.Name
		}
	}
	type holder struct{ device, person string }
	addrs := map[string]holder{}
	for _, id := range m.DeviceIDs() {
		d := m.Devices[id]
		p := m.People[d.Person]
		if p == nil {
			errs = append(errs, fmt.Sprintf(t.T("Device %s: person %s does not exist."), d.Name, d.Person))
			continue
		}
		say := func(msg string, args ...any) {
			errs = append(errs, fmt.Sprintf(t.T(msg), append([]any{d.Name, p.Name}, args...)...))
		}
		if !awg.ValidKey(d.PublicKey) {
			say("Device %s of %s: the public key is not a key.")
		}
		if d.PrivateKey != "" && !awg.ValidKey(d.PrivateKey) {
			say("Device %s of %s: the private key is not a key.")
		}
		if d.PresharedKey != "" && !awg.ValidKey(d.PresharedKey) {
			say("Device %s of %s: the preshared key is not a key.")
		}
		// its own link values (0 / nil: the server's); one out of range is never used
		if d.MTU != 0 && (d.MTU < 1280 || d.MTU > 1500) {
			say("Device %s of %s: MTU %d is not between 1280 and 1500.", d.MTU)
		}
		if d.Keepalive != nil && (*d.Keepalive < 0 || *d.Keepalive > 600) {
			say("Device %s of %s: keep-alive %d is not between 0 and 600 seconds.", *d.Keepalive)
		}
		n, ok := ipnet.IP(d.Address)
		if !ok {
			if d.Address != "" {
				say("Device %s of %s: address %s is not a plain IPv4 address.", d.Address)
			} else {
				say("Device %s of %s: address (none) is not a plain IPv4 address.")
			}
			continue
		}
		srv := m.Servers[p.Server]
		// AmneziaWG ignores a peer with the interface's own key
		if srv != nil && srv.PublicKey != "" && d.PublicKey == srv.PublicKey {
			say("Device %s of %s: the public key is the server's own.")
		}
		if srv != nil {
			if net, ok := ipnet.Subnet(srv.Subnet); ok {
				last := uint64(net.Base) + net.Size() - 2
				if n < net.First() || uint64(n) > last {
					say("Device %s of %s: address %s is outside %s's tunnel %s.", d.Address, srv.Name, srv.Subnet)
				} else if n == net.First() {
					say("Device %s of %s: address %s is the router's own address on %s.", d.Address, srv.Name)
				}
			}
		}
		key := p.Server + " " + d.Address
		if o, taken := addrs[key]; taken {
			say("Device %s of %s: address %s is also used by device %s of %s.", d.Address, o.device, o.person)
		}
		addrs[key] = holder{d.Name, p.Name}
	}
	for _, id := range m.CircleIDs() {
		if c := m.Circles[id]; m.Servers[c.Server] == nil {
			errs = append(errs, fmt.Sprintf(t.T("Circle %s: server %s does not exist."), c.Name, c.Server))
		}
	}
	return errs
}

// TunnelDevices is the devices the sync loads into a server's tunnel, in the settings' order
// (dawnline.awg tunnel_devices): those of people who are active or held only by a limit the portal
// explains, that are on, with a key and an address, and not the server's own key. states is each person's
// state (package state).
func TunnelDevices(m *model.Model, sid string, states map[string]string) []*model.Device {
	out := []*model.Device{}
	own := ""
	if srv := m.Servers[sid]; srv != nil {
		own = srv.PublicKey
	}
	for _, id := range m.DeviceIDs() {
		d := m.Devices[id]
		p := m.People[d.Person]
		// turned off, or a router its owner asked for that the admin has not taken
		if p == nil || p.Server != sid || d.Disabled || d.Waiting {
			continue
		}
		if s := states[p.ID]; s != "active" && s != "quota" {
			continue
		}
		if _, ok := ipnet.IP(d.Address); !ok || !awg.ValidKey(d.PublicKey) || (own != "" && d.PublicKey == own) {
			continue
		}
		out = append(out, d)
	}
	return out
}

// PeerDiff is how the peers read on a tunnel differ from the devices that belong there, counted by key.
func PeerDiff(devs []*model.Device, peers map[string]awg.Peer, ifname string) Peers {
	want := map[string]bool{}
	for _, d := range devs {
		want[d.PublicKey] = true
	}
	p := Peers{Expected: len(devs)}
	found := 0
	for k, peer := range peers {
		if peer.Ifname != ifname {
			continue
		}
		p.Loaded++
		if want[k] {
			found++
		} else {
			p.Extra++
		}
	}
	p.Missing = len(want) - found
	return p
}

// Divert is a policy rule that sends marked traffic into a table with `local default`, the way transparent
// proxies capture the router's own traffic.
type Divert struct {
	Pref       int
	Mark, Mask uint32
	Table      string
}

const markAll = 0xffffffff

var (
	markRule     = regexp.MustCompile(`^(\d+):.*fwmark 0x([0-9a-f]+)(/0x([0-9a-f]+))?.* lookup (\S+)`)
	localDefault = regexp.MustCompile(`(^|\n)local default`)
)

// ProxyDiverts finds the diverts, one a mark and mask (dawnline.fw proxy_diverts). rules is `ip <family>
// rule show` and table `ip <family> route show table <name>`, for "-4" and "-6".
func ProxyDiverts(rules func(family string) string, table func(family, name string) string) []Divert {
	out := []Divert{}
	seen := map[string]bool{}
	for _, fam := range []string{"-4", "-6"} {
		for _, line := range strings.Split(rules(fam), "\n") {
			m := markRule.FindStringSubmatch(line)
			if m == nil {
				continue
			}
			pref, _ := strconv.Atoi(m[1])
			if pref >= 32766 {
				continue
			}
			mark, _ := strconv.ParseUint(m[2], 16, 32)
			mask := uint64(markAll)
			if m[4] != "" {
				mask, _ = strconv.ParseUint(m[4], 16, 32)
			}
			key := fmt.Sprintf("%d/%d", mark, mask)
			if seen[key] || !localDefault.MatchString(table(fam, m[5])) {
				continue
			}
			seen[key] = true
			out = append(out, Divert{pref, uint32(mark), uint32(mask), m[5]})
		}
	}
	return out
}

// String is a divert as `ip rule` shows it, for people: "pref 1000 fwmark 0x1 → table 100".
func (d Divert) String() string {
	mask := ""
	if d.Mask != markAll {
		mask = fmt.Sprintf("/0x%x", d.Mask)
	}
	return fmt.Sprintf("pref %d fwmark 0x%x%s → table %s", d.Pref, d.Mark, mask, d.Table)
}

// ReplyScript is the table that keeps answers from Dawnline's ports out of the diverts, as dawnline.fw
// writes it, or "" when there is nothing to keep out of them.
func ReplyScript(m *model.Model, diverts []Divert) string {
	var tcp, udp []int
	add := func(list []int, n int) []int {
		for _, x := range list {
			if x == n {
				return list
			}
		}
		if n < 1 || n > 65535 {
			return list
		}
		return append(list, n)
	}
	if s := m.Settings; s.PortalEnabled {
		tcp = add(tcp, s.PortalPort)
		for _, h := range append([]string{s.PortalHost}, s.PortalAlt...) {
			if _, ip := ipnet.IP(h); ip {
				tcp = add(tcp, s.PortalPort+1)
				break
			}
		}
	}
	for _, id := range m.ServerIDs() {
		if srv := m.Servers[id]; srv.PrivateKey != "" && srv.Enabled {
			udp = add(udp, srv.Port)
		}
	}
	if len(diverts) == 0 || (len(tcp) == 0 && len(udp) == 0) {
		return ""
	}
	t := []string{"table inet dawnline_reply {", "\tchain out {", "\t\ttype route hook output priority filter + 10; policy accept;"}
	for _, proto := range []struct {
		name  string
		ports []int
	}{{"tcp", tcp}, {"udp", udp}} {
		if len(proto.ports) == 0 {
			continue
		}
		var ports []string
		for _, p := range proto.ports {
			ports = append(ports, strconv.Itoa(p))
		}
		for _, d := range diverts {
			// only the divert's bits: other marks on the packet (multi-WAN) stay
			rule := fmt.Sprintf("meta mark 0x%x meta mark set 0x0", d.Mark)
			if d.Mask != markAll {
				rule = fmt.Sprintf("meta mark & 0x%x == 0x%x meta mark set meta mark & 0x%x", d.Mask, d.Mark, ^d.Mask)
			}
			t = append(t, "\t\t"+proto.name+" sport { "+strings.Join(ports, ", ")+" } "+rule)
		}
	}
	return strings.Join(append(t, "\t}", "}"), "\n") + "\n"
}

// ServerErrors is what is wrong with a server's definition against the rest of the router
// (dawnline.core server_errors): its interface name, port, tunnel network against `others`, public address.
func ServerErrors(srv *model.Server, others []string, t *i18n.Catalog) []string {
	errs := []string{}
	if !model.ValidIfname(srv.Ifname) {
		errs = append(errs, t.T("Interface name: 1-12 lowercase letters, digits or _."))
	}
	if srv.Port < 1 || srv.Port > 65535 {
		errs = append(errs, t.T("Port must be 1-65535."))
	}
	if c, ok := ipnet.Subnet(srv.Subnet); !ok {
		errs = append(errs, t.T("Subnet must look like 10.77.0.0/24."))
	} else {
		for _, o := range others {
			if oc, ok := ipnet.Subnet(o); ok && overlap(c, oc) {
				errs = append(errs, fmt.Sprintf(t.T("Subnet overlaps %s."), o))
			}
		}
	}
	if srv.Endpoint != "" && !endpoint.ValidHost(srv.Endpoint) {
		errs = append(errs, t.T("Endpoint must be a hostname or IP address."))
	}
	return errs
}

// ConfigErrors is what is wrong with settings about to replace the current ones (a restore, an import):
// people and devices consistent (ModelErrors), and each server with a valid interface name that is its
// own and not one of the router's (`network`: the router's network configuration), a tunnel network that
// overlaps neither the router's (`foreign`) nor an earlier server's, a port of its own and disguise values
// AmneziaWG takes. Empty when they can be used. dawnline.backup config_errors.
func ConfigErrors(m *model.Model, t *i18n.Catalog, network *uci.Config, foreign []string) []string {
	errs := ModelErrors(m, t)
	ifnames, ports := map[string]string{}, map[int]string{}
	var subnets []string
	for _, id := range m.ServerIDs() {
		srv := m.Servers[id]
		for _, e := range append(ServerErrors(srv, append(append([]string{}, foreign...), subnets...), t), disguise.Unsafe(srv.Obf)...) {
			errs = append(errs, fmt.Sprintf(t.T("Server %s: %s"), srv.Name, e))
		}
		if other, used := ifnames[srv.Ifname]; used {
			errs = append(errs, fmt.Sprintf(t.T("Server %s: interface %s is also used by %s."), srv.Name, srv.Ifname, other))
		}
		ifnames[srv.Ifname] = srv.Name
		own := srv.Ifname == "dlx0" || srv.Ifname == "dll0"
		if network != nil {
			if s := network.Section(srv.Ifname); s != nil {
				_, ours := s.Values["_dawnline"]
				own = own || s.Type != "interface" || !ours
			}
		}
		if own {
			errs = append(errs, fmt.Sprintf(t.T("Server %s: %s is one of the router's own network interfaces."), srv.Name, srv.Ifname))
		}
		if other, used := ports[srv.Port]; used {
			errs = append(errs, fmt.Sprintf(t.T("Server %s: UDP %d is also used by %s."), srv.Name, srv.Port, other))
		}
		ports[srv.Port] = srv.Name
		if srv.Subnet != "" {
			subnets = append(subnets, srv.Subnet)
		}
	}
	return errs
}
