package uci

import (
	"encoding/json"
	"os"
	"testing"
)

// The model's fixtures as libuci commits them, and one of them through a row of changes, file for file
// (testdata/write.uc, scripts/ucode-golden.sh).
func TestWrittenAsLibuci(t *testing.T) {
	raw, err := os.ReadFile("testdata/write.json")
	if err != nil {
		t.Fatal(err)
	}
	var golden struct {
		Canon map[string]string `json:"canon"`
		Steps []struct {
			Op   []any  `json:"op"`
			OK   bool   `json:"ok"`
			File string `json:"file"`
		} `json:"steps"`
	}
	if err := json.Unmarshal(raw, &golden); err != nil {
		t.Fatal(err)
	}
	if len(golden.Canon) != 2 || len(golden.Steps) < 18 {
		t.Fatal("the golden is too small")
	}
	for name, want := range golden.Canon {
		text, err := os.ReadFile("../model/testdata/" + name + ".uci")
		if err != nil {
			t.Fatal(err)
		}
		c, err := Parse(string(text))
		if err != nil {
			t.Fatal(err)
		}
		if got := c.Format(); got != want {
			t.Errorf("%s is written otherwise:\n%s\n--- libuci:\n%s", name, got, want)
		}
		// what is written reads back as itself
		again, err := Parse(c.Format())
		if err != nil || again.Format() != want {
			t.Errorf("%s does not read back as written: %v", name, err)
		}
	}
	text, _ := os.ReadFile("../model/testdata/small.uci")
	file := string(text)
	for i, step := range golden.Steps {
		// as the golden: read anew, one change, written
		c, err := Parse(file)
		if err != nil {
			t.Fatalf("step %d: %v", i, err)
		}
		str := func(n int) string { s, _ := step.Op[n].(string); return s }
		var ok bool
		switch str(0) {
		case "add":
			ok = c.Add(str(1), str(2)) != nil
		case "delete":
			if len(step.Op) > 2 {
				ok = c.Delete(str(1), str(2))
			} else {
				ok = c.DeleteSection(str(1))
			}
		case "set":
			if list, isList := step.Op[3].([]any); isList {
				var entries []string
				for _, e := range list {
					entries = append(entries, e.(string))
				}
				ok = c.SetList(str(1), str(2), entries)
			} else {
				ok = c.Set(str(1), str(2), str(3))
			}
		}
		file = c.Format()
		if ok != step.OK || file != step.File {
			t.Fatalf("step %d %v: ok %v (libuci %v)\n%s\n--- libuci:\n%s", i, step.Op, ok, step.OK, file, step.File)
		}
	}
}
