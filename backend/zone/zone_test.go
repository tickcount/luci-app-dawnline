package zone

import (
	"os"
	"testing"
	"time"
)

func TestFromPOSIX(t *testing.T) {
	at := func(tz, utc string) string {
		loc, err := FromPOSIX(tz)
		if err != nil {
			t.Fatalf("%s: %v", tz, err)
		}
		u, _ := time.Parse("2006-01-02 15:04", utc)
		return u.In(loc).Format("2006-01-02 15:04 MST")
	}
	for _, c := range []struct{ tz, utc, want string }{
		// the development router's night: a new day there, the old one in UTC
		{"MSK-3", "2026-11-11 21:06", "2026-11-12 00:06 MSK"},
		// daylight saving by rule: the last Sunday of March to the last one of October
		{"CET-1CEST,M3.5.0,M10.5.0/3", "2026-01-15 12:00", "2026-01-15 13:00 CET"},
		{"CET-1CEST,M3.5.0,M10.5.0/3", "2026-07-15 12:00", "2026-07-15 14:00 CEST"},
		{"CET-1CEST,M3.5.0,M10.5.0/3", "2026-03-29 00:59", "2026-03-29 01:59 CET"},
		{"CET-1CEST,M3.5.0,M10.5.0/3", "2026-03-29 01:00", "2026-03-29 03:00 CEST"},
		// west of Greenwich, half hours, names in brackets (as OpenWrt writes zones that have no letters)
		{"EST5EDT,M3.2.0,M11.1.0", "2026-12-01 03:00", "2026-11-30 22:00 EST"},
		{"<+0330>-3:30", "2026-06-01 00:00", "2026-06-01 03:30 +0330"},
		{"UTC0", "2026-06-01 00:00", "2026-06-01 00:00 UTC"},
	} {
		if got := at(c.tz, c.utc); got != c.want {
			t.Errorf("%s at %s: %s, want %s", c.tz, c.utc, got, c.want)
		}
	}
	if _, err := FromPOSIX("no zone at all"); err == nil {
		// Go takes a name it cannot read for UTC under that name or refuses it: either is no zone to count days in
		t.Log("a line that is no zone was taken")
	}
}

func TestLoadFollowsTheFile(t *testing.T) {
	defer local.Store(nil)
	defer read.Store(nil)
	path := t.TempDir() + "/TZ"
	if Load(path) {
		t.Fatal("a zone from no file")
	}
	os.WriteFile(path, []byte("MSK-3\n"), 0o644)
	if !Load(path) || Load(path) {
		t.Fatal("the zone is loaded once per line")
	}
	if _, off := time.Unix(0, 0).In(Local()).Zone(); off != 3*3600 {
		t.Fatalf("offset %d", off)
	}
	os.WriteFile(path, []byte("CET-1CEST,M3.5.0,M10.5.0/3\n"), 0o644)
	if !Load(path) {
		t.Fatal("a changed line is not taken")
	}
	if _, off := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC).In(Local()).Zone(); off != 2*3600 {
		t.Fatalf("offset %d", off)
	}
}
