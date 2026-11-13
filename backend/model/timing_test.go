package model

import "testing"

func ka(n int) *Device { return &Device{Keepalive: &n} }

// The cases of tests/ucode/awg.test.uc («keepalive_range and idle_handshake») and live.test.uc's windows.
func TestKeepaliveAndIdleHandshake(t *testing.T) {
	srv := &Server{Keepalive: 25, Obf: map[string]string{}}
	jittered := &Server{Keepalive: 25, Obf: map[string]string{"header_protection_key": "k", "rekey_after_time": "100-120"}}
	rng := func(s *Server, d *Device) [3]int {
		lo, hi, ok := KeepaliveRange(s, d)
		if !ok {
			return [3]int{-1, -1, 0}
		}
		return [3]int{lo, hi, 1}
	}
	for name, c := range map[string]struct {
		got, want [3]int
	}{
		"the server's, no range":         {rng(srv, &Device{}), [3]int{25, 25, 1}},
		"the device's own":               {rng(srv, ka(120)), [3]int{120, 120, 1}},
		"off for the device":             {rng(srv, ka(0)), [3]int{-1, -1, 0}},
		"off on the server":              {rng(&Server{Obf: map[string]string{}}, &Device{}), [3]int{-1, -1, 0}},
		"jittered with 3.1":              {rng(jittered, &Device{}), [3]int{25, 35, 1}},
		"the device's own, jittered":     {rng(jittered, ka(60)), [3]int{60, 70, 1}},
		"out of range: the server's own": {rng(srv, ka(9999)), [3]int{25, 25, 1}},
	} {
		if c.got != c.want {
			t.Errorf("%s: %v, want %v", name, c.got, c.want)
		}
	}
	idle := func(s *Server, d *Device) int {
		h, ok := IdleHandshake(s, d)
		if !ok {
			return -1
		}
		return h
	}
	for name, c := range map[string][2]int{
		"within the rekey time: up to one keep-alive past it":  {idle(srv, &Device{}), 145},
		"Maximum: RekeyAfterTime 100-120, keep-alive up to 35": {idle(jittered, &Device{}), 155},
		"every second keep-alive":                              {idle(srv, ka(100)), 220},
		"every keep-alive once they are further apart":         {idle(srv, ka(300)), 300},
		"past 180 s the key is refused anyway":                 {idle(&Server{Keepalive: 25, Obf: map[string]string{"rekey_after_time": "200-400"}}, &Device{}), 205},
		"keep-alive off":                                       {idle(srv, ka(0)), -1},
	} {
		if c[0] != c[1] {
			t.Errorf("%s: %d, want %d", name, c[0], c[1])
		}
	}
}

func TestOnlineWindow(t *testing.T) {
	srv := &Server{Keepalive: 25, Obf: map[string]string{}}
	for name, c := range map[string][2]int{
		"a computer with the usual keep-alive":            {OnlineWindowOf(srv, &Device{Kind: "computer"}), 190},
		"a long keep-alive: 30 s past its next handshake": {OnlineWindowOf(srv, &Device{Kind: "computer", Keepalive: ka(300).Keepalive}), 330},
		"a phone sleeps": {OnlineWindowOf(srv, &Device{Kind: "phone"}), 600},
		"a tablet too":   {OnlineWindowOf(srv, &Device{Kind: "tablet"}), 600},
		"no server":      {OnlineWindowOf(nil, &Device{Kind: "router"}), 190},
	} {
		if c[0] != c[1] {
			t.Errorf("%s: %d, want %d", name, c[0], c[1])
		}
	}
}

func TestTunnels(t *testing.T) {
	good := &Server{ID: "home", Ifname: "dawn0", Subnet: "10.77.0.0/24", PrivateKey: "k", Enabled: true}
	if tn, ok := TunnelOf(good); !ok || tn.Address != "10.77.0.1" || tn.Ifname != "dawn0" {
		t.Fatalf("tunnel: %+v %v", tn, ok)
	}
	for name, s := range map[string]*Server{
		"no keys":            {Ifname: "dawn0", Subnet: "10.77.0.0/24"},
		"kept down":          {Ifname: "dawn0", Subnet: "10.77.0.0/24", PrivateKey: "k", Blocked: "taken"},
		"a bad name":         {Ifname: "Dawn-0", Subnet: "10.77.0.0/24", PrivateKey: "k"},
		"no subnet":          {Ifname: "dawn0", PrivateKey: "k"},
		"a host, not a net":  {Ifname: "dawn0", Subnet: "10.77.0.1", PrivateKey: "k"},
		"too small a subnet": {Ifname: "dawn0", Subnet: "10.77.0.0/31", PrivateKey: "k"},
	} {
		if _, ok := TunnelOf(s); ok {
			t.Errorf("%s: has a tunnel", name)
		}
	}
	m := &Model{Servers: map[string]*Server{"home": good, "off": {Ifname: "dawn1", Subnet: "10.78.0.0/24", PrivateKey: "k"}}, serverIDs: []string{"off", "home"}}
	if got := m.TunnelIfnames(); len(got) != 1 || got[0] != "dawn0" {
		t.Fatalf("ifnames: %v", got)
	}
}
