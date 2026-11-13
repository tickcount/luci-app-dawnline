package presence

import (
	"reflect"
	"testing"

	"github.com/tickcount/luci-app-dawnline/backend/awg"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
)

const (
	keyPhone  = "HIgo9xNzJMWLKASShiTqIybxZ0U3wGLiUeJ1PKf8ykw="
	keyLaptop = "TrMvSoP4jYQlY6RIzBgbssQqY3vxI2Pi+y71lOWWXX0="
	keyNew    = "u4pL0000000000000000000000000000000000DyRrM="
)

func settings(t *testing.T, phoneKey string) *model.Model {
	c, err := uci.Parse(`
config server 'home'
	option ifname 'dawn0'
	option subnet '10.77.0.0/24'
	option private_key 'k'
config person 'anna'
	option server 'home'
config device 'phone'
	option person 'anna'
	option kind 'phone'
	option public_key '` + phoneKey + `'
config device 'laptop'
	option person 'anna'
	option kind 'computer'
	option public_key '` + keyLaptop + `'
`)
	if err != nil {
		t.Fatal(err)
	}
	return model.Load(c, nil)
}

// A look at the tunnel: its link's index, and the peers with their handshake and where they spoke from.
func look(index int, peers map[string]awg.Peer) awg.Dump {
	d := awg.Dump{OK: true, Reads: map[string]string{"dawn0": awg.Read}, Ifaces: map[string]awg.Iface{"dawn0": {Ifindex: index}}, Peers: peers}
	if index == 0 {
		d.Reads["dawn0"] = awg.Down
		d.Ifaces = map[string]awg.Iface{}
	}
	return d
}

func TestConnectRoamDisconnect(t *testing.T) {
	m := settings(t, keyPhone)
	w := New(nil, nil)
	at := func(now, handshake int64, from string) Seen {
		return w.Look(m, look(7, map[string]awg.Peer{keyLaptop: {Handshake: handshake, Endpoint: from}, keyPhone: {}}), now, nil)
	}
	// never shook hands: nothing
	if s := at(1000, 0, ""); len(s.Events) != 0 || len(s.People) != 0 {
		t.Fatalf("idle: %+v", s)
	}
	s := at(1010, 1005, "203.0.113.7:41821")
	if !reflect.DeepEqual(s.Events, []Event{{Type: Connect, Person: "anna", Device: "laptop", Detail: "203.0.113.7"}}) ||
		!reflect.DeepEqual(s.People, []string{"anna"}) || !reflect.DeepEqual(s.Addresses, []string{"203.0.113.7"}) {
		t.Fatalf("connect: %+v", s)
	}
	// still there, nothing new
	if s := at(1100, 1005, "203.0.113.7:41821"); len(s.Events) != 0 || len(s.People) != 0 {
		t.Fatalf("steady: %+v", s)
	}
	s = at(1120, 1110, "[2001:db8::1]:500")
	if len(s.Events) != 1 || s.Events[0].Type != Roam || s.Events[0].Detail != "203.0.113.7 → 2001:db8::1" || len(s.People) != 1 {
		t.Fatalf("roam: %+v", s)
	}
	// a computer's window is 190 s from its handshake
	if s := at(1110+189, 1110, "[2001:db8::1]:500"); len(s.Events) != 0 {
		t.Fatalf("within its window: %+v", s)
	}
	s = at(1110+190, 1110, "[2001:db8::1]:500")
	if !reflect.DeepEqual(s.Events, []Event{{Type: Disconnect, Person: "anna", Device: "laptop"}}) || w.Online["laptop"] {
		t.Fatalf("disconnect: %+v", s)
	}
	if w.Endpoint["laptop"] != "2001:db8::1" {
		t.Fatalf("the last address is kept: %v", w.Endpoint)
	}
}

// A phone sleeps through its keep-alives: ten minutes, not three.
func TestPhoneSleeps(t *testing.T) {
	m := settings(t, keyPhone)
	w := New(nil, nil)
	at := func(now int64) Seen {
		return w.Look(m, look(7, map[string]awg.Peer{keyPhone: {Handshake: 1000, Endpoint: "198.51.100.4:9"}}), now, nil)
	}
	at(1001)
	if s := at(1000 + 599); len(s.Events) != 0 || !w.Online["phone"] {
		t.Fatalf("asleep: %+v", s)
	}
	if s := at(1000 + 600); len(s.Events) != 1 || s.Events[0].Type != Disconnect {
		t.Fatalf("gone: %+v", s)
	}
}

// One configuration on two devices: its address goes back and forth, which is no roaming.
func TestSharedConfigurationDoesNotRoam(t *testing.T) {
	m := settings(t, keyPhone)
	w := New(nil, nil)
	w.Look(m, look(7, map[string]awg.Peer{keyLaptop: {Handshake: 1000, Endpoint: "203.0.113.7:1"}}), 1001, nil)
	s := w.Look(m, look(7, map[string]awg.Peer{keyLaptop: {Handshake: 1010, Endpoint: "198.51.100.4:1"}}), 1011, func(string, *awg.Peer, bool, bool) bool { return true })
	if len(s.Events) != 0 || len(s.People) != 0 {
		t.Fatalf("shared: %+v", s)
	}
}

// The tunnel set up again: its devices are missing for a while and come back without a handshake.
func TestTunnelSetUpAgain(t *testing.T) {
	m := settings(t, keyPhone)
	w := New(nil, nil)
	w.Look(m, look(7, map[string]awg.Peer{keyLaptop: {Handshake: 1000, Endpoint: "203.0.113.7:1"}}), 1001, nil)
	// a new link, no peers yet, then peers with no handshake: still online within the grace and its window
	if s := w.Look(m, look(8, map[string]awg.Peer{}), 1010, nil); len(s.Events) != 0 || !w.Online["laptop"] {
		t.Fatalf("set up again: %+v", s)
	}
	if s := w.Look(m, look(8, map[string]awg.Peer{keyLaptop: {}}), 1030, nil); len(s.Events) != 0 || !w.Online["laptop"] {
		t.Fatalf("back without a handshake: %+v", s)
	}
	// past the grace, a device that is not in the tunnel is offline at once
	if s := w.Look(m, look(8, map[string]awg.Peer{}), 1010+RestartGrace+1, nil); len(s.Events) != 1 || s.Events[0].Type != Disconnect {
		t.Fatalf("removed: %+v", s)
	}
}

func TestUnreadTunnelSaysNothing(t *testing.T) {
	m := settings(t, keyPhone)
	w := New(nil, nil)
	w.Look(m, look(7, map[string]awg.Peer{keyLaptop: {Handshake: 1000, Endpoint: "203.0.113.7:1"}}), 1001, nil)
	failed := awg.Dump{Reads: map[string]string{"dawn0": awg.Failed}, Ifaces: map[string]awg.Iface{}, Peers: map[string]awg.Peer{}}
	if s := w.Look(m, failed, 5000, nil); len(s.Events) != 0 || !w.Online["laptop"] {
		t.Fatalf("an unread tunnel changed something: %+v", s)
	}
}

// New keys end the old session, whatever its handshake said; a removed device is forgotten.
func TestNewKeysAndRemoval(t *testing.T) {
	w := New(nil, nil)
	w.Look(settings(t, keyPhone), look(7, map[string]awg.Peer{keyPhone: {Handshake: 1000, Endpoint: "198.51.100.4:9"}}), 1001, nil)
	s := w.Look(settings(t, keyNew), look(7, map[string]awg.Peer{keyNew: {}}), 1002, nil)
	if !reflect.DeepEqual(s.Rekeyed, []string{"phone"}) || len(s.Events) != 1 || s.Events[0].Type != Disconnect {
		t.Fatalf("new keys: %+v", s)
	}
	c, _ := uci.Parse("config server 'home'\n")
	w.Look(model.Load(c, nil), look(7, nil), 1003, nil)
	if len(w.Online) != 0 || len(w.Endpoint) != 0 {
		t.Fatalf("removed devices are kept: %+v %+v", w.Online, w.Endpoint)
	}
}

// What was kept of the last run: a device online then is not a new connect now.
func TestRestartKeepsWhoWasOnline(t *testing.T) {
	m := settings(t, keyPhone)
	w := New(map[string]bool{"laptop": true}, map[string]string{"laptop": "203.0.113.7"})
	if s := w.Look(m, look(7, map[string]awg.Peer{keyLaptop: {Handshake: 1000, Endpoint: "203.0.113.7:1"}}), 1001, nil); len(s.Events) != 0 {
		t.Fatalf("a restart logged a connect: %+v", s)
	}
}
