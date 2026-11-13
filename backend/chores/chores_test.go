package chores

import (
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/servicelog"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
	"github.com/tickcount/luci-app-dawnline/backend/usage"
	"github.com/tickcount/luci-app-dawnline/backend/zone"
)

func TestStateEvent(t *testing.T) {
	for _, c := range []struct{ prev, st, kind, detail string }{
		{"", "expired", "", ""}, {"active", "active", "", ""}, {"active", "paused", "", ""}, {"paused", "active", "", ""}, {"server_off", "active", "", ""},
		{"active", "quota", "quota_reached", ""}, {"quota", "active", "quota_restored", ""}, {"quota", "expired", "paused", "end date reached"},
		{"active", "odd", "paused", "odd"},
	} {
		e := StateEvent("p", c.prev, c.st)
		kind, _ := e["type"].(string)
		detail, _ := e["detail"].(string)
		if kind != c.kind || detail != c.detail {
			t.Errorf("%s → %s: %v", c.prev, c.st, e)
		}
	}
}

// The schedule of automatic updates: the hour after the set time, once a slot, also across midnight; a
// check when its interval passed.
func TestDue(t *testing.T) {
	loc := zone.Local()
	at := func(s string) time.Time {
		x, err := time.ParseInLocation("2006-01-02 15:04", s, loc)
		if err != nil {
			t.Fatal(err)
		}
		return x
	}
	pol := model.Updates{Check: true, Interval: "1d", Auto: true, Mode: "scheduled", Time: "23:30", Targets: []string{"app"}}
	fresh := at("2026-11-12 23:00").Unix()
	for _, c := range []struct {
		now, day string
		check    int64
		want     string
	}{
		{"2026-11-12 23:29", "", fresh, ""}, {"2026-11-12 23:30", "", fresh, "install"}, {"2026-11-13 00:29", "", fresh, "install"},
		{"2026-11-13 00:30", "", fresh, ""}, {"2026-11-13 00:10", "2026-11-12", fresh, ""}, {"2026-11-13 23:40", "2026-11-12", at("2026-11-13 23:00").Unix(), "install"},
		{"2026-11-12 12:00", "", at("2026-11-11 12:00").Unix(), "check"}, {"2026-11-12 12:00", "", at("2026-11-11 12:01").Unix(), ""},
	} {
		if got := Due(pol, c.day, c.check, at(c.now)); got != c.want {
			t.Errorf("at %s (installed %q): %q, not %q", c.now, c.day, got, c.want)
		}
	}
	off := pol
	off.Auto, off.Check = false, false
	if Due(off, "", 0, at("2026-11-12 23:40")) != "" {
		t.Error("due with everything off")
	}
	now := pol
	now.Mode = "immediate"
	if Due(now, "", fresh, at("2026-11-12 23:40")) != "" {
		t.Error("a scheduled install without a schedule")
	}
}

func TestTick(t *testing.T) {
	dir := t.TempDir()
	text, _ := os.ReadFile("../access/testdata/access.uci")
	c, err := uci.Parse(string(text))
	if err != nil {
		t.Fatal(err)
	}
	os.WriteFile(dir+"/dawnline", text, 0o600)
	os.WriteFile(dir+"/cert", []byte("not a certificate"), 0o644)
	clock := time.Date(2026, 11, 12, 2, 59, 0, 0, zone.Local())
	wan := "203.0.113.7"
	var said []string
	backups, reloads, updates := 0, 0, 0
	failing := false
	ch := &Chores{RunDir: dir + "/run", DataDir: dir + "/data", Config: dir + "/dawnline", Now: func() time.Time { return clock },
		Log:        &servicelog.Log{RunDir: dir + "/run", Level: func() string { return "info" }, Syslog: func(_, line string) { said = append(said, line) }},
		PortalCert: func(model.Settings) (string, bool) { return dir + "/cert", false },
		WanAddress: func(*model.Server) string { return wan },
		Backup: func(kind string) (string, error) {
			if failing {
				return "", errors.New("the flash is full")
			}
			backups++
			return kind + "-1.tar.gz", nil
		},
		Reload: func() { reloads++ }, Update: func() { updates++ }, Updating: func() bool { return false }}
	people := c.OfType("person")
	if len(people) == 0 {
		t.Fatal("the household has nobody")
	}
	who := people[0].Name
	u := usage.Empty()
	load := func() *model.Model { return model.Load(c, nil) }
	told := func(part string) bool {
		for _, l := range said {
			if strings.Contains(l, part) {
				return true
			}
		}
		return false
	}
	// the first tick: nothing to compare with, the address noted, the certificate seen; an update check is due
	if ev := ch.Tick(load(), u); len(ev) != 0 || backups != 0 || reloads != 0 || updates != 1 {
		t.Fatalf("the first tick: %v, %d backups, %d reloads, %d updates", ev, backups, reloads, updates)
	}
	if !told("certificate expires within 7 days") {
		t.Errorf("a certificate that cannot be read is not told: %v", said)
	}
	// an end date three days off: announced once; passed: a pause for that reason
	c.Set(who, "expires", "2026-11-14")
	ev := ch.Tick(load(), u)
	if len(ev) != 1 || ev[0]["type"] != "expiring" || ev[0]["detail"] != "3 days" || ev[0]["person"] != who {
		t.Errorf("the end date's last days: %v", ev)
	}
	if ev := ch.Tick(load(), u); len(ev) != 0 {
		t.Errorf("announced again: %v", ev)
	}
	c.Set(who, "expires", "2026-11-11")
	ev = ch.Tick(load(), u)
	if len(ev) != 1 || ev[0]["type"] != "paused" || ev[0]["detail"] != "end date reached" {
		t.Errorf("the end date passed: %v", ev)
	}
	c.Delete(who, "expires")
	if ev := ch.Tick(load(), u); len(ev) != 1 || ev[0]["type"] != "resumed" {
		t.Errorf("the end date taken away: %v", ev)
	}
	// the night's third hour: one backup a day, and only of settings that changed
	clock = time.Date(2026, 11, 12, 3, 1, 0, 0, zone.Local())
	failing = true
	ch.Tick(load(), u)
	if !told("nightly backup failed: the flash is full") || backups != 0 {
		t.Errorf("a failed backup is not told: %v", said)
	}
	failing = false
	clock = clock.Add(24 * time.Hour)
	ch.Tick(load(), u)
	ch.Tick(load(), u)
	clock = clock.Add(24 * time.Hour)
	ch.Tick(load(), u)
	if backups != 1 || !told("nightly backup saved: auto-1.tar.gz") {
		t.Errorf("%d backups: %v", backups, said)
	}
	// the certificate's file replaced: told, and the service takes it
	os.Chtimes(dir+"/cert", clock, clock.Add(-time.Hour))
	ch.Tick(load(), u)
	if reloads != 1 || !told("certificate renewed") {
		t.Errorf("a renewed certificate: %d reloads, %v", reloads, said)
	}
	// the public address moved, and a server hands out the old one itself
	c.Set("home", "endpoint", "203.0.113.7")
	wan = "198.51.100.9"
	said = nil
	ch.Tick(load(), u)
	if !told("public address changed · 203.0.113.7 → 198.51.100.9") {
		t.Errorf("a moved address is not told: %v", said)
	}
	notes, _ := os.ReadFile(dir + "/data/notes.json")
	if !strings.Contains(string(notes), `"wan":"198.51.100.9"`) || !strings.Contains(string(notes), "warned:"+who) {
		t.Errorf("what was told is not kept: %s", notes)
	}
	if st, _ := os.Stat(dir + "/data/notes.json"); st.Mode().Perm() != 0o600 {
		t.Error("the notes are not private")
	}
}

// The speed record: a point a minute from the totals, the last thirty a server and fifteen a person; who
// is gone goes from the files.
func TestRate(t *testing.T) {
	dir := t.TempDir()
	text, _ := os.ReadFile("../access/testdata/access.uci")
	c, _ := uci.Parse(string(text))
	m := model.Load(c, nil)
	who := m.PersonIDs()[0]
	srv := m.People[who].Server
	clock := time.Unix(1_800_000_000, 0)
	ch := &Chores{RunDir: dir, DataDir: dir + "/data", Now: func() time.Time { return clock }}
	u := usage.Empty()
	u.People[who] = &usage.Record{Total: &usage.Pair{1000, 500}}
	os.WriteFile(dir+"/rate.json", []byte(`{"gone":[[1,2,3]]}`), 0o644)
	ch.rate(m, u)
	for i := 1; i <= 40; i++ {
		clock = clock.Add(time.Minute)
		u.People[who].Total = &usage.Pair{1000 + float64(i)*6000, 500 + float64(i)*600}
		ch.rate(m, u)
	}
	var hist, people map[string][][3]int64
	raw, _ := os.ReadFile(dir + "/rate.json")
	json.Unmarshal(raw, &hist)
	raw, _ = os.ReadFile(dir + "/rate_people.json")
	json.Unmarshal(raw, &people)
	last := [3]int64{clock.Unix(), 100, 10}
	if len(hist[srv]) != 30 || hist[srv][29] != last || len(people[who]) != 15 || people[who][14] != last || hist["gone"] != nil {
		t.Errorf("the record: %d points a server, %d a person, the last %v", len(hist[srv]), len(people[who]), hist[srv])
	}
	// a counter that went back (a reset) is no negative speed; a long gap is no point
	clock = clock.Add(time.Minute)
	u.People[who].Total = &usage.Pair{0, 0}
	ch.rate(m, u)
	clock = clock.Add(time.Hour)
	ch.rate(m, u)
	raw, _ = os.ReadFile(dir + "/rate.json")
	json.Unmarshal(raw, &hist)
	if n := len(hist[srv]); n != 30 || hist[srv][n-1] != [3]int64{clock.Add(-time.Hour).Unix(), 0, 0} {
		t.Errorf("after a reset and a gap: %v", hist[srv][len(hist[srv])-2:])
	}
}
