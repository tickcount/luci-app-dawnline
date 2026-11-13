package state

import (
	"encoding/json"
	"os"
	"testing"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
	"github.com/tickcount/luci-app-dawnline/backend/usage"
	"github.com/tickcount/luci-app-dawnline/backend/zone"
)

// Every person of testdata/state.uci, at every moment of the trace, stands where ucode says
// (scripts/ucode-golden.sh writes trace.json from dawnline.core).
func TestHeldToUcode(t *testing.T) {
	zone.Set(time.UTC)
	text, err := os.ReadFile("testdata/state.uci")
	if err != nil {
		t.Fatal(err)
	}
	c, err := uci.Parse(string(text))
	if err != nil {
		t.Fatal(err)
	}
	m := model.Load(c, nil)
	raw, err := os.ReadFile("testdata/trace.json")
	if err != nil {
		t.Fatal(err)
	}
	var golden struct {
		Usage   *usage.Usage `json:"usage"`
		Moments []struct {
			TS     int64 `json:"ts"`
			People map[string]struct {
				State string  `json:"state"`
				Own   string  `json:"own"`
				Used  float64 `json:"used"`
				Quota float64 `json:"quota"`
			} `json:"people"`
		} `json:"moments"`
	}
	if err := json.Unmarshal(raw, &golden); err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, at := range golden.Moments {
		if len(at.People) != len(m.People) {
			t.Fatalf("ucode knows %d people, Go %d", len(at.People), len(m.People))
		}
		for id, want := range at.People {
			p := m.People[id]
			got := [2]string{Of(m, p, golden.Usage, at.TS), Own(p, golden.Usage, at.TS)}
			if got != [2]string{want.State, want.Own} {
				t.Errorf("%s at %d: %v, ucode has %s / %s", id, at.TS, got, want.State, want.Own)
			}
			if u, q := Usage(p, golden.Usage, at.TS), QuotaBytes(p, at.TS); u != want.Used || q != want.Quota {
				t.Errorf("%s at %d: used %v of %v, ucode has %v of %v", id, at.TS, u, q, want.Used, want.Quota)
			}
			seen[want.State] = true
		}
	}
	for _, s := range []string{Active, Paused, Expired, Quota, NoServer, ServerOff} {
		if !seen[s] {
			t.Errorf("the trace never reaches %q", s)
		}
	}
}

// An end date is the router's own day.
func TestTheRoutersDay(t *testing.T) {
	msk, _ := zone.FromPOSIX("MSK-3")
	zone.Set(msk)
	defer zone.Set(time.UTC)
	end, ok := DateEnd("2026-11-12")
	if !ok || time.Unix(end, 0).UTC().Format("2006-01-02 15:04:05") != "2026-11-12 20:59:59" {
		t.Fatalf("the end of the day: %v", time.Unix(end, 0).UTC())
	}
}
