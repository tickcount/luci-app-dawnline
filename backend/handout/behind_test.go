package handout

import (
	"os"
	"strings"
	"testing"

	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
)

// A device that sends only some networks into the tunnel is given what is behind the routers it reaches;
// one that sends everything needs no word of them, and a router is never given its own.
func TestNetworksBehindRoutersInAConfiguration(t *testing.T) {
	text, err := os.ReadFile("../access/testdata/access.uci")
	if err != nil {
		t.Fatal(err)
	}
	c, err := uci.Parse(string(text))
	if err != nil {
		t.Fatal(err)
	}
	home := []string{"192.168.77.0/24"}
	allowed := func(id string) string {
		m := model.Load(c, nil)
		cfg := ClientConfig(m, m.Devices[id], home)
		if cfg == nil {
			t.Fatalf("%s has no configuration", id)
		}
		return strings.Join(cfg.Amnezia.AllowedIPs, ", ")
	}
	print := func(id string) string {
		m := model.Load(c, nil)
		return Fingerprint(m, m.Devices[id], home)
	}
	// Anna's laptop keeps its own local network outside; her phone sends everything; Fedor is in another circle
	before := map[string]string{}
	for _, id := range []string{"laptop", "phone", "bphone", "fphone", "dphone", "lphone"} {
		before[id] = print(id)
	}
	c.Set("bphone", "kind", "router")
	c.SetList("bphone", "behind_net", []string{"192.168.2.0/24"})
	c.Set("kphone", "kind", "router")
	c.SetList("kphone", "behind_net", []string{"192.168.3.0/24"})
	c.Set("fphone", "lan_bypass", "1")
	c.Set("lphone", "lan_bypass", "1")
	if got := allowed("laptop"); !strings.Contains(got, "192.168.2.0/24") || strings.Contains(got, "192.168.3.0/24") {
		t.Errorf("Anna's laptop, in Boris's circle: %s", got)
	}
	if got := allowed("phone"); got != "0.0.0.0/0, ::/0" {
		t.Errorf("Anna's phone sends everything: %s", got)
	}
	if got := allowed("fphone"); strings.Contains(got, "192.168.2.0/24") {
		t.Errorf("Fedor's phone, in another circle: %s", got)
	}
	// where everyone reaches everyone: the other server's network, and only that server's
	if got := allowed("lphone"); !strings.Contains(got, "192.168.3.0/24") || strings.Contains(got, "192.168.2.0/24") {
		t.Errorf("Lev's phone: %s", got)
	}
	// a router is not told to send its own network into the tunnel
	c.Set("bphone", "lan_bypass", "1")
	if got := allowed("bphone"); strings.Contains(got, "192.168.2.0/24") {
		t.Errorf("Boris's router: %s", got)
	}
	// who was given a new network must import again; who was not keeps what they hold
	if print("laptop") == before["laptop"] {
		t.Error("Anna's laptop holds a configuration without the network, and is not told")
	}
	for _, id := range []string{"phone", "dphone"} {
		if print(id) != before[id] {
			t.Errorf("%s is told to import again for a network that is not in its configuration", id)
		}
	}
}
