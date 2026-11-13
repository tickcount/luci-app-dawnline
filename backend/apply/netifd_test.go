package apply

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/tickcount/luci-app-dawnline/backend/awg"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
)

// The router's network configuration through a row of changes to access's household: after each, the file
// ucode's netifd sync leaves, the servers it keeps down and why, and what it ran (testdata/netifd.uc).
func TestNetifdAsUcode(t *testing.T) {
	raw, err := os.ReadFile("testdata/netifd.json")
	if err != nil {
		t.Fatal(err)
	}
	var trace struct {
		Steps []struct {
			What         string                    `json:"what"`
			Changed      bool                      `json:"changed"`
			Network      string                    `json:"network"`
			Blocked      map[string]any            `json:"blocked"`
			ModelBlocked map[string]any            `json:"model_blocked"`
			Cmds         []string                  `json:"cmds"`
			Intents      map[string]map[string]any `json:"intents"`
			NoAWG        bool                      `json:"no_awg"`
		} `json:"steps"`
	}
	if err := json.Unmarshal(raw, &trace); err != nil {
		t.Fatal(err)
	}
	if len(trace.Steps) != 9 {
		t.Fatalf("%d steps", len(trace.Steps))
	}
	text, _ := os.ReadFile("../access/testdata/access.uci")
	c, err := uci.Parse(string(text))
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	network, _ := os.ReadFile("testdata/network.uci")
	os.WriteFile(dir+"/network", network, 0o644)
	var cmds []string
	r := &Router{RunDir: dir + "/run", Network: dir + "/network", Exec: func(name string, args ...string) (string, int) {
		cmds = append(cmds, strings.Join(append([]string{name}, args...), " "))
		return "", 0
	}}
	tools := true
	caps := awg.Caps{V2: true, V3: true, Tools: "3.1"}
	for i, want := range trace.Steps {
		switch i {
		case 2:
			c.Set("home", "port", "4501")
			c.Set("cabin", "enabled", "0")
		case 3:
			c.Set("home", "jmin", "90")
			c.Set("home", "jmax", "50")
		case 4:
			c.Delete("home", "jmin")
			c.Delete("home", "jmax")
			c.Set("home", "name", "Anna's house")
		case 5:
			c.Set("home", "name", "House")
		case 6:
			c.DeleteSection("cabin")
			c.Set("open", "ifname", "Not-A-Name")
		case 7:
			c.Set("home", "header_protection_key", "yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=")
			for _, k := range []string{"s1", "s2", "s3", "s4"} {
				c.Set("home", k, "12")
			}
			c.Set("home", "i1", "<b 0x01><r 2>")
			c.Set("home", "disable_cookies", "on")
		case 8:
			tools = false
			c.Set("home", "port", "4502")
		}
		cmds = nil
		// as ucode's: each sync reads the settings anew, with who was kept down before
		var before map[string]any
		if raw, err := os.ReadFile(dir + "/run/netifd-blocked.json"); err == nil {
			json.Unmarshal(raw, &before)
		}
		m := model.Load(c, before)
		changed := r.Netifd(m, tools, caps)
		fail := func(what string, got, exp any) {
			t.Errorf("step %d (%s): %s\n go:    %v\n ucode: %v", i, want.What, what, got, exp)
		}
		if changed != want.Changed {
			fail("whether it changed", changed, want.Changed)
		}
		if got, _ := os.ReadFile(dir + "/network"); string(got) != want.Network {
			g, w := strings.Split(string(got), "\n"), strings.Split(want.Network, "\n")
			for n := 0; n < len(g) || n < len(w); n++ {
				if n >= len(g) || n >= len(w) || g[n] != w[n] {
					a, b := "(the end)", "(the end)"
					if n < len(g) {
						a = g[n]
					}
					if n < len(w) {
						b = w[n]
					}
					fail("the network configuration, line "+string(rune('0'+(n+1)/10))+string(rune('0'+(n+1)%10)), a, b)
					break
				}
			}
		}
		var blocked map[string]any
		if raw, err := os.ReadFile(dir + "/run/netifd-blocked.json"); err == nil {
			json.Unmarshal(raw, &blocked)
		}
		if !reflect.DeepEqual(blocked, want.Blocked) {
			fail("who is kept down", blocked, want.Blocked)
		}
		kept := map[string]any{}
		for id, srv := range m.Servers {
			kept[id] = srv.Blocked
			if why, is := srv.Blocked.(map[string]any); is {
				kept[id] = why
			}
		}
		if !reflect.DeepEqual(kept, want.ModelBlocked) {
			fail("who the model holds as kept down", kept, want.ModelBlocked)
		}
		if strings.Join(cmds, "; ") != strings.Join(want.Cmds, "; ") {
			fail("what was run", cmds, want.Cmds)
		}
		var all map[string]map[string]any
		if raw, err := os.ReadFile(dir + "/run/iface-intent.json"); err == nil {
			json.Unmarshal(raw, &all)
		}
		intents := map[string]map[string]any{}
		for k, v := range all {
			intents[k] = map[string]any{"reason": v["reason"], "name": v["name"]}
		}
		if !reflect.DeepEqual(intents, want.Intents) {
			fail("why each tunnel goes down", intents, want.Intents)
		}
		if _, err := os.Stat(dir + "/run/netifd-no-awg"); (err == nil) != want.NoAWG {
			fail("whether missing tools were told", err == nil, want.NoAWG)
		}
	}
	left, _ := os.ReadDir(dir)
	for _, e := range left {
		if strings.HasPrefix(e.Name(), ".") {
			t.Errorf("%s stays beside the configuration", e.Name())
		}
	}
}
