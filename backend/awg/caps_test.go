package awg

import (
	"encoding/json"
	"os"
	"testing"
)

// Generations and the wait for a reboot, as ucode tells them (testdata/caps.uc, scripts/ucode-golden.sh).
func TestGenerationsAsUcode(t *testing.T) {
	raw, err := os.ReadFile("testdata/caps.json")
	if err != nil {
		t.Fatal(err)
	}
	var g struct {
		Gens map[string]string `json:"gens"`
		Runs []struct {
			Rec     *Record `json:"rec"`
			Boot    *string `json:"boot"`
			Core    *int64  `json:"core"`
			Version *string `json:"version"`
			Pending bool    `json:"pending"`
			Gen     any     `json:"gen"`
		} `json:"runs"`
	}
	if err := json.Unmarshal(raw, &g); err != nil {
		t.Fatal(err)
	}
	if len(g.Gens) < 12 || len(g.Runs) < 100 {
		t.Fatalf("too little: %d versions, %d runs", len(g.Gens), len(g.Runs))
	}
	for v, want := range g.Gens {
		if got := Gen(v); got != want {
			t.Errorf("Gen(%q) = %s, ucode %s", v, got, want)
		}
	}
	waits := 0
	for i, r := range g.Runs {
		boot, core := "", int64(0)
		if r.Boot != nil {
			boot = *r.Boot
		}
		if r.Core != nil {
			core = *r.Core
		}
		if r.Pending {
			waits++
		}
		if got := Pending(r.Rec, boot, core); got != r.Pending {
			t.Errorf("run %d: pending %v, ucode %v", i, got, r.Pending)
		}
		if got := RunningGen(r.Rec, boot, core, r.Version); got != r.Gen {
			t.Errorf("run %d: generation %v, ucode %v", i, got, r.Gen)
		}
	}
	if waits == 0 {
		t.Fatal("no run waits for a reboot")
	}
}

func TestCapsOf(t *testing.T) {
	s := func(v string) *string { return &v }
	no := false
	core := int64(65536)
	v2 := "proto_config_add_int awg_s3\nawg_i1"
	v3 := v2 + "\nawg_header_protection_key"
	for name, c := range map[string]struct {
		f    Found
		want Caps
	}{
		"nothing installed": {Found{}, Caps{}},
		"3.1 all through":   {Found{Script: v3, Tool: true, Tool3: true, Version: s("6.12.94.3.1.20260906-r1")}, Caps{V2: true, V3: true, Tools: "3.1", Kmod: "3.1"}},
		"3.1 tools over a 2.0 module": {Found{Script: v3, Tool: true, Tool3: true, Version: s("6.6.73.1.0.20250903-r2")},
			Caps{V2: true, Tools: "3.1", Kmod: "2.0", Mismatch: true}},
		"a script ahead of its tool": {Found{Script: v3, Tool: true, Version: s("3.1.20260906-r1")}, Caps{V2: true, Tools: "2.0", Kmod: "3.1", Mismatch: true}},
		"a module put there by hand": {Found{Script: v3, Tool: true, Tool3: true}, Caps{V2: true, V3: true, Tools: "3.1"}},
		"the first generation":       {Found{Script: "awg_jc", Tool: true, Version: s("1.0.20240213")}, Caps{Tools: "1.0", Kmod: "1.0"}},
		"an update that waits for a reboot": {Found{Script: v3, Tool: true, Tool3: true, Version: s("3.1.20260906-r1"), Boot: "b", Core: core,
			Record: &Record{Reloaded: &no, Boot: s("b"), PrevCore: &core, PrevGen: s("1.0")}},
			Caps{Tools: "3.1", Kmod: "1.0", Mismatch: true, Pending: true}},
	} {
		if got := CapsOf(c.f); got != c.want {
			t.Errorf("%s: %+v", name, got)
		}
	}
}
