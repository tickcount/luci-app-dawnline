package apply

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/netview"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
)

// The router's firewall configuration through a row of changes to access's household: after each, the file
// ucode's firewall sync leaves, whether it changed and what it ran (testdata/fw.uc).
func TestFirewallAsUcode(t *testing.T) {
	raw, err := os.ReadFile("testdata/fw.json")
	if err != nil {
		t.Fatal(err)
	}
	var trace struct {
		Steps []struct {
			What     string   `json:"what"`
			Dry      bool     `json:"dry"`
			Changed  bool     `json:"changed"`
			Before   string   `json:"before"`
			Firewall string   `json:"firewall"`
			Cmds     []string `json:"cmds"`
		} `json:"steps"`
	}
	if err := json.Unmarshal(raw, &trace); err != nil {
		t.Fatal(err)
	}
	if len(trace.Steps) != 11 {
		t.Fatalf("%d steps", len(trace.Steps))
	}
	// the router the golden ran on: what its container said of itself (netview's golden, the same run)
	raw, err = os.ReadFile("../netview/testdata/trace.json")
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
	os.WriteFile(dir+"/firewall", []byte(trace.Steps[0].Before), 0o644)
	var cmds []string
	r := &Router{RunDir: dir + "/run", Firewall: dir + "/firewall", Exec: func(name string, args ...string) (string, int) {
		cmds = append(cmds, strings.Join(append([]string{name}, args...), " "))
		return "", 0
	}}
	// as ucode's: the zones are read anew from the firewall as it stands
	r.Snapshot = func() *netview.Snapshot {
		text, _ := os.ReadFile(dir + "/firewall")
		fw, _ := uci.Parse(string(text))
		return netview.Take(netview.Sources{Routes: func() []byte { return router.Routes }, Addrs: func() []byte { return router.Addrs },
			Links: func() map[string]netview.Link { return router.Links }, Zones: func() netview.Zones { return netview.ZonesOf(fw) }})
	}
	text, _ := os.ReadFile("../access/testdata/access.uci")
	c, err := uci.Parse(string(text))
	if err != nil {
		t.Fatal(err)
	}
	for i, want := range trace.Steps {
		switch i {
		case 2:
			c.Set("home", "port", "4501")
			c.Set("cabin", "enabled", "0")
			c.SetList("home", "lan_device", []string{"dlhome", "dlguest"})
		case 3:
			c.SetList("open", "lan_device", []string{"dlguest"})
		case 4:
			c.Set("settings", "portal_port", "443")
		case 5:
			c.Set("settings", "portal_port", "8443")
			c.Delete("settings", "portal_alt")
		case 6:
			c.Set("home", "port", "4502")
		case 7:
			c.DeleteSection("cabin")
			c.Set("home", "lan_like", "1")
		case 8:
			c.Set("home", "lan_like", "0")
			c.Set("open", "lan_like", "0")
		case 9:
			text, _ := os.ReadFile(dir + "/firewall")
			fw, _ := uci.Parse(string(text))
			fw.DeleteSection("dawnline_home_zone")
			fw.Add("rule", "dawnline_home_zone")
			fw.Set("dawnline_home_zone", "name", "Not a zone")
			fw.Add("forwarding", "dawnline_old_wan")
			fw.Set("dawnline_old_wan", "src", "dawn9")
			os.WriteFile(dir+"/firewall", []byte(fw.Format()), 0o644)
			c.Set("settings", "portal_enabled", "0")
		}
		fail := func(what string, got, exp any) {
			t.Errorf("step %d (%s): %s\n go:    %v\n ucode: %v", i, want.What, what, got, exp)
		}
		if got, _ := os.ReadFile(dir + "/firewall"); string(got) != want.Before {
			fail("the firewall the step starts from", string(got), want.Before)
		}
		cmds = nil
		m := model.Load(c, nil)
		var changed bool
		if want.Dry {
			changed = r.FirewallDiffers(m)
		} else {
			changed = r.Fw(m)
		}
		if changed != want.Changed {
			fail("whether it changed", changed, want.Changed)
		}
		if got, _ := os.ReadFile(dir + "/firewall"); string(got) != want.Firewall {
			g, w := strings.Split(string(got), "\n"), strings.Split(want.Firewall, "\n")
			for n := 0; n < len(g) || n < len(w); n++ {
				if n >= len(g) || n >= len(w) || g[n] != w[n] {
					a, b := "(the end)", "(the end)"
					if n < len(g) {
						a = g[n]
					}
					if n < len(w) {
						b = w[n]
					}
					fail("the firewall configuration, from a line on", a, b)
					break
				}
			}
			os.WriteFile(dir+"/firewall", []byte(want.Firewall), 0o644)
		}
		// the snapshot's own question to netifd is not the sync's
		var ran []string
		for _, l := range want.Cmds {
			if l != "ubus call network.interface dump" {
				ran = append(ran, l)
			}
		}
		if strings.Join(cmds, "; ") != strings.Join(ran, "; ") {
			fail("what was run", cmds, ran)
		}
	}
}
