package apply

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/awg"
	"github.com/tickcount/luci-app-dawnline/backend/i18n"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/netview"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
	"github.com/tickcount/luci-app-dawnline/backend/usage"
)

// The keeper syncs when something moved and not otherwise: the first time, when the settings' file was
// written, when the access table is gone; and it applies everything again only when the router's networks
// stay changed for two ticks.
func TestKeeper(t *testing.T) {
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
	text, _ := os.ReadFile("../access/testdata/access.uci")
	c, _ := uci.Parse(string(text))
	for _, id := range []string{"home", "cabin", "open"} {
		c.Set(id, "lan_like", "0")
	}
	os.WriteFile(dir+"/dawnline", []byte(c.Format()), 0o600)
	present := false
	loads, reloads := 0, 0
	addrs := router.Addrs
	r := &Router{RunDir: dir + "/run", VarEtc: dir + "/etc", SysNet: dir + "/sys", NetnsDir: dir + "/netns", Leases: dir + "/leases",
		Network: dir + "/network", Firewall: dir + "/firewall", HostsFile: dir + "/hosts",
		Exec: func(name string, args ...string) (string, int) {
			line := name + " " + strings.Join(args, " ")
			switch {
			case line == "nft list table inet dawnline":
				if present {
					return "", 0
				}
				return "", 1
			case strings.HasPrefix(line, "nft list"):
				return "", 1
			case name == "nft" && args[0] == "-f":
				script, _ := os.ReadFile(args[1])
				if strings.HasPrefix(string(script), "flush set") && !present {
					return "Error: No such file or directory", 1
				}
				loads++
				present = true
			case line == "fw4 -q reload":
				reloads++
			case name == "awg" && args[0] == "show":
				return "", 1
			}
			return "", 0
		}}
	r.Snapshot = func() *netview.Snapshot {
		text, _ := os.ReadFile(dir + "/firewall")
		fw, _ := uci.Parse(string(text))
		return netview.Take(netview.Sources{Routes: func() []byte { return router.Routes }, Addrs: func() []byte { return addrs },
			Links: func() map[string]netview.Link { return router.Links }, Zones: func() netview.Zones { return netview.ZonesOf(fw) }})
	}
	u := &usage.Usage{}
	k := &Keeper{R: r, Config: dir + "/dawnline", Words: i18n.Use("", ""), Usage: func() *usage.Usage { return u },
		Tools: func() bool { return true }, Caps: func() awg.Caps { return awg.Caps{V2: true, V3: true} },
		Load: func() (*model.Model, string, error) {
			text, _ := os.ReadFile(dir + "/dawnline")
			c, err := uci.Parse(string(text))
			if err != nil {
				return nil, "", err
			}
			return model.Load(c, nil), "", nil
		}}
	tick := func(what string, want int) {
		t.Helper()
		before := loads
		k.Tick()
		if loads-before != want {
			t.Errorf("%s: the table was loaded %d times, not %d", what, loads-before, want)
		}
	}
	tick("the first tick", 1)
	tick("nothing moved", 0)
	// the settings written by anyone: seen by the file itself
	time.Sleep(5 * time.Millisecond)
	os.WriteFile(dir+"/dawnline.new", []byte(c.Format()), 0o600)
	os.Rename(dir+"/dawnline.new", dir+"/dawnline")
	tick("the settings' file replaced", 1)
	tick("and nothing since", 0)
	// a flushed ruleset: the table is put back on the next tick
	present = false
	tick("the access table gone", 1)
	if reloads != 0 {
		t.Errorf("the firewall was reloaded %d times with the networks as they were", reloads)
	}
	// The router's networks: nothing kept of an apply yet, so the first look is the base. A change that
	// passes within a tick sets nothing up again; one that stays does, once.
	other := json.RawMessage(strings.ReplaceAll(string(router.Addrs), "192.168.77.1", "192.168.78.1"))
	if string(other) == string(router.Addrs) {
		t.Fatal("the router's addresses are not what this test changes")
	}
	addrs = other
	k.Tick()
	addrs = router.Addrs
	k.Tick()
	if _, err := os.Stat(dir + "/run/net.sig"); err == nil {
		t.Error("a change that passed set everything up again")
	}
	addrs = other
	k.Tick()
	k.Tick()
	sig, err := os.ReadFile(dir + "/run/net.sig")
	if err != nil || !strings.Contains(string(sig), "192.168.78.1") {
		t.Errorf("a change that stayed did not set everything up again: %s", sig)
	}
	if now, _ := os.ReadFile(dir + "/firewall"); !strings.Contains(string(now), "dawnline_home_zone") {
		t.Error("the apply after the change left no firewall of ours")
	}
	before := reloads
	k.Tick()
	k.Tick()
	if reloads != before {
		t.Error("applied again with the networks as the last apply saw them")
	}
}
