package nft

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/netview"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
)

// The access table for access's household, byte for byte the one ucode makes, for every row of states and
// of what is read from the router (testdata/trace.uc, scripts/ucode-golden.sh).
func TestTableAsUcode(t *testing.T) {
	raw, err := os.ReadFile("testdata/trace.json")
	if err != nil {
		t.Fatal(err)
	}
	type oneCase = struct {
		States map[string]string `json:"states"`
		Ctx    struct {
			DNSAddr  *string `json:"dns_addr"`
			Resolver struct {
				Mode    string `json:"mode"`
				Address string `json:"address"`
				Port    int    `json:"port"`
			} `json:"resolver"`
			LanDNS *string `json:"lan_dns"`
		} `json:"ctx"`
		Sets  Sets   `json:"sets"`
		Table string `json:"table"`
		Shape struct{ Chains, Sets, Rules int }
	}
	var trace struct {
		Cases []oneCase `json:"cases"`
		Extra []oneCase `json:"extra"`
	}
	if err := json.Unmarshal(raw, &trace); err != nil {
		t.Fatal(err)
	}
	if len(trace.Cases) != 16 || len(trace.Extra) != 3 {
		t.Fatalf("%d and %d cases", len(trace.Cases), len(trace.Extra))
	}
	load := func(path string) *model.Model {
		text, _ := os.ReadFile(path)
		c, err := uci.Parse(string(text))
		if err != nil {
			t.Fatal(err)
		}
		return model.Load(c, nil)
	}
	m, m2 := load("../access/testdata/access.uci"), load("testdata/extra.uci")
	raw, err = os.ReadFile("../netview/testdata/trace.json")
	if err != nil {
		t.Fatal(err)
	}
	var router struct {
		Routes   json.RawMessage         `json:"routes"`
		Addrs    json.RawMessage         `json:"addrs"`
		Firewall string                  `json:"firewall"`
		Links    map[string]netview.Link `json:"links"`
	}
	json.Unmarshal(raw, &router)
	fw, _ := uci.Parse(router.Firewall)
	snap := netview.Take(netview.Sources{Routes: func() []byte { return router.Routes }, Addrs: func() []byte { return router.Addrs },
		Links: func() map[string]netview.Link { return router.Links }, Zones: func() netview.Zones { return netview.ZonesOf(fw) }})
	members := 0
	filled := map[string]bool{}
	for i, want := range append(trace.Cases, trace.Extra...) {
		m := m
		if i >= len(trace.Cases) {
			m = m2
		}
		sets := AccessSets(m, want.States, snap)
		for _, name := range Names {
			filled[name] = filled[name] || len(sets[name]) > 0
		}
		for _, name := range Names {
			members += len(sets[name])
		}
		if !reflect.DeepEqual(sets, want.Sets) {
			for _, name := range Names {
				if !reflect.DeepEqual(sets[name], want.Sets[name]) {
					t.Errorf("case %d: set %s\n go:    %v\n ucode: %v", i, name, sets[name], want.Sets[name])
				}
			}
			continue
		}
		str := func(p *string) string {
			if p == nil {
				return ""
			}
			return *p
		}
		ctx := Ctx{DNSAddr: str(want.Ctx.DNSAddr), LanDNS: str(want.Ctx.LanDNS), ResolverPort: want.Ctx.Resolver.Port, Snap: snap}
		if want.Ctx.Resolver.Mode == "ns" {
			ctx.ResolverNS = want.Ctx.Resolver.Address
		}
		got := Render(m, sets, ctx)
		if got != want.Table {
			g, w := strings.Split(got, "\n"), strings.Split(want.Table, "\n")
			for n := 0; n < len(g) && n < len(w); n++ {
				if g[n] != w[n] {
					t.Errorf("case %d: line %d\n go:    %s\n ucode: %s", i, n+1, g[n], w[n])
					break
				}
			}
			if len(g) != len(w) {
				t.Errorf("case %d: %d lines, ucode %d", i, len(g), len(w))
			}
			continue
		}
		if chains, nsets, rules := Shape(got); chains != want.Shape.Chains || nsets != want.Shape.Sets || rules != want.Shape.Rules {
			t.Errorf("case %d: shape %d %d %d, ucode %+v", i, chains, nsets, rules, want.Shape)
		}
	}
	for _, name := range Names {
		if !filled[name] {
			t.Errorf("no case fills %s", name)
		}
	}
	if members < 200 {
		t.Fatalf("the household fills the sets too little: %d members", members)
	}
}

func TestUpdateScript(t *testing.T) {
	got := Update(Sets{"lan_ok": {"10.77.0.2", "10.77.0.2", "10.77.0.3"}, "svc_ok": {"10.77.0.8 . 192.168.77.5 . 445"}})
	want := "flush set inet dawnline lan_ok\nadd element inet dawnline lan_ok { 10.77.0.2, 10.77.0.3 }\nflush set inet dawnline lan_all\nflush set inet dawnline lan_part\n" +
		"flush set inet dawnline mesh_pairs\nflush set inet dawnline inet_ok\nflush set inet dawnline svc_ok\nadd element inet dawnline svc_ok { 10.77.0.8 . 192.168.77.5 . 445 }\n" +
		"flush set inet dawnline svc_host\nflush set inet dawnline dns_real\n"
	if got != want {
		t.Fatalf("the update:\n%s", got)
	}
	if !strings.HasPrefix(Rebuild("table inet dawnline {\n}\n"), "table inet dawnline\ndelete table inet dawnline\ntable inet dawnline {") {
		t.Fatal("a rebuild does not replace the table in one transaction")
	}
}
