package access

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"github.com/tickcount/luci-app-dawnline/backend/awg"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/netview"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
)

// Every connection of the made-up household, step for step and sentence for sentence as ucode says it
// (testdata/trace.uc on testdata/access.uci, on the router netview's golden is taken from).
func TestHouseholdAsUcode(t *testing.T) {
	raw, err := os.ReadFile("testdata/trace.json")
	if err != nil {
		t.Fatal(err)
	}
	var trace struct {
		States map[string]string   `json:"states"`
		Peers  map[string]awg.Peer `json:"peers"`
		Online map[string]bool     `json:"online"`
		Cases  []struct {
			From, To string
			OK       bool   `json:"ok"`
			Steps    []Step `json:"steps"`
			Error    string `json:"error"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &trace); err != nil {
		t.Fatal(err)
	}
	text, _ := os.ReadFile("testdata/access.uci")
	c, err := uci.Parse(string(text))
	if err != nil {
		t.Fatal(err)
	}
	m := model.Load(c, nil)
	// the router: what the golden's container said of itself
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
	if err := json.Unmarshal(raw, &router); err != nil {
		t.Fatal(err)
	}
	fw, _ := uci.Parse(router.Firewall)
	snap := netview.Take(netview.Sources{Routes: func() []byte { return router.Routes }, Addrs: func() []byte { return router.Addrs },
		Links: func() map[string]netview.Link { return router.Links }, Zones: func() netview.Zones { return netview.ZonesOf(fw) }})
	ctx := Ctx{States: trace.States, Peers: trace.Peers, Snap: snap, Online: func(d *model.Device, _ awg.Peer) bool { return trace.Online[d.ID] }}
	if len(trace.Cases) < 500 {
		t.Fatalf("only %d cases", len(trace.Cases))
	}
	passed, stopped, refused, titles, bad := 0, 0, 0, map[string]bool{}, 0
	for _, want := range trace.Cases {
		ok, steps, err := Check(m, want.From, want.To, ctx)
		if want.Error != "" {
			refused++
			if err == nil || err.Error() != want.Error {
				t.Errorf("%s → %s: %v, ucode refuses with %q", want.From, want.To, err, want.Error)
			}
			continue
		}
		if ok {
			passed++
		} else {
			stopped++
		}
		for _, s := range steps {
			titles[s.Title] = true
		}
		if err != nil || ok != want.OK || !reflect.DeepEqual(steps, want.Steps) {
			if bad++; bad <= 12 {
				g, _ := json.Marshal(steps)
				u, _ := json.Marshal(want.Steps)
				t.Errorf("%s → %s (%v)\n go:    %v %s\n ucode: %v %s", want.From, want.To, err, ok, g, want.OK, u)
			}
		}
	}
	if bad > 0 {
		t.Errorf("%d of %d cases differ", bad, len(trace.Cases))
	}
	if passed < 30 || stopped < 100 || refused < 3 || len(titles) < 60 {
		t.Fatalf("the household exercises too little: %d pass, %d stop, %d refused, %d different steps", passed, stopped, refused, len(titles))
	}
}
