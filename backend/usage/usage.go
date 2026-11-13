// Package usage is the traffic accounting: the tunnels' counters folded into what each device and person
// used, by the day, the month and the person's limit month, and the router's traffic by the hour. It is
// dawnline.live's collect() and its helpers in Go, rule for rule, on the same file: usage.json is read and
// written by both backends while both exist, so its shape here is the file's.
//
// Pure but for Load and Save: the settings, a look at the tunnels and the clock go in, the counters change.
// The clock is the router's local one (days and months are the router's calendar).
package usage

import (
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/awg"
	"github.com/tickcount/luci-app-dawnline/backend/files"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/presence"
	"github.com/tickcount/luci-app-dawnline/backend/zone"
)

// hoursKept is how many hours of router-wide traffic are kept (today and yesterday): Overview's bars.
const hoursKept = 48

// addressesKept is how many recent client addresses a device keeps (for the map).
const addressesKept = 8

// Pair is bytes received from a device and sent to it. Numbers are float64 as the file's are read: whole
// to 2^53, far more than a router moves.
type Pair [2]float64

// Period is a person's limit month: when it began and what it counted.
type Period struct {
	Start float64 `json:"start"`
	Rx    float64 `json:"rx"`
	Tx    float64 `json:"tx"`
}

// Record is what is kept of a device or a person. A device has Raw (its peer's counters at the last
// read), Ifindex (the link they were read on), its last handshake, address and recent addresses; a person
// has Period. Both have the totals and the history.
type Record struct {
	Raw       *Pair              `json:"raw,omitempty"`
	Ifindex   *int               `json:"ifindex,omitempty"`
	Total     *Pair              `json:"total,omitempty"`
	Months    map[string]Pair    `json:"months,omitempty"`
	Days      map[string]Pair    `json:"days,omitempty"`
	Period    *Period            `json:"period,omitempty"`
	Handshake float64            `json:"handshake,omitempty"`
	Endpoint  *string            `json:"endpoint,omitempty"`
	IPs       map[string]float64 `json:"ips,omitempty"`
}

// Usage is the whole file.
type Usage struct {
	Devices map[string]*Record `json:"devices"`
	People  map[string]*Record `json:"people"`
	Hours   map[string]Pair    `json:"hours,omitempty"`
	Updated float64            `json:"updated"`
	Flushed float64            `json:"flushed"`
}

// Empty is a file with nothing counted yet.
func Empty() *Usage {
	return &Usage{Devices: map[string]*Record{}, People: map[string]*Record{}}
}

// Load reads the counters: the live copy in the run directory, else what flash holds. With fromFlash only
// flash counts (a restore put new counters there, and the live ones are the old).
func Load(run, data string, fromFlash bool) *Usage {
	u := Empty()
	if !fromFlash && files.ReadJSON(run+"/usage.json", u) {
		return fill(u)
	}
	u = Empty()
	files.ReadJSON(data+"/usage.json", u)
	return fill(u)
}

func fill(u *Usage) *Usage {
	if u.Devices == nil {
		u.Devices = map[string]*Record{}
	}
	if u.People == nil {
		u.People = map[string]*Record{}
	}
	return u
}

// Save writes the counters to the run directory (tmpfs), and to flash too when persist is set: flash is
// not worn by a write a minute.
func Save(u *Usage, run, data string, persist bool, now int64) error {
	os.MkdirAll(run, 0o755)
	if err := files.WriteJSON(run+"/usage.json", u, 0o600); err != nil {
		return err
	}
	if !persist {
		return nil
	}
	u.Flushed = float64(now)
	os.MkdirAll(data, 0o700)
	return files.WriteJSON(data+"/usage.json", u, 0o600)
}

// Policy is how much history is kept.
type Policy struct {
	Days, Months int
}

var whole = regexp.MustCompile(`^-?[0-9]{1,9}$`)

// PolicyOf reads the retention settings as dawnline.live policy() does: a whole number within its range,
// or the default.
func PolicyOf(r model.Retention) Policy {
	get := func(v any, dflt, lo, hi int) int {
		s, _ := v.(string)
		s = strings.TrimSpace(s)
		if !whole.MatchString(s) {
			return dflt
		}
		n, _ := strconv.Atoi(s)
		if n < lo || n > hi {
			return dflt
		}
		return n
	}
	return Policy{Days: get(r.UsageKeepDays, 62, 7, 1830), Months: get(r.UsageKeepMonths, 24, 1, 120)}
}

// Live is a device as the last look found it.
type Live struct {
	Online    bool    `json:"online"`
	Handshake float64 `json:"handshake"`
	Endpoint  string  `json:"endpoint"`
	Present   bool    `json:"present"`
}

func monthKey(t time.Time) string { return t.Format("2006-01") }
func dayKey(t time.Time) string   { return t.Format("2006-01-02") }
func hourKey(t time.Time) string  { return t.Format("2006-01-02 15") }

// monthAfter is the same moment a month later on the router's calendar (a day the next month does not
// have is its last one: 31 Jan → 28 or 29 Feb): when a limit month that began at ts ends.
func MonthAfter(ts int64) int64 { return monthAfter(ts) }

func monthAfter(ts int64) int64 {
	t := time.Unix(ts, 0).In(zone.Local())
	y, mo := t.Year(), t.Month()+1
	if mo > 12 {
		y, mo = y+1, 1
	}
	// the last day of that month: the day before the 1st of the one after it
	last := time.Date(y, mo+1, 1, 12, 0, 0, 0, zone.Local()).AddDate(0, 0, -1).Day()
	return time.Date(y, mo, min(t.Day(), last), t.Hour(), t.Minute(), t.Second(), 0, zone.Local()).Unix()
}

// LimitMonth is the limit month of a person's record that runs at ts, or nil when none does. A limit month
// is not the calendar's: it begins with the person's first traffic and ends a month later; the next one
// begins only with their next traffic, so time they are away uses up none of it. A record from before
// limit months has none: the calendar month that ran then is its first one, with what it had counted, and
// it ends on the 1st as it would have.
func LimitMonth(u *Record, ts int64) *Period {
	if u == nil {
		return nil
	}
	p := u.Period
	if p == nil {
		t := time.Unix(ts, 0).In(zone.Local())
		mm, counted := u.Months[monthKey(t)]
		if !counted {
			return nil
		}
		first := time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, zone.Local()).Unix()
		p = &Period{Start: float64(first), Rx: mm[0], Tx: mm[1]}
	}
	if ts < monthAfter(int64(p.Start)) {
		return p
	}
	return nil
}

func add(bucket map[string]Pair, key string, rx, tx float64) {
	v := bucket[key]
	bucket[key] = Pair{v[0] + rx, v[1] + tx}
}

// prune keeps the newest `keep` keys of a history (they sort by date).
func prune(bucket map[string]Pair, keep int) {
	if len(bucket) <= keep {
		return
	}
	keys := make([]string, 0, len(bucket))
	for k := range bucket {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys[:len(keys)-keep] {
		delete(bucket, k)
	}
}

// account adds traffic to a record's total and its day and month.
func account(rec *Record, rx, tx float64, t time.Time) {
	total := Pair{}
	if rec.Total != nil {
		total = *rec.Total
	}
	rec.Total = &Pair{total[0] + rx, total[1] + tx}
	if rec.Months == nil {
		rec.Months = map[string]Pair{}
	}
	if rec.Days == nil {
		rec.Days = map[string]Pair{}
	}
	add(rec.Months, monthKey(t), rx, tx)
	add(rec.Days, dayKey(t), rx, tx)
}

// accountMonth adds a person's traffic to their limit month: the one that runs, or a new one that begins
// with this traffic. Called before account, which a record from before limit months is read by.
func accountMonth(rec *Record, rx, tx float64, ts int64) {
	p := LimitMonth(rec, ts)
	if p == nil {
		p = &Period{Start: float64(ts)}
	}
	rec.Period = &Period{Start: p.Start, Rx: p.Rx + rx, Tx: p.Tx + tx}
}

// Collect folds a look at the tunnels into the counters and returns each device as that look found it.
// Counters restart from zero when a peer is added again or its tunnel is set up again: a drop is taken as
// a reset, and so is a new link (each record keeps the index of the link its counters were read on: new
// counters that already passed the old ones would be counted short).
//
// A device missing from the look had its counters reset only when its tunnel was read or is down: one the
// tool could not read says nothing, and forgetting the last counters there would count them again on the
// next good read.
func Collect(m *model.Model, u *Usage, d awg.Dump, ts int64) map[string]Live {
	now := time.Unix(ts, 0).In(zone.Local())
	live := map[string]Live{}
	var all Pair
	for _, id := range m.DeviceIDs() {
		dev := m.Devices[id]
		rec := u.Devices[id]
		if rec == nil {
			rec = &Record{Raw: &Pair{}}
			u.Devices[id] = rec
		}
		var srv *model.Server
		if p := m.People[dev.Person]; p != nil {
			srv = m.Servers[p.Server]
		}
		peer, there := d.Peers[dev.PublicKey]
		if !there {
			ifname := ""
			if srv != nil {
				ifname = srv.Ifname
			}
			if d.Reads[ifname] != awg.Failed {
				rec.Raw = &Pair{}
			}
			endpoint := ""
			if rec.Endpoint != nil {
				endpoint = *rec.Endpoint
			}
			live[id] = Live{Handshake: rec.Handshake, Endpoint: endpoint}
			continue
		}
		raw := Pair{}
		if rec.Raw != nil {
			raw = *rec.Raw
		}
		if ifc, read := d.Ifaces[peer.Ifname]; read {
			if rec.Ifindex != nil && *rec.Ifindex != ifc.Ifindex {
				raw = Pair{}
			}
			index := ifc.Ifindex
			rec.Ifindex = &index
		}
		rx, tx := float64(peer.Rx), float64(peer.Tx)
		drx, dtx := rx, tx
		if rx >= raw[0] {
			drx = rx - raw[0]
		}
		if tx >= raw[1] {
			dtx = tx - raw[1]
		}
		rec.Raw = &Pair{rx, tx}
		if drx > 0 || dtx > 0 {
			account(rec, drx, dtx, now)
			all[0] += drx
			all[1] += dtx
			p := u.People[dev.Person]
			if p == nil {
				p = &Record{}
				u.People[dev.Person] = p
			}
			accountMonth(p, drx, dtx, ts)
			account(p, drx, dtx, now)
		}
		ip := presence.EndpointIP(peer.Endpoint)
		if peer.Handshake > 0 {
			rec.Handshake = float64(peer.Handshake)
			rec.Endpoint = &ip
			if rec.IPs == nil {
				rec.IPs = map[string]float64{}
			}
			if ip != "" {
				rec.IPs[ip] = float64(peer.Handshake)
			}
			keepNewest(rec.IPs, addressesKept)
		}
		l := Live{Present: true, Handshake: rec.Handshake, Endpoint: ip,
			Online: peer.Handshake > 0 && ts-peer.Handshake < int64(model.OnlineWindowOf(srv, dev))}
		if peer.Handshake > 0 {
			l.Handshake = float64(peer.Handshake)
		}
		if l.Endpoint == "" && rec.Endpoint != nil {
			l.Endpoint = *rec.Endpoint
		}
		live[id] = l
	}
	// Counters of devices that no longer exist are forgotten (their bytes stay in the person's totals).
	for id := range u.Devices {
		if m.Devices[id] == nil {
			delete(u.Devices, id)
		}
	}
	if all[0] > 0 || all[1] > 0 {
		if u.Hours == nil {
			u.Hours = map[string]Pair{}
		}
		add(u.Hours, hourKey(now), all[0], all[1])
	}
	if u.Hours != nil {
		prune(u.Hours, hoursKept)
	}
	Prune(u, PolicyOf(m.Settings.Retention))
	u.Updated = float64(ts)
	return live
}

// keepNewest keeps the n addresses seen last.
func keepNewest(ips map[string]float64, n int) {
	if len(ips) <= n {
		return
	}
	keys := make([]string, 0, len(ips))
	for k := range ips {
		keys = append(keys, k)
	}
	sort.SliceStable(keys, func(i, j int) bool { return ips[keys[i]] > ips[keys[j]] })
	for _, k := range keys[n:] {
		delete(ips, k)
	}
}

// Prune applies the history's retention to every record.
func Prune(u *Usage, pol Policy) {
	for _, group := range []map[string]*Record{u.Devices, u.People} {
		for _, rec := range group {
			if rec.Months != nil {
				prune(rec.Months, pol.Months)
			}
			if rec.Days != nil {
				prune(rec.Days, pol.Days)
			}
		}
	}
}

// wipe forgets a record's traffic history; the kernel's counters and the last handshake stay.
func wipe(rec *Record) {
	if rec == nil {
		return
	}
	rec.Total, rec.Months, rec.Days, rec.Period = nil, nil, nil, nil
}

// Reset forgets traffic history. scope: all | person | device | limit. A person's reset also clears their
// devices and restarts their data limit; a device's leaves the person's totals (and so their limit) alone;
// `limit` restarts a person's limit month and touches nothing else (an ended month is left in its place,
// not none: a record from before limit months would be read by its calendar month again).
func Reset(u *Usage, m *model.Model, scope, id string) {
	switch scope {
	case "all":
		u.Hours = nil
		for _, rec := range u.Devices {
			wipe(rec)
		}
		for _, rec := range u.People {
			wipe(rec)
		}
	case "person":
		wipe(u.People[id])
		if p := m.People[id]; p != nil {
			for _, did := range p.Devices {
				wipe(u.Devices[did])
			}
		}
	case "device":
		wipe(u.Devices[id])
	case "limit":
		if rec := u.People[id]; rec != nil {
			rec.Period = &Period{}
		}
	}
}
