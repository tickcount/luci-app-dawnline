package netview

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
)

// From what the golden's router said, the same interfaces, WAN, LAN and home networks as ucode found
// (scripts/ucode-golden.sh writes trace.json from dawnline.net and dawnline.core).
func TestHeldToUcode(t *testing.T) {
	raw, err := os.ReadFile("testdata/trace.json")
	if err != nil {
		t.Fatal(err)
	}
	var golden struct {
		Routes   json.RawMessage `json:"routes"`
		Addrs    json.RawMessage `json:"addrs"`
		Firewall string          `json:"firewall"`
		Zones    []string        `json:"zones"`
		Servers  map[string]struct {
			Wan struct {
				Dev     string `json:"dev"`
				Auto    bool   `json:"auto"`
				Zone    string `json:"zone"`
				Missing bool   `json:"missing"`
			} `json:"wan"`
			Home []struct {
				Dev     string   `json:"dev"`
				Auto    bool     `json:"auto"`
				Nets    []string `json:"nets"`
				Zone    string   `json:"zone"`
				Missing bool     `json:"missing"`
			} `json:"home"`
			Nets  []string `json:"nets"`
			Zones []string `json:"zones"`
		} `json:"servers"`
		Links   map[string]Link     `json:"links"`
		Devices map[string]*Device  `json:"devices"`
		WAN     *string             `json:"wan"`
		LAN     *string             `json:"lan"`
		Homes   map[string][]string `json:"homes"`
	}
	if err := json.Unmarshal(raw, &golden); err != nil {
		t.Fatal(err)
	}
	fw, err := uci.Parse(golden.Firewall)
	if err != nil {
		t.Fatal(err)
	}
	s := Take(Sources{Routes: func() []byte { return golden.Routes }, Addrs: func() []byte { return golden.Addrs },
		Links: func() map[string]Link { return golden.Links }, Zones: func() Zones { return ZonesOf(fw) }})
	if !reflect.DeepEqual(s.Zones, golden.Zones) || len(s.Zones) < 2 {
		t.Fatalf("zones %v, ucode has %v", s.Zones, golden.Zones)
	}
	if !reflect.DeepEqual(s.Devices, golden.Devices) {
		g, _ := json.MarshalIndent(s.Devices, "", " ")
		w, _ := json.MarshalIndent(golden.Devices, "", " ")
		t.Fatalf("the interfaces differ\nGo:    %s\nucode: %s", g, w)
	}
	str := func(p *string) string {
		if p == nil {
			return ""
		}
		return *p
	}
	if s.WAN != str(golden.WAN) || s.LAN != str(golden.LAN) {
		t.Fatalf("WAN %q, LAN %q; ucode has %q, %q", s.WAN, s.LAN, str(golden.WAN), str(golden.LAN))
	}
	if s.LAN == "" || len(golden.Devices) < 5 {
		t.Fatalf("the golden's router is too bare to hold anything to: %d interfaces, LAN %q", len(golden.Devices), s.LAN)
	}
	text, err := os.ReadFile("../handout/testdata/conf.uci")
	if err != nil {
		t.Fatal(err)
	}
	c, err := uci.Parse(string(text))
	if err != nil {
		t.Fatal(err)
	}
	m := model.Load(c, nil)
	zoned := 0
	for id, want := range golden.Servers {
		wan, home, nets, zones := s.ServerNet(m.Servers[id])
		got, _ := json.Marshal(map[string]any{"wan": wan, "home": home, "nets": nets, "zones": zones})
		type w = map[string]any
		homes := []any{}
		for _, h := range want.Home {
			homes = append(homes, HomeOf{h.Dev, h.Auto, h.Nets, h.Zone, h.Missing})
			if h.Zone != "" {
				zoned++
			}
		}
		exp, _ := json.Marshal(w{"wan": Wan{want.Wan.Dev, want.Wan.Auto, want.Wan.Zone, want.Wan.Missing}, "home": homes, "nets": want.Nets, "zones": want.Zones})
		if string(got) != string(exp) {
			t.Errorf("server %s uses\n Go:    %s\n ucode: %s", id, got, exp)
		}
	}
	if len(golden.Servers) == 0 || zoned == 0 {
		t.Fatalf("the golden holds no server's home in a zone: %d servers", len(golden.Servers))
	}
	reached := 0
	for id, want := range golden.Homes {
		p := m.People[id]
		srv := m.Servers[p.Server]
		if srv == nil {
			continue
		}
		got := s.PersonHome(srv, p)
		reached += len(got)
		if len(got) != len(want) || (len(got) > 0 && !reflect.DeepEqual(got, want)) {
			t.Errorf("%s reaches %v, ucode has %v", id, got, want)
		}
	}
	if reached == 0 {
		t.Fatal("nobody reaches a home network in the golden")
	}
}
