package view

import (
	"encoding/json"
	"os"
	"reflect"
	"sort"
	"testing"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/awg"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
	"github.com/tickcount/luci-app-dawnline/backend/usage"
	"github.com/tickcount/luci-app-dawnline/backend/zone"
)

func plain(v any) any {
	raw, _ := json.Marshal(v)
	var out any
	json.Unmarshal(raw, &out)
	return out
}

// where the two differ, by path
func differ(path string, got, want any, out *[]string) {
	g, gok := got.(map[string]any)
	w, wok := want.(map[string]any)
	if gok && wok {
		keys := map[string]bool{}
		for k := range g {
			keys[k] = true
		}
		for k := range w {
			keys[k] = true
		}
		names := make([]string, 0, len(keys))
		for k := range keys {
			names = append(names, k)
		}
		sort.Strings(names)
		for _, k := range names {
			differ(path+"."+k, g[k], w[k], out)
		}
		return
	}
	ga, gok := got.([]any)
	wa, wok := want.([]any)
	if gok && wok && len(ga) == len(wa) {
		for i := range ga {
			differ(path+"["+string(rune('0'+i%10))+"]", ga[i], wa[i], out)
		}
		return
	}
	if !reflect.DeepEqual(got, want) {
		g, _ := json.Marshal(got)
		w, _ := json.Marshal(want)
		*out = append(*out, path+": "+string(g)+", ucode has "+string(w))
	}
}

// Every person of testdata/view.uci is shown as ucode shows them, to the admin and to themselves, with a
// watcher's word on who is online and without one (scripts/ucode-golden.sh writes trace.json from dawnline.view).
func TestHeldToUcode(t *testing.T) {
	zone.Set(time.UTC)
	text, err := os.ReadFile("testdata/view.uci")
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
		TS        int64                     `json:"ts"`
		Usage     *usage.Usage              `json:"usage"`
		Peers     map[string]awg.Peer       `json:"peers"`
		Issued    map[string]Issued         `json:"issued"`
		Reconnect map[string]float64        `json:"reconnect"`
		Watched   map[string]map[string]any `json:"watched"`
		Alone     map[string]map[string]any `json:"alone"`
	}
	if err := json.Unmarshal(raw, &golden); err != nil {
		t.Fatal(err)
	}
	base := World{M: m, Usage: golden.Usage, Peers: golden.Peers, Issued: golden.Issued, Reconnect: golden.Reconnect, Now: golden.TS}
	watched := base
	watched.Online = map[string]bool{"a1": true, "a2": false, "b1": true}
	watched.Link = map[string]any{"a2": map[string]any{"state": "knocking", "since": float64(golden.TS - 60)}}
	watched.Setup = map[string]any{"a1": map[string]any{"state": "flowing", "since": float64(golden.TS - 30)}}
	alone := base
	alone.Windows = map[string]int64{"a2": 600}
	var diffs []string
	for name, run := range map[string]struct {
		w    World
		want map[string]map[string]any
	}{"watched": {watched, golden.Watched}, "alone": {alone, golden.Alone}} {
		if len(run.want["admin"]) != len(m.People) {
			t.Fatalf("%s: ucode shows %d people, the model has %d", name, len(run.want["admin"]), len(m.People))
		}
		for id, p := range m.People {
			differ(name+".admin."+id, plain(run.w.PersonOf(p, true)), run.want["admin"][id], &diffs)
			differ(name+".own."+id, plain(run.w.PersonOf(p, false)), run.want["own"][id], &diffs)
		}
	}
	sort.Strings(diffs)
	for i, d := range diffs {
		if i < 40 {
			t.Error(d)
		}
	}
}
