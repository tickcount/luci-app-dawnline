// Package zone is the router's time zone: what "today", an hour of the day and the first of a month mean
// when the traffic is counted.
//
// Go finds the local zone in the TZ variable or in /etc/localtime. OpenWrt has neither for a service: its
// zone is one line in /etc/TZ, a POSIX TZ string ("MSK-3", "CET-1CEST,M3.5.0,M10.5.0/3"), which its C
// library reads there. Left alone, a Go program on the router counts its days in UTC. So the zone is read
// from that line here, and everything that asks for local time asks Local().
//
// The string is handed to Go's own reader of such rules: a zone file (TZif, RFC 8536) with no transitions
// and the string as its footer, which is where a zone file says how time goes on after its last
// transition.
package zone

import (
	"os"
	"strings"
	"sync/atomic"
	"time"
)

// File is where OpenWrt keeps the zone.
const File = "/etc/TZ"

var (
	local atomic.Pointer[time.Location]
	read  atomic.Pointer[string]
)

// Local is the router's zone: the one last set or loaded, else Go's own idea of it.
func Local() *time.Location {
	if l := local.Load(); l != nil {
		return l
	}
	return time.Local
}

// Set makes loc the router's zone (a test's own, too).
func Set(loc *time.Location) { local.Store(loc) }

// Load reads the zone from path when its line changed since the last Load, and tells whether it did. A
// file that is not there or does not parse leaves the zone as it was.
func Load(path string) bool {
	raw, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	tz := strings.TrimSpace(string(raw))
	if was := read.Load(); tz == "" || (was != nil && *was == tz) {
		return false
	}
	loc, err := FromPOSIX(tz)
	if err != nil {
		return false
	}
	read.Store(&tz)
	local.Store(loc)
	return true
}

// FromPOSIX is the zone a POSIX TZ string describes, daylight saving rules included.
func FromPOSIX(tz string) (*time.Location, error) {
	// One block: no transitions, one local time type (UTC, never used: the footer rules from the start),
	// its abbreviation.
	block := func() []byte {
		b := []byte("TZif2")
		b = append(b, make([]byte, 15)...)
		// isutcnt, isstdcnt, leapcnt, timecnt, typecnt, charcnt
		for _, n := range []byte{0, 0, 0, 0, 1, 4} {
			b = append(b, 0, 0, 0, n)
		}
		// utoff (4), isdst (1), abbreviation's index (1); then "UTC\0"
		b = append(b, 0, 0, 0, 0, 0, 0)
		return append(b, 'U', 'T', 'C', 0)
	}
	// The 32-bit block, then the 64-bit one (the same, with no transition times to differ in), then the footer.
	data := append(block(), block()...)
	data = append(data, '\n')
	data = append(data, tz...)
	data = append(data, '\n')
	loc, err := time.LoadLocationFromTZData(tz, data)
	if err != nil {
		return nil, err
	}
	return loc, nil
}
