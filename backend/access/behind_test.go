package access

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

// A host behind someone's router is checked as the router is: the household on the golden's router, with
// Boris's router in Anna's circle (192.168.2.0/24 behind it) and Kira's where everyone reaches everyone.
func TestAHostBehindARouter(t *testing.T) {
	text, _ := os.ReadFile("testdata/access.uci")
	c, err := uci.Parse(string(text))
	if err != nil {
		t.Fatal(err)
	}
	for id, net := range map[string]string{"bphone": "192.168.2.0/24", "kphone": "192.168.3.0/24"} {
		c.Set(id, "kind", "router")
		c.SetList(id, "behind_net", []string{net})
	}
	c.Set("laptop", "lan_bypass", "1")
	m := model.Load(c, nil)
	raw, err := os.ReadFile("../netview/testdata/trace.json")
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
	snap := netview.Take(netview.Sources{Routes: func() []byte { return router.Routes }, Addrs: func() []byte { return router.Addrs },
		Links: func() map[string]netview.Link { return router.Links }, Zones: func() netview.Zones { return netview.ZonesOf(fw) }})
	states := map[string]string{}
	for _, id := range m.PersonIDs() {
		states[id] = "active"
	}
	// every device has a session and is connected now: what stops a connection here is the rules alone
	peers := map[string]awg.Peer{}
	for _, id := range m.DeviceIDs() {
		peers[m.Devices[id].PublicKey] = awg.Peer{Handshake: 1700000000}
	}
	ctx := Ctx{States: states, Peers: peers, Snap: snap, Online: func(*model.Device, awg.Peer) bool { return true }}
	said := func(steps []Step) string {
		var out []string
		for _, s := range steps {
			out = append(out, s.Title)
		}
		return strings.Join(out, " | ")
	}
	for _, c := range []struct {
		from, to string
		ok       bool
		has      string
	}{
		// Anna's laptop (it keeps its own local network outside, so its configuration names the network) to a host behind Boris's router, in her circle
		{"laptop", "192.168.2.10", true, "192.168.2.10 is behind Boris · Bphone"},
		// and back: the host has Boris's access, so it reaches what his router reaches
		{"192.168.2.10", "laptop", true, "192.168.2.10 is behind Boris · Bphone"},
		// Fedor is in another circle
		{"fphone", "192.168.2.10", false, "are not in one circle"},
		// a home address reaches it as it reaches the router, and it reaches home
		{"192.168.77.20", "192.168.2.10", true, "192.168.77.20 is at home"},
		{"192.168.2.10", "192.168.77.20", true, "192.168.2.10 is behind Boris · Bphone"},
		// the router itself and what is behind it need no tunnel between them
		{"bphone", "192.168.2.10", false, "192.168.2.10 is behind this device"},
		// two hosts behind one router likewise
		{"192.168.2.10", "192.168.2.20", false, "192.168.2.20 is behind this device"},
		// another server's network is another server's
		{"phone", "192.168.3.10", false, "is on another server"},
		// an address behind nobody is what it always was
		{"phone", "192.168.9.10", false, ""},
	} {
		ok, steps, err := Check(m, c.from, c.to, ctx)
		if err != nil || ok != c.ok || !strings.Contains(said(steps), c.has) {
			t.Errorf("%s → %s: %v %v, want %v with %q\n  %s", c.from, c.to, ok, err, c.ok, c.has, said(steps))
		}
	}
	// a router that waits for the admin's answer stands for nothing yet
	m.Devices["bphone"].Waiting = true
	if _, steps, _ := Check(m, "laptop", "192.168.2.10", ctx); strings.Contains(said(steps), "is behind") {
		t.Errorf("a waiting router's network is checked as its own: %s", said(steps))
	}
}
