package model

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/uci"
	"github.com/tickcount/luci-app-dawnline/backend/zone"
)

// Each fixture read by this model is what the ucode model read of it (the *.json beside it, written by
// scripts/ucode-golden.sh in an OpenWrt container whose clock is UTC).
func TestHeldToUcode(t *testing.T) {
	zone.Set(time.UTC)
	files, _ := filepath.Glob("testdata/*.uci")
	if len(files) < 2 {
		t.Fatalf("fixtures: %v", files)
	}
	for _, f := range files {
		text, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		c, err := uci.Parse(string(text))
		if err != nil {
			t.Fatalf("%s: %v", f, err)
		}
		mine, err := json.Marshal(Load(c, nil))
		if err != nil {
			t.Fatal(err)
		}
		theirs, err := os.ReadFile(strings.TrimSuffix(f, ".uci") + ".json")
		if err != nil {
			t.Fatal(err)
		}
		var got, want any
		json.Unmarshal(mine, &got)
		if err := json.Unmarshal(theirs, &want); err != nil {
			t.Fatalf("%s: the golden is not JSON: %v", f, err)
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("%s: read differently than ucode reads it:\n%s", f, strings.Join(differ("", got, want), "\n"))
		}
	}
}

// differ names where two documents part, so a failure says which field.
func differ(path string, got, want any) []string {
	g, gok := got.(map[string]any)
	w, wok := want.(map[string]any)
	if gok && wok {
		var out []string
		for k := range w {
			if _, has := g[k]; !has {
				out = append(out, path+"."+k+": missing, ucode has "+show(w[k]))
			}
		}
		for k, v := range g {
			if _, has := w[k]; !has {
				out = append(out, path+"."+k+": "+show(v)+", ucode has none")
				continue
			}
			out = append(out, differ(path+"."+k, v, w[k])...)
		}
		return out
	}
	if reflect.DeepEqual(got, want) {
		return nil
	}
	return []string{path + ": " + show(got) + ", ucode has " + show(want)}
}

func show(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func TestNumbersAsUcodeReadsThem(t *testing.T) {
	for s, want := range map[string]float64{" 90 ": 90, "0x10": 16, "1e3": 1000, "1.9": 1.9, "-3": -3, "": 0, "010": 10, "+5": 5, "5.": 5, "0b11": 3, "0o17": 15, "-1.9": -1.9} {
		if got, ok := number(s); !ok || got != want {
			t.Errorf("%q: %v %v, want %v", s, got, ok, want)
		}
	}
	for _, s := range []string{"12abc", "1 2", ".5", "Infinity", "auto"} {
		if _, ok := number(s); ok {
			t.Errorf("%q read as a number", s)
		}
	}
}

// A server another tunnel keeps down says why.
func TestBlocked(t *testing.T) {
	c, _ := uci.Parse("config server 'home'\nconfig server 'cabin'\n")
	m := Load(c, map[string]any{"cabin": "another tunnel has its name"})
	if m.Servers["home"].Blocked != nil || m.Servers["cabin"].Blocked != "another tunnel has its name" {
		t.Fatalf("blocked: %v %v", m.Servers["home"].Blocked, m.Servers["cabin"].Blocked)
	}
}
