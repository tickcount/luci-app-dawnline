package resolve

import (
	"context"
	"reflect"
	"sync/atomic"
	"testing"
	"time"
)

func TestAddresses(t *testing.T) {
	var asked atomic.Int32
	now := time.Unix(1_800_000_000, 0)
	r := &Resolver{Now: func() time.Time { return now }, Lookup: func(_ context.Context, server, network, host string) []string {
		asked.Add(1)
		switch {
		case host == "vpn.example.org" && server == "8.8.8.8" && network == "ip4":
			return []string{"203.0.113.7"}
		case host == "vpn.example.org" && server == "8.8.8.8" && network == "ip6":
			return []string{"2001:db8::7"}
		// the router's own resolver rewrites the name: it is believed only when the public ones say nothing
		case host == "vpn.example.org" && server == "127.0.0.1" && network == "ip4":
			return []string{"192.168.1.1"}
		case host == "six.example.org" && server == "1.1.1.1" && network == "ip6":
			return []string{"2001:db8::6"}
		case host == "home.lan" && server == "127.0.0.1" && network == "ip4":
			return []string{"192.168.1.20"}
		}
		return nil
	}}
	for host, want := range map[string][]string{
		"vpn.example.org": {"203.0.113.7", "2001:db8::7"}, "six.example.org": {"2001:db8::6"}, "home.lan": {"192.168.1.20"},
		"nowhere.example": nil, "198.51.100.4": {"198.51.100.4"}, "2001:db8::1": {"2001:db8::1"}, "not a name": nil, "": nil,
	} {
		if got := r.Addresses(host); !reflect.DeepEqual(got, want) {
			t.Errorf("%q: %v", host, got)
		}
	}
	if r.HostIP("vpn.example.org") != "203.0.113.7" || r.HostIP("six.example.org") != "2001:db8::6" || r.HostIP("nowhere.example") != "" {
		t.Fatal("HostIP")
	}
	// kept: an answer five minutes, a failure one
	n := asked.Load()
	now = now.Add(4 * time.Minute)
	r.Addresses("vpn.example.org")
	if asked.Load() != n {
		t.Fatal("asked again within five minutes")
	}
	r.Addresses("nowhere.example")
	if asked.Load() == n {
		t.Fatal("a failure was kept longer than a minute")
	}
	n = asked.Load()
	now = now.Add(2 * time.Minute)
	if r.Addresses("vpn.example.org"); asked.Load() == n {
		t.Fatal("an answer was kept longer than five minutes")
	}
}
