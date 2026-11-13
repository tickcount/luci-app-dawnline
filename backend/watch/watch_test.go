package watch

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/awg"
	"github.com/tickcount/luci-app-dawnline/backend/hub"
)

const (
	keyPhone  = "HIgo9xNzJMWLKASShiTqIybxZ0U3wGLiUeJ1PKf8ykw="
	keyLaptop = "TrMvSoP4jYQlY6RIzBgbssQqY3vxI2Pi+y71lOWWXX0="
)

const settings = `
config settings 'settings'
	option geo_enabled '1'
config server 'home'
	option ifname 'dawn0'
	option subnet '10.77.0.0/24'
	option private_key 'k'
config person 'anna'
	option server 'home'
	option name 'Anna'
config device 'phone'
	option person 'anna'
	option name 'Phone'
	option kind 'phone'
	option public_key '` + keyPhone + `'
config device 'laptop'
	option person 'anna'
	option name 'Laptop'
	option kind 'computer'
	option public_key '` + keyLaptop + `'
`

// A router to watch: its state directories in a temporary one, its tunnel and its clocks in the test's hands.
type stand struct {
	t     *testing.T
	dir   string
	w     *Watcher
	now   int64
	peers map[string]awg.Peer
	wants bool
}

func (s *stand) Wants(string) bool { return s.wants }

func newStand(t *testing.T) *stand {
	dir := t.TempDir()
	s := &stand{t: t, dir: dir, now: 1_800_000_000, peers: map[string]awg.Peer{}}
	for _, d := range []string{"run", "data"} {
		os.MkdirAll(filepath.Join(dir, d), 0o755)
	}
	os.WriteFile(dir+"/config", []byte(settings), 0o600)
	s.w = &Watcher{
		Config: dir + "/config", RunDir: dir + "/run", DataDir: dir + "/data", DHCP: dir + "/dhcp", Leases: dir + "/leases",
		Hub: hub.New(), Audience: s,
		Now:  func() time.Time { return time.Unix(s.now, 0) },
		Mono: func() float64 { return float64(s.now) },
	}
	return s
}

// look moves the clock a second on and takes a look at the tunnel as it is set.
func (s *stand) look() {
	s.now++
	peers := map[string]awg.Peer{}
	for k, p := range s.peers {
		peers[k] = p
	}
	s.w.Tunnels = dumpOf(awg.Dump{OK: true, Reads: map[string]string{"dawn0": awg.Read}, Ifaces: map[string]awg.Iface{"dawn0": {Ifindex: 7}}, Peers: peers})
	s.w.Look()
}

// dumpOf is a reader that gives this look whatever it is asked for.
func dumpOf(d awg.Dump) awg.Reader {
	lines := ""
	// one interface line, then a peer a line, as `awg show <ifname> dump` prints them
	lines += "yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=\txTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=\t4500\toff\n"
	for key, p := range d.Peers {
		ep := p.Endpoint
		if ep == "" {
			ep = "(none)"
		}
		lines += key + "\t(none)\t" + ep + "\t10.77.0.2/32\t" + itoa(p.Handshake) + "\t" + itoa(p.Rx) + "\t" + itoa(p.Tx) + "\toff\n"
	}
	return awg.Reader{
		Show:  func(string) (string, bool) { return lines, true },
		Index: func(string) (int, bool) { return 7, true },
	}
}

func itoa(n int64) string {
	b, _ := json.Marshal(n)
	return string(b)
}

func (s *stand) read(name string, v any) bool {
	raw, err := os.ReadFile(s.dir + "/" + name)
	if err != nil {
		return false
	}
	if err := json.Unmarshal(raw, v); err != nil {
		s.t.Fatalf("%s is not JSON: %v", name, err)
	}
	return true
}

func TestConnectWritesWhatTheAgentWrote(t *testing.T) {
	s := newStand(t)
	// what the last watcher left, the places' cache and the leases
	os.WriteFile(s.dir+"/run/presence.json", []byte(`{"online":{"phone":false},"endpoint":{},"rev":40,"people":{"anna":12}}`), 0o600)
	os.WriteFile(s.dir+"/run/geo.json", []byte(`{"ips":{"203.0.113.7":{"city":"Krasnodar","org":"Rostelecom"},"198.51.100.4":{"fail":1}}}`), 0o600)
	os.WriteFile(s.dir+"/leases", []byte("1800000000 aa:bb:cc:dd:ee:ff 192.168.1.50 laptop-lan *\n"), 0o644)
	s.w.Start()
	s.look()
	var pres struct {
		Online   map[string]bool
		Endpoint map[string]string
		Rev      int64
		People   map[string]int64
	}
	// nobody came: nothing is written anew, the revision stands
	s.read("run/presence.json", &pres)
	if pres.Rev != 40 {
		t.Fatalf("the revision moved with nothing to tell: %d", pres.Rev)
	}
	if _, err := os.Stat(s.dir + "/run/backend.beat"); err != nil {
		t.Fatal("no beat: the agent's watcher would not stand by")
	}

	s.peers[keyLaptop] = awg.Peer{Handshake: s.now, Endpoint: "203.0.113.7:41821", Rx: 1000, Tx: 5000}
	s.look()
	s.read("run/presence.json", &pres)
	// as the agent: the revision moves when presence is saved, and again once the log has the event
	if !pres.Online["laptop"] || pres.Online["phone"] || pres.Endpoint["laptop"] != "203.0.113.7" || pres.Rev != 42 || pres.People["anna"] != 42 {
		t.Fatalf("presence: %+v", pres)
	}
	var events []map[string]any
	s.read("run/events.json", &events)
	want := []map[string]any{{
		"ts": float64(s.now), "type": "connect", "person": "anna", "device": "laptop", "detail": "203.0.113.7",
		"where": "Krasnodar · Rostelecom", "pname": "Anna", "dname": "Laptop", "dkind": "computer",
	}}
	if !reflect.DeepEqual(events, want) {
		t.Fatalf("the log: %v", events)
	}
	var u struct {
		Devices map[string]struct{ Total [2]float64 }
		People  map[string]struct{ Total [2]float64 }
	}
	s.read("run/usage.json", &u)
	if u.Devices["laptop"].Total != [2]float64{1000, 5000} || u.People["anna"].Total != [2]float64{1000, 5000} {
		t.Fatalf("the counters: %+v", u)
	}
	// the agent is asked for the place of an address that connected (the lookups stay with it)
	var asked []string
	if s.read("run/geo.poke", &asked); !reflect.DeepEqual(asked, []string{"203.0.113.7"}) {
		t.Fatalf("the addresses to locate: %v", asked)
	}
	// the stream has it too
	snap := s.w.Hub.Sync("", 0, nil)
	if on := snap.Docs["presence"].(map[string]any)["online"].(map[string]any); on["laptop"] != true {
		t.Fatalf("the presence topic: %v", snap.Docs["presence"])
	}

	// from an address at home: the lease's name goes with the event; a place that failed is no place
	s.peers[keyPhone] = awg.Peer{Handshake: s.now, Endpoint: "192.168.1.50:5000"}
	s.look()
	s.read("run/events.json", &events)
	last := events[len(events)-1]
	if last["device"] != "phone" || !reflect.DeepEqual(last["hosts"], map[string]any{"192.168.1.50": "laptop-lan"}) || last["where"] != nil {
		t.Fatalf("a connect from home: %v", last)
	}
}

func TestMeterOnlyWhileAsked(t *testing.T) {
	s := newStand(t)
	s.w.Start()
	s.peers[keyLaptop] = awg.Peer{Handshake: s.now, Endpoint: "203.0.113.7:1", Rx: 0, Tx: 0}
	for i := 0; i < 3; i++ {
		s.peers[keyLaptop] = awg.Peer{Handshake: s.peers[keyLaptop].Handshake, Endpoint: "203.0.113.7:1", Rx: int64(i) * 1000, Tx: int64(i) * 4000}
		s.look()
	}
	if _, err := os.Stat(s.dir + "/run/meter.json"); err == nil {
		t.Fatal("the meter is written with nobody looking")
	}
	// the stream has the points all the same: a page that starts looking draws its line at once
	if list, _ := s.w.Hub.Sync("", 0, nil).Docs["meter"].([]any); len(list) != 2 {
		t.Fatalf("the meter topic with nobody looking: %v", list)
	}
	s.wants = true
	s.peers[keyLaptop] = awg.Peer{Handshake: s.peers[keyLaptop].Handshake, Endpoint: "203.0.113.7:1", Rx: 3000, Tx: 12000}
	s.look()
	var m struct {
		TS     int64
		Points []struct {
			TS      int64
			Servers map[string][2]int64
			Dev     map[string][2]int64
		}
	}
	if !s.read("run/meter.json", &m) || m.TS != s.now || len(m.Points) != 3 {
		t.Fatalf("the meter: %+v", m)
	}
	// the points kept while nobody looked are there at once
	if p := m.Points[2]; p.Servers["home"] != [2]int64{1000, 4000} || p.Dev["laptop"] != [2]int64{1000, 4000} {
		t.Fatalf("the newest point: %+v", p)
	}
	if list, _ := s.w.Hub.Sync("", 0, nil).Docs["meter"].([]any); len(list) != 3 {
		t.Fatalf("the meter topic: %v", list)
	}
	s.wants = false
	s.look()
	if _, err := os.Stat(s.dir + "/run/meter.json"); err == nil {
		t.Fatal("the meter's file stays though nobody looks")
	}
	// asked for through the old door: the file whose age says so
	os.WriteFile(s.dir+"/run/meter.want", nil, 0o644)
	os.Chtimes(s.dir+"/run/meter.want", time.Unix(s.now, 0), time.Unix(s.now, 0))
	s.look()
	if _, err := os.Stat(s.dir + "/run/meter.json"); err != nil {
		t.Fatal("the meter is not written for the page that asks the old way")
	}
}

func TestPokeResetAndStop(t *testing.T) {
	s := newStand(t)
	os.WriteFile(s.dir+"/run/usage.json", []byte(`{"devices":{},"people":{"anna":{"total":[5,5],"days":{"2026-01-01":[5,5]}}},"updated":0,"flushed":0}`), 0o600)
	s.w.Start()
	s.look()
	// the agent's word that something changed for a person: their revision moves
	os.WriteFile(s.dir+"/run/presence.poke", []byte(`["anna"]`), 0o600)
	s.look()
	var pres struct {
		Rev    int64
		People map[string]int64
	}
	s.read("run/presence.json", &pres)
	if pres.Rev != 1 || pres.People["anna"] != 1 {
		t.Fatalf("after a poke: %+v", pres)
	}
	if _, err := os.Stat(s.dir + "/run/presence.poke"); err == nil {
		t.Fatal("the poke was not taken away")
	}
	// a reset asked for from the admin is applied within the minute, and put on flash at once
	os.WriteFile(s.dir+"/run/usage.reset", []byte(`{"scope":"person","id":"anna"}`), 0o600)
	s.now += 60
	s.look()
	var u struct {
		People  map[string]map[string]any
		Flushed float64
	}
	if !s.read("data/usage.json", &u) || u.People["anna"]["total"] != nil || u.Flushed != float64(s.now) {
		t.Fatalf("after a reset: %+v", u)
	}
	s.w.Stop()
	if _, err := os.Stat(s.dir + "/run/backend.beat"); err == nil {
		t.Fatal("the beat stays after a stop: the agent's watcher would not take over")
	}
}

func TestResetUsageNow(t *testing.T) {
	s := newStand(t)
	if s.w.ResetUsage("all", "") {
		t.Fatal("reset before the first look")
	}
	os.WriteFile(s.dir+"/run/usage.json", []byte(`{"devices":{"laptop":{"total":[7,7],"days":{"2026-01-01":[7,7]}}},"people":{"anna":{"total":[9,9],"days":{"2026-01-01":[9,9]}}},"updated":0,"flushed":0}`), 0o600)
	s.w.Start()
	s.look()
	told := 0
	s.w.Changed = func() { told++ }
	if !s.w.ResetUsage("device", "laptop") {
		t.Fatal("not reset")
	}
	var u struct {
		Devices map[string]map[string]any
		People  map[string]map[string]any
		Flushed float64
	}
	// on flash at once, the person's own totals untouched, and the pages told
	if !s.read("data/usage.json", &u) || u.Devices["laptop"]["total"] != nil || u.People["anna"]["total"] == nil || u.Flushed != float64(s.now) || told != 1 {
		t.Fatalf("after a device's reset: %+v, told %d", u, told)
	}
}

// A look asked for before the watcher started (whoever tells the topics may ask at any moment) does nothing.
func TestLookBeforeStart(t *testing.T) {
	s := newStand(t)
	s.w.Look()
	if s.w.World() != nil {
		t.Fatal("a world before the watcher started")
	}
	s.w.Start()
	s.look()
	if s.w.World() == nil {
		t.Fatal("no world after the first look")
	}
}
