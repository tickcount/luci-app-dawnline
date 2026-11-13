package meter

import (
	"reflect"
	"testing"

	"github.com/tickcount/luci-app-dawnline/backend/awg"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
)

const (
	keyA = "HIgo9xNzJMWLKASShiTqIybxZ0U3wGLiUeJ1PKf8ykw="
	keyB = "TrMvSoP4jYQlY6RIzBgbssQqY3vxI2Pi+y71lOWWXX0="
)

func settings(t *testing.T) *model.Model {
	c, err := uci.Parse(`
config server 'home'
	option ifname 'dawn0'
config server 'cabin'
	option ifname 'dawn1'
config person 'anna'
	option server 'home'
config person 'boris'
	option server 'cabin'
config device 'a'
	option person 'anna'
	option public_key '` + keyA + `'
config device 'b'
	option person 'boris'
	option public_key '` + keyB + `'
`)
	if err != nil {
		t.Fatal(err)
	}
	return model.Load(c, nil)
}

func dump(reads map[string]string, peers map[string]awg.Peer) awg.Dump {
	return awg.Dump{OK: true, Reads: reads, Peers: peers}
}

func TestPoint(t *testing.T) {
	m := settings(t)
	both := map[string]string{"dawn0": awg.Read, "dawn1": awg.Read}
	a := Take(m, dump(both, map[string]awg.Peer{keyA: {Rx: 1000, Tx: 5000}, keyB: {Rx: 10, Tx: 10}}), 100.0, 1000)
	b := Take(m, dump(both, map[string]awg.Peer{keyA: {Rx: 3000, Tx: 9000}, keyB: {Rx: 10, Tx: 10}}), 102.0, 1002)
	p, ok := Between(a, b)
	want := Point{TS: 1002, Servers: map[string][2]int64{"home": {1000, 2000}, "cabin": {0, 0}}, Dev: map[string][2]int64{"a": {1000, 2000}}}
	if !ok || !reflect.DeepEqual(p, want) {
		t.Fatalf("point: %+v %v", p, ok)
	}
	// a tunnel that could not be read is not in the point at all; its device neither
	c := Take(m, dump(map[string]string{"dawn0": awg.Read, "dawn1": awg.Failed}, map[string]awg.Peer{keyA: {Rx: 3000, Tx: 9000}, keyB: {Rx: 99, Tx: 99}}), 103.0, 1003)
	p, _ = Between(b, c)
	if _, has := p.Servers["cabin"]; has || len(p.Dev) != 0 || p.Servers["home"] != [2]int64{0, 0} {
		t.Fatalf("an unread tunnel: %+v", p)
	}
	// counters that went down (the tunnel set up again) count as nothing, not as a negative speed
	d := Take(m, dump(both, map[string]awg.Peer{keyA: {Rx: 5, Tx: 5}}), 104.0, 1004)
	if p, _ := Between(c, d); p.Servers["home"] != [2]int64{0, 0} {
		t.Fatalf("a reset counter: %+v", p)
	}
}

func TestNoPointAcrossAGap(t *testing.T) {
	m := settings(t)
	one := map[string]string{"dawn0": awg.Read}
	a := Take(m, dump(one, nil), 100, 1000)
	for _, mono := range []float64{100.1, 106} {
		if _, ok := Between(a, Take(m, dump(one, nil), mono, 1001)); ok {
			t.Errorf("a point over %.1f s", mono-100)
		}
	}
}

func TestKeep(t *testing.T) {
	var ring []Point
	for ts := int64(1); ts <= 130; ts++ {
		ring, _ = Keep(ring, Point{TS: ts})
	}
	if len(ring) != Points || ring[0].TS != 11 || ring[len(ring)-1].TS != 130 {
		t.Fatalf("ring: %d points, %d to %d", len(ring), ring[0].TS, ring[len(ring)-1].TS)
	}
	// the watcher stalled: what is older than two minutes before the new point goes
	ring, cut := Keep(ring, Point{TS: 300})
	if len(ring) != 1 || cut {
		t.Fatalf("after a stall: %d points, cut %v", len(ring), cut)
	}
	// the clock went back: points from that second or later go, and whoever shows the ring is told
	ring, _ = Keep(ring, Point{TS: 301})
	ring, cut = Keep(ring, Point{TS: 300})
	if len(ring) != 1 || ring[0].TS != 300 || !cut {
		t.Fatalf("after the clock went back: %+v, cut %v", ring, cut)
	}
}
