package nft

import (
	"encoding/json"
	"os"
	"strings"
	"testing"

	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/netview"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
)

// sitesOf is access's household on the golden's router, with routers that have networks behind them:
// Boris's in Anna's circle (devices within circles), Kira's where everyone reaches everyone, Clara's with
// the internet alone, Dima's with one home network, Eva's with home services, and Hana's whose network is
// one the router has itself.
func sitesOf(t *testing.T) (*model.Model, *netview.Snapshot) {
	t.Helper()
	text, err := os.ReadFile("../access/testdata/access.uci")
	if err != nil {
		t.Fatal(err)
	}
	c, err := uci.Parse(string(text))
	if err != nil {
		t.Fatal(err)
	}
	for id, net := range map[string]string{"bphone": "192.168.2.0/24", "kphone": "192.168.3.0/24", "cphone": "192.168.4.0/24",
		"dphone": "192.168.5.0/24", "ephone": "192.168.6.0/24", "hphone": "192.168.50.0/24"} {
		c.Set(id, "kind", "router")
		c.SetList(id, "behind_net", []string{net})
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
	snap := netview.Take(netview.Sources{Routes: func() []byte { return router.Routes }, Addrs: func() []byte { return router.Addrs },
		Links: func() map[string]netview.Link { return router.Links }})
	return model.Load(c, nil), snap
}

// A router stands for the networks behind it: they are wherever its address is, and nowhere else.
func TestNetworksBehindRoutersInTheSets(t *testing.T) {
	m, snap := sitesOf(t)
	states := map[string]string{}
	for _, id := range m.PersonIDs() {
		states[id] = "active"
	}
	sets := AccessSets(m, states, snap)
	in := func(set, member string) bool {
		for _, x := range sets[set] {
			if x == member {
				return true
			}
		}
		return false
	}
	for _, c := range []struct {
		set, member string
		want        bool
	}{
		// part of home: with home, with the internet, and with the circle (never with itself)
		{"lan_ok", "192.168.2.0/24", true},
		{"lan_all", "192.168.2.0/24", true},
		{"inet_ok", "192.168.2.0/24", true},
		{"mesh_pairs", "10.77.0.2 . 192.168.2.0/24", true},
		{"mesh_pairs", "192.168.2.0/24 . 10.77.0.2", true},
		{"mesh_pairs", "10.77.0.5 . 192.168.2.0/24", false},
		{"mesh_pairs", "192.168.2.0/24 . 10.77.0.5", false},
		// another circle's phone does not reach it
		{"mesh_pairs", "10.77.0.9 . 192.168.2.0/24", false},
		// where everyone reaches everyone the pairs are not kept: being part of home is enough
		{"lan_ok", "192.168.3.0/24", true},
		// the internet alone
		{"inet_ok", "192.168.4.0/24", true},
		{"lan_ok", "192.168.4.0/24", false},
		{"lan_all", "192.168.4.0/24", false},
		// one home network: only that one
		{"lan_part", "192.168.5.0/24 . 192.168.50.0/24", true},
		{"lan_all", "192.168.5.0/24", false},
		// home services: what the owner's own devices reach of them
		{"svc_host", "192.168.6.0/24 . 192.168.50.20", in("svc_host", "10.77.0.8 . 192.168.50.20")},
		{"lan_ok", "192.168.6.0/24", false},
		// a network the router has itself is behind nobody
		{"lan_ok", "192.168.50.0/24", false},
		{"lan_all", "192.168.50.0/24", false},
		{"inet_ok", "192.168.50.0/24", false},
	} {
		if in(c.set, c.member) != c.want {
			t.Errorf("%s has %q: %v, want %v\n%v", c.set, c.member, !c.want, c.want, sets[c.set])
		}
	}
	// Eva's services reach the network as they reach her phone: member for member
	for _, set := range []string{"svc_ok", "svc_host"} {
		phone, site := 0, 0
		for _, x := range sets[set] {
			if strings.HasPrefix(x, "10.77.0.8 . ") {
				phone++
			}
			if strings.HasPrefix(x, "192.168.6.0/24 . ") {
				site++
			}
		}
		if phone != site {
			t.Errorf("%s: %d for the phone, %d for the network behind it", set, phone, site)
		}
	}
	// someone paused takes their network with them
	states["boris"] = "paused"
	for _, set := range Names {
		for _, x := range AccessSets(m, states, snap)[set] {
			if strings.Contains(x, "192.168.2.0/24") {
				t.Errorf("%s still has %q with its owner paused", set, x)
			}
		}
	}
	// a router that waits for the admin's answer is nowhere: neither its address nor what is behind it
	m.Devices["kphone"].Waiting = true
	for _, set := range Names {
		for _, x := range AccessSets(m, states, snap)[set] {
			if strings.Contains(x, "192.168.3.0/24") || strings.Contains(x, "10.79.0.2") {
				t.Errorf("%s has %q of a router that waits", set, x)
			}
		}
	}
	m.Devices["kphone"].Waiting = false
	// every set that holds people's sources takes a network
	table := Render(m, sets, Ctx{Snap: snap, ResolverPort: 5354})
	for _, name := range Names {
		for _, l := range strings.Split(table, "\n") {
			if strings.HasPrefix(l, "\tset "+name+" ") && !strings.Contains(l, "flags interval;") {
				t.Errorf("set %s takes no network: %s", name, l)
			}
		}
	}
}
