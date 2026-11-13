// Package meter is the live meter: each server's throughput and that of each device moving traffic, one
// point a second over the last two minutes (dawnline.meter in Go, rule for rule).
//
// A point is made from two looks at the tunnels that are about a second apart. Bytes are the peers'
// counters: what was sent includes the disguise (prefixes, padding, junk), what was received is the
// packets without their prefix, so both are close to what is on the wire.
//
// Pure: looks in, points out. Who looks every second, and for whom, is the producer's.
package meter

import (
	"github.com/tickcount/luci-app-dawnline/backend/awg"
	"github.com/tickcount/luci-app-dawnline/backend/model"
)

// Points is how many are kept: two minutes, one a second.
const Points = 120

// Sample is one look, as the meter needs it.
type Sample struct {
	// Mono is a clock that only goes forward, in seconds with their fraction: the gap between two samples.
	Mono float64
	// TS is the router's clock (unix seconds): the point's name.
	TS int64
	// Servers are those whose tunnel was read.
	Servers []string
	// Dev is each device's counters on such a server.
	Dev map[string]Counters
}

// Counters are a device's bytes since its tunnel last added it, and the server it is on.
type Counters struct {
	Rx, Tx int64
	Server string
}

// Point is one second: bytes a second of each server's devices together (rx what came from them, tx what
// went to them), for every server whose tunnel was read, and of each device that moved something (one left
// out moved nothing).
type Point struct {
	TS      int64               `json:"ts"`
	Servers map[string][2]int64 `json:"servers"`
	Dev     map[string][2]int64 `json:"dev"`
}

// Take makes a sample of a look at the tunnels.
func Take(m *model.Model, d awg.Dump, mono float64, now int64) Sample {
	s := Sample{Mono: mono, TS: now, Servers: []string{}, Dev: map[string]Counters{}}
	read := map[string]bool{}
	for _, id := range m.ServerIDs() {
		if d.Reads[m.Servers[id].Ifname] == awg.Read {
			read[id] = true
			s.Servers = append(s.Servers, id)
		}
	}
	for _, id := range m.DeviceIDs() {
		dev := m.Devices[id]
		p := m.People[dev.Person]
		if p == nil || !read[p.Server] {
			continue
		}
		if peer, there := d.Peers[dev.PublicKey]; there {
			s.Dev[id] = Counters{Rx: peer.Rx, Tx: peer.Tx, Server: p.Server}
		}
	}
	return s
}

// delta is a counter's change, 0 when it went down (a tunnel set up again starts from zero).
func delta(a, b int64) int64 {
	if b >= a {
		return b - a
	}
	return 0
}

// Between is the point between two samples; ok is false when they are not a second or so apart (the first
// sample, a stalled watcher). A device is counted from its second sample on, on the server it was on in both.
func Between(a, b Sample) (Point, bool) {
	dt := b.Mono - a.Mono
	if !(dt > 0.2 && dt < 5) {
		return Point{}, false
	}
	sum := map[string][2]int64{}
	for _, sid := range b.Servers {
		sum[sid] = [2]int64{}
	}
	p := Point{TS: b.TS, Servers: map[string][2]int64{}, Dev: map[string][2]int64{}}
	for id, v := range b.Dev {
		o, had := a.Dev[id]
		if !had || o.Server != v.Server {
			continue
		}
		rx, tx := delta(o.Rx, v.Rx), delta(o.Tx, v.Tx)
		t := sum[v.Server]
		sum[v.Server] = [2]int64{t[0] + rx, t[1] + tx}
		if rx != 0 || tx != 0 {
			p.Dev[id] = [2]int64{int64(float64(rx) / dt), int64(float64(tx) / dt)}
		}
	}
	for sid, v := range sum {
		p.Servers[sid] = [2]int64{int64(float64(v[0]) / dt), int64(float64(v[1]) / dt)}
	}
	return p, true
}

// Keep adds a point to the ring (newest last) and returns it: at most Points of them, none older than
// Points seconds before the new one (the watcher may have stalled in between) and none from its second or
// later (the clock went back). `cut` tells that points were taken from the ring's end, so whoever shows the
// ring must show it anew, not only add the new point.
func Keep(ring []Point, p Point) (out []Point, cut bool) {
	for len(ring) > 0 && ring[len(ring)-1].TS >= p.TS {
		ring = ring[:len(ring)-1]
		cut = true
	}
	ring = append(ring, p)
	for len(ring) > Points || ring[0].TS <= p.TS-Points {
		ring = ring[1:]
	}
	return ring, cut
}
