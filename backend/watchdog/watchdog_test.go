package watchdog

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/servicelog"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
)

// A target through its life: one bad minute is nothing, the second is repaired, each repair that did not
// help waits longer, three are said once, and coming back is told with how many it took.
func TestPass(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/run/watchdog.json"
	var said []string
	log := &servicelog.Log{RunDir: dir + "/run", Level: func() string { return "info" }, Syslog: func(_, line string) { said = append(said, line) }}
	ok, runs := false, 0
	probe := func() []Probe {
		return []Probe{{ID: "nft", Src: "dawnline", Name: "Access rules", Who: "Access rules", OK: ok, Problem: "are missing", Back: "are loaded again",
			Detail: func() string { return "what nft said" }, Repair: &Repair{What: "loading them again", Run: func(n int) { runs++ }}}}
	}
	state := func() State {
		var st State
		raw, _ := os.ReadFile(path)
		json.Unmarshal(raw, &st)
		return st
	}
	told := func(part string) int {
		n := 0
		for _, l := range said {
			if strings.Contains(l, part) {
				n++
			}
		}
		return n
	}
	now := int64(1_800_000_000)
	Pass(path, probe(), true, false, now, log)
	if runs != 0 || len(said) != 0 || state().Targets["nft"].Bad != 1 {
		t.Fatalf("one bad minute: %d repairs, %v", runs, said)
	}
	// busy with an update: nothing is repaired, however long it is bad
	Pass(path, probe(), true, true, now+60, log)
	if runs != 0 {
		t.Fatal("repaired during an update")
	}
	Pass(path, probe(), true, false, now+120, log)
	if runs != 1 || told("Access rules are missing - loading them again") != 1 {
		t.Fatalf("the second bad minute: %d repairs, %v", runs, said)
	}
	// the next repair waits two minutes, the one after ten
	Pass(path, probe(), true, false, now+180, log)
	if runs != 1 {
		t.Fatal("repaired again before its wait")
	}
	Pass(path, probe(), true, false, now+240, log)
	Pass(path, probe(), true, false, now+300, log)
	Pass(path, probe(), true, false, now+840, log)
	if runs != 3 {
		t.Fatalf("%d repairs after fourteen minutes", runs)
	}
	// three did not help: said once, then quiet tries
	Pass(path, probe(), true, false, now+2700, log)
	Pass(path, probe(), true, false, now+6400, log)
	if told("3 repairs didn't help") != 1 || runs != 5 || told("loading them again") != 3 {
		t.Fatalf("after three: %d repairs, %v", runs, said)
	}
	if st := state(); len(st.Repairs) != 3 || !st.Targets["nft"].Stuck {
		t.Fatalf("the state: %+v", st)
	}
	ok = true
	Pass(path, probe(), true, false, now+6460, log)
	if told("Access rules are loaded again · restored") != 1 {
		t.Fatalf("coming back is not told: %v", said)
	}
	// it flaps: the count of repairs stays until ten good minutes in a row
	if state().Targets["nft"].Tries != 5 {
		t.Fatal("the repairs are forgotten at once")
	}
	for i := int64(1); i <= 9; i++ {
		Pass(path, probe(), true, false, now+6460+60*i, log)
	}
	if state().Targets["nft"].Tries != 0 {
		t.Fatal("the repairs are never forgotten")
	}
	// repairs off: reported once, nothing done; a target no longer looked at is dropped
	ok, said = false, nil
	Pass(path, probe(), false, false, now+90000, log)
	Pass(path, probe(), false, false, now+90060, log)
	Pass(path, probe(), false, false, now+90120, log)
	if runs != 5 || told("Access rules are missing") != 1 || len(state().Repairs) != 0 {
		t.Fatalf("with repairs off: %d repairs, %v, %+v", runs, said, state().Repairs)
	}
	Pass(path, nil, true, false, now+90180, log)
	if len(state().Targets) != 0 {
		t.Fatal("a target nobody looks at stays")
	}
	// a repair with a limit stops there (as ucode's: the repair itself was the last word on it)
	n := 0
	limited := []Probe{{ID: "x", Src: "dawnline", Name: "X", Who: "X", Problem: "is down", Back: "is up", Repair: &Repair{What: "kicking it", Max: 1, Run: func(int) { n++; panic("it bit back") }}}}
	said = nil
	for i := int64(0); i < 5; i++ {
		Pass(path, limited, true, false, now+100000+4000*i, log)
	}
	if n != 1 || told("is down - kicking it") != 1 || told("couldn't be repaired: it bit back") != 1 {
		t.Fatalf("a limited repair ran %d times: %v", n, said)
	}
}

// The probes for access's household on a router where all is well, and what each fault turns up.
func TestProbes(t *testing.T) {
	text, _ := os.ReadFile("../access/testdata/access.uci")
	c, err := uci.Parse(string(text))
	if err != nil {
		t.Fatal(err)
	}
	m := model.Load(c, nil)
	var ran []string
	good := func() Facts {
		return Facts{Tools: true, Kmod: true, Loaded: true, Handler: true, NftPresent: true, PortalCan: true, PortalListening: true, ResolverConf: true, ResolverRunning: true,
			Owner: func(ifn string) (string, bool) {
				for id, s := range m.Servers {
					if s.Ifname == ifn {
						return id, true
					}
				}
				return "", false
			},
			Iface: func(string) Iface { return Iface{Exists: true, Up: true} }, IfaceErrors: func(string) string { return "" }, UDPListening: func(int) bool { return true },
			Drift: map[string][]string{"home": {}, "cabin": {}, "open": {}}, Said: func(string) string { return "" },
			Reapply: func() { ran = append(ran, "apply") }, Run: func(name string, args ...string) { ran = append(ran, name+" "+strings.Join(args, " ")) },
			StartServices: func() { ran = append(ran, "start") }, BlockedNote: func(map[string]any) string { return "is kept down" }, BlockedFix: func(map[string]any) string { return "fix" }}
	}
	by := func(f Facts) map[string]Probe {
		out := map[string]Probe{}
		for _, p := range Probes(m, f) {
			out[p.ID] = p
		}
		return out
	}
	all := by(good())
	for _, id := range []string{"awg", "up_home", "up_cabin", "up_open", "cfg_home", "cfg_cabin", "cfg_open", "nft", "fw", "portal", "resolver"} {
		if p, has := all[id]; !has || !p.OK {
			t.Errorf("%s: there %v, fine %v", id, has, p.OK)
		}
	}
	if len(all) != 11 {
		t.Errorf("%d probes", len(all))
	}
	f := good()
	f.Kmod = false
	f.Missing = []string{"kmod-amneziawg"}
	if p := by(f); p["awg"].OK || p["awg"].Repair != nil || p["awg"].Detail() != "Missing: kmod-amneziawg." || len(p) != 5 {
		t.Errorf("without the module: %+v, %d probes", p["awg"], len(p))
	}
	f = good()
	f.Loaded = false
	p := by(f)
	p["awg"].Repair.Run(1)
	if p["awg"].Problem != "kernel module isn't loaded" || ran[len(ran)-1] != "modprobe amneziawg" || p["up_home"].ID == "" {
		t.Errorf("a module not loaded: %+v, %v", p["awg"], ran)
	}
	f = good()
	f.Handler = false
	if p := by(f); p["awg"].Repair != nil || p["up_home"].ID != "" || p["cfg_home"].ID != "" {
		t.Errorf("without netifd's handler the tunnels are still probed: %v", p)
	}
	f = good()
	f.Iface = func(ifn string) Iface { return Iface{Exists: ifn != "dawn1", Up: ifn == "dawn2"} }
	f.Owner = func(ifn string) (string, bool) { return "", ifn == "dawn2" }
	f.Drift = map[string][]string{"home": {"listen_port", "mtu"}}
	f.Firewall = "off"
	p = by(f)
	p["up_home"].Repair.Run(1)
	p["up_cabin"].Repair.Run(1)
	p["cfg_home"].Repair.Run(1)
	if p["up_home"].Problem != "AmneziaWG isn't running" || p["up_cabin"].Problem != "AmneziaWG is missing from the router" ||
		p["up_open"].Problem != "is kept down" || p["up_open"].Repair != nil || strings.Join(ran[len(ran)-3:], "; ") != "ifup dawn0; apply; apply" {
		t.Errorf("the tunnels' faults: %q %q %q, %v", p["up_home"].Problem, p["up_cabin"].Problem, p["up_open"].Problem, ran)
	}
	if p["cfg_home"].OK || p["cfg_home"].Detail() != "Changed: listen_port, mtu." || p["cfg_cabin"].ID != "" {
		t.Errorf("an interface changed by hand: %+v", p["cfg_home"])
	}
	if p["fw"].OK || p["fw"].Repair != nil {
		t.Errorf("fw4 stopped on purpose is repaired: %+v", p["fw"])
	}
	f = good()
	f.Firewall = "changed"
	by(f)["fw"].Repair.Run(1)
	if strings.Join(ran[len(ran)-2:], "; ") != "apply; fw4 -q reload" {
		t.Errorf("the firewall's repair: %v", ran)
	}
}
