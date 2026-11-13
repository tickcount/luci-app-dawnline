// Package chores is what Dawnline does on its own once a minute besides keeping the router to the
// settings (the ucode agent's steps "People", "Personal portal", "Router", "Backup" and "updates"):
// people's states that change on their own go to the activity log, an end date is announced when its last
// days begin, a renewed or expiring certificate and a changed public address are told in the service log,
// the settings are backed up at night, and an automatic update is started when one is due.
package chores

import (
	"crypto/md5"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/files"
	"github.com/tickcount/luci-app-dawnline/backend/journal"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/servicelog"
	"github.com/tickcount/luci-app-dawnline/backend/state"
	"github.com/tickcount/luci-app-dawnline/backend/usage"
	"github.com/tickcount/luci-app-dawnline/backend/zone"
)

// ExpireWarn is how many days before an end date it is announced.
const ExpireWarn = 3

// Chores does one router's. What it remembers between ticks starts as "nothing seen yet".
type Chores struct {
	RunDir, DataDir, Config string
	Log                     *servicelog.Log
	// PortalCert is the certificate the portal uses and whether it is Dawnline's own self-signed one.
	PortalCert func(s model.Settings) (path string, selfSigned bool)
	// WanAddress is the router's public IPv4 as a server sees it ("": none).
	WanAddress func(srv *model.Server) string
	// Backup saves the settings (a kind of backup: "auto"); Reload has the service read its settings again.
	Backup func(kind string) (string, error)
	Reload func()
	// Updating tells whether an update job runs; Update starts the updater on its own.
	Updating func() bool
	Update   func()
	// FlushPlaces puts the places' cache on flash (nil: there is none to keep).
	FlushPlaces func()
	// Now is the moment (nil: the clock).
	Now func() time.Time

	states    map[string]string
	certTime  int64
	certSeen  bool
	certCheck int64
	backupDay int
	notes     map[string]any

	rateAt              int64
	rateServers         map[string]usage.Pair
	ratePeople          map[string]usage.Pair
	flushed, logFlushed int64
	failed              map[string]string
}

func (c *Chores) now() time.Time {
	if c.Now != nil {
		return c.Now()
	}
	return time.Now()
}

func (c *Chores) slog(src, level, msg, detail, who string) {
	if c.Log != nil {
		c.Log.Write(src, level, msg, detail, who, servicelog.Extra{})
	}
}

// What the service log was already told. On flash: the public address often changes with a reboot
// (PPPoE), and that is when it matters. Written rarely.
func (c *Chores) note(k string, v any) {
	c.notes[k] = v
	os.MkdirAll(c.DataDir, 0o700)
	files.WriteJSON(c.DataDir+"/notes.json", c.notes, 0o600)
}

var stateReason = map[string]string{"paused": "paused by admin", "expired": "end date reached", "quota": "data limit reached",
	"no_server": "no server", "server_off": "server turned off", "active": "active"}

// StateEvent is the event for a person's state moving on its own from prev to st, or nil. The admin's own
// pauses and a server turned off or on are logged when they happen, so nothing here; nothing either
// without a state before. The data limit has its own events; everything else is paused or resumed with
// the reason.
func StateEvent(person, prev, st string) journal.Event {
	byAdmin := func(x string) bool { return x == "paused" || x == "server_off" }
	if prev == "" || prev == st || byAdmin(prev) || byAdmin(st) {
		return nil
	}
	if st == "quota" {
		return journal.Event{"type": "quota_reached", "person": person}
	}
	if prev == "quota" && st == "active" {
		return journal.Event{"type": "quota_restored", "person": person}
	}
	kind := "paused"
	if st == "active" {
		kind = "resumed"
	}
	reason := stateReason[st]
	if reason == "" {
		reason = st
	}
	return journal.Event{"type": kind, "person": person, "detail": reason}
}

// people is the states that changed on their own, and the end dates whose last days begin (once an end
// date; not on a clock that is not set).
func (c *Chores) people(m *model.Model, u *usage.Usage) []journal.Event {
	now := c.now()
	ts := now.Unix()
	var events []journal.Event
	states := map[string]string{}
	for _, id := range m.PersonIDs() {
		states[id] = state.Of(m, m.People[id], u, ts)
		if e := StateEvent(id, c.states[id], states[id]); e != nil && c.states != nil {
			events = append(events, e)
		}
	}
	c.states = states
	if now.In(zone.Local()).Year() < 2025 {
		return events
	}
	for _, id := range m.PersonIDs() {
		p := m.People[id]
		end, ok := state.DateEnd(p.Expires)
		if p.Expires == "" || !ok || end <= ts {
			continue
		}
		left := (end-ts)/86400 + 1
		if left <= ExpireWarn && c.notes["warned:"+id] != p.Expires {
			c.note("warned:"+id, p.Expires)
			days := "days"
			if left == 1 {
				days = "day"
			}
			events = append(events, journal.Event{"type": "expiring", "person": id, "detail": fmt.Sprintf("%d %s", left, days)})
		}
	}
	return events
}

// certEnd is when a certificate ends ("Jan 1 2027", and the moment), from its file.
func certEnd(path string) (string, time.Time, bool) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", time.Time{}, false
	}
	block, _ := pem.Decode(raw)
	if block == nil {
		return "", time.Time{}, false
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return "", time.Time{}, false
	}
	end := cert.NotAfter.UTC()
	return fmt.Sprintf("%s %d %d", end.Format("Jan"), end.Day(), end.Year()), end, true
}

// cert tells a renewed certificate (and has the service take it), and one that runs out within a week
// (ACME did not renew it): once a certificate, looked at hourly.
func (c *Chores) cert(m *model.Model) {
	if !m.Settings.PortalEnabled || c.PortalCert == nil {
		return
	}
	path, self := c.PortalCert(m.Settings)
	st, err := os.Stat(path)
	var mt int64
	if err == nil {
		mt = st.ModTime().Unix()
	}
	if c.certSeen && c.certTime != 0 && mt != 0 && mt != c.certTime {
		until := "?"
		if s, _, ok := certEnd(path); ok {
			until = s
		}
		c.slog("portal", "up", "certificate renewed · valid until "+until, "", "Personal portal")
		if c.Reload != nil {
			c.Reload()
		}
	}
	c.certTime, c.certSeen = mt, true
	now := c.now().Unix()
	if mt == 0 || self || now-c.certCheck < 3600 {
		return
	}
	c.certCheck = now
	warned, _ := c.notes["cert_warned"].(float64)
	s, end, ok := certEnd(path)
	if int64(warned) != mt && (!ok || end.Unix()-now < 604800) {
		msg := "certificate expires within 7 days"
		if ok {
			msg = "certificate expires " + s
		}
		c.slog("portal", "error", msg, "Browsers will refuse the portal after that. Renew it with ACME, or choose another certificate in Settings.", "Personal portal")
		c.note("cert_warned", float64(mt))
	}
}

// wan tells that the router's public IPv4 changed. Devices whose configuration holds the address itself
// (a server's public address is an IP) cannot connect until they get a new one; with a hostname only the
// DNS record must follow.
func (c *Chores) wan(m *model.Model) {
	if c.WanAddress == nil {
		return
	}
	ip := ""
	for _, id := range m.ServerIDs() {
		if srv := m.Servers[id]; srv.Enabled && srv.PrivateKey != "" {
			ip = c.WanAddress(srv)
			break
		}
	}
	was, _ := c.notes["wan"].(string)
	if ip == "" || ip == was {
		return
	}
	c.note("wan", ip)
	if was == "" {
		return
	}
	var stuck []string
	for _, id := range m.ServerIDs() {
		if srv := m.Servers[id]; m.EndpointHost(srv) == was {
			stuck = append(stuck, srv.Name)
		}
	}
	msg := fmt.Sprintf("public address changed · %s → %s", was, ip)
	switch len(stuck) {
	case 0:
		c.slog("dawnline", "info", msg, "", "Router")
	case 1:
		c.slog("dawnline", "error", msg, stuck[0]+" still gives devices the old address: set the public address in the server settings (a DDNS name keeps working), then devices need new configurations.", "Router")
	default:
		c.slog("dawnline", "error", msg, strings.Join(stuck, ", ")+" still give devices the old address: set the public address in the server settings (a DDNS name keeps working), then devices need new configurations.", "Router")
	}
}

// backup saves the settings in the night's third hour, once a day, when they changed since the last one.
func (c *Chores) backup() {
	t := c.now().In(zone.Local())
	if t.Hour() != 3 || c.backupDay == t.Day() || c.Backup == nil {
		return
	}
	c.backupDay = t.Day()
	raw, err := os.ReadFile(c.Config)
	if err != nil {
		return
	}
	sum := md5.Sum(raw)
	now := hex.EncodeToString(sum[:])
	var st struct {
		Auto string `json:"auto"`
	}
	files.ReadJSON(c.DataDir+"/backup-state.json", &st)
	if now == st.Auto {
		return
	}
	name, err := c.Backup("auto")
	if err != nil {
		// tried again tomorrow; meanwhile the admin should know (a full flash, mostly)
		c.slog("dawnline", "error", "nightly backup failed: "+err.Error(), "", "Backup")
		return
	}
	files.WriteJSON(c.DataDir+"/backup-state.json", map[string]any{"auto": now}, 0o600)
	if c.Log != nil {
		if name != "" {
			name = ": " + name
		}
		c.Log.Say("info", "backup", "nightly backup saved"+name)
	}
}

var intervals = map[string]int64{"6h": 6 * 3600, "12h": 12 * 3600, "1d": 86400, "7d": 7 * 86400}
var clock = regexp.MustCompile(`^([0-9]{1,2}):([0-9]{2})$`)

// slot is the scheduled slot now is in (up to an hour after the set time, also across midnight).
func slot(pol model.Updates, now time.Time) (time.Time, bool) {
	hm := clock.FindStringSubmatch(pol.Time)
	if hm == nil {
		return time.Time{}, false
	}
	h, _ := strconv.Atoi(hm[1])
	mi, _ := strconv.Atoi(hm[2])
	for _, day := range []time.Time{now, now.Add(-24 * time.Hour)} {
		d := day.In(zone.Local())
		// as ucode's: the day's midnight by the clock's own reading, then the set time
		at := time.Unix(day.Unix()-int64(d.Hour()*3600+d.Minute()*60+d.Second())+int64(h*3600+mi*60), 0)
		if !now.Before(at) && now.Sub(at) < time.Hour {
			return at, true
		}
	}
	return time.Time{}, false
}

// Due is what an automatic run should do now (dawnline.updates due): "install" (the scheduled window, at
// most an hour after the set time, once a slot), "check" (the interval has passed), or "".
func Due(pol model.Updates, installDay string, lastCheck int64, now time.Time) string {
	if pol.Auto && pol.Mode == "scheduled" && len(pol.Targets) > 0 {
		if at, in := slot(pol, now); in && installDay != at.In(zone.Local()).Format("2006-01-02") {
			return "install"
		}
	}
	every := intervals[pol.Interval]
	if every == 0 {
		every = 86400
	}
	if pol.Check && now.Unix()-lastCheck >= every {
		return "check"
	}
	return ""
}

// updates starts an automatic check or update when one is due. The updater does the work in its own
// process; this only decides when.
func (c *Chores) updates(m *model.Model) {
	if c.Update == nil {
		return
	}
	var st struct {
		InstallDay string  `json:"install_day"`
		Check      float64 `json:"check"`
	}
	files.ReadJSON(c.DataDir+"/update-auto.json", &st)
	if Due(m.Settings.Updates, st.InstallDay, int64(st.Check), c.now()) != "" && !(c.Updating != nil && c.Updating()) {
		c.Update()
	}
}

func (c *Chores) step(who string, quiet bool, fn func()) {
	defer func() {
		e := recover()
		if e == nil {
			delete(c.failed, who)
			return
		}
		msg := fmt.Sprint(e)
		// a new failure in the service log, a repeat or a quiet step's in syslog alone
		if !quiet && c.failed[who] != msg {
			c.slog("dawnline", "error", "failed: "+msg, "", who)
		} else if c.Log != nil {
			c.Log.Say("error", "chores", who+": "+msg)
		}
		c.failed[who] = msg
	}()
	fn()
}

// Tick is one minute's chores: the events for the activity log (the caller writes them and tells the
// pages), and everything else done. Each step on its own: a failing one is logged and the others still run.
func (c *Chores) Tick(m *model.Model, u *usage.Usage) []journal.Event {
	if c.notes == nil {
		c.notes = map[string]any{}
		files.ReadJSON(c.DataDir+"/notes.json", &c.notes)
		c.failed = map[string]string{}
	}
	var events []journal.Event
	c.step("Speed", true, func() { c.rate(m, u) })
	c.step("People", false, func() { events = c.people(m, u) })
	c.step("Personal portal", false, func() { c.cert(m) })
	c.step("Router", true, func() { c.wan(m) })
	c.step("Backup", false, c.backup)
	c.step("updates", true, func() { c.updates(m) })
	c.step("Logs", true, func() { c.keepLogs(m) })
	return events
}
