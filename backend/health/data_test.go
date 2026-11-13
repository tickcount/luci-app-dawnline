package health

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/tickcount/luci-app-dawnline/backend/awg"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/state"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
	"github.com/tickcount/luci-app-dawnline/backend/usage"
)

// What is wrong with testdata/broken.uci, who is loaded into each tunnel and how made-up tunnels stand
// against that, as ucode says (testdata/trace.uc, scripts/ucode-golden.sh).
func TestBrokenSettingsAsUcode(t *testing.T) {
	raw, err := os.ReadFile("testdata/trace.json")
	if err != nil {
		t.Fatal(err)
	}
	var trace struct {
		TS      int64               `json:"ts"`
		Errors  []string            `json:"errors"`
		States  map[string]string   `json:"states"`
		Tunnels map[string][]string `json:"tunnels"`
		Diffs   []struct {
			Server string   `json:"server"`
			Loaded []string `json:"loaded"`
			Diff   struct{ Loaded, Missing, Extra int }
		} `json:"diffs"`
	}
	if err := json.Unmarshal(raw, &trace); err != nil {
		t.Fatal(err)
	}
	text, _ := os.ReadFile("testdata/broken.uci")
	c, err := uci.Parse(string(text))
	if err != nil {
		t.Fatal(err)
	}
	m := model.Load(c, nil)
	if got := ModelErrors(m, nil); !reflect.DeepEqual(got, trace.Errors) || len(got) < 12 {
		t.Errorf("what is wrong\n go:\n  %s\n ucode:\n  %s", strings.Join(got, "\n  "), strings.Join(trace.Errors, "\n  "))
	}
	states := map[string]string{}
	for id, p := range m.People {
		states[id] = state.Of(m, p, usage.Empty(), trace.TS)
	}
	if !reflect.DeepEqual(states, trace.States) {
		t.Fatalf("states %v, ucode %v", states, trace.States)
	}
	loaded := 0
	for sid, want := range trace.Tunnels {
		got := []string{}
		for _, d := range TunnelDevices(m, sid, states) {
			got = append(got, d.ID)
		}
		loaded += len(got)
		if !reflect.DeepEqual(got, want) {
			t.Errorf("tunnel %s holds %v, ucode %v", sid, got, want)
		}
	}
	if loaded == 0 || len(trace.Diffs) < 8 {
		t.Fatal("the golden loads nobody")
	}
	for i, d := range trace.Diffs {
		srv := m.Servers[d.Server]
		peers := map[string]awg.Peer{"YYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYA=": {Ifname: "another"}}
		for _, k := range d.Loaded {
			peers[k] = awg.Peer{Ifname: srv.Ifname}
		}
		got := PeerDiff(TunnelDevices(m, d.Server, states), peers, srv.Ifname)
		if got.Loaded != d.Diff.Loaded || got.Missing != d.Diff.Missing || got.Extra != d.Diff.Extra {
			t.Errorf("diff %d: %+v, ucode %+v", i, got, d.Diff)
		}
	}
}

func TestProxiesAndTheReplyTable(t *testing.T) {
	rules := map[string]string{
		"-4": "0:\tfrom all lookup local\n1000:\tfrom all fwmark 0x1 lookup 100\n1001:\tfrom all fwmark 0x1 lookup 100\n2000:\tfrom all fwmark 0x200/0xff00 lookup 200\n3000:\tfrom all fwmark 0x7 lookup 300\n32766:\tfrom all fwmark 0x9 lookup main\n",
		"-6": "1000:\tfrom all fwmark 0x1 lookup 100\n",
	}
	tables := map[string]string{"100": "local default dev lo scope host\n", "200": "10.0.0.0/8 dev x\nlocal default dev lo\n", "300": "default via 10.0.0.1 dev wan\n"}
	d := ProxyDiverts(func(f string) string { return rules[f] }, func(_, name string) string { return tables[name] })
	var said []string
	for _, x := range d {
		said = append(said, x.String())
	}
	if strings.Join(said, "; ") != "pref 1000 fwmark 0x1 → table 100; pref 2000 fwmark 0x200/0xff00 → table 200" {
		t.Fatalf("diverts: %v", said)
	}
	c, _ := uci.Parse("config settings 'settings'\n\toption portal_enabled '1'\n\toption portal_port '4500'\n\tlist portal_alt '203.0.113.7'\n" +
		"config server 'home'\n\toption port '4500'\n\toption private_key 'k'\nconfig server 'cabin'\n\toption port '4600'\n\toption private_key 'k'\n\toption enabled '0'\n")
	m := model.Load(c, nil)
	want := "table inet dawnline_reply {\n\tchain out {\n\t\ttype route hook output priority filter + 10; policy accept;\n" +
		"\t\ttcp sport { 4500, 4501 } meta mark 0x1 meta mark set 0x0\n\t\ttcp sport { 4500, 4501 } meta mark & 0xff00 == 0x200 meta mark set meta mark & 0xffff00ff\n" +
		"\t\tudp sport { 4500 } meta mark 0x1 meta mark set 0x0\n\t\tudp sport { 4500 } meta mark & 0xff00 == 0x200 meta mark set meta mark & 0xffff00ff\n\t}\n}\n"
	if got := ReplyScript(m, d); got != want {
		t.Fatalf("the reply table:\n%s", got)
	}
	if ReplyScript(m, nil) != "" {
		t.Fatal("a reply table with no proxy to keep out of")
	}
}

// Settings whose servers are wrong in every way: what a restore says of them, as ucode says it.
func TestConfigErrorsAsUcode(t *testing.T) {
	raw, _ := os.ReadFile("testdata/trace.json")
	var trace struct {
		Network string   `json:"network"`
		Errors  []string `json:"config_errors"`
	}
	if err := json.Unmarshal(raw, &trace); err != nil {
		t.Fatal(err)
	}
	text, _ := os.ReadFile("testdata/servers.uci")
	c, err := uci.Parse(string(text))
	if err != nil {
		t.Fatal(err)
	}
	network, err := uci.Parse(trace.Network)
	if err != nil {
		t.Fatal(err)
	}
	got := ConfigErrors(model.Load(c, nil), nil, network, nil)
	if !reflect.DeepEqual(got, trace.Errors) || len(got) < 12 {
		t.Errorf("what a restore says\n go:\n  %s\n ucode:\n  %s", strings.Join(got, "\n  "), strings.Join(trace.Errors, "\n  "))
	}
}
