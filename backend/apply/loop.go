package apply

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/files"
	"github.com/tickcount/luci-app-dawnline/backend/ipnet"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/servicelog"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
)

// "Like a home device" (dawnline.loop): tunnel clients' internet traffic enters the router from the LAN,
// so whatever handles LAN traffic there (proxies, DPI bypass, DNS filters, fw4's lan zone) handles it too.
//
//	dawn0 ──policy route──▶ dlx0 ═veth═ dlx1 ┐ netns "dawnline" ┌ dll1 ═veth═ dll0 ── br-lan
//	                                           └── NAT to a LAN address ┘
//
// The netns is one more device on the LAN bridge with its own address (picked from the LAN's network above
// the DHCP pool) and its own MAC (hashed from the bridge's), the same each time it is made. Everything is
// derived from the router at run time. If the LAN is not a bridge or setup fails, the direct path stays and
// loop.json says why, as a code with its values.

const (
	loopNS                          = "dawnline"
	txRoot, txNS, lanRoot, lanNS    = "dlx0", "dlx1", "dll0", "dll1"
	prefLoopDNS, prefMain, prefLoop = 5205, 5210, 5290
	loopWho                         = "Internet like a home device"
)

// LoopServer is one tunnel on the path: its networks that keep their direct route, and of those the ones
// behind people's routers (nil when there are none: the plan is compared with the one kept in loop.json),
// which the netns answers through the tunnel as it does the tunnel's own subnet.
type LoopServer struct {
	Ifname string   `json:"ifname"`
	Subnet string   `json:"subnet"`
	Direct []string `json:"direct"`
	Behind []string `json:"behind,omitempty"`
}

// LoopPlan is what should exist (dawnline.loop plan), kept in loop.json in ucode's own order of keys.
type LoopPlan struct {
	Dev     string       `json:"dev"`
	Gateway string       `json:"gateway"`
	Address string       `json:"address"`
	MAC     string       `json:"mac"`
	Prefix  int          `json:"prefix"`
	DNS     string       `json:"dns"`
	Transit uint32       `json:"transit"`
	TxRoot  string       `json:"tx_root"`
	TxNS    string       `json:"tx_ns"`
	Table   int          `json:"table"`
	Servers []LoopServer `json:"servers"`
}

// Loop is what bringing the path to the settings came to: off (nobody wants it), a reason it cannot be
// (a code with its values), or the plan that is in place.
type Loop struct {
	Off   bool
	Error map[string]any
	Plan  *LoopPlan
}

func (r *Router) sysNet() string {
	if r.SysNet != "" {
		return r.SysNet
	}
	return "/sys/class/net"
}

func (r *Router) netnsFile() string {
	if r.NetnsDir != "" {
		return r.NetnsDir + "/" + loopNS
	}
	return "/var/run/netns/" + loopNS
}

func (r *Router) linkThere(dev string) bool {
	_, err := os.Stat(r.sysNet() + "/" + dev)
	return err == nil
}

func (r *Router) nsThere() bool {
	_, err := os.Stat(r.netnsFile())
	return err == nil
}

// sh runs a shell command as ucode's sh(): what it said (both streams) and its exit code.
func (r *Router) sh(cmd string) (string, int) { return r.Exec("sh", "-c", cmd) }

// q quotes a word for the shell.
func q(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

func trimmed(s string) string { return strings.Trim(s, " \t\r\n\v\f") }

// run gives the commands that set the path up or take it down, each in the log as it is given; what failed,
// each with what it said.
func (r *Router) run(cmds []string) []string {
	var errs []string
	for _, c := range cmds {
		r.say("info", "loop", "$ "+c)
	}
	for _, c := range cmds {
		if out, code := r.sh(c); code != 0 {
			errs = append(errs, c+": "+trimmed(out))
			r.say("error", "loop", "failed: "+c+" · "+trimmed(out))
		}
	}
	return errs
}

func (r *Router) loopLog(level, msg, detail string) {
	if r.Log != nil {
		r.Log.Write("dawnline", level, msg, detail, loopWho, servicelog.Extra{})
	}
}

/* ---------- facts about the LAN ---------- */

type dhcpFacts struct {
	pool    *[2]uint32
	dns     string
	statics []uint32
}

// dhcpOf is the DHCP pool, static leases and the DNS handed to LAN clients, for one netifd interface.
func (r *Router) dhcpOf(logical string, lan ipnet.Net) dhcpFacts {
	var f dhcpFacts
	raw, err := os.ReadFile(r.DHCP)
	if err != nil {
		return f
	}
	c, err := uci.Parse(string(raw))
	if err != nil {
		return f
	}
	for _, s := range c.OfType("dhcp") {
		iface, _ := s.Get("interface")
		if ignore, _ := s.Get("ignore"); iface != logical || ignore == "1" {
			continue
		}
		num := func(key string, dflt float64) (float64, bool) {
			v, has := s.Get(key)
			if !has {
				return dflt, true
			}
			return model.Number(v)
		}
		start, ok1 := num("start", 100)
		limit, ok2 := num("limit", 150)
		f.pool = nil
		if ok1 && ok2 {
			f.pool = &[2]uint32{lan.Base + uint32(int64(start)), lan.Base + uint32(int64(start)+int64(limit)) - 1}
		}
		v := s.Values["dhcp_option"]
		opts := v.List
		if !v.IsList && v.Str != "" {
			opts = []string{v.Str}
		}
		for _, o := range opts {
			if m := dnsOption.FindStringSubmatch(o); m != nil && f.dns == "" {
				f.dns = m[2]
			}
		}
	}
	for _, s := range c.OfType("host") {
		v, _ := s.Get("ip")
		if ip, ok := ipnet.IP(v); ok {
			f.statics = append(f.statics, ip)
		}
	}
	return f
}

// usedAddresses is the addresses other devices are using right now (neighbour table and leases): each
// with the MAC that holds it ("": one is not known).
func (r *Router) usedAddresses(dev string) map[string]string {
	used := map[string]string{}
	if out, code := r.sh("ip -j -4 neigh show dev " + q(dev)); code == 0 {
		var list []struct {
			Dst    string   `json:"dst"`
			Lladdr string   `json:"lladdr"`
			State  []string `json:"state"`
		}
		if json.Unmarshal([]byte(trimmed(out)), &list) == nil {
			for _, n := range list {
				if n.Dst != "" && !has(n.State, "FAILED") && !has(n.State, "INCOMPLETE") {
					used[n.Dst] = n.Lladdr
				}
			}
		}
	}
	leases := r.Leases
	if leases == "" {
		leases = "/tmp/dhcp.leases"
	}
	raw, _ := os.ReadFile(leases)
	for _, l := range strings.Split(string(raw), "\n") {
		if f := strings.Split(l, " "); len(f) >= 3 {
			used[f[2]] = f[1]
		}
	}
	return used
}

func has(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// ourMAC is the MAC the netns's LAN link has now; "" without the link.
func (r *Router) ourMAC() string {
	out, code := r.sh("ip -n " + loopNS + " -j link show " + lanNS + " 2>/dev/null")
	if code != 0 {
		return ""
	}
	var list []struct {
		Address string `json:"address"`
	}
	if json.Unmarshal([]byte(trimmed(out)), &list) != nil || len(list) == 0 {
		return ""
	}
	return list[0].Address
}

func fnv1a(s string, h uint32) uint32 {
	for i := 0; i < len(s); i++ {
		h = (h ^ uint32(s[i])) * 16777619
	}
	return h
}

// LanMAC is the MAC for the netns's LAN link, from the bridge's: a locally administered unicast address
// hashed from it, so it is the same every time and differs between routers. Not the bridge's MAC with a
// bit flipped: radios and ports often get those.
func LanMAC(bridge string) string {
	s := strings.ToLower(trimmed(bridge))
	h1 := fnv1a("dawnline lan "+s, 0x811c9dc5)
	h2 := fnv1a(s, h1)
	return fmt.Sprintf("%02x:%02x:%02x:%02x:%02x:%02x", ((h1>>24)&0xfc)|0x02, (h1>>16)&0xff, (h1>>8)&0xff, h1&0xff, (h2>>24)&0xff, (h2>>16)&0xff)
}

// addressFree tells whether the netns may use a LAN address: a host of the network, not the router's, not
// a static lease, outside the DHCP pool and not held by another device (an entry with one of the MACs in
// mine is the netns itself, also from before it was made again).
func addressFree(ip, router uint32, lan ipnet.Net, f dhcpFacts, used map[string]string, mine []string) bool {
	if ip <= lan.Base || uint64(ip) >= uint64(lan.Base)+lan.Size()-1 || ip == router {
		return false
	}
	for _, s := range f.statics {
		if s == ip {
			return false
		}
	}
	if f.pool != nil && ip >= f.pool[0] && ip <= f.pool[1] {
		return false
	}
	u, held := used[ipnet.String(ip)]
	return !held || (u != "" && has(mine, u))
}

// pickAddress is a LAN address for the netns: the saved one while it is free, otherwise the highest free
// host that does not answer.
func (r *Router) pickAddress(lan ipnet.Net, router uint32, f dhcpFacts, saved, dev string, mine []string) string {
	used := r.usedAddresses(dev)
	if sv, ok := ipnet.IP(saved); ok && addressFree(sv, router, lan, f, used, mine) {
		return ipnet.String(sv)
	}
	for ip := lan.Base + uint32(lan.Size()) - 2; ip > lan.Base; ip-- {
		if !addressFree(ip, router, lan, f, used, mine) {
			continue
		}
		// last check: nobody answers on it
		r.sh("ping -c 1 -W 1 -I " + q(dev) + " " + ipnet.String(ip))
		if addressFree(ip, router, lan, f, r.usedAddresses(dev), mine) {
			return ipnet.String(ip)
		}
	}
	return ""
}

// pickTransit is a /30 in 169.254.0.0/16 that no route or address on the router overlaps.
func (r *Router) pickTransit() (uint32, bool) {
	var busy []ipnet.Net
	snap := r.Snapshot()
	for _, d := range snap.Devices {
		for _, n := range append(append([]string{}, d.Nets...), d.Addrs...) {
			if c, ok := ipnet.Any(n); ok {
				busy = append(busy, c)
			}
		}
	}
	for k := 77; k < 77+256; k++ {
		base, _ := ipnet.IP(fmt.Sprintf("169.254.%d.0", k%256))
		free := true
		for _, c := range busy {
			if uint64(base) < uint64(c.Base)+c.Size() && uint64(c.Base) < uint64(base)+4 {
				free = false
				break
			}
		}
		if free {
			return base, true
		}
	}
	return 0, false
}

// pickTable is a routing table nobody else uses (ours holds a single route via the transit link).
func (r *Router) pickTable(saved int) (int, bool) {
	free := func(t int) bool {
		out, code := r.sh("ip -4 route show table " + strconv.Itoa(t))
		said := trimmed(out)
		if code != 0 || said == "" {
			return true
		}
		return !strings.Contains(said, "\n") && strings.Contains(said, " dev "+txRoot)
	}
	if saved != 0 && free(saved) {
		return saved, true
	}
	for t := 2077; t < 2177; t++ {
		if free(t) {
			return t, true
		}
	}
	return 0, false
}

// LoopErrorNote is a reason the path is off, for the service log and syslog: English, like every log line.
func LoopErrorNote(e map[string]any) string {
	switch e["code"] {
	case "no_lan":
		return "No LAN detected."
	case "not_bridge":
		return fmt.Sprintf("%v is not a bridge, so Dawnline cannot join the LAN as a device.", e["dev"])
	case "no_ipv4":
		return fmt.Sprintf("%v has no IPv4 address.", e["dev"])
	case "no_address":
		return fmt.Sprintf("No free address on %v.", e["net"])
	case "no_transit":
		return "No free link-local range for the internal link."
	}
	return "No free routing table."
}

/* ---------- plan ---------- */

type loopState struct {
	Applied int64     `json:"applied"`
	Plan    *LoopPlan `json:"plan"`
	Transit uint32    `json:"transit"`
	Fast    *bool     `json:"fast"`
	Error   any       `json:"error"`
	Off     bool      `json:"off"`
}

func (r *Router) loopState() loopState {
	var s loopState
	files.ReadJSON(r.RunDir+"/loop.json", &s)
	return s
}

// LoopPlanFor is what should exist for these settings; saved is the LAN address kept from before
// (settings.lan_address). Pure apart from reading the router (and one ping a candidate address).
func (r *Router) LoopPlanFor(m *model.Model, saved string) Loop {
	var wanted []*model.Server
	for _, id := range m.ServerIDs() {
		if s := m.Servers[id]; tunnelOK(s) && s.Enabled && s.LanLike {
			wanted = append(wanted, s)
		}
	}
	if len(wanted) == 0 {
		return Loop{Off: true}
	}
	snap := r.Snapshot()
	dev := snap.LAN
	d := snap.Devices[dev]
	if dev == "" || d == nil {
		return Loop{Error: map[string]any{"code": "no_lan"}}
	}
	if d.Kind != "bridge" {
		return Loop{Error: map[string]any{"code": "not_bridge", "dev": dev}}
	}
	var lan ipnet.Net
	var router uint32
	ok := len(d.Addrs) > 0
	if ok {
		if lan, ok = ipnet.Subnet(d.Addrs[0]); ok {
			router, ok = ipnet.IP(strings.SplitN(d.Addrs[0], "/", 2)[0])
		}
	}
	if !ok {
		return Loop{Error: map[string]any{"code": "no_ipv4", "dev": dev}}
	}
	facts := r.dhcpOf(d.Logical, lan)
	bridge, _ := os.ReadFile(r.sysNet() + "/" + dev + "/address")
	mac := LanMAC(string(bridge))
	// the netns's MACs: the one it gets, and the one it has (a random one from an older version)
	addr := r.pickAddress(lan, router, facts, saved, dev, []string{mac, r.ourMAC()})
	if addr == "" {
		return Loop{Error: map[string]any{"code": "no_address", "net": lan.String()}}
	}
	last := r.loopState()
	tx, ok := r.pickTransit()
	if !ok {
		return Loop{Error: map[string]any{"code": "no_transit"}}
	}
	saw := 0
	if last.Plan != nil {
		saw = last.Plan.Table
	}
	table, ok := r.pickTable(saw)
	if !ok {
		return Loop{Error: map[string]any{"code": "no_table"}}
	}
	p := &LoopPlan{Dev: dev, Gateway: ipnet.String(router), Address: addr, MAC: mac, Prefix: lan.Prefix, DNS: facts.dns, Transit: tx,
		TxRoot: ipnet.String(tx + 1), TxNS: ipnet.String(tx + 2), Table: table, Servers: []LoopServer{}}
	if p.DNS == "" {
		p.DNS = p.Gateway
	}
	// by the settings alone, whoever is loaded now: the path does not move with people's states
	behind := snap.Behind(m)
	for _, srv := range wanted {
		_, _, nets, _ := snap.ServerNet(srv)
		var sites []string
		for _, id := range m.DeviceIDs() {
			if p := m.People[m.Devices[id].Person]; p != nil && p.Server == srv.ID {
				sites = append(sites, behind[id]...)
			}
		}
		if sites != nil {
			sites = ipnet.Collapse(sites)
		}
		p.Servers = append(p.Servers, LoopServer{Ifname: srv.Ifname, Subnet: srv.Subnet,
			Direct: ipnet.Collapse(append(append([]string{srv.Subnet}, nets...), sites...)), Behind: sites})
	}
	return Loop{Plan: p}
}

/* ---------- apply ---------- */

// NSRules is the netns's nft script as text. With fast, a flowtable on the netns's own two links takes
// established TCP and UDP flows past conntrack and the forward hook here. Only dlx1 and dll1: the root
// namespace's links stay out, the guard there sees every packet.
func NSRules(p *LoopPlan, fast bool) string {
	ft, add := "", ""
	if fast {
		ft = "\n\tflowtable ft {\n\t\thook ingress priority 0;\n\t\tdevices = { \"" + txNS + "\", \"" + lanNS + "\" };\n\t}"
		add = "\n\t\tct state established meta l4proto { tcp, udp } flow add @ft"
	}
	return "table inet dawnline\ndelete table inet dawnline\ntable inet dawnline {" + ft + `
	chain nat_pre {
		type nat hook prerouting priority dstnat; policy accept;
		iifname "` + txNS + `" ip daddr ` + p.Address + ` meta l4proto { tcp, udp } th dport 53 dnat ip to ` + p.DNS + `:53
	}
	chain nat_post {
		type nat hook postrouting priority srcnat; policy accept;
		oifname "` + lanNS + `" masquerade
	}
	chain filter_forward {
		type filter hook forward priority filter; policy drop;` + add + `
		ct state established,related accept
		iifname "` + txNS + `" oifname "` + lanNS + `" accept
	}
	chain filter_input {
		type filter hook input priority filter; policy drop;
		ct state established,related accept
		iifname "lo" accept
		icmp type echo-request accept
		iifname "` + txNS + `" meta l4proto { tcp, udp } th dport 53 accept
	}
}
`
}

// loadNSRules loads the netns's rules, with the flowtable when the kernel takes it, else without (the path
// works either way): slow is why the flowtable failed, err why the rules without it failed too.
func (r *Router) loadNSRules(p *LoopPlan) (fast bool, slow, err string) {
	os.MkdirAll(r.varEtc(), 0o755)
	path := r.varEtc() + "/dawnline-ns.nft"
	load := func(fast bool) string {
		os.WriteFile(path, []byte(NSRules(p, fast)), 0o644)
		if errs := r.run([]string{"ip netns exec " + loopNS + " nft -f " + path}); len(errs) > 0 {
			return errs[0]
		}
		return ""
	}
	if slow = load(true); slow == "" {
		return true, "", ""
	}
	return false, slow, load(false)
}

// LoopRule is one policy rule of the path (To "": all).
type LoopRule struct {
	Pref  int
	Iif   string
	To    string
	Table string
}

// LoopRules is the policy rules a plan wants, in order. A server interface: DNS to the netns address
// through the netns, home networks and the tunnel network by main, the rest into the netns.
func LoopRules(p *LoopPlan) []LoopRule {
	var out []LoopRule
	if p == nil {
		return out
	}
	table := strconv.Itoa(p.Table)
	for _, s := range p.Servers {
		out = append(out, LoopRule{prefLoopDNS, s.Ifname, p.Address + "/32", table})
		for _, n := range s.Direct {
			out = append(out, LoopRule{prefMain, s.Ifname, n, "main"})
		}
		out = append(out, LoopRule{prefLoop, s.Ifname, "", table})
	}
	return out
}

// IPRule is a policy rule as `ip -j -4 rule show` prints it.
type IPRule struct {
	Priority int             `json:"priority"`
	Src      string          `json:"src"`
	Srclen   *int            `json:"srclen"`
	Dst      string          `json:"dst"`
	Dstlen   *int            `json:"dstlen"`
	Iif      string          `json:"iif"`
	Table    string          `json:"table"`
	Detached json.RawMessage `json:"iif_detached"`
}

// currentRules is our policy rules: in our priority band and bound to a Dawnline tunnel interface, or left
// behind by a removed tunnel (its interface is gone).
func (r *Router) currentRules(ifnames []string) []IPRule {
	var out []IPRule
	said, code := r.sh("ip -j -4 rule show")
	if code != 0 {
		return out
	}
	var all []IPRule
	if json.Unmarshal([]byte(trimmed(said)), &all) != nil {
		return out
	}
	for _, x := range all {
		if x.Priority >= 5200 && x.Priority < 5300 && x.Iif != "" && (has(ifnames, x.Iif) || x.Detached != nil) {
			out = append(out, x)
		}
	}
	return out
}

// ruleNet is a source or destination as `ip -j rule` has it, or "" for all.
func ruleNet(addr string, n *int) string {
	if addr == "" || addr == "all" {
		return ""
	}
	if n != nil {
		return addr + "/" + strconv.Itoa(*n)
	}
	return addr
}

func ruleKey(pref int, from, iif, to, table string) string {
	// `ip -j rule` shows a /32 source or destination without its length
	full := func(n string) string {
		switch {
		case n == "":
			return "all"
		case !strings.Contains(n, "/"):
			return n + "/32"
		}
		return n
	}
	return fmt.Sprintf("%d %s %s %s %s", pref, full(from), iif, full(to), table)
}

func ruleDel(x IPRule) string {
	cmd := "ip -4 rule del priority " + strconv.Itoa(x.Priority)
	if from := ruleNet(x.Src, x.Srclen); from != "" {
		cmd += " from " + from
	}
	cmd += " iif " + q(x.Iif)
	if to := ruleNet(x.Dst, x.Dstlen); to != "" {
		cmd += " to " + to
	}
	return cmd + " lookup " + x.Table
}

// RuleCmds is the commands that turn the rules there are into the ones a plan wants: the missing ones
// added first, then the ones no longer wanted removed, so a device's traffic never falls between two
// rules while others change. None when they are as wanted.
func RuleCmds(p *LoopPlan, current []IPRule) []string {
	have, want := map[string]IPRule{}, map[string]bool{}
	var order, cmds, twice []string
	for _, x := range current {
		k := ruleKey(x.Priority, ruleNet(x.Src, x.Srclen), x.Iif, ruleNet(x.Dst, x.Dstlen), x.Table)
		if _, seen := have[k]; seen {
			twice = append(twice, ruleDel(x))
		} else {
			order = append(order, k)
		}
		have[k] = x
	}
	for _, w := range LoopRules(p) {
		k := ruleKey(w.Pref, "", w.Iif, w.To, w.Table)
		if _, there := have[k]; !there && !want[k] {
			cmd := "ip -4 rule add priority " + strconv.Itoa(w.Pref) + " iif " + q(w.Iif)
			if w.To != "" {
				cmd += " to " + w.To
			}
			cmds = append(cmds, cmd+" lookup "+w.Table)
		}
		want[k] = true
	}
	for _, k := range order {
		if !want[k] {
			cmds = append(cmds, ruleDel(have[k]))
		}
	}
	// the same rule twice (one deletion removes one of them)
	return append(cmds, twice...)
}

// LoopRemove takes away the netns, links and rules, and the router's neighbour entry for the netns.
func (r *Router) LoopRemove(ifnames []string) {
	last := r.loopState().Plan
	// read while the link is there: the entry is ours when it carries the netns's MAC
	stale := false
	if last != nil && last.Dev != "" {
		held := r.usedAddresses(last.Dev)[last.Address]
		stale = held != "" && (held == last.MAC || held == r.ourMAC())
	}
	var cmds []string
	for _, x := range r.currentRules(ifnames) {
		cmds = append(cmds, ruleDel(x))
	}
	if last != nil && last.Table != 0 {
		cmds = append(cmds, "ip -4 route flush table "+strconv.Itoa(last.Table))
	}
	if r.linkThere(txRoot) {
		cmds = append(cmds, "ip link del "+txRoot)
	}
	if r.linkThere(lanRoot) {
		cmds = append(cmds, "ip link del "+lanRoot)
	}
	if r.nsThere() {
		cmds = append(cmds, "ip netns del "+loopNS)
	}
	// left there, it would hold the address for a MAC nobody has
	if stale {
		cmds = append(cmds, "ip -4 neigh del "+q(last.Address)+" dev "+q(last.Dev))
	}
	r.run(cmds)
	os.Remove(r.RunDir + "/loop.json")
}

func sameJSON(a, b any) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return string(x) == string(y)
}

// LoopEnsure brings the path to the plan. Cheap when nothing changed: it compares with the last applied
// plan and only checks that links, bridge port and rules exist. saved is the LAN address kept from before.
func (r *Router) LoopEnsure(m *model.Model, saved string, force bool) Loop {
	state := r.RunDir + "/loop.json"
	var ifnames []string
	for _, id := range m.ServerIDs() {
		ifnames = append(ifnames, m.Servers[id].Ifname)
	}
	res := r.LoopPlanFor(m, saved)
	if res.Plan == nil {
		// read before the removal, which deletes it: the error is logged once, not every tick
		was := r.loopState()
		if was.Plan != nil || r.linkThere(txRoot) || r.linkThere(lanRoot) || len(r.currentRules(ifnames)) > 0 {
			r.LoopRemove(ifnames)
		}
		os.MkdirAll(r.RunDir, 0o755)
		var why any
		if res.Error != nil {
			why = res.Error
		}
		files.WriteJSON(state, map[string]any{"error": why, "off": res.Off}, 0o644)
		if res.Error != nil && !sameJSON(res.Error, was.Error) {
			r.loopLog("error", "is off", LoopErrorNote(res.Error))
		}
		return res
	}
	p := res.Plan
	last := r.loopState()
	same := !force && last.Applied != 0 && last.Plan != nil && reflect.DeepEqual(last.Plan, p)
	master, _ := os.Readlink(r.sysNet() + "/" + lanRoot + "/master")
	healthy := r.linkThere(txRoot) && r.linkThere(lanRoot) && r.nsThere() && master != "" && filepath.Base(master) == p.Dev
	if same && healthy && len(RuleCmds(p, r.currentRules(ifnames))) == 0 {
		return res
	}
	// A link made by an older version has a random MAC (its plan had none, so this runs once after an
	// update): it gets the stable one.
	remac := r.linkThere(lanRoot) && r.ourMAC() != p.MAC
	var cmds []string
	if !r.nsThere() {
		cmds = append(cmds, "ip netns add "+loopNS)
	}
	if !r.linkThere(txRoot) {
		cmds = append(cmds, "ip link add "+txRoot+" type veth peer name "+txNS+" netns "+loopNS)
	}
	if !r.linkThere(lanRoot) {
		cmds = append(cmds, "ip link add "+lanRoot+" type veth peer name "+lanNS+" address "+p.MAC+" netns "+loopNS)
	}
	if remac {
		cmds = append(cmds, "ip -n "+loopNS+" link set "+lanNS+" down", "ip -n "+loopNS+" link set "+lanNS+" address "+p.MAC)
	}
	errs := r.run(cmds)
	n := "ip -n " + loopNS + " "
	cmds = []string{
		"ip addr flush dev " + txRoot,
		"ip addr add " + p.TxRoot + "/30 dev " + txRoot,
		"ip link set " + txRoot + " up",
		"ip link set " + lanRoot + " master " + q(p.Dev),
		"ip link set " + lanRoot + " up",
		n + "link set lo up",
		n + "addr flush dev " + txNS,
		n + "addr add " + p.TxNS + "/30 dev " + txNS,
		n + "link set " + txNS + " up",
		n + "addr flush dev " + lanNS,
		n + "addr add " + p.Address + "/" + strconv.Itoa(p.Prefix) + " dev " + lanNS,
		n + "link set " + lanNS + " up",
		n + "route replace default via " + p.Gateway + " dev " + lanNS,
		// the resolver's own queries (from the transit address) go back out the transit link
		n + "route replace default via " + p.TxRoot + " dev " + txNS + " table 100",
		n + "rule del from " + p.TxNS + " lookup 100 2>/dev/null; " + n + "rule add from " + p.TxNS + " lookup 100",
		"ip netns exec " + loopNS + " sh -c 'echo 1 > /proc/sys/net/ipv4/ip_forward; echo 0 > /proc/sys/net/ipv4/conf/all/rp_filter; echo 0 > /proc/sys/net/ipv4/conf/default/rp_filter'",
		"ip -4 route replace default via " + p.TxNS + " dev " + txRoot + " table " + strconv.Itoa(p.Table),
	}
	// the networks behind routers are answered through the tunnel too; the ones of the plan before go first
	sites := false
	for _, s := range p.Servers {
		sites = sites || len(s.Behind) > 0
	}
	if last.Plan != nil {
		for _, s := range last.Plan.Servers {
			sites = sites || len(s.Behind) > 0
		}
	}
	if sites {
		cmds = append(cmds, n+"route flush proto "+routeProto+" 2>/dev/null || true")
	}
	for _, s := range p.Servers {
		cmds = append(cmds, n+"route replace "+q(s.Subnet)+" via "+q(p.TxRoot)+" dev "+txNS)
		for _, b := range s.Behind {
			cmds = append(cmds, n+"route replace "+q(b)+" via "+q(p.TxRoot)+" dev "+txNS+" proto "+routeProto)
		}
	}
	// the router knows the address by the old MAC: ask again now, not when the entry expires
	if remac {
		cmds = append(cmds, "ip -4 neigh flush to "+p.Address+" dev "+q(p.Dev))
	}
	errs = append(errs, r.run(cmds)...)
	fast, slow, err := r.loadNSRules(p)
	if err != "" {
		errs = append(errs, err)
	}
	errs = append(errs, r.run(RuleCmds(p, r.currentRules(ifnames)))...)
	if len(errs) > 0 {
		why := map[string]any{"code": "setup", "detail": errs[0]}
		if !sameJSON(r.loopState().Error, why) {
			r.loopLog("error", "failed - internet goes out directly for now", errs[0])
		}
		r.LoopRemove(ifnames)
		files.WriteJSON(state, map[string]any{"error": why}, 0o644)
		return Loop{Error: why}
	}
	os.MkdirAll(r.RunDir, 0o755)
	files.WriteJSON(state, loopState2{Applied: time.Now().Unix(), Plan: p, Transit: p.Transit, Fast: fast}, 0o644)
	switch {
	case last.Applied == 0 || last.Plan == nil || last.Plan.Dev != p.Dev || last.Plan.Address != p.Address:
		r.loopLog("up", fmt.Sprintf("is on · traffic enters %s as %s", p.Dev, p.Address), "")
	case !healthy:
		r.loopLog("repair", fmt.Sprintf("was broken - set up again (%s as %s)", p.Dev, p.Address), "")
	}
	// once, not again on every apply while the module is still missing
	if !fast && (last.Fast == nil || *last.Fast) {
		r.loopLog("info", "runs without its fast path",
			"Without kmod-nft-offload every packet on this path passes the firewall twice. Install it and restart Dawnline.\n"+slow)
	}
	return res
}

// loopState2 is loop.json while the path is up, in ucode's own order of keys.
type loopState2 struct {
	Applied int64     `json:"applied"`
	Plan    *LoopPlan `json:"plan"`
	Transit uint32    `json:"transit"`
	Fast    bool      `json:"fast"`
}
