// Package apply puts the settings into effect on the router, as dawnline.apply does. This file is the
// runtime sync: the access table's sets, the devices into the tunnels (AmneziaWG peers) and the hostnames.
// Cheap, and safe to call often.
//
// Fail closed: without the table the firewall would let every loaded device reach everything, so while it
// is missing no device is loaded at all. An older table that survived a failed rebuild keeps limiting them
// with the sets it has, and the devices still follow people's states (a revoked one leaves).
//
// Held to ucode on a router whose `nft` and `awg` are stand-ins that keep what they are given
// (testdata/trace.uc, scripts/ucode-golden.sh): the scripts loaded, the peers of each tunnel, the
// hostnames and what is answered, through a table that is not there yet, one that will not load and a
// tunnel that refuses its devices.
package apply

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"

	"github.com/tickcount/luci-app-dawnline/backend/files"
	"github.com/tickcount/luci-app-dawnline/backend/health"
	"github.com/tickcount/luci-app-dawnline/backend/i18n"
	"github.com/tickcount/luci-app-dawnline/backend/ipnet"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/netview"
	"github.com/tickcount/luci-app-dawnline/backend/nft"
	"github.com/tickcount/luci-app-dawnline/backend/servicelog"
	"github.com/tickcount/luci-app-dawnline/backend/state"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
	"github.com/tickcount/luci-app-dawnline/backend/usage"
	"github.com/tickcount/luci-app-dawnline/backend/view"
)

// Router is the router a sync works on.
type Router struct {
	// RunDir is the state directory (locks, what was last loaded); HostsFile where dnsmasq reads extra names;
	// Network the router's network configuration, Firewall its firewall's.
	RunDir, HostsFile, Network, Firewall string
	// VarEtc is where generated configurations go ("": /var/etc); ResolverPid the Home-only resolver's pid file.
	VarEtc, ResolverPid string
	// Remember keeps the LAN address the home-like path chose (settings.lan_address), so it is the same after a restart.
	Remember func(address string)
	// dry: nothing outside the files this router is given is written (ApplyPlan).
	dry bool
	// SysNet is where the kernel shows interfaces ("": /sys/class/net), NetnsDir where named network
	// namespaces are ("": /var/run/netns), Leases dnsmasq's leases ("": /tmp/dhcp.leases).
	SysNet, NetnsDir, Leases string
	// Exec runs a command: what it said (both streams) and its exit code.
	Exec func(name string, args ...string) (out string, code int)
	// Snapshot is the router's interfaces; DHCP the path of its DHCP settings.
	Snapshot func() *netview.Snapshot
	DHCP     string
	Log      *servicelog.Log
}

// Result is what a sync came to: each server's devices ("ok", "down", or what awg said), people's states,
// the table's error ("" when it loaded), the routes' ("" when they are as wanted) and a sentence for the
// admin when it did not fully take.
type Result struct {
	Peers   map[string]string
	States  map[string]string
	Table   string
	Routes  string
	Warning string
}

func (r *Router) say(level, src, line string) {
	if r.Log != nil {
		r.Log.Say(level, src, line)
	}
}

// someOf names up to ten of a list, and how many more there are.
func someOf(list []string) string {
	if len(list) <= 10 {
		return strings.Join(list, ", ")
	}
	return strings.Join(list[:10], ", ") + " and " + strconv.Itoa(len(list)-10) + " more"
}

func minus(a, b []string) []string {
	in := map[string]bool{}
	for _, x := range b {
		in[x] = true
	}
	var out []string
	for _, x := range a {
		if !in[x] {
			out = append(out, x)
		}
	}
	return out
}

func uniq(list []string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, x := range list {
		if !seen[x] {
			seen[x] = true
			out = append(out, x)
		}
	}
	return out
}

// tunnelOK tells a server that runs one of Dawnline's own tunnels.
func tunnelOK(srv *model.Server) bool {
	_, ok := ipnet.Subnet(srv.Subnet)
	return ok && srv.PrivateKey != "" && srv.Blocked == nil && model.ValidIfname(srv.Ifname)
}

// likeHome is the home-like path as it stands (dawnline.loop status): whether it is up, its address on the
// LAN, the LAN's DNS it found and its address on the inner link.
func (r *Router) likeHome() (active bool, address, dns, transit string) {
	var s struct {
		Plan *struct {
			Address string `json:"address"`
			DNS     string `json:"dns"`
			TxNS    string `json:"tx_ns"`
		} `json:"plan"`
	}
	files.ReadJSON(r.RunDir+"/loop.json", &s)
	if s.Plan == nil {
		return false, "", "", ""
	}
	_, e1 := os.Stat("/sys/class/net/dlx0")
	_, e2 := os.Stat("/sys/class/net/dll0")
	return e1 == nil && e2 == nil, s.Plan.Address, s.Plan.DNS, s.Plan.TxNS
}

var dnsOption = regexp.MustCompile(`^(option:dns-server|6),([0-9.]+)`)

// lanDNS is the DNS the LAN gets from DHCP (option 6), else the router on the LAN (dawnline.loop lan_dns);
// known is what the home-like path found already.
func (r *Router) lanDNS(snap *netview.Snapshot, known string) string {
	out := known
	if lan := snap.Devices[snap.LAN]; out == "" && lan != nil && len(lan.Addrs) > 0 {
		out = strings.SplitN(lan.Addrs[0], "/", 2)[0]
		if _, ok := ipnet.Subnet(lan.Addrs[0]); ok {
			if raw, err := os.ReadFile(r.DHCP); err == nil {
				if c, err := uci.Parse(string(raw)); err == nil {
					found := ""
					for _, s := range c.OfType("dhcp") {
						iface, _ := s.Get("interface")
						if ignore, _ := s.Get("ignore"); iface != lan.Logical || ignore == "1" {
							continue
						}
						v := s.Values["dhcp_option"]
						opts := v.List
						if !v.IsList && v.Str != "" {
							opts = []string{v.Str}
						}
						for _, o := range opts {
							if m := dnsOption.FindStringSubmatch(o); m != nil && found == "" {
								found = m[2]
							}
						}
					}
					if found != "" {
						out = found
					}
				}
			}
		}
	}
	return out
}

// Ctx is what the table is made from besides the settings, read from the router (dawnline.nft router_ctx).
func (r *Router) Ctx(snap *netview.Snapshot) nft.Ctx {
	active, address, dns, transit := r.likeHome()
	ctx := nft.Ctx{Snap: snap, ResolverPort: 5354}
	if active {
		ctx.DNSAddr = address
		if transit != "" {
			ctx.ResolverNS, ctx.ResolverPort = transit, 53
		}
	}
	ctx.LanDNS = r.lanDNS(snap, dns)
	return ctx
}

// load runs an nft script (one transaction): "" when it loaded, else what nft said.
func (r *Router) load(script string) string {
	os.MkdirAll(r.RunDir, 0o755)
	// a file of its own: two writers must never load each other's script
	var b [4]byte
	rand.Read(b[:])
	f := r.RunDir + "/nft." + hex.EncodeToString(b[:]) + ".rules"
	if os.WriteFile(f, []byte(script), 0o600) != nil {
		return "couldn't write " + f
	}
	out, code := r.Exec("nft", "-f", f)
	os.Remove(f)
	if code == 0 {
		return ""
	}
	// without the random file name, so the same failure reads the same every time
	if said := strings.ReplaceAll(strings.Trim(out, " \t\r\n\v\f"), f, "rules"); said != "" {
		return said
	}
	return fmt.Sprintf("nft exited with %d", code)
}

// Present tells whether the table is loaded.
func (r *Router) Present() bool {
	_, code := r.Exec("nft", "list", "table", "inet", "dawnline")
	return code == 0
}

// logSets tells the sets in syslog: each that changed, or that none did; remembered for the next time.
func (r *Router) logSets(sets nft.Sets, how string) {
	path := r.RunDir + "/nft-sets.json"
	var was map[string][]string
	first := !files.ReadJSON(path, &was) || was == nil
	now := map[string][]string{}
	var diff, counts []string
	for _, name := range nft.Names {
		a, b := uniq(was[name]), uniq(sets[name])
		now[name] = b
		counts = append(counts, name+" "+strconv.Itoa(len(b)))
		add, del := minus(b, a), minus(a, b)
		if len(add) > 0 || len(del) > 0 {
			line := fmt.Sprintf("%s %d → %d", name, len(a), len(b))
			if len(add) > 0 {
				line += ": +" + someOf(add)
			}
			if len(del) > 0 {
				if len(add) > 0 {
					line += " -" + someOf(del)
				} else {
					line += ": -" + someOf(del)
				}
			}
			diff = append(diff, line)
		}
	}
	files.WriteJSON(path, now, 0o600)
	switch {
	// the first load since the router started: how many in each set (the members at debug)
	case first:
		r.say("info", "nftables", "table inet dawnline: "+how+" · "+strings.Join(counts, ", "))
		for _, n := range nft.Names {
			if len(now[n]) > 0 {
				r.say("debug", "nftables", "set "+n+": "+strings.Join(now[n], " "))
			}
		}
	case len(diff) > 0:
		r.say("info", "nftables", "table inet dawnline: "+how+" · "+strings.Join(diff, "; "))
	default:
		r.say("debug", "nftables", "table inet dawnline: "+how+" · sets unchanged ("+strings.Join(counts, ", ")+")")
	}
}

// rebuild replaces the whole table: "" or the error.
//
// members: a runtime sync, where only who is in the sets may have moved. The table is replaced whole all
// the same: to add an element to a set that exists, nft first reads the router's whole ruleset, every
// other program's sets with it (0.9 s on an MT7981 beside a proxy's lists), where replacing our own table
// reads nothing (0.06 s). The line in the log is then the sets', and the rebuild's own is for a debug log.
func (r *Router) rebuild(m *model.Model, sets nft.Sets, snap *netview.Snapshot, members bool) string {
	table := nft.Render(m, sets, r.Ctx(snap))
	if err := r.load(nft.Rebuild(table)); err != "" {
		r.say("error", "nftables", "table inet dawnline: rebuild failed · "+err)
		return err
	}
	chains, nsets, rules := nft.Shape(table)
	level, how := "info", "sets loaded with the table"
	if members {
		level, how = "debug", "sets updated"
	}
	r.say(level, "nftables", fmt.Sprintf("table inet dawnline: rebuilt · %d chains, %d sets, %d rules", chains, nsets, rules))
	r.logSets(sets, how)
	return ""
}

// table has the table in place, replaced whole every time: with `full` after a change of its shape,
// otherwise for who is in its sets. A failure is told in the service log once per distinct error.
func (r *Router) table(m *model.Model, sets nft.Sets, snap *netview.Snapshot, full bool) string {
	err := r.rebuild(m, sets, snap, !full)
	path := r.RunDir + "/nft.err"
	was, werr := os.ReadFile(path)
	if err == "" {
		if werr == nil {
			os.Remove(path)
		}
		return ""
	}
	if werr != nil || string(was) != err {
		msg := "couldn't load - no device is loaded into the tunnels until they do"
		if r.Present() {
			msg = "couldn't be updated - the previous rules stay, and changes to access wait until they load"
		}
		if r.Log != nil {
			r.Log.Write("dawnline", "error", msg, err, "Access rules", servicelog.Extra{})
		}
		os.MkdirAll(r.RunDir, 0o755)
		os.WriteFile(path, []byte(err), 0o644)
	}
	return err
}

// PeersConf is what a tunnel is given to hold: its own key and port, then each device that belongs there
// with the networks behind it (behind: by the device's id), and who they are for a log line
// ("Person · Device (address)").
func PeersConf(m *model.Model, srv *model.Server, states map[string]string, behind map[string][]string) (conf string, who []string) {
	lines := []string{"[Interface]", "PrivateKey = " + srv.PrivateKey, "ListenPort = " + strconv.Itoa(srv.Port), ""}
	who = []string{}
	for _, d := range health.TunnelDevices(m, srv.ID, states) {
		lines = append(lines, "[Peer]", "PublicKey = "+d.PublicKey)
		if d.PresharedKey != "" {
			lines = append(lines, "PresharedKey = "+d.PresharedKey)
		}
		// a router brings the networks behind it: the tunnel takes their packets from it and sends theirs to it
		lines = append(lines, "AllowedIPs = "+strings.Join(append([]string{d.Address + "/32"}, behind[d.ID]...), ", "), "")
		name := d.Person
		if p := m.People[d.Person]; p != nil {
			name = p.Name
		}
		who = append(who, name+" · "+d.Name+" ("+strings.Join(append([]string{d.Address}, behind[d.ID]...), ", ")+")")
	}
	return strings.Join(lines, "\n"), who
}

// peers pushes every server's devices to the kernel without restarting its tunnel.
func (r *Router) peers(m *model.Model, states map[string]string, behind map[string][]string) map[string]string {
	os.MkdirAll(r.RunDir, 0o755)
	res := map[string]string{}
	path := r.RunDir + "/peers-seen.json"
	seen := map[string][]string{}
	files.ReadJSON(path, &seen)
	now := map[string][]string{}
	for _, id := range m.ServerIDs() {
		srv := m.Servers[id]
		// only Dawnline's own interfaces: never another tunnel of the same name
		if !srv.Enabled || !tunnelOK(srv) {
			continue
		}
		if _, code := r.Exec("awg", "show", srv.Ifname, "public-key"); code != 0 {
			res[id] = "down"
			r.say("debug", "awg", "interface "+srv.Ifname+" ("+srv.Name+"): down, no devices to load")
			continue
		}
		conf, who := PeersConf(m, srv, states, behind)
		f := r.RunDir + "/" + srv.Ifname + ".conf"
		os.WriteFile(f, []byte(conf), 0o600)
		out, code := r.Exec("awg", "syncconf", srv.Ifname, f)
		os.Remove(f)
		if code != 0 {
			res[id] = strings.Trim(out, " \t\r\n\v\f")
			if r.Log != nil {
				r.Log.Write("awg", "error", "couldn't load devices into the tunnel", res[id], srv.Name, servicelog.Extra{})
			}
			continue
		}
		res[id] = "ok"
		// who came in and who left since the last load: info; the same peers: debug
		now[srv.Ifname] = who
		plural := "peers"
		if len(who) == 1 {
			plural = "peer"
		}
		head := fmt.Sprintf("interface %s (%s): awg syncconf · listen port %d · %d %s", srv.Ifname, srv.Name, srv.Port, len(who), plural)
		was, had := seen[srv.Ifname]
		if !had {
			r.say("info", "awg", head+" loaded")
			r.say("debug", "awg", "interface "+srv.Ifname+": "+strings.Join(who, ", "))
			continue
		}
		add, del := minus(who, was), minus(was, who)
		switch {
		case len(add) > 0 || len(del) > 0:
			line := head
			if len(add) > 0 {
				line += " · added " + someOf(add)
			}
			if len(del) > 0 {
				line += " · removed " + someOf(del)
			}
			r.say("info", "awg", line)
		default:
			r.say("debug", "awg", head+", unchanged")
		}
	}
	a, _ := json.Marshal(now)
	b, _ := json.Marshal(seen)
	if string(a) != string(b) {
		files.WriteJSON(path, now, 0o600)
	}
	return res
}

// Hosts is the names dnsmasq is given for people's devices: one label a device, unique within the person
// (the pages show the same), and the router's own on the LAN while the home-like path is up.
func Hosts(m *model.Model, lanAddress string) (body string, names int) {
	var lines []string
	if m.Settings.Hostnames {
		for _, pid := range m.PersonIDs() {
			p := m.People[pid]
			labels := view.Labels(m, p)
			for _, id := range p.Devices {
				if d := m.Devices[id]; d != nil {
					if _, ok := ipnet.IP(d.Address); ok {
						lines = append(lines, d.Address+" "+labels[id]+"."+p.ID+"."+m.Settings.Domain)
					}
				}
			}
		}
	}
	if lanAddress != "" {
		lines = append(lines, lanAddress+" dawnline."+m.Settings.Domain)
	}
	if len(lines) == 0 {
		return "", 0
	}
	return strings.Join(lines, "\n") + "\n", len(lines)
}

// hosts keeps the names file as Hosts says and has dnsmasq read it again when it changed.
func (r *Router) hosts(m *model.Model) bool {
	active, address, _, _ := r.likeHome()
	if !active {
		address = ""
	}
	body, n := Hosts(m, address)
	was, _ := os.ReadFile(r.HostsFile)
	// dnsmasq runs as its own user: a file only root reads is no use to it
	readable := false
	if st, err := os.Stat(r.HostsFile); err == nil {
		readable = st.Mode().Perm()&0o004 != 0
	}
	if string(was) == body && (body == "" || readable) {
		r.say("debug", "dns", fmt.Sprintf("%s: unchanged · %d names", r.HostsFile, n))
		return false
	}
	if i := strings.LastIndex(r.HostsFile, "/"); i > 0 {
		os.MkdirAll(r.HostsFile[:i], 0o755)
	}
	if body == "" {
		os.Remove(r.HostsFile)
		r.say("info", "dns", r.HostsFile+": removed (no device names)")
	} else {
		os.WriteFile(r.HostsFile, []byte(body), 0o644)
		os.Chmod(r.HostsFile, 0o644)
		r.say("info", "dns", fmt.Sprintf("%s: %d names written (*.%s) · killall -HUP dnsmasq", r.HostsFile, n, m.Settings.Domain))
	}
	r.Exec("killall", "-HUP", "dnsmasq")
	return true
}

// Sync is the runtime sync: with the apply lock held, the access sets first, then the devices into the
// tunnels, then the hostnames. `full` rebuilds the whole table (its shape changed).
func (r *Router) Sync(m *model.Model, u *usage.Usage, now int64, full bool, t *i18n.Catalog) Result {
	defer files.Lock(r.RunDir, "apply")()
	return r.sync(m, u, now, full, t)
}

// sync is Sync with the apply lock held already.
func (r *Router) sync(m *model.Model, u *usage.Usage, now int64, full bool, t *i18n.Catalog) Result {
	states := map[string]string{}
	for _, id := range m.PersonIDs() {
		states[id] = state.Of(m, m.People[id], u, now)
	}
	snap := r.Snapshot()
	sets := nft.AccessSets(m, states, snap)
	table := r.table(m, sets, snap, full)
	// fail closed: with no table at all, nobody is loaded
	loaded := states
	if table != "" && !r.Present() {
		loaded = map[string]string{}
	}
	behind := snap.Behind(m)
	peers := r.peers(m, loaded, behind)
	routes := r.routes(m, loaded, peers, behind)
	r.hosts(m)
	os.MkdirAll(r.RunDir, 0o755)
	files.WriteJSON(r.RunDir+"/states.json", states, 0o644)
	// what an admin should hear when it did not fully take, with what nft or awg said
	var out []string
	if table != "" {
		if r.Present() {
			out = append(out, fmt.Sprintf(t.T("Access rules couldn't be updated (%s): the previous rules stay, so this change isn't in effect yet."), table))
		} else {
			out = append(out, fmt.Sprintf(t.T("Access rules couldn't load (%s): no device is loaded into the tunnels until they do."), table))
		}
	}
	for _, id := range m.ServerIDs() {
		if res, has := peers[id]; has && res != "ok" && res != "down" {
			out = append(out, fmt.Sprintf(t.T("Couldn't load devices into %s: %s."), m.Servers[id].Name, res))
		}
	}
	if routes != "" {
		out = append(out, fmt.Sprintf(t.T("Couldn't set the routes to the networks behind routers (%s): they aren't reachable yet."), routes))
	}
	warning := ""
	if len(out) > 0 {
		warning = strings.Join(append(out, t.T("Open Overview → Health.")), " ")
	}
	return Result{Peers: peers, States: states, Table: table, Routes: routes, Warning: warning}
}

// Plan is what a sync would load, with nothing loaded: the table's text, the script for its sets, each
// tunnel's peers by interface, the routes to the networks behind routers by interface (as if every tunnel
// took its devices) and the hostnames. For holding the Go sync to what a router runs now.
type Plan struct {
	Table  string              `json:"table"`
	Update string              `json:"update"`
	Peers  map[string]string   `json:"peers"`
	Routes map[string][]string `json:"routes,omitempty"`
	Hosts  string              `json:"hosts"`
}

// Plan works a sync out and loads nothing.
func (r *Router) Plan(m *model.Model, u *usage.Usage, now int64) Plan {
	states := map[string]string{}
	for _, id := range m.PersonIDs() {
		states[id] = state.Of(m, m.People[id], u, now)
	}
	snap := r.Snapshot()
	sets := nft.AccessSets(m, states, snap)
	p := Plan{Table: nft.Render(m, sets, r.Ctx(snap)), Update: nft.Update(sets), Peers: map[string]string{}}
	behind := snap.Behind(m)
	took := map[string]string{}
	for _, id := range m.ServerIDs() {
		if srv := m.Servers[id]; srv.Enabled && tunnelOK(srv) {
			p.Peers[srv.Ifname], _ = PeersConf(m, srv, states, behind)
			took[id] = "ok"
		}
	}
	if want := RoutesWanted(m, states, took, behind); len(want) > 0 {
		p.Routes = want
	}
	active, address, _, _ := r.likeHome()
	if !active {
		address = ""
	}
	p.Hosts, _ = Hosts(m, address)
	return p
}
