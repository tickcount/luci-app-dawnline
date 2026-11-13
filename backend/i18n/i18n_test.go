package i18n

import (
	"encoding/json"
	"os"
	"testing"
)

// The catalogs of testdata answer as LuCI's own reader answers from them (testdata/trace.uc).
func TestAsLuCI(t *testing.T) {
	raw, err := os.ReadFile("testdata/trace.json")
	if err != nil {
		t.Fatal(err)
	}
	var trace map[string]struct {
		T map[string]*string `json:"t"`
		N [][]any            `json:"n"`
	}
	if err := json.Unmarshal(raw, &trace); err != nil {
		t.Fatal(err)
	}
	if len(trace) != 2 {
		t.Fatalf("%d languages", len(trace))
	}
	for lang, want := range trace {
		c, err := Load("testdata/" + lang + ".lmo")
		if err != nil {
			t.Fatal(err)
		}
		found := 0
		for id, s := range want.T {
			// the reader says nothing where Dawnline then keeps the English
			w := id
			if s != nil {
				w = *s
				found++
			}
			if got := c.T(id); got != w {
				t.Errorf("%s: T(%q) = %q, LuCI %q", lang, id, got, w)
			}
		}
		if found < 2 || len(want.N) < 100 {
			t.Fatalf("%s: the trace exercises too little", lang)
		}
		for _, r := range want.N {
			n, one, many := int64(r[0].(float64)), r[1].(string), r[2].(string)
			if got := c.N(n, one, many); got != r[3] {
				t.Errorf("%s: N(%v, %q) = %q, LuCI %q", lang, r[0], one, got, r[3])
			}
		}
	}
}

func TestUse(t *testing.T) {
	dir := t.TempDir()
	raw, _ := os.ReadFile("testdata/ru.lmo")
	os.WriteFile(dir+"/dawnline.ru.lmo", raw, 0o644)
	os.WriteFile(dir+"/dawnline.pt-br.lmo", raw, 0o644)
	os.WriteFile(dir+"/dawnline.xx.lmo", []byte("no"), 0o644)
	for lang, speaks := range map[string]bool{"ru": true, "pt_BR": true, "pt-br": true, "en": false, "": false, "de": false, "../ru": false, "xx": false, "RU": false} {
		if c := Use(dir, lang); (c != nil) != speaks {
			t.Errorf("%q: %v", lang, c != nil)
		}
	}
	var none *Catalog
	if none.T("Save") != "Save" || none.N(1, "%s device", "%s devices") != "%s device" || none.N(4, "%s device", "%s devices") != "%s devices" {
		t.Fatal("no catalog does not speak English")
	}
}

func TestPluralRules(t *testing.T) {
	for expr, want := range map[string][]int64{
		"(n != 1)": {1, 0, 1, 1},
		"n>1":      {0, 0, 1, 1},
		"0":        {0, 0, 0, 0},
		"n==0 ? 0 : n==1 ? 1 : n==2 ? 2 : n%100>=3 && n%100<=10 ? 3 : 4": {0, 1, 2, 3},
		"!(n-1) + 2*3/2": {3, 4, 3, 3},
	} {
		for n, w := range want {
			if got, ok := eval(expr, int64(n)); !ok || got != w {
				t.Errorf("%s for %d: %d %v, want %d", expr, n, got, ok, w)
			}
		}
	}
	for _, bad := range []string{"", "n ?", "(n", "n n", "n % 0", "x"} {
		if _, ok := eval(bad, 3); ok {
			t.Errorf("%q was taken", bad)
		}
	}
}
