package apply

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/awg"
	"github.com/tickcount/luci-app-dawnline/backend/files"
	"github.com/tickcount/luci-app-dawnline/backend/i18n"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/usage"
)

// The full apply (dawnline.apply apply): the settings turned into router state. Network interfaces, the
// firewall, the home-like path and the Home-only resolver, the reply table, then the runtime sync with the
// access table rebuilt. One lock ("apply") for all of it, the settings read inside it, so a rebuild and a
// runtime sync never interleave and the last one to run works from the newest settings.

// Full is what a full apply came to.
type Full struct {
	Network, Firewall bool
	// LikeHome is true while the home-like path is up, false when nobody wants it, or why it cannot be:
	// {error: a sentence in the admin's language}.
	LikeHome any
	Peers    map[string]string
	Warning  string
}

// uc writes a value as ucode's "%J" does: the agent compares the signature as text.
func uc(v any) string {
	switch x := v.(type) {
	case nil:
		return "null"
	case bool:
		return strconv.FormatBool(x)
	case string:
		return strconv.Quote(x)
	case []string:
		if len(x) == 0 {
			return "[ ]"
		}
		q := make([]string, len(x))
		for i, s := range x {
			q[i] = strconv.Quote(s)
		}
		return "[ " + strings.Join(q, ", ") + " ]"
	case []any:
		if len(x) == 0 {
			return "[ ]"
		}
		q := make([]string, len(x))
		for i, s := range x {
			q[i] = uc(s)
		}
		return "[ " + strings.Join(q, ", ") + " ]"
	case [][2]any:
		if len(x) == 0 {
			return "{ }"
		}
		q := make([]string, len(x))
		for i, kv := range x {
			q[i] = strconv.Quote(kv[0].(string)) + ": " + uc(kv[1])
		}
		return "{ " + strings.Join(q, ", ") + " }"
	}
	return "null"
}

func orNull(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// NetSignature is everything on the router that Dawnline's state is derived from: WAN and LAN, the home
// networks and zones of each server, the netns address and the LAN's DNS (dawnline.apply net_signature).
// An apply is due again when it changes (LAN renumbered, interface added, bridge recreated, DHCP DNS changed).
func (r *Router) NetSignature(m *model.Model) string {
	snap := r.Snapshot()
	var servers [][2]any
	for _, id := range m.ServerIDs() {
		wan, home, nets, zones := snap.ServerNet(m.Servers[id])
		homes := []any{}
		for _, h := range home {
			homes = append(homes, [][2]any{{"dev", h.Dev}, {"auto", h.Auto}, {"nets", append([]string{}, h.Nets...)}, {"zone", orNull(h.Zone)}, {"missing", h.Missing}})
		}
		servers = append(servers, [2]any{id, [][2]any{
			{"wan", [][2]any{{"dev", orNull(wan.Dev)}, {"auto", wan.Auto}, {"zone", wan.Zone}, {"missing", wan.Missing}}},
			{"home", homes}, {"nets", append([]string{}, nets...)}, {"zones", append([]string{}, zones...)}}})
	}
	var addrs any
	if lan := snap.Devices[snap.LAN]; lan != nil {
		addrs = append([]string{}, lan.Addrs...)
	}
	active, address, known, _ := r.likeHome()
	var loop any
	if active {
		loop = orNull(address)
	}
	return uc([][2]any{{"wan", orNull(snap.WAN)}, {"lan", orNull(snap.LAN)}, {"addrs", addrs}, {"servers", servers},
		{"dns", orNull(r.lanDNS(snap, known))}, {"loop", loop}})
}

// loopErrorText says why the home-like path is off, in the reader's language (dawnline.loop error_text).
func loopErrorText(e map[string]any, t *i18n.Catalog) string {
	switch e["code"] {
	case "no_lan":
		return t.T("No LAN detected.")
	case "not_bridge":
		return fmt.Sprintf(t.T("%s is not a bridge, so Dawnline cannot join the LAN as a device."), e["dev"])
	case "no_ipv4":
		return fmt.Sprintf(t.T("%s has no IPv4 address."), e["dev"])
	case "no_address":
		return fmt.Sprintf(t.T("No free address on %s."), e["net"])
	case "no_transit":
		return t.T("No free link-local range for the internal link.")
	case "no_table":
		return t.T("No free routing table.")
	}
	return fmt.Sprintf(t.T("Setup failed: %s"), e["detail"])
}

func count(n int, one, many string) string {
	if n == 1 {
		return "1 " + one
	}
	return strconv.Itoa(n) + " " + many
}

// Apply is the full apply. load reads the settings anew (with the LAN address kept for the home-like
// path) once the lock is held; tools tells whether amneziawg-tools is there, caps what this AmneziaWG runs.
func (r *Router) Apply(load func() (*model.Model, string, error), u *usage.Usage, t *i18n.Catalog, tools bool, caps awg.Caps) Full {
	t0 := time.Now()
	r.say("debug", "apply", "applying the configuration")
	step := func(name string, fn func() string) {
		at := time.Now()
		what := fn()
		if what != "" {
			what = " · " + what
		}
		r.say("debug", "apply", fmt.Sprintf("%s done in %d ms%s", name, time.Since(at).Milliseconds(), what))
	}
	changed := func(x bool) string {
		if x {
			return "changed"
		}
		return "unchanged"
	}
	unlock := files.Lock(r.RunDir, "apply")
	m, saved, err := load()
	if err != nil {
		unlock()
		r.say("error", "apply", "the settings could not be read: nothing was applied · "+err.Error())
		return Full{Warning: err.Error(), LikeHome: false}
	}
	var out Full
	var lp Loop
	var s Result
	step("network (netifd)", func() string { out.Network = r.Netifd(m, tools, caps); return changed(out.Network) })
	step("firewall (fw4)", func() string { out.Firewall = r.Fw(m); return changed(out.Firewall) })
	step("internet like a home device", func() string { lp = r.LoopEnsure(m, saved, true); return "" })
	step("resolver for Home-only devices", func() string { r.SyncResolver(m); return "" })
	step("reply routes", func() string { r.ReplyRoutes(m); return "" })
	step("access rules and devices", func() string { s = r.sync(m, u, time.Now().Unix(), true, t); return "" })
	os.MkdirAll(r.RunDir, 0o755)
	os.WriteFile(r.RunDir+"/net.sig", []byte(r.NetSignature(m)), 0o644)
	present := s.Table != "" && r.Present()
	unlock()
	// the address is kept once the lock is released: the settings' own lock is never taken inside it
	if lp.Plan != nil && lp.Plan.Address != "" && lp.Plan.Address != saved && r.Remember != nil {
		r.Remember(lp.Plan.Address)
	}
	took := fmt.Sprintf("configuration applied in %d ms · %s, %s, %s", time.Since(t0).Milliseconds(),
		count(len(m.Servers), "server", "servers"), count(len(m.People), "person", "people"), count(len(m.Devices), "device", "devices"))
	// the same as the warning, for syslog: in English whatever the admin's language
	var facts []string
	if s.Table != "" {
		if present {
			facts = append(facts, "access rules not updated, the previous ones stay: "+s.Table)
		} else {
			facts = append(facts, "access rules not loaded, no device loaded: "+s.Table)
		}
	}
	for _, id := range m.ServerIDs() {
		if res, has := s.Peers[id]; has && res != "ok" && res != "down" {
			facts = append(facts, m.Servers[id].Name+": devices not loaded: "+res)
		}
	}
	if len(facts) > 0 {
		r.say("warn", "apply", took+" · "+strings.Join(facts, " · "))
	} else {
		r.say("info", "apply", took)
	}
	out.Peers, out.Warning = s.Peers, s.Warning
	out.LikeHome = !lp.Off
	if lp.Error != nil {
		note := LoopErrorNote(lp.Error)
		if lp.Error["code"] == "setup" {
			note = fmt.Sprintf("Setup failed: %v", lp.Error["detail"])
		}
		r.say("warn", "apply", "internet like a home device: "+note)
		out.LikeHome = map[string]any{"error": loopErrorText(lp.Error, t)}
	}
	return out
}

// NetChanged tells whether the router's networks differ from what the last apply worked from.
func (r *Router) NetChanged(m *model.Model) bool {
	was, err := os.ReadFile(r.RunDir + "/net.sig")
	return err != nil || string(was) != r.NetSignature(m)
}

// Teardown removes everything Dawnline made on the router (dawnline.apply teardown): the home-like path,
// the resolver's configuration, every tunnel interface and firewall section of ours, the reply table, the
// access table and the device names. m is the settings as they stand; nothing of them is written here.
func (r *Router) Teardown(m *model.Model) {
	defer files.Lock(r.RunDir, "apply")()
	var ifnames []string
	for _, id := range m.ServerIDs() {
		ifnames = append(ifnames, m.Servers[id].Ifname)
	}
	r.LoopRemove(ifnames)
	os.Remove(r.varEtc() + "/dawnline-dns.conf")
	// as with no server and no portal: what is ours is then nobody's, and goes
	bare := m.WithoutServers()
	bare.Settings.PortalEnabled = false
	r.Netifd(bare, true, awg.Caps{})
	r.Fw(bare)
	r.ReplyRoutes(bare)
	r.Exec("nft", "delete", "table", "inet", "dawnline")
	os.Remove(r.HostsFile)
	os.Remove(r.RunDir + "/net.sig")
	r.Exec("killall", "-HUP", "dnsmasq")
}
