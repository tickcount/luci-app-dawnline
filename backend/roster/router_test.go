package roster

import (
	"os"
	"reflect"
	"testing"

	"github.com/tickcount/luci-app-dawnline/backend/model"
)

func TestBlockedText(t *testing.T) {
	srv := func(why any) *model.Server {
		return &model.Server{Name: "Home", Blocked: why, Obf: map[string]string{"jmin": "9", "jmax": "3"}}
	}
	for _, c := range []struct {
		why  any
		text any
		ok   bool
	}{
		{nil, nil, true},
		{"another tunnel has its name", "Home another tunnel has its name.", true},
		{map[string]any{"code": "ifname", "ifname": "bad name"}, `Home has an invalid interface name "bad name".`, true},
		{map[string]any{"code": "taken", "ifname": "wg0"}, "Home can't use the network interface wg0: it exists and isn't Dawnline's.", true},
		{map[string]any{"code": "disguise", "need": "3.1", "installed": "2.0"}, "Home is kept down: its disguise needs AmneziaWG 3.1 (installed: 2.0).", true},
		{map[string]any{"code": "disguise", "need": "2.0", "installed": nil}, "Home is kept down: its disguise needs AmneziaWG 2.0 (installed: none).", true},
		{map[string]any{"code": "later"}, "Home is kept down.", true},
		{map[string]any{"code": "disguise_invalid"}, "Home is kept down: its disguise has values AmneziaWG cannot take. Jmin must not be larger than Jmax.", true},
		{7.0, nil, false},
	} {
		if text, ok := blockedText(srv(c.why)); text != c.text || ok != c.ok {
			t.Errorf("%v: %v %v", c.why, text, ok)
		}
	}
}

func TestLikeHome(t *testing.T) {
	dir := t.TempDir()
	for _, c := range []struct {
		file string
		want map[string]any
	}{
		{``, map[string]any{"active": false, "off": false, "error": nil}},
		{`{"off":true}`, map[string]any{"active": false, "off": true, "error": nil}},
		{`{"error":"An older version's own words."}`, map[string]any{"active": false, "off": false, "error": "An older version's own words."}},
		{`{"error":{"code":"not_bridge","dev":"eth1"}}`, map[string]any{"active": false, "off": false, "error": "eth1 is not a bridge, so Dawnline cannot join the LAN as a device."}},
		{`{"error":{"code":"failed","detail":"ip: no such device"}}`, map[string]any{"active": false, "off": false, "error": "Setup failed: ip: no such device"}},
		// set up, but its links are not on this machine: not active, not in the bridge
		{`{"plan":{"dev":"br-lan","address":"192.168.1.9","dns":"192.168.1.1","gateway":"192.168.1.1","tx_ns":"169.254.7.2"}}`,
			map[string]any{"active": false, "dev": "br-lan", "address": "192.168.1.9", "dns": "192.168.1.1", "gateway": "192.168.1.1", "transit": "169.254.7.2", "bridged": false}},
	} {
		os.Remove(dir + "/loop.json")
		if c.file != "" {
			os.WriteFile(dir+"/loop.json", []byte(c.file), 0o600)
		}
		if got, ok := LikeHome(dir); !ok || !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s: %v", c.file, got)
		}
	}
}

func TestPublicWAN(t *testing.T) {
	for wan, want := range map[string]any{"": nil, "192.168.1.2": nil, "100.72.0.9": nil, "10.0.0.1": nil, "172.20.1.1": nil, "203.0.113.7": "203.0.113.7"} {
		if got := publicWAN(wan); got != want {
			t.Errorf("%q: %v", wan, got)
		}
	}
}
