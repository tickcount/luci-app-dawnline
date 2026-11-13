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

// The Home-only resolver's configuration in each place it may run: the files ucode's own sync writes, and
// whether it changed (testdata/resolver.uc).
func TestResolverAsUcode(t *testing.T) {
	raw, err := os.ReadFile("testdata/resolver.json")
	if err != nil {
		t.Fatal(err)
	}
	var trace struct {
		DHCP  string `json:"dhcp"`
		Steps []struct {
			What   string `json:"what"`
			Target struct {
				Mode    string `json:"mode"`
				Address string `json:"address"`
				Port    int    `json:"port"`
			} `json:"target"`
			Lan     string `json:"lan"`
			Changed bool   `json:"changed"`
			Conf    string `json:"conf"`
			Resolv  string `json:"resolv"`
		} `json:"steps"`
	}
	if err := json.Unmarshal(raw, &trace); err != nil {
		t.Fatal(err)
	}
	if len(trace.Steps) != 6 {
		t.Fatalf("%d steps", len(trace.Steps))
	}
	dir := t.TempDir()
	os.WriteFile(dir+"/dhcp", []byte(trace.DHCP), 0o644)
	wanDNS := true
	var killed []string
	r := &Router{RunDir: dir + "/run", VarEtc: dir + "/etc", ResolverPid: dir + "/pid", DHCP: dir + "/dhcp",
		Snapshot: func() *netview.Snapshot { return &netview.Snapshot{Devices: map[string]*netview.Device{}} },
		Exec: func(name string, args ...string) (string, int) {
			line := name + " " + strings.Join(args, " ")
			switch {
			case name == "kill":
				killed = append(killed, args...)
			case !wanDNS:
			case line == "ubus call network.interface.wan status":
				return `{ "dns-server": [ "9.9.9.9", "2001:db8::1", "149.112.112.112" ] }`, 0
			case line == "ubus call network.interface.wan6 status":
				return `{ "dns-server": [ "9.9.9.9" ] }`, 0
			}
			return "", 0
		}}
	text, _ := os.ReadFile("../access/testdata/access.uci")
	c, err := uci.Parse(string(text))
	if err != nil {
		t.Fatal(err)
	}
	for i, want := range trace.Steps {
		switch i {
		case 3:
			c.Set("cabin", "enabled", "0")
			os.WriteFile(dir+"/pid", []byte("4242\n"), 0o644)
		case 4:
			c.Set("home", "enabled", "0")
			c.Set("open", "enabled", "0")
			os.Remove(dir + "/pid")
		case 5:
			wanDNS = false
		}
		killed = nil
		changed := r.Resolver(model.Load(c, nil), Target{Mode: want.Target.Mode, Address: want.Target.Address, Port: want.Target.Port}, want.Lan)
		if changed != want.Changed {
			t.Errorf("step %d (%s): changed %v, ucode %v", i, want.What, changed, want.Changed)
		}
		if got, _ := os.ReadFile(dir + "/etc/dawnline-dns.conf"); string(got) != want.Conf {
			t.Errorf("step %d (%s): the configuration\n%s--- ucode:\n%s", i, want.What, got, want.Conf)
		}
		if got, _ := os.ReadFile(dir + "/etc/dawnline-dns.resolv"); string(got) != want.Resolv {
			t.Errorf("step %d (%s): the upstream file\n%s--- ucode:\n%s", i, want.What, got, want.Resolv)
		}
		// the one that ran is stopped, so procd starts it from the new file
		if stop := i == 3; stop != (strings.Join(killed, " ") == "4242") || (!stop && killed != nil) {
			t.Errorf("step %d (%s): stopped %v", i, want.What, killed)
		}
	}
}
