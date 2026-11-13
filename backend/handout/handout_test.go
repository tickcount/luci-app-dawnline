package handout

import (
	"encoding/json"
	"os"
	"reflect"
	"sort"
	"testing"

	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
)

// Every device of testdata/conf.uci gets the configuration and the fingerprint ucode gives it
// (scripts/ucode-golden.sh writes trace.json from dawnline.awg), from the home networks ucode found.
func TestHeldToUcode(t *testing.T) {
	text, err := os.ReadFile("testdata/conf.uci")
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
		Names   map[string]string `json:"names"`
		Devices map[string]struct {
			Home   []string `json:"home"`
			Config any      `json:"config"`
			FP     *string  `json:"fp"`
		} `json:"devices"`
	}
	if err := json.Unmarshal(raw, &golden); err != nil {
		t.Fatal(err)
	}
	if len(golden.Devices) != len(m.Devices) || len(m.Devices) < 20 {
		t.Fatalf("ucode knows %d devices, Go %d", len(golden.Devices), len(m.Devices))
	}
	ids := make([]string, 0, len(golden.Devices))
	for id := range golden.Devices {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	homes := 0
	for _, id := range ids {
		want := golden.Devices[id]
		dev := m.Devices[id]
		if dev == nil {
			t.Fatalf("%s: not in the Go model", id)
		}
		homes += len(want.Home)
		got := ClientConfig(m, dev, want.Home)
		var plain any
		if got != nil {
			b, _ := json.Marshal(got)
			json.Unmarshal(b, &plain)
		}
		if !reflect.DeepEqual(plain, want.Config) {
			g, _ := json.MarshalIndent(plain, "", " ")
			w, _ := json.MarshalIndent(want.Config, "", " ")
			t.Fatalf("%s: the configuration differs\nGo:    %s\nucode: %s", id, g, w)
		}
		fp := Fingerprint(m, dev, want.Home)
		if (want.FP == nil) != (fp == "") || (want.FP != nil && *want.FP != fp) {
			t.Fatalf("%s: fingerprint %q, ucode has %v", id, fp, want.FP)
		}
	}
	if homes == 0 {
		t.Fatal("no device of the trace reaches a home network: the trace was made without its interfaces")
	}
	for name, want := range golden.Names {
		if got := TunnelName(name); got != want {
			t.Errorf("the tunnel's name of %q: %q, ucode has %q", name, got, want)
		}
	}
}
