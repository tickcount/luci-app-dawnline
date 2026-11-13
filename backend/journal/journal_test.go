package journal

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"github.com/tickcount/luci-app-dawnline/backend/model"
)

func read(t *testing.T, path string) []Event {
	var ev []Event
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(raw, &ev); err != nil {
		t.Fatal(err)
	}
	return ev
}

func names(person, device string) (string, string, string) {
	return map[string]string{"anna": "Anna"}[person], map[string]string{"d1": "Phone"}[device], map[string]string{"d1": "phone"}[device]
}

func TestPolicy(t *testing.T) {
	for name, c := range map[string]struct {
		r    model.Retention
		want Policy
	}{
		"nothing set":          {model.Retention{}, Policy{30, 2000, Categories, "hourly"}},
		"connections off":      {model.Retention{LogConnections: "0"}, Policy{30, 2000, []string{"people", "problems"}, "hourly"}},
		"a list":               {model.Retention{LogCategory: []string{"problems", "devices", "people", "nonsense"}, LogKeepDays: "0", LogMax: "100", LogPersist: "off"}, Policy{0, 100, []string{"problems", "people"}, "off"}},
		"one string":           {model.Retention{LogCategory: "connections, problems"}, Policy{30, 2000, []string{"connections", "problems"}, "hourly"}},
		"out of range, a typo": {model.Retention{LogKeepDays: "99999", LogMax: "50", LogPersist: "daily"}, Policy{30, 2000, Categories, "hourly"}},
	} {
		if got := PolicyOf(c.r); !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s: %+v, want %+v", name, got, c.want)
		}
	}
}

func TestAddNamesTrimsAndFilters(t *testing.T) {
	dir := t.TempDir()
	l := Log{Run: dir, Data: dir + "/flash"}
	pol := Policy{KeepDays: 1, Max: 3, Categories: []string{"connections"}, Persist: "hourly"}
	now := int64(1_000_000)
	// what flash holds is the log until the first write
	os.MkdirAll(l.Data, 0o700)
	os.WriteFile(l.flash(), []byte(`[{"ts":1,"type":"connect","future":"kept as it is"},{"ts":999990,"type":"connect","person":"old"}]`), 0o600)
	if err := l.Add([]Event{
		{"type": "connect", "person": "anna", "device": "d1", "detail": "203.0.113.7"},
		{"type": "paused", "person": "anna"},
		{"type": "disconnect", "person": "gone", "device": "d9", "ts": float64(999999)},
	}, pol, names, now); err != nil {
		t.Fatal(err)
	}
	got := read(t, l.live())
	want := []Event{
		{"ts": float64(999990), "type": "connect", "person": "old"},
		{"ts": float64(now), "type": "connect", "person": "anna", "device": "d1", "detail": "203.0.113.7", "pname": "Anna", "dname": "Phone", "dkind": "phone"},
		{"ts": float64(999999), "type": "disconnect", "person": "gone", "device": "d9"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("log: %v", got)
	}
	if st, _ := os.Stat(l.live()); st.Mode().Perm() != 0o600 {
		t.Errorf("mode %v", st.Mode().Perm())
	}
	for i := 0; i < 5; i++ {
		l.Add([]Event{{"type": "roam", "person": "anna", "device": "d1"}}, pol, names, now+int64(i))
	}
	if got := read(t, l.live()); len(got) != 3 || got[0]["type"] != "roam" {
		t.Fatalf("not cut to the newest three: %v", got)
	}
	// nothing recorded: nothing written
	before, _ := os.Stat(l.live())
	l.Add([]Event{{"type": "paused"}}, pol, names, now+10)
	if after, _ := os.Stat(l.live()); !after.ModTime().Equal(before.ModTime()) {
		t.Error("written for an event that is not recorded")
	}
}

func TestAddMerged(t *testing.T) {
	dir := t.TempDir()
	l := Log{Run: dir, Data: dir}
	pol := Policy{Max: 100, Categories: Categories}
	e := func(detail string) Event {
		return Event{"type": "device_failing", "person": "anna", "device": "d1", "detail": detail}
	}
	l.AddMerged(e("trying"), 3600, pol, names, 1000)
	l.AddMerged(e("dropped"), 3600, pol, names, 1500)
	l.AddMerged(e("trying"), 3600, pol, names, 2000)
	got := read(t, l.live())
	if len(got) != 1 || got[0]["detail"] != "trying, dropped" || got[0]["ts"] != float64(2000) || got[0]["pname"] != "Anna" {
		t.Fatalf("merged: %v", got)
	}
	// past the window, or about another device: a line of its own
	l.AddMerged(e("unstable"), 3600, pol, names, 2000+3600)
	l.AddMerged(Event{"type": "device_failing", "person": "anna", "device": "d2", "detail": "trying"}, 3600, pol, names, 2000+3601)
	if got := read(t, l.live()); len(got) != 3 {
		t.Fatalf("not merged: %v", got)
	}
}

func TestPersist(t *testing.T) {
	dir := t.TempDir()
	l := Log{Run: dir, Data: dir + "/flash"}
	pol := Policy{Max: 100, Categories: Categories, Persist: "hourly"}
	l.Add([]Event{{"type": "connect"}}, pol, names, 1000)
	if err := l.Persist(pol, 1000); err != nil {
		t.Fatal(err)
	}
	if got := read(t, l.flash()); len(got) != 1 {
		t.Fatalf("flash: %v", got)
	}
	pol.Persist = "off"
	l.Persist(pol, 1000)
	if _, err := os.Stat(l.flash()); err == nil {
		t.Error("the flash copy stays though the log is kept in memory only")
	}
}

func TestAnEventInSyslog(t *testing.T) {
	for line, e := range map[string]Event{
		"info Anna paused (admin)":                               {"type": "paused", "person": "anna", "pname": "Anna", "by": "admin"},
		"info Anna · Phone device changed · kind=phone (portal)": {"type": "device_changed", "person": "anna", "pname": "Anna", "device": "phone", "dname": "Phone", "detail": "kind=phone", "by": "portal"},
		"warn portal blocked · 203.0.113.7":                      {"type": "portal_blocked", "detail": "203.0.113.7"},
		"info server up":                                         {"type": "server_up"},
		"warn bob unheard of":                                    {"type": "unheard_of", "person": "bob"},
		" Anna connect":                                          {"type": "connect", "pname": "Anna"},
		" Anna · Phone device failing":                           {"type": "device_failing", "pname": "Anna", "dname": "Phone"},
	} {
		if got := Level(e) + " " + Line(e); got != line {
			t.Errorf("%q, want %q", got, line)
		}
	}
}
