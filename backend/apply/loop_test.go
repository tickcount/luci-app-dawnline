package apply

import (
	"encoding/json"
	"os"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/netview"
	"github.com/tickcount/luci-app-dawnline/backend/servicelog"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
)

type loopGolden struct {
	Bridge string `json:"bridge"`
	DHCP   string `json:"dhcp"`
	Steps  []struct {
		What    string           `json:"what"`
		Force   bool             `json:"force"`
		Result  json.RawMessage  `json:"result"`
		State   any              `json:"state"`
		NSRules string           `json:"ns_rules"`
		Log     []map[string]any `json:"log"`
		Ran     []string         `json:"ran"`
		Failed  []string         `json:"failed"`
		Pings   []string         `json:"pings"`
		Sys     struct {
			Dlx0  bool `json:"dlx0"`
			Dll0  bool `json:"dll0"`
			Netns bool `json:"netns"`
		} `json:"sys"`
	} `json:"steps"`
	Macs  [][2]*string `json:"macs"`
	Rules struct {
		Plan *LoopPlan `json:"plan"`
		Want []struct {
			Pref  int     `json:"pref"`
			Iif   string  `json:"iif"`
			To    *string `json:"to"`
			Table string  `json:"table"`
		} `json:"want"`
		Current     []IPRule `json:"current"`
		Cmds        []string `json:"cmds"`
		FromNothing []string `json:"from_nothing"`
		ToNothing   []string `json:"to_nothing"`
	} `json:"rules"`
	NSRules []string `json:"ns_rules"`
	Notes   []string `json:"notes"`
}

func loopTrace(t *testing.T) loopGolden {
	raw, err := os.ReadFile("testdata/loop.json")
	if err != nil {
		t.Fatal(err)
	}
	var g loopGolden
	if err := json.Unmarshal(raw, &g); err != nil {
		t.Fatal(err)
	}
	return g
}

// The pure parts of the home-like path, on ucode's own answers (testdata/loop.uc).
func TestLoopPartsAsUcode(t *testing.T) {
	g := loopTrace(t)
	if len(g.Macs) != 5 {
		t.Fatal("the golden is too small")
	}
	for _, m := range g.Macs {
		in := ""
		if m[0] != nil {
			in = *m[0]
		}
		if got := LanMAC(in); got != *m[1] {
			t.Errorf("the MAC from %q: %s, ucode %s", in, got, *m[1])
		}
	}
	want := LoopRules(g.Rules.Plan)
	if len(want) != len(g.Rules.Want) || len(want) == 0 {
		t.Fatalf("%d rules, ucode %d", len(want), len(g.Rules.Want))
	}
	for i, w := range g.Rules.Want {
		to := ""
		if w.To != nil {
			to = *w.To
		}
		if want[i] != (LoopRule{w.Pref, w.Iif, to, w.Table}) {
			t.Errorf("rule %d: %v, ucode %v", i, want[i], w)
		}
	}
	if len(LoopRules(nil)) != 0 {
		t.Error("rules from no plan")
	}
	for _, c := range []struct {
		what string
		got  []string
		want []string
	}{{"from what there is", RuleCmds(g.Rules.Plan, g.Rules.Current), g.Rules.Cmds}, {"from nothing", RuleCmds(g.Rules.Plan, nil), g.Rules.FromNothing},
		{"to nothing", RuleCmds(&LoopPlan{}, g.Rules.Current), g.Rules.ToNothing}} {
		if strings.Join(c.got, "\n") != strings.Join(c.want, "\n") || len(c.want) == 0 {
			t.Errorf("the commands %s:\n%s\n--- ucode:\n%s", c.what, strings.Join(c.got, "\n"), strings.Join(c.want, "\n"))
		}
	}
	if NSRules(g.Rules.Plan, true) != g.NSRules[0] || NSRules(g.Rules.Plan, false) != g.NSRules[1] {
		t.Errorf("the netns's rules:\n%s\n--- ucode:\n%s", NSRules(g.Rules.Plan, true), g.NSRules[0])
	}
	for i, e := range []map[string]any{{"code": "no_lan"}, {"code": "not_bridge", "dev": "eth1"}, {"code": "no_ipv4", "dev": "br-lan"},
		{"code": "no_address", "net": "10.0.1.0/24"}, {"code": "no_transit"}, {"code": "no_table"}} {
		if got := LoopErrorNote(e); got != g.Notes[i] {
			t.Errorf("the note for %v: %q, ucode %q", e, got, g.Notes[i])
		}
	}
}

// The home-like path through a row of states of the router: the plan, the commands in their order,
// loop.json, the netns's rules and the service log are ucode's own (testdata/loop.uc). The stand-in for ip
// here keeps the same state the golden's does.
func TestLoopAsUcode(t *testing.T) {
	g := loopTrace(t)
	if len(g.Steps) != 15 {
		t.Fatalf("%d steps", len(g.Steps))
	}
	raw, err := os.ReadFile("../netview/testdata/trace.json")
	if err != nil {
		t.Fatal(err)
	}
	var router struct {
		Routes json.RawMessage         `json:"routes"`
		Addrs  json.RawMessage         `json:"addrs"`
		Links  map[string]netview.Link `json:"links"`
	}
	if err := json.Unmarshal(raw, &router); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	sys, etc := dir+"/sys", dir+"/etc"
	os.MkdirAll(sys+"/br-lan", 0o755)
	os.WriteFile(sys+"/br-lan/address", []byte(g.Bridge+"\n"), 0o644)
	os.MkdirAll(dir+"/netns", 0o755)
	os.WriteFile(dir+"/dhcp", []byte(g.DHCP), 0o644)
	// what the stand-in is told and keeps
	var neigh, nsmac, mac, rules, fail string
	var ftFail bool
	tables := map[string]string{}
	var pings, said []string
	there := func(p string) bool { _, err := os.Stat(p); return err == nil }
	r := &Router{RunDir: dir + "/run", VarEtc: etc, SysNet: sys, NetnsDir: dir + "/netns", Leases: dir + "/leases", DHCP: dir + "/dhcp"}
	r.Snapshot = func() *netview.Snapshot {
		return netview.Take(netview.Sources{Routes: func() []byte { return router.Routes }, Addrs: func() []byte { return router.Addrs },
			Links: func() map[string]netview.Link { return router.Links },
			Logical: func() map[string]netview.Logical {
				return map[string]netview.Logical{"br-lan": {Name: "lan", Proto: "static"}}
			}})
	}
	r.Log = &servicelog.Log{RunDir: dir + "/run", Level: func() string { return "info" }, Syslog: func(_, line string) { said = append(said, line) }}
	r.Exec = func(name string, args ...string) (string, int) {
		if name != "sh" || len(args) != 2 || args[0] != "-c" {
			t.Fatalf("not through the shell: %s %v", name, args)
		}
		cmd := args[1]
		plain := strings.ReplaceAll(cmd, "'", "")
		if strings.HasPrefix(cmd, "ping ") {
			pings = append(pings, plain)
			return "", 1
		}
		if fail != "" && strings.Contains(plain, fail) {
			return "RTNETLINK answers: a made-up failure\n", 2
		}
		word := strings.Fields(plain)
		switch {
		case strings.HasPrefix(cmd, "ip -j -4 neigh show dev "):
			if neigh == "" {
				return "[]\n", 0
			}
			return neigh, 0
		case strings.HasPrefix(cmd, "ip -n dawnline -j link show dll1"):
			if !there(sys + "/dll0") {
				return "", 1
			}
			if nsmac != "" {
				return `[{"address":"` + nsmac + `"}]`, 0
			}
			return `[{"address":"` + mac + `"}]`, 0
		case cmd == "ip -j -4 rule show":
			if rules == "" {
				return "[]", 0
			}
			return rules, 0
		case strings.HasPrefix(cmd, "ip -4 route show table "):
			return tables[word[5]], 0
		case cmd == "ip netns add dawnline":
			os.WriteFile(dir+"/netns/dawnline", nil, 0o644)
		case cmd == "ip netns del dawnline":
			os.Remove(dir + "/netns/dawnline")
		case strings.HasPrefix(cmd, "ip netns exec dawnline nft -f "):
			if text, _ := os.ReadFile(word[6]); ftFail && strings.Contains(string(text), "flowtable") {
				return word[6] + ":4:2-10: Error: Could not process rule: No such file or directory\n", 1
			}
		case strings.HasPrefix(cmd, "ip link add dlx0 "):
			os.MkdirAll(sys+"/dlx0", 0o755)
		case strings.HasPrefix(cmd, "ip link add dll0 "):
			for i, w := range word {
				if w == "address" {
					mac = word[i+1]
				}
			}
			os.MkdirAll(sys+"/dll0", 0o755)
		case strings.HasPrefix(cmd, "ip link del "):
			os.RemoveAll(sys + "/" + word[3])
		case strings.HasPrefix(cmd, "ip link set dll0 master "):
			os.Remove(sys + "/dll0/master")
			os.Symlink("../"+word[5], sys+"/dll0/master")
		case strings.HasPrefix(cmd, "ip -n dawnline link set dll1 address "):
			mac, nsmac = word[7], ""
		}
		return "", 0
	}
	text, _ := os.ReadFile("../access/testdata/access.uci")
	c, err := uci.Parse(string(text))
	if err != nil {
		t.Fatal(err)
	}
	var last *LoopPlan
	// the rules a plan wants, as `ip -j -4 rule show` prints them once they are in
	shown := func() []map[string]any {
		var out []map[string]any
		for _, w := range LoopRules(last) {
			o := map[string]any{"priority": w.Pref, "src": "all", "iif": w.Iif, "table": w.Table}
			if w.To != "" {
				parts := strings.SplitN(w.To, "/", 2)
				o["dst"] = parts[0]
				if n, _ := strconv.Atoi(parts[1]); n != 32 {
					o["dstlen"] = n
				}
			}
			out = append(out, o)
		}
		return out
	}
	put := func(list []map[string]any) {
		raw, _ := json.Marshal(list)
		rules = string(raw)
	}
	saved, logged := "", 0
	for i, want := range g.Steps {
		switch i {
		case 1, 7, 8, 9, 12, 13:
			put(shown())
		case 2:
			l := shown()
			put(append(append([]map[string]any{}, l[1:]...), l[1], map[string]any{"priority": 5210, "src": "10.9.0.2", "iif": "dawn1", "dst": "10.1.0.0", "dstlen": 16, "table": "main"},
				map[string]any{"priority": 5290, "src": "all", "iif": "dawn7", "iif_detached": nil, "table": "2077"},
				map[string]any{"priority": 5290, "src": "all", "iif": "eth9", "table": "2077"}, map[string]any{"priority": 100, "src": "all", "iif": "dawn1", "table": "main"}))
		case 3:
			put(shown())
			ftFail = true
		case 5:
			ftFail, nsmac = false, "5e:00:11:22:33:44"
		case 6:
			nsmac, saved = "", "192.168.77.200"
			neigh = `[{"dst":"192.168.77.200","lladdr":"aa:bb:cc:00:00:01","state":["REACHABLE"]},{"dst":"192.168.77.254","lladdr":"aa:bb:cc:00:00:02","state":["FAILED"]},{"dst":"192.168.77.253","state":["STALE"]}]`
			os.WriteFile(dir+"/leases", []byte("1700000000 aa:bb:cc:00:00:03 192.168.77.252 phone *\n"), 0o644)
			d, _ := uci.Parse(g.DHCP)
			d.Add("host", "nas")
			d.Set("nas", "ip", "192.168.77.251")
			d.Set("lan", "start", "240")
			d.Set("lan", "limit", "11")
			d.SetList("lan", "dhcp_option", []string{"3,192.168.77.1", "6,192.168.77.53,192.168.77.54"})
			os.WriteFile(dir+"/dhcp", []byte(d.Format()), 0o644)
		case 14:
			put(nil)
		}
		switch i {
		case 7:
			saved = "192.168.77.201"
		case 8:
			tables["2077"] = "default via 10.0.0.1 dev eth5\n10.0.0.0/24 dev eth5\n"
			tables["2078"] = "default via 169.254.77.2 dev dlx0\n"
		case 9:
			fail = "route replace default via 192.168.77.1"
		case 11:
			fail = ""
		case 12:
			c.Set("cabin", "lan_like", "0")
		case 13:
			c.Set("open", "lan_like", "0")
		}
		pings, said = nil, nil
		res := r.LoopEnsure(model.Load(c, nil), saved, want.Force)
		if res.Plan != nil {
			last = res.Plan
		}
		fail := func(what string, got, exp any) {
			a, _ := json.Marshal(got)
			b, _ := json.Marshal(exp)
			t.Errorf("step %d (%s): %s\n go:    %s\n ucode: %s", i, want.What, what, a, b)
		}
		same := func(got, exp any) bool {
			var a, b any
			x, _ := json.Marshal(got)
			y, _ := json.Marshal(exp)
			json.Unmarshal(x, &a)
			json.Unmarshal(y, &b)
			return reflect.DeepEqual(a, b)
		}
		// where the files are kept here is not where the router keeps them
		home := func(s string) string { return strings.ReplaceAll(s, etc, "/var/etc") }
		var result any = res.Plan
		switch {
		case res.Off:
			result = map[string]any{"off": true}
		case res.Error != nil:
			result = map[string]any{"error": map[string]any{"code": res.Error["code"], "detail": home(res.Error["detail"].(string))}}
		}
		if !same(result, want.Result) {
			fail("what it came to", result, want.Result)
		}
		var ran, failed []string
		for _, l := range said {
			if s, is := strings.CutPrefix(l, "[info] [loop] $ "); is {
				ran = append(ran, home(s))
			}
			if s, is := strings.CutPrefix(l, "[error] [loop] failed: "); is {
				failed = append(failed, home(s))
			}
		}
		if strings.Join(ran, "\n") != strings.Join(want.Ran, "\n") {
			fail("the commands", ran, want.Ran)
		}
		if strings.Join(failed, "\n") != strings.Join(want.Failed, "\n") {
			fail("what failed", failed, want.Failed)
		}
		if strings.Join(pings, "\n") != strings.Join(want.Pings, "\n") {
			fail("who was asked whether they answer", pings, want.Pings)
		}
		var state any
		if raw, err := os.ReadFile(dir + "/run/loop.json"); err == nil {
			json.Unmarshal([]byte(home(string(raw))), &state)
			if s, is := state.(map[string]any); is && s["applied"] != nil {
				s["applied"] = float64(1)
			}
		}
		if !same(state, want.State) {
			fail("loop.json", state, want.State)
		}
		if got, _ := os.ReadFile(etc + "/dawnline-ns.nft"); string(got) != want.NSRules {
			fail("the netns's rules", string(got), want.NSRules)
		}
		var log []map[string]any
		lines, _ := os.ReadFile(dir + "/run/service.log")
		all := strings.Split(strings.TrimRight(string(lines), "\n"), "\n")
		if len(lines) == 0 {
			all = nil
		}
		for _, l := range all[logged:] {
			var e map[string]any
			json.Unmarshal([]byte(home(l)), &e)
			delete(e, "ts")
			log = append(log, e)
		}
		logged = len(all)
		if !same(log, want.Log) && !(len(log) == 0 && len(want.Log) == 0) {
			fail("the service log", log, want.Log)
		}
		if there(sys+"/dlx0") != want.Sys.Dlx0 || there(sys+"/dll0") != want.Sys.Dll0 || there(dir+"/netns/dawnline") != want.Sys.Netns {
			fail("what is left on the router", []bool{there(sys + "/dlx0"), there(sys + "/dll0"), there(dir + "/netns/dawnline")}, want.Sys)
		}
	}
}
