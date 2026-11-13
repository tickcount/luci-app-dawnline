package disguise

import (
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"regexp"
	"strings"
	"testing"
)

// Each made-up set of values gets the sentences ucode gives it (testdata/trace.uc, scripts/ucode-golden.sh).
func TestUnsafeAsUcode(t *testing.T) {
	raw, err := os.ReadFile("testdata/trace.json")
	if err != nil {
		t.Fatal(err)
	}
	var golden struct {
		Sets []struct {
			O    map[string]string `json:"o"`
			Errs []string          `json:"errs"`
			All  []string          `json:"all"`
		} `json:"sets"`
	}
	if err := json.Unmarshal(raw, &golden); err != nil {
		t.Fatal(err)
	}
	rows := golden.Sets
	if len(rows) < 30 {
		t.Fatalf("only %d rows", len(rows))
	}
	said := 0
	for i, r := range rows {
		got := Unsafe(r.O)
		said += len(got)
		if !reflect.DeepEqual(got, r.Errs) {
			t.Errorf("row %d %v:\n go:    %q\n ucode: %q", i, r.O, got, r.Errs)
		}
		if all := Errors(r.O); !reflect.DeepEqual(all, r.All) {
			t.Errorf("row %d %v, with Dawnline's own bounds:\n go:    %q\n ucode: %q", i, r.O, all, r.All)
		}
	}
	if said < 40 {
		t.Fatalf("the rows exercise too little: %d sentences", said)
	}
}

// shape is a value with what the dice decide taken out: digits as 9, hex bytes of a tag as x.
func shape(key, v string) string {
	if key == "header_protection_key" {
		return fmt.Sprint("key of ", len(v))
	}
	v = regexp.MustCompile(`0x[0-9a-f]+`).ReplaceAllStringFunc(v, func(s string) string { return "0x" + strings.Repeat("x", len(s)-2) })
	// how many digits a drawn number has is the dice's too
	return regexp.MustCompile(`[0-9]+`).ReplaceAllString(v, "9")
}

// A preset made here has the names, the order and the shapes of the ones ucode makes, passes its own check,
// and ucode's presets pass it too.
func TestPresets(t *testing.T) {
	raw, _ := os.ReadFile("testdata/presets.json")
	var golden struct {
		Presets map[string][]map[string]string `json:"presets"`
	}
	json.Unmarshal(raw, &golden)
	for _, name := range Methods {
		theirs := golden.Presets[name]
		if len(theirs) == 0 {
			t.Fatalf("the golden has no %s preset", name)
		}
		shapes := map[string]map[string]bool{}
		for _, o := range theirs {
			if errs := Errors(o); len(errs) != 0 {
				t.Errorf("ucode's own %s preset is refused: %q", name, errs)
			}
			for k, v := range o {
				if shapes[k] == nil {
					shapes[k] = map[string]bool{}
				}
				shapes[k][shape(k, v)] = true
			}
		}
		for i := 0; i < 200; i++ {
			mine := Preset(name)
			o := map[string]string{}
			for _, p := range mine {
				if _, twice := o[p.Key]; twice {
					t.Fatalf("%s: %s twice", name, p.Key)
				}
				o[p.Key] = p.Value
				if !shapes[p.Key][shape(p.Key, p.Value)] {
					t.Fatalf("%s: %s = %q has a shape ucode never makes (%v)", name, p.Key, p.Value, shapes[p.Key])
				}
			}
			if len(o) != len(theirs[0]) {
				t.Fatalf("%s: %d values, ucode makes %d", name, len(o), len(theirs[0]))
			}
			if errs := Errors(o); len(errs) != 0 {
				t.Fatalf("%s: a preset its own check refuses: %q\n%v", name, errs, o)
			}
		}
	}
	if !reflect.DeepEqual(Preset("off"), []Pair{{"jc", "0"}, {"jmin", "0"}, {"jmax", "0"}, {"s1", "0"}, {"s2", "0"}, {"h1", "1"}, {"h2", "2"}, {"h3", "3"}, {"h4", "4"}}) {
		t.Fatal("no disguise is not what it was")
	}
}
