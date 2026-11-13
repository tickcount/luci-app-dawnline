package usage

import (
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/awg"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
	"github.com/tickcount/luci-app-dawnline/backend/zone"
)

// The generator of testdata/trace.uc, number for number.
type gen struct{ x int64 }

func (g *gen) rnd(n int64) int64 {
	g.x = (g.x*1103515245 + 12345) % 2147483648
	return (g.x >> 8) % n
}

// plain is a document as JSON reads it, without what is empty: an empty history is the same as none.
func plain(v any) any {
	raw, _ := json.Marshal(v)
	var out any
	json.Unmarshal(raw, &out)
	return tidy(out)
}

func tidy(v any) any {
	if m, ok := v.(map[string]any); ok {
		for k, e := range m {
			e = tidy(e)
			if sub, isMap := e.(map[string]any); isMap && len(sub) == 0 {
				delete(m, k)
				continue
			}
			m[k] = e
		}
	}
	return v
}

func differ(path string, got, want any) []string {
	g, gok := got.(map[string]any)
	w, wok := want.(map[string]any)
	if gok && wok {
		var out []string
		for k := range w {
			if _, has := g[k]; !has {
				out = append(out, fmt.Sprintf("%s.%s: missing, ucode has %v", path, k, w[k]))
			}
		}
		for k, v := range g {
			if _, has := w[k]; !has {
				out = append(out, fmt.Sprintf("%s.%s: %v, ucode has none", path, k, v))
				continue
			}
			out = append(out, differ(path+"."+k, v, w[k])...)
		}
		return out
	}
	if reflect.DeepEqual(got, want) {
		return nil
	}
	return []string{fmt.Sprintf("%s: %v, ucode has %v", path, got, want)}
}

// The same made-up looks through Collect as trace.uc put through dawnline.live collect(), from the same
// usage file, at the same moment: the same counters at the end, and the same view of every device at
// every look.
func TestHeldToUcode(t *testing.T) {
	zone.Set(time.UTC)
	text, err := os.ReadFile("testdata/usage.uci")
	if err != nil {
		t.Fatal(err)
	}
	c, err := uci.Parse(string(text))
	if err != nil {
		t.Fatal(err)
	}
	m := model.Load(c, nil)
	raw, err := os.ReadFile("testdata/trace.json")
	if err != nil {
		t.Fatal(err)
	}
	var golden struct {
		TS    int64           `json:"ts"`
		Steps int             `json:"steps"`
		Seed  json.RawMessage `json:"seed"`
		Final any             `json:"final"`
		Hash  int64           `json:"hash"`
	}
	if err := json.Unmarshal(raw, &golden); err != nil {
		t.Fatal(err)
	}
	u := Empty()
	if err := json.Unmarshal(golden.Seed, u); err != nil {
		t.Fatalf("the seeded usage does not read: %v", err)
	}
	ts0 := golden.TS

	g := &gen{x: 4711}
	ifindex := []int{5, 9}
	type peer struct {
		present    bool
		rx, tx, hs int64
		ep         string
	}
	st := map[string]*peer{}
	for _, id := range m.DeviceIDs() {
		st[id] = &peer{present: true, hs: ts0 - 3000}
	}
	hash := int64(7)
	for i := 0; i < golden.Steps; i++ {
		d := awg.Dump{OK: true, Reads: map[string]string{}, Ifaces: map[string]awg.Iface{}, Peers: map[string]awg.Peer{}}
		state := map[string]string{}
		for n, sid := range m.ServerIDs() {
			srv := m.Servers[sid]
			switch r := g.rnd(100); {
			case r < 4:
				state[sid] = awg.Failed
			case r < 7:
				state[sid] = awg.Down
			default:
				state[sid] = awg.Read
			}
			if g.rnd(100) < 2 {
				ifindex[n]++
			}
			d.Reads[srv.Ifname] = state[sid]
			if state[sid] == awg.Read {
				d.Ifaces[srv.Ifname] = awg.Iface{Ifindex: ifindex[n]}
			}
		}
		for _, id := range m.DeviceIDs() {
			dev, s := m.Devices[id], st[id]
			sid := m.People[dev.Person].Server
			if g.rnd(100) < 3 {
				s.present = !s.present
				if s.present {
					s.rx, s.tx = 0, 0
				}
			}
			if !s.present {
				continue
			}
			if g.rnd(100) < 60 {
				s.rx += g.rnd(5000)
			}
			if g.rnd(100) < 60 {
				s.tx += g.rnd(90000)
			}
			if g.rnd(100) < 3 {
				s.rx = g.rnd(100)
				s.tx = g.rnd(100)
			}
			if g.rnd(100) < 20 {
				s.hs += 1 + g.rnd(50)
			}
			if g.rnd(100) < 10 {
				s.ep = fmt.Sprintf("203.0.113.%d:4000", 1+g.rnd(12))
			}
			if state[sid] == awg.Read {
				d.Peers[dev.PublicKey] = awg.Peer{Ifname: m.Servers[sid].Ifname, Endpoint: s.ep, Handshake: s.hs, Rx: s.rx, Tx: s.tx}
			}
		}
		seen := Collect(m, u, d, ts0)
		for _, id := range m.DeviceIDs() {
			v := seen[id]
			on, present := 0, 0
			if v.Online {
				on = 1
			}
			if v.Present {
				present = 1
			}
			for _, ch := range []byte(fmt.Sprintf("%s:%d:%d:%s:%d;", id, on, int64(v.Handshake), v.Endpoint, present)) {
				hash = (hash*131 + int64(ch)) % 1000000007
			}
		}
	}
	if d := differ("", plain(u), tidy(golden.Final)); len(d) > 0 {
		t.Errorf("the counters ended differently than ucode's:\n%s", strings.Join(d[:min(len(d), 25)], "\n"))
	}
	if hash != golden.Hash {
		t.Errorf("what the looks showed of the devices differs somewhere: hash %d, ucode has %d", hash, golden.Hash)
	}
}

func TestLimitMonth(t *testing.T) {
	zone.Set(time.UTC)
	at := func(s string) int64 {
		v, err := time.Parse("2006-01-02 15:04:05", s)
		if err != nil {
			t.Fatal(err)
		}
		return v.Unix()
	}
	// a month later on the calendar; a day the next month lacks is its last one
	for from, to := range map[string]string{
		"2026-01-31 10:00:00": "2026-02-28 10:00:00",
		"2028-01-31 10:00:00": "2028-02-29 10:00:00",
		"2026-12-15 23:59:59": "2027-01-15 23:59:59",
		"2026-03-31 00:00:00": "2026-04-30 00:00:00",
	} {
		if got := monthAfter(at(from)); got != at(to) {
			t.Errorf("a month after %s: %s, want %s", from, time.Unix(got, 0).UTC().Format("2006-01-02 15:04:05"), to)
		}
	}
	running := &Record{Period: &Period{Start: float64(at("2026-11-01 00:00:00")), Rx: 5}}
	if p := LimitMonth(running, at("2026-11-30 23:59:59")); p == nil || p.Rx != 5 {
		t.Error("a running limit month is not found")
	}
	if LimitMonth(running, at("2026-12-01 00:00:00")) != nil {
		t.Error("an ended limit month still runs")
	}
	old := &Record{Months: map[string]Pair{"2026-11": {7, 9}}}
	if p := LimitMonth(old, at("2026-11-11 12:00:00")); p == nil || p.Start != float64(at("2026-11-01 00:00:00")) || p.Tx != 9 {
		t.Errorf("a record from before limit months: %+v", p)
	}
	if LimitMonth(&Record{}, at("2026-11-11 12:00:00")) != nil || LimitMonth(nil, 0) != nil {
		t.Error("a limit month out of nothing")
	}
}

func TestReset(t *testing.T) {
	c, _ := uci.Parse("config person 'anna'\nconfig device 'd1'\n\toption person 'anna'\nconfig device 'd2'\n\toption person 'x'\n")
	m := model.Load(c, nil)
	fresh := func() *Usage {
		return &Usage{
			Devices: map[string]*Record{"d1": {Raw: &Pair{1, 1}, Total: &Pair{5, 5}, Handshake: 9}, "d2": {Total: &Pair{7, 7}}},
			People:  map[string]*Record{"anna": {Total: &Pair{5, 5}, Period: &Period{Start: 3, Rx: 5}}},
			Hours:   map[string]Pair{"2026-11-11 10": {1, 1}},
		}
	}
	u := fresh()
	Reset(u, m, "person", "anna")
	if u.People["anna"].Total != nil || u.Devices["d1"].Total != nil || u.Devices["d1"].Raw == nil || u.Devices["d1"].Handshake != 9 || u.Devices["d2"].Total == nil {
		t.Errorf("person: %+v %+v", u.People["anna"], u.Devices["d1"])
	}
	u = fresh()
	Reset(u, m, "device", "d1")
	if u.Devices["d1"].Total != nil || u.People["anna"].Total == nil {
		t.Error("device")
	}
	u = fresh()
	Reset(u, m, "limit", "anna")
	if p := u.People["anna"].Period; p == nil || p.Start != 0 || p.Rx != 0 || u.People["anna"].Total == nil {
		t.Errorf("limit: %+v", u.People["anna"])
	}
	u = fresh()
	Reset(u, m, "all", "")
	if u.Hours != nil || u.Devices["d2"].Total != nil || u.People["anna"].Period != nil {
		t.Error("all")
	}
}

// Days, hours and months are the router's own, not UTC's: a Go program on OpenWrt knows no zone unless it
// is told (package zone). The night this was found: 00:06 in Moscow, 21:06 the day before in UTC.
func TestDaysAreTheRoutersOwn(t *testing.T) {
	msk, err := zone.FromPOSIX("MSK-3")
	if err != nil {
		t.Fatal(err)
	}
	zone.Set(msk)
	defer zone.Set(time.UTC)
	ts := time.Date(2026, 11, 11, 21, 6, 32, 0, time.UTC).Unix()
	now := time.Unix(ts, 0).In(zone.Local())
	if dayKey(now) != "2026-11-12" || hourKey(now) != "2026-11-12 00" || monthKey(now) != "2026-11" {
		t.Fatalf("the day %s, the hour %s, the month %s", dayKey(now), hourKey(now), monthKey(now))
	}
	// a limit month that began on the 31st at 23:30 Moscow time ends on the last of the next month there
	began := time.Date(2026, 1, 31, 20, 30, 0, 0, time.UTC).Unix()
	if got := time.Unix(monthAfter(began), 0).In(msk).Format("2006-01-02 15:04"); got != "2026-02-28 23:30" {
		t.Fatalf("a month after: %s", got)
	}
}
