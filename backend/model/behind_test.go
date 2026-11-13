package model

import (
	"reflect"
	"testing"

	"github.com/tickcount/luci-app-dawnline/backend/ipnet"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
)

func TestWhatMayStandBehindARouter(t *testing.T) {
	for _, c := range []struct{ in, net, why string }{
		{"192.168.2.0/24", "192.168.2.0/24", ""},
		{"192.168.2.7/24", "192.168.2.0/24", ""},
		{"10.5.0.0/16", "10.5.0.0/16", ""},
		{"172.31.255.0/30", "172.31.255.0/30", ""},
		{"192.168.2.0", "", "form"},
		{"192.168.2.0/31", "", "form"},
		{"192.168.2.0/24 ", "", "form"},
		{"home", "", "form"},
		{"", "", "form"},
		{"10.0.0.0/8", "", "wide"},
		{"10.4.0.0/15", "", "wide"},
		{"8.8.8.0/24", "", "public"},
		{"172.32.0.0/24", "", "public"},
		{"100.64.0.0/24", "", "public"},
		{"169.254.1.0/24", "", "public"},
	} {
		n, why := BehindNet(c.in)
		if why != c.why || (why == "" && n.String() != c.net) {
			t.Errorf("%q: %s %q, want %s %q", c.in, n, why, c.net, c.why)
		}
	}
}

// A household for the networks behind routers: two servers, one that keeps devices within circles.
const sites = `
config server 'home'
	option subnet '10.77.0.0/24'
	option mesh 'all'

config server 'cabin'
	option subnet '10.78.0.0/24'
	option mesh 'circles'

config circle 'fam'
	option server 'cabin'

config person 'anna'
	option server 'home'
	option access 'both'

config person 'boris'
	option server 'home'
	option access 'lan'

config person 'clara'
	option server 'home'
	option access 'internet'

config person 'eva'
	option server 'home'
	option access 'lan'
	list service 'nas'

config person 'hana'
	option server 'cabin'
	option access 'both'
	option circle 'fam'

config person 'ivan'
	option server 'cabin'
	option access 'both'
	option circle 'fam'

config person 'kira'
	option server 'cabin'
	option access 'both'

config device 'r1'
	option person 'anna'
	option kind 'router'
	option address '10.77.0.2'
	list behind_net '192.168.2.9/24'
	list behind_net '10.77.0.128/25'
	list behind_net 'the garage'
	list behind_net '192.168.2.128/25'
	list behind_net '192.168.50.0/24'
	list behind_net '10.78.0.0/16'

config device 'phone'
	option person 'anna'
	option address '10.77.0.3'
	list behind_net '192.168.9.0/24'

config device 'r2'
	option person 'boris'
	option kind 'router'
	option address '10.77.0.4'
	list behind_net '192.168.2.0/23'
	list behind_net '172.16.9.0/24'

config device 'r3'
	option person 'clara'
	option kind 'router'
	option address '10.77.0.5'
	option behind_net '192.168.30.0/24'

config device 'r4'
	option person 'eva'
	option kind 'router'
	option address '10.77.0.6'
	list behind_net '192.168.40.0/24'

config device 'r5'
	option person 'hana'
	option kind 'router'
	option address '10.78.0.2'
	list behind_net '192.168.60.0/24'

config device 'iphone'
	option person 'ivan'
	option address '10.78.0.3'

config device 'kphone'
	option person 'kira'
	option address '10.78.0.4'
`

func household(t *testing.T, text string) *Model {
	t.Helper()
	c, err := uci.Parse(text)
	if err != nil {
		t.Fatal(err)
	}
	return Load(c, nil)
}

func TestNetworksInEffect(t *testing.T) {
	m := household(t, sites)
	// the router has 192.168.50.0/24 itself; a tunnel's subnet is never behind anyone; r1 came first
	got := m.BehindOf([]string{"192.168.50.0/24", "192.168.77.0/24"})
	want := map[string][]string{"r1": {"192.168.2.0/24"}, "r2": {"172.16.9.0/24"}, "r3": {"192.168.30.0/24"}, "r4": {"192.168.40.0/24"}, "r5": {"192.168.60.0/24"}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("in effect: %v, want %v", got, want)
	}
	// what the router has itself is not known: only the settings speak
	if got := m.BehindOf(nil)["r1"]; !reflect.DeepEqual(got, []string{"192.168.2.0/24", "192.168.50.0/24"}) {
		t.Errorf("r1 with nothing known of the router: %v", got)
	}
	// more than a router may have: the first BehindMost count
	many := "config server 's'\n\toption subnet '10.77.0.0/24'\n\nconfig person 'p'\n\toption server 's'\n\nconfig device 'r'\n\toption person 'p'\n\toption kind 'router'\n"
	for i := 0; i < BehindMost+3; i++ {
		many += "\tlist behind_net '192.168." + string(rune('0'+i/10)) + string(rune('0'+i%10)) + ".0/24'\n"
	}
	if got := household(t, many).BehindOf(nil)["r"]; len(got) != BehindMost || got[BehindMost-1] != "192.168.7.0/24" {
		t.Errorf("over the most: %v", got)
	}
}

func TestWhatANetworkRunsInto(t *testing.T) {
	m := household(t, sites)
	own := []string{"192.168.50.0/24"}
	for _, c := range []struct {
		net, device string
		want        *Clash
	}{
		{"192.168.70.0/24", "", nil},
		{"10.77.0.0/25", "", &Clash{Net: "10.77.0.0/24", Server: "home"}},
		{"10.78.0.0/16", "", &Clash{Net: "10.78.0.0/24", Server: "cabin"}},
		{"192.168.50.128/25", "", &Clash{Net: "192.168.50.0/24"}},
		{"192.168.60.0/24", "", &Clash{Net: "192.168.60.0/24", Device: "r5"}},
		// its own network is no clash
		{"192.168.60.0/24", "r5", nil},
		{"172.16.0.0/16", "r5", &Clash{Net: "172.16.9.0/24", Device: "r2"}},
	} {
		n, _ := ipnet.Any(c.net)
		if got := m.BehindClash(n, c.device, own); !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s for %q: %+v, want %+v", c.net, c.device, got, c.want)
		}
	}
}

func TestWhoReachesWhatIsBehind(t *testing.T) {
	m := household(t, sites)
	behind := m.BehindOf([]string{"192.168.50.0/24"})
	for _, c := range []struct {
		person, device string
		want           []string
	}{
		// everyone reaches everyone on the server: every network of people who are part of home, but its own
		{"anna", "phone", []string{"192.168.2.0/24", "172.16.9.0/24"}},
		{"anna", "r1", []string{"172.16.9.0/24"}},
		{"boris", "r2", []string{"192.168.2.0/24"}},
		// the internet alone, or a few home services: no part of home
		{"clara", "r3", nil},
		{"eva", "r4", nil},
		// within circles: the circle's router, and nobody else's
		{"ivan", "iphone", []string{"192.168.60.0/24"}},
		{"kira", "kphone", nil},
		{"hana", "r5", nil},
	} {
		if got := m.BehindReach(m.People[c.person], c.device, behind); !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s's %s reaches %v, want %v", c.person, c.device, got, c.want)
		}
	}
	m.Servers["home"].Mesh = "off"
	if got := m.BehindReach(m.People["anna"], "phone", behind); got != nil {
		t.Errorf("devices do not reach each other, yet anna's phone reaches %v", got)
	}
}

// What a router's owner asked for is read with the router, means nothing on another kind of device, and is
// in effect nowhere while the router waits.
func TestRequestsAsWritten(t *testing.T) {
	m := household(t, sites+`
config device 'r6'
	option person 'kira'
	option kind 'router'
	option address '10.78.0.5'
	option waiting '1'
	option asked '1700000000'
	list ask_net '192.168.61.0/24'
	list behind_net '192.168.62.0/24'

config device 'r7'
	option person 'kira'
	option kind 'router'
	option address '10.78.0.6'
	option declined 'because'
	list declined_net '192.168.63.0/24'

config device 'tablet'
	option person 'kira'
	option kind 'tablet'
	option address '10.78.0.7'
	option waiting '1'
	option declined 'talk'
	list ask_net '192.168.64.0/24'
`)
	r6, r7, tablet := m.Devices["r6"], m.Devices["r7"], m.Devices["tablet"]
	if !r6.Waiting || r6.Asked != 1700000000 || !reflect.DeepEqual(r6.Ask, []string{"192.168.61.0/24"}) || r6.Declined != "" {
		t.Errorf("a router that waits: %+v", r6)
	}
	if r7.Waiting || r7.Declined != "plain" || !reflect.DeepEqual(r7.DeclinedNets, []string{"192.168.63.0/24"}) || r7.Asked != 0 {
		t.Errorf("a network turned down for a reason nobody knows: %+v", r7)
	}
	if tablet.Waiting || tablet.Ask != nil || tablet.Declined != "" {
		t.Errorf("a tablet asks for nothing: %+v", tablet)
	}
	if got := m.BehindOf(nil)["r6"]; got != nil {
		t.Errorf("a waiting router's network is in effect: %v", got)
	}
	if m.Servers["home"].PortalRouters != "ask" || m.Servers["home"].PortalNets != "ask" {
		t.Errorf("the rules a server starts with: %q, %q", m.Servers["home"].PortalRouters, m.Servers["home"].PortalNets)
	}
	set := household(t, "config server 's'\n\toption portal_routers 'free'\n\toption portal_nets 'free'\n\nconfig server 'o'\n\toption portal_routers 'off'\n\toption portal_nets 'never'\n")
	if s, o := set.Servers["s"], set.Servers["o"]; s.PortalRouters != "free" || s.PortalNets != "free" || o.PortalRouters != "off" || o.PortalNets != "ask" {
		t.Errorf("the rules as set: %+v, %+v", s, o)
	}
}
