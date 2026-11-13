package chores

import (
	"os"

	"github.com/tickcount/luci-app-dawnline/backend/files"
	"github.com/tickcount/luci-app-dawnline/backend/journal"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/usage"
)

// point is a minute's speed: the moment, bytes a second down and up.
type point [3]int64

// rate keeps the last half hour of each server's speed (rate.json) and the last quarter of each person's
// (rate_people.json), a point a minute, from the counters' totals.
func (c *Chores) rate(m *model.Model, u *usage.Usage) {
	ts := c.now().Unix()
	servers := map[string]usage.Pair{}
	totals := map[string]usage.Pair{}
	for _, id := range m.PersonIDs() {
		rec := u.People[id]
		if rec == nil || rec.Total == nil {
			continue
		}
		totals[id] = *rec.Total
		s := servers[m.People[id].Server]
		s[0] += rec.Total[0]
		s[1] += rec.Total[1]
		servers[m.People[id].Server] = s
	}
	hist := map[string][]point{}
	people := map[string][]point{}
	files.ReadJSON(c.RunDir+"/rate.json", &hist)
	files.ReadJSON(c.RunDir+"/rate_people.json", &people)
	per := func(now, was float64, dt int64) int64 {
		if now < was {
			return 0
		}
		return int64((now - was) / float64(dt))
	}
	if dt := ts - c.rateAt; c.rateAt != 0 && dt > 0 && dt < 600 {
		for s, v := range servers {
			p, had := c.rateServers[s]
			if !had {
				p = v
			}
			hist[s] = append(hist[s], point{ts, per(v[0], p[0], dt), per(v[1], p[1], dt)})
			if n := len(hist[s]); n > 30 {
				hist[s] = hist[s][n-30:]
			}
		}
		for _, id := range m.PersonIDs() {
			t, has := totals[id]
			p, had := c.ratePeople[id]
			if !has || !had {
				continue
			}
			people[id] = append(people[id], point{ts, per(t[0], p[0], dt), per(t[1], p[1], dt)})
			if n := len(people[id]); n > 15 {
				people[id] = people[id][n-15:]
			}
		}
	}
	for s := range hist {
		if m.Servers[s] == nil {
			delete(hist, s)
		}
	}
	for id := range people {
		if m.People[id] == nil {
			delete(people, id)
		}
	}
	c.rateAt, c.rateServers, c.ratePeople = ts, servers, totals
	os.MkdirAll(c.RunDir, 0o755)
	files.WriteJSON(c.RunDir+"/rate.json", hist, 0o644)
	files.WriteJSON(c.RunDir+"/rate_people.json", people, 0o644)
}

// flushEvery is how often what lives in memory is put on flash.
const flushEvery = 3600

var logFlush = map[string]int64{"10min": 600, "hourly": 3600}

// keepLogs trims the service log, and puts it, the places and the activity log on flash as often as each
// is meant to be: flash is written rarely.
func (c *Chores) keepLogs(m *model.Model) {
	now := c.now().Unix()
	if c.flushed == 0 {
		c.flushed, c.logFlushed = now, now
	}
	persist := now-c.flushed >= flushEvery
	if persist {
		c.flushed = now
		if c.FlushPlaces != nil {
			c.FlushPlaces()
		}
	}
	if c.Log != nil {
		c.Log.Trim(c.DataDir, persist)
	}
	pol := journal.PolicyOf(m.Settings.Retention)
	if pol.Persist == "off" || now-c.logFlushed >= logFlush[pol.Persist] {
		journal.Log{Run: c.RunDir, Data: c.DataDir}.Persist(pol, now)
		c.logFlushed = now
	}
}
