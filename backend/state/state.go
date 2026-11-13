// Package state is where a person stands: whether their access works now, and if not, why. As
// dawnline.core works it out (own_state, person_state, person_usage, person_quota): the same answer for the
// same settings, counters and moment, because the access rules, the admin and the person's own page must all
// say the same thing.
//
// Pure: the settings, the counters and a moment in, a word out. Days are the router's (package zone).
package state

import (
	"regexp"
	"strconv"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/usage"
	"github.com/tickcount/luci-app-dawnline/backend/zone"
)

// The states.
const (
	Active    = "active"
	Paused    = "paused"
	Expired   = "expired"
	Quota     = "quota"
	NoServer  = "no_server"
	ServerOff = "server_off"
)

var date = regexp.MustCompile(`^([0-9]{4})-([0-9]{2})-([0-9]{2})$`)

// DateEnd is the last second of a day "YYYY-MM-DD" on the router's calendar; ok is false for anything else.
func DateEnd(s string) (int64, bool) {
	m := date.FindStringSubmatch(s)
	if m == nil {
		return 0, false
	}
	y, _ := strconv.Atoi(m[1])
	mo, _ := strconv.Atoi(m[2])
	d, _ := strconv.Atoi(m[3])
	return time.Date(y, time.Month(mo), d, 23, 59, 59, 0, zone.Local()).Unix(), true
}

// Usage is the bytes a person used in their limit's period at ts: their limit month, or all time.
func Usage(p *model.Person, u *usage.Usage, ts int64) float64 {
	if u == nil {
		return 0
	}
	rec := u.People[p.ID]
	if rec == nil {
		return 0
	}
	if p.QuotaPeriod == "total" {
		if rec.Total == nil {
			return 0
		}
		return rec.Total[0] + rec.Total[1]
	}
	if lm := usage.LimitMonth(rec, ts); lm != nil {
		return lm.Rx + lm.Tx
	}
	return 0
}

// QuotaBytes is a person's limit at ts: the base and the extra data while it lasts; 0 is no limit.
func QuotaBytes(p *model.Person, ts int64) float64 {
	if !(p.QuotaGB > 0) {
		return 0
	}
	gb := p.QuotaGB
	if p.BonusGB > 0 && ts < int64(p.BonusUntil) {
		gb += p.BonusGB
	}
	return gb * 1073741824
}

// PersonExpired tells whether a person's end date has passed.
func PersonExpired(p *model.Person, ts int64) bool {
	if p.Expires == "" {
		return false
	}
	end, ok := DateEnd(p.Expires)
	return ok && ts > end
}

// Own is a person's state whatever their server is doing.
func Own(p *model.Person, u *usage.Usage, ts int64) string {
	if p.Paused {
		return Paused
	}
	// Past the end date access stops: the one thing an end date does.
	if PersonExpired(p, ts) {
		return Expired
	}
	if q := QuotaBytes(p, ts); q > 0 && Usage(p, u, ts) >= q {
		return Quota
	}
	return Active
}

// Of is a person's state: active, or why they are off (their own reason, or their server's).
func Of(m *model.Model, p *model.Person, u *usage.Usage, ts int64) string {
	srv := m.Servers[p.Server]
	if srv == nil {
		return NoServer
	}
	if !srv.Enabled {
		return ServerOff
	}
	return Own(p, u, ts)
}
