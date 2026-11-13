package link

import (
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"testing"

	"github.com/tickcount/luci-app-dawnline/backend/model"
)

// The generator of testdata/trace.uc, number for number.
type gen struct{ x int64 }

func (g *gen) rnd(n int64) int64 {
	g.x = (g.x*1103515245 + 12345) % 2147483648
	return (g.x >> 8) % n
}

var endpoints = []string{"203.0.113.7:41821", "198.51.100.4:9000", "[2001:db8::1]:500"}

var modes = [][]int64{
	{3, 40, 30, 60, 200, 300, 310, 150, 160},
	{1, 0, 5, 400, 420, 420, 425, 300, 300},
	{2, 150, 200, 20, 300, 500, 505, 100, 105},
	{1, 10, 2, 0, 250, 250, 252, 400, 400},
}

type run struct {
	Seed    int64   `json:"seed"`
	Mode    int     `json:"mode"`
	Ka      int64   `json:"ka"`
	Steps   int     `json:"steps"`
	Hash    int64   `json:"hash"`
	Setups  int     `json:"setups"`
	Changes [][]any `json:"changes"`
}

// The same made-up reads through this package as trace.uc put through dawnline.link.
func trace(seed int64, mode int, ka int64, steps int) run {
	g := &gen{x: seed}
	p := modes[mode]
	now, hs, rx, tx := int64(1000000), int64(0), int64(0), int64(0)
	ep, present := "", true
	h := Fresh(now)
	out := run{Seed: seed, Mode: mode, Ka: ka, Steps: steps, Hash: 7, Changes: [][]any{}}
	for i := 0; i < steps; i++ {
		now++
		r := g.rnd(1000)
		if present {
			if r < p[0] {
				present = false
			} else {
				if g.rnd(1000) < p[1] {
					hs = now - g.rnd(2)
				}
				if g.rnd(1000) < p[2] {
					ep = endpoints[g.rnd(3)]
				}
				switch k := g.rnd(1000); {
				case k < p[3]:
					rx += 148 * (1 + g.rnd(3))
				case k < p[4]:
					rx += 32 + g.rnd(ka-31)
				case k < p[5]:
					rx += 48 + 16*g.rnd(90)
				case k < p[6]:
					rx = g.rnd(500)
					tx = g.rnd(500)
				}
				if t := g.rnd(1000); t < p[7] {
					tx += 32 + g.rnd(200)
				} else if t < p[8] {
					tx += 100000
				}
			}
		} else if r < 100 {
			present, rx, tx, hs = true, 0, 0, 0
		}
		on := present && hs > 0 && now-hs < 190
		var read *Read
		if present {
			read = &Read{Endpoint: ep, Handshake: hs, Rx: rx, Tx: tx}
		}
		change, sc := h.Step(read, now, on, ka)
		word, flag := "-", 0
		if sc {
			out.Setups++
			flag = 1
		}
		if change != nil {
			out.Changes = append(out.Changes, []any{float64(i), change.From, change.To})
			word = change.From + ">" + change.To
		}
		setup, since := "", int64(0)
		if h.Setup != nil {
			setup, since = h.Setup.State, h.Setup.Since
		}
		for _, c := range []byte(fmt.Sprintf("%s|%d|%s|%d|%s|%s|%d\n", word, flag, h.State, h.Since, h.Raw, setup, since)) {
			out.Hash = (out.Hash*131 + int64(c)) % 1000000007
		}
	}
	return out
}

// Step for step what dawnline.link does (testdata/trace.json, written by scripts/ucode-golden.sh).
func TestHeldToUcode(t *testing.T) {
	raw, err := os.ReadFile("testdata/trace.json")
	if err != nil {
		t.Fatal(err)
	}
	var want []run
	if err := json.Unmarshal(raw, &want); err != nil {
		t.Fatal(err)
	}
	if len(want) < 20 {
		t.Fatalf("%d runs in the golden", len(want))
	}
	states := map[string]bool{}
	for _, w := range want {
		got := trace(w.Seed, w.Mode, w.Ka, w.Steps)
		if !reflect.DeepEqual(got.Changes, w.Changes) {
			t.Errorf("mode %d ka %d seed %d: shown changes %v, ucode has %v", w.Mode, w.Ka, w.Seed, got.Changes, w.Changes)
			continue
		}
		if got.Setups != w.Setups || got.Hash != w.Hash {
			t.Errorf("mode %d ka %d seed %d: the same changes, but %d set-up changes and hash %d; ucode has %d and %d",
				w.Mode, w.Ka, w.Seed, got.Setups, got.Hash, w.Setups, w.Hash)
		}
		for _, c := range w.Changes {
			states[c[2].(string)] = true
		}
	}
	for _, s := range []string{Trying, Shared, Dropped, Unstable, ""} {
		if !states[s] {
			t.Errorf("the golden never shows %q: the runs no longer exercise it", s)
		}
	}
}

func TestKeepaliveMax(t *testing.T) {
	for name, c := range map[string]struct {
		obf  map[string]string
		want int64
	}{
		"plain":                  {map[string]string{}, 32},
		"padded":                 {map[string]string{"content_padding_addition": "10-100"}, 132},
		"one padding":            {map[string]string{"content_padding_addition": "40"}, 72},
		"trailers":               {map[string]string{"random_trailers": "on"}, 1532},
		"padding over trailers":  {map[string]string{"content_padding_addition": "10-100", "random_trailers": "on"}, 132},
		"no padding to speak of": {map[string]string{"content_padding_addition": "0", "random_trailers": "1"}, 1532},
	} {
		if got := KeepaliveMax(&model.Server{Obf: c.obf}); got != c.want {
			t.Errorf("%s: %d, want %d", name, got, c.want)
		}
	}
	if KeepaliveMax(nil) != 32 {
		t.Error("no server")
	}
}

func TestEvent(t *testing.T) {
	for _, c := range []struct {
		change       *Change
		on           bool
		kind, detail string
	}{
		{nil, true, "", ""},
		{&Change{To: Trying}, false, "device_failing", Trying},
		{&Change{From: Shared, To: Dropped}, true, "device_failing", Dropped},
		{&Change{From: Dropped}, true, "device_recovered", Dropped},
		{&Change{From: Trying}, false, "", ""},
	} {
		if k, d := Event(c.change, c.on); k != c.kind || d != c.detail {
			t.Errorf("%+v on=%v: %q %q", c.change, c.on, k, d)
		}
	}
}
