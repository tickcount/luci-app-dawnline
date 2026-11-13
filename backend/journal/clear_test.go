package journal_test

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/journal"
	"github.com/tickcount/luci-app-dawnline/backend/servicelog"
)

// What clearing leaves of made-up logs, file for file as ucode leaves them (testdata/clear.uc).
func TestClearAsUcode(t *testing.T) {
	raw, err := os.ReadFile("testdata/clear.json")
	if err != nil {
		t.Fatal(err)
	}
	var trace struct {
		Now    int64           `json:"now"`
		Events json.RawMessage `json:"events"`
		Flash  json.RawMessage `json:"flash"`
		Cases  []struct {
			F struct {
				Person, Device, Category string
				Before                   int64
			} `json:"f"`
			NoLive    bool `json:"no_live"`
			NoFlash   bool `json:"no_flash"`
			Removed   int  `json:"removed"`
			Live      any  `json:"live"`
			KeptFlash any  `json:"kept_flash"`
		} `json:"cases"`
		Lines []string `json:"lines"`
		Log   []struct {
			Days    int64   `json:"days"`
			Saved   bool    `json:"saved"`
			NoLive  bool    `json:"no_live"`
			Removed int     `json:"removed"`
			Live    *string `json:"live"`
			Kept    *string `json:"kept"`
		} `json:"log"`
	}
	if err := json.Unmarshal(raw, &trace); err != nil {
		t.Fatal(err)
	}
	if len(trace.Cases) < 10 || len(trace.Log) < 6 {
		t.Fatal("too few cases")
	}
	read := func(path string) any {
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		var v any
		json.Unmarshal(raw, &v)
		return v
	}
	went := 0
	for i, c := range trace.Cases {
		dir := t.TempDir()
		os.MkdirAll(dir+"/data", 0o755)
		if !c.NoLive {
			os.WriteFile(dir+"/events.json", trace.Events, 0o600)
		}
		if !c.NoFlash {
			os.WriteFile(dir+"/data/events.json", trace.Flash, 0o600)
		}
		got := journal.Log{Run: dir, Data: dir + "/data"}.Clear(journal.Filter{Person: c.F.Person, Device: c.F.Device, Category: c.F.Category, Before: c.F.Before})
		went += got
		if got != c.Removed || !reflect.DeepEqual(read(dir+"/events.json"), c.Live) || !reflect.DeepEqual(read(dir+"/data/events.json"), c.KeptFlash) {
			t.Errorf("case %d %+v: removed %d (ucode %d)\n live  %v\n ucode %v\n flash %v\n ucode %v", i, c.F, got, c.Removed, read(dir+"/events.json"), c.Live, read(dir+"/data/events.json"), c.KeptFlash)
		}
	}
	if went < 15 {
		t.Fatalf("the cases remove too little: %d", went)
	}
	text := func(path string) *string {
		raw, err := os.ReadFile(path)
		if err != nil {
			return nil
		}
		s := string(raw)
		return &s
	}
	for i, c := range trace.Log {
		dir := t.TempDir()
		os.MkdirAll(dir+"/data", 0o755)
		if !c.NoLive {
			os.WriteFile(dir+"/service.log", []byte(strings.Join(trace.Lines, "\n")+"\n\n"), 0o600)
		}
		if c.Saved {
			os.WriteFile(dir+"/data/service.log", []byte(strings.Join(trace.Lines[:3], "\n")+"\n"), 0o600)
		}
		l := servicelog.Log{RunDir: dir, Now: func() time.Time { return time.Unix(trace.Now, 0) }}
		got := l.Clear(dir+"/data", c.Days)
		if got != c.Removed || !reflect.DeepEqual(text(dir+"/service.log"), c.Live) || !reflect.DeepEqual(text(dir+"/data/service.log"), c.Kept) {
			show := func(p *string) string {
				if p == nil {
					return "(no file)"
				}
				return *p
			}
			t.Errorf("log case %d %+v: removed %d (ucode %d)\n live %q\n ucode %q\n kept %q\n ucode %q", i, c, got, c.Removed, show(text(dir+"/service.log")), show(c.Live), show(text(dir+"/data/service.log")), show(c.Kept))
		}
	}
}
