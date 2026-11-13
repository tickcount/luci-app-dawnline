package methods

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
	"unicode"
	"unicode/utf8"

	"github.com/tickcount/luci-app-dawnline/backend/netview"
	"github.com/tickcount/luci-app-dawnline/backend/store"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
	"github.com/tickcount/luci-app-dawnline/backend/view"
)

// sitesStand is access's household on the golden's router (which has 192.168.50.0/24 and 192.168.77.0/24
// itself) with Boris's and Kira's devices made routers, and how often the full apply and the sync were
// asked for.
func sitesStand(t *testing.T) (d Deps, st *store.Store, dir string, applied, synced *int) {
	t.Helper()
	dir = t.TempDir()
	text, _ := os.ReadFile("../access/testdata/access.uci")
	c, err := uci.Parse(string(text))
	if err != nil {
		t.Fatal(err)
	}
	c.Set("bphone", "kind", "router")
	c.Set("kphone", "kind", "router")
	c.Set("lev", "device_limit", "10")
	os.WriteFile(dir+"/dawnline", []byte(c.Format()), 0o600)
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
	applied, synced = new(int), new(int)
	st = &store.Store{Config: dir + "/dawnline", RunDir: dir}
	d = Deps{World: func() *view.World { return &view.World{} }, Store: st, Config: dir + "/dawnline", RunDir: dir, DataDir: dir + "/data",
		Snapshot: func() *netview.Snapshot {
			return netview.Take(netview.Sources{Routes: func() []byte { return router.Routes }, Addrs: func() []byte { return router.Addrs },
				Links: func() map[string]netview.Link { return router.Links }})
		},
		AWG:   func() map[string]any { return map[string]any{"tools": true, "kmod": true} },
		Apply: func(string) map[string]any { *applied++; return map[string]any{"warning": nil} },
		Sync:  func(string) any { *synced++; return nil }}
	// keys and ids as a row of made-up ones, each its own
	keys, hex := newKeys, randHex
	t.Cleanup(func() { newKeys, randHex = keys, hex })
	n := 0
	newKeys = func() Keys {
		n++
		k := func(c byte) string { return strings.Repeat(string(c), 41) + string(rune('A'+n)) + "A=" }
		return Keys{Private: k('P'), Public: k('Q'), Preshared: k('R')}
	}
	made := 0
	randHex = func(int) string { made++; return "0a0b0c0" + string(rune('0'+made)) }
	return d, st, dir, applied, synced
}

// The networks behind a router, as the admin sets them: access's household on the golden's router (which
// has 192.168.50.0/24 and 192.168.77.0/24 itself), every refusal in its words, and the full apply asked
// for only when something changed.
func TestNetworksBehindARouter(t *testing.T) {
	d, st, dir, ap, sy := sitesStand(t)
	behind := func(id string) []string {
		_, m, err := st.Read()
		if err != nil {
			t.Fatal(err)
		}
		return m.Devices[id].Behind
	}
	set := func(id string, nets ...any) map[string]any {
		return ask(t, d, "device_networks", map[string]any{"id": id, "networks": nets})
	}
	// two networks, each told from its first address, the one written twice once
	res := set("bphone", " 192.168.2.9/24 ", "172.20.0.0/16", "192.168.2.0/24", "")
	if res["error"] != nil || !reflect.DeepEqual(behind("bphone"), []string{"192.168.2.0/24", "172.20.0.0/16"}) || *ap != 1 || *sy != 0 {
		t.Fatalf("set: %v, %v, applied %d, synced %d", res, behind("bphone"), *ap, *sy)
	}
	if !reflect.DeepEqual(res["networks"], []string{"192.168.2.0/24", "172.20.0.0/16"}) {
		t.Errorf("answered %v", res["networks"])
	}
	// the same again: nothing written, nothing applied
	if res = set("bphone", "192.168.2.0/24", "172.20.0.0/16"); res["error"] != nil || *ap != 1 {
		t.Errorf("the same list: %v, applied %d", res, *ap)
	}
	for _, r := range []struct {
		id   string
		nets []any
		want string
	}{
		{"bphone", []any{"192.168.2.0"}, "Network 192.168.2.0 is not written like 192.168.2.0/24."},
		{"bphone", []any{"10.0.0.0/8"}, "Network 10.0.0.0/8 is too wide: /16 at the most."},
		{"bphone", []any{"8.8.8.0/24"}, "Network 8.8.8.0/24 is not private (10.x, 172.16-31.x, 192.168.x)."},
		{"bphone", []any{"192.168.4.0/24", "192.168.4.128/25"}, "Networks 192.168.4.0/24 and 192.168.4.128/25 share addresses."},
		{"bphone", []any{"10.77.0.0/16"}, "Network 10.77.0.0/16 is taken: 10.77.0.0/24 is the tunnel network of Home. The two ends of a tunnel need different addresses."},
		{"bphone", []any{"192.168.50.0/25"}, "Network 192.168.50.0/25 is taken: the router has 192.168.50.0/24 itself. The two ends of a tunnel need different addresses."},
		{"kphone", []any{"172.20.5.0/24"}, "Network 172.20.5.0/24 is taken: 172.20.0.0/16 is behind Bphone (Boris). Two sites need different addresses."},
		{"phone", []any{"192.168.9.0/24"}, "Only a router has networks behind it."},
		{"nobody", []any{"192.168.9.0/24"}, "Unknown device."},
		{"bphone", []any{"192.168.10.0/24", "192.168.11.0/24", "192.168.12.0/24", "192.168.13.0/24", "192.168.14.0/24", "192.168.15.0/24",
			"192.168.16.0/24", "192.168.17.0/24", "192.168.18.0/24"}, "A router has 8 networks behind it at the most."},
	} {
		if res := set(r.id, r.nets...); res["error"] != r.want {
			t.Errorf("%s %v: %v, want %q", r.id, r.nets, res["error"], r.want)
		}
		// the page shows a refusal as it came only when it begins as a sentence does (web/src/admin/failure.ts):
		// one that began with the network's address would be read as a program's error
		if first, _ := utf8.DecodeRuneInString(r.want); !unicode.IsUpper(first) {
			t.Errorf("%q does not begin with a capital letter", r.want)
		}
	}
	if *ap != 1 || !reflect.DeepEqual(behind("bphone"), []string{"192.168.2.0/24", "172.20.0.0/16"}) {
		t.Errorf("a refusal wrote or applied: %d, %v", *ap, behind("bphone"))
	}
	// the names in a refusal are the settings' own
	_, m, _ := st.Read()
	if m.Servers["home"].Name != "Home" || m.Devices["bphone"].Name != "Bphone" || m.People["boris"].Name != "Boris" {
		t.Fatalf("the household's names moved: %q, %q, %q", m.Servers["home"].Name, m.Devices["bphone"].Name, m.People["boris"].Name)
	}
	// none: the option goes, and the routes with it
	if res = set("bphone"); res["error"] != nil || behind("bphone") != nil || *ap != 2 {
		t.Errorf("none: %v, %v, applied %d", res, behind("bphone"), *ap)
	}
	if file, _ := os.ReadFile(dir + "/dawnline"); strings.Contains(string(file), "behind_net") {
		t.Error("the option is still in the file")
	}
	// a router added with its networks is applied in full; another device is loaded by the sync, as before
	res = ask(t, d, "device_create", map[string]any{"person": "lev", "name": "Dacha", "kind": "router", "networks": []any{"192.168.88.1/24"}})
	if res["error"] != nil || res["id"] != "d_0a0b0c01" || !reflect.DeepEqual(behind("d_0a0b0c01"), []string{"192.168.88.0/24"}) || *ap != 3 || *sy != 0 {
		t.Fatalf("a router with its network: %v, applied %d, synced %d", res["error"], *ap, *sy)
	}
	if res = ask(t, d, "device_create", map[string]any{"person": "lev", "name": "Tablet", "kind": "tablet", "networks": []any{"192.168.89.0/24"}}); res["error"] != "Only a router has networks behind it." {
		t.Errorf("a tablet with a network: %v", res["error"])
	}
	if res = ask(t, d, "device_create", map[string]any{"person": "lev", "name": "Second", "kind": "router", "networks": []any{"192.168.88.128/25"}}); res["error"] !=
		"Network 192.168.88.128/25 is taken: 192.168.88.0/24 is behind Dacha (Lev). Two sites need different addresses." {
		t.Errorf("a second router on the first one's addresses: %v", res["error"])
	}
	if *ap != 3 || *sy != 0 {
		t.Errorf("refusals applied: %d, %d", *ap, *sy)
	}
	// set up again as a phone: what is no router has nothing behind it
	if res = ask(t, d, "device_rotate", map[string]any{"id": "d_0a0b0c01", "kind": "phone"}); res["error"] != nil || behind("d_0a0b0c01") != nil || *ap != 4 {
		t.Errorf("a router made a phone: %v, %v, applied %d", res["error"], behind("d_0a0b0c01"), *ap)
	}
	// and the log has each change in its words
	var details []string
	for _, e := range journalOf(t, dir) {
		if e["type"] == "device_changed" {
			details = append(details, e["detail"].(string))
		}
	}
	want := []string{"networks=192.168.2.0/24 172.20.0.0/16", "networks=none", "networks=192.168.88.0/24", "kind=phone, networks=none"}
	if !reflect.DeepEqual(details, want) {
		t.Errorf("logged %v, want %v", details, want)
	}
}

// journalOf is the activity log a test's methods wrote, the oldest first.
func journalOf(t *testing.T, dir string) []map[string]any {
	t.Helper()
	var list []map[string]any
	raw, err := os.ReadFile(dir + "/events.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &list); err != nil {
		t.Fatal(err)
	}
	if len(list) > 1 && list[0]["ts"].(float64) > list[len(list)-1]["ts"].(float64) {
		for i, j := 0, len(list)-1; i < j; i, j = i+1, j-1 {
			list[i], list[j] = list[j], list[i]
		}
	}
	return list
}
