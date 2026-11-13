package apply

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/tickcount/luci-app-dawnline/backend/awg"

	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/netview"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
)

// The network signature is ucode's own text: its agent applies again when the two differ (testdata/sig.uc).
func TestNetSignatureAsUcode(t *testing.T) {
	raw, err := os.ReadFile("testdata/sig.json")
	if err != nil {
		t.Fatal(err)
	}
	var g struct {
		Sigs []string `json:"sigs"`
	}
	if err := json.Unmarshal(raw, &g); err != nil || len(g.Sigs) != 3 {
		t.Fatal("the golden is not as expected")
	}
	raw, err = os.ReadFile("../netview/testdata/trace.json")
	if err != nil {
		t.Fatal(err)
	}
	var router struct {
		Routes   json.RawMessage         `json:"routes"`
		Addrs    json.RawMessage         `json:"addrs"`
		Firewall string                  `json:"firewall"`
		Links    map[string]netview.Link `json:"links"`
	}
	if err := json.Unmarshal(raw, &router); err != nil {
		t.Fatal(err)
	}
	fw, _ := uci.Parse(router.Firewall)
	dir := t.TempDir()
	r := &Router{RunDir: dir, Snapshot: func() *netview.Snapshot {
		return netview.Take(netview.Sources{Routes: func() []byte { return router.Routes }, Addrs: func() []byte { return router.Addrs },
			Links: func() map[string]netview.Link { return router.Links }, Zones: func() netview.Zones { return netview.ZonesOf(fw) }})
	}}
	text, _ := os.ReadFile("../access/testdata/access.uci")
	c, err := uci.Parse(string(text))
	if err != nil {
		t.Fatal(err)
	}
	for i, want := range g.Sigs {
		switch i {
		case 1:
			c.SetList("home", "lan_device", []string{"dlhome", "nope0", "lanp1"})
			c.Set("cabin", "auto_lan", "1")
			c.Set("open", "auto_wan", "0")
			c.Set("open", "wan_device", "wg9")
		case 2:
			c.Set("open", "wan_device", "gone7")
			c.SetList("open", "lan_device", []string{"gone8"})
			c.Set("cabin", "lan_zone", "lan")
		}
		m := model.Load(c, nil)
		if got := r.NetSignature(m); got != want {
			t.Errorf("signature %d:\n%s\n--- ucode:\n%s", i, got, want)
		}
		if i == 0 {
			if !r.NetChanged(m) {
				t.Error("no signature kept, and nothing is due")
			}
			os.WriteFile(dir+"/net.sig", []byte(want), 0o644)
			if r.NetChanged(m) {
				t.Error("an apply is due with the networks as they were")
			}
		} else if !r.NetChanged(m) {
			t.Error("the networks changed, and no apply is due")
		}
	}
}

// A plan of the full apply changes nothing: after a real apply of the same settings it finds nothing to
// do, and after a change it names the lines and the commands, with the router's own files as they were.
func TestApplyPlanChangesNothing(t *testing.T) {
	raw, _ := os.ReadFile("../netview/testdata/trace.json")
	var router struct {
		Routes   json.RawMessage         `json:"routes"`
		Addrs    json.RawMessage         `json:"addrs"`
		Firewall string                  `json:"firewall"`
		Links    map[string]netview.Link `json:"links"`
	}
	if err := json.Unmarshal(raw, &router); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	network, _ := os.ReadFile("testdata/network.uci")
	os.WriteFile(dir+"/network", network, 0o644)
	os.WriteFile(dir+"/firewall", []byte(router.Firewall), 0o644)
	var ran []string
	r := &Router{RunDir: dir + "/run", VarEtc: dir + "/etc", ResolverPid: dir + "/pid", SysNet: dir + "/sys", NetnsDir: dir + "/netns", Leases: dir + "/leases",
		Network: dir + "/network", Firewall: dir + "/firewall", HostsFile: dir + "/hosts",
		Exec: func(name string, args ...string) (string, int) {
			line := name + " " + strings.Join(args, " ")
			if !asks(name, args) {
				ran = append(ran, line)
			}
			if strings.HasPrefix(line, "nft list") {
				return "", 1
			}
			return "", 0
		}}
	r.Snapshot = func() *netview.Snapshot {
		text, _ := os.ReadFile(dir + "/firewall")
		fw, _ := uci.Parse(string(text))
		return netview.Take(netview.Sources{Routes: func() []byte { return router.Routes }, Addrs: func() []byte { return router.Addrs },
			Links: func() map[string]netview.Link { return router.Links }, Zones: func() netview.Zones { return netview.ZonesOf(fw) }})
	}
	text, _ := os.ReadFile("../access/testdata/access.uci")
	c, _ := uci.Parse(string(text))
	// nobody like a home device here: that path has its own test, with a router to answer it
	for _, id := range []string{"home", "cabin", "open"} {
		c.Set(id, "lan_like", "0")
	}
	load := func() *model.Model {
		var blocked map[string]any
		if raw, err := os.ReadFile(dir + "/run/netifd-blocked.json"); err == nil {
			json.Unmarshal(raw, &blocked)
		}
		return model.Load(c, blocked)
	}
	caps := awg.Caps{V2: true, V3: true}
	m := load()
	r.Netifd(m, true, caps)
	r.Fw(m)
	r.LoopEnsure(m, "", true)
	r.SyncResolver(m)
	r.ReplyRoutes(m)
	os.WriteFile(dir+"/run/net.sig", []byte(r.NetSignature(m)), 0o644)
	keep := func() string {
		out := ""
		for _, f := range []string{"/network", "/firewall", "/run/netifd-blocked.json", "/run/loop.json", "/run/iface-intent.json", "/etc/dawnline-dns.conf", "/run/net.sig"} {
			raw, _ := os.ReadFile(dir + f)
			out += f + "\n" + string(raw) + "\n"
		}
		return out
	}
	before := keep()
	ran = nil
	plan := r.ApplyPlan(load(), "", true, caps)
	js, _ := json.Marshal(plan)
	if plan["network"] != false || plan["firewall"] != false || plan["resolver"] != false || plan["signature"] != true ||
		len(plan["would_run"].([]string)) != 0 || len(plan["network_lines"].([]string)) != 0 || plan["like_home"] != "off" {
		t.Errorf("something to do right after an apply: %s", js)
	}
	// a port moved: the plan says so, and the router is as it was
	c.Set("home", "port", "4999")
	plan = r.ApplyPlan(load(), "", true, caps)
	js, _ = json.Marshal(plan)
	if plan["network"] != true || plan["firewall"] != true {
		t.Errorf("a moved port changes nothing: %s", js)
	}
	lines := strings.Join(plan["network_lines"].([]string), "\n") + "\n" + strings.Join(plan["firewall_lines"].([]string), "\n")
	if !strings.Contains(lines, "- \toption listen_port '4500'") || !strings.Contains(lines, "+ \toption listen_port '4999'") || !strings.Contains(lines, "+ \toption dest_port '4999'") {
		t.Errorf("the lines of the change:\n%s", lines)
	}
	would := strings.Join(plan["would_run"].([]string), "; ")
	if !strings.Contains(would, "ubus call network reload") || !strings.Contains(would, "ifup dawn0") || !strings.Contains(would, "fw4 -q reload") {
		t.Errorf("the commands of the change: %s", would)
	}
	if strings.Contains(string(js), "aaaaaaaa") {
		t.Error("a key in the plan")
	}
	if keep() != before || len(ran) != 0 {
		t.Errorf("the plan changed the router: ran %v", ran)
	}
}

// A teardown leaves the router's network and firewall as they were before Dawnline: what is ours goes,
// what is not stays, an interface of someone else's under a tunnel's name too.
func TestTeardown(t *testing.T) {
	raw, _ := os.ReadFile("../netview/testdata/trace.json")
	var router struct {
		Routes   json.RawMessage         `json:"routes"`
		Addrs    json.RawMessage         `json:"addrs"`
		Firewall string                  `json:"firewall"`
		Links    map[string]netview.Link `json:"links"`
	}
	if err := json.Unmarshal(raw, &router); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	network, _ := os.ReadFile("testdata/network.uci")
	os.WriteFile(dir+"/network", network, 0o644)
	os.WriteFile(dir+"/firewall", []byte(router.Firewall), 0o644)
	os.WriteFile(dir+"/hosts", []byte("10.77.0.2 phone.anna.vpn\n"), 0o644)
	var ran []string
	r := &Router{RunDir: dir + "/run", VarEtc: dir + "/etc", SysNet: dir + "/sys", NetnsDir: dir + "/netns", Leases: dir + "/leases",
		Network: dir + "/network", Firewall: dir + "/firewall", HostsFile: dir + "/hosts",
		Exec: func(name string, args ...string) (string, int) {
			if !asks(name, args) {
				ran = append(ran, name+" "+strings.Join(args, " "))
			}
			return "", 0
		}}
	r.Snapshot = func() *netview.Snapshot {
		text, _ := os.ReadFile(dir + "/firewall")
		fw, _ := uci.Parse(string(text))
		return netview.Take(netview.Sources{Routes: func() []byte { return router.Routes }, Addrs: func() []byte { return router.Addrs },
			Links: func() map[string]netview.Link { return router.Links }, Zones: func() netview.Zones { return netview.ZonesOf(fw) }})
	}
	text, _ := os.ReadFile("../access/testdata/access.uci")
	c, _ := uci.Parse(string(text))
	m := model.Load(c, nil)
	r.Netifd(m, true, awg.Caps{V2: true, V3: true})
	r.Fw(m)
	os.WriteFile(dir+"/run/net.sig", []byte("x"), 0o644)
	if now, _ := os.ReadFile(dir + "/firewall"); !strings.Contains(string(now), "dawnline_home_zone") {
		t.Fatal("nothing was set up to take down")
	}
	ran = nil
	r.Teardown(model.Load(c, nil))
	as := func(text []byte) string { c, _ := uci.Parse(string(text)); return c.Format() }
	if now, _ := os.ReadFile(dir + "/network"); string(now) != as(network) {
		t.Errorf("the network configuration after:\n%s", now)
	}
	if now, _ := os.ReadFile(dir + "/firewall"); string(now) != as([]byte(router.Firewall)) {
		t.Errorf("the firewall after:\n%s", now)
	}
	for _, f := range []string{"/hosts", "/run/net.sig"} {
		if _, err := os.Stat(dir + f); err == nil {
			t.Errorf("%s stays", f)
		}
	}
	did := strings.Join(ran, "; ")
	for _, want := range []string{"ifdown dawn0", "ifdown dawn1", "ubus call network reload", "fw4 -q reload", "nft delete table inet dawnline", "killall -HUP dnsmasq"} {
		if !strings.Contains(did, want) {
			t.Errorf("%s was not run: %s", want, did)
		}
	}
	if strings.Contains(did, "ifdown dawn2") || strings.Contains(did, "ifup") {
		t.Errorf("more than ours was touched: %s", did)
	}
}
