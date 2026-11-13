package health

import (
	"strings"
	"testing"

	"github.com/tickcount/luci-app-dawnline/backend/endpoint"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
)

const settings = `
config settings 'settings'
	option portal_enabled '1'
	option portal_port '4500'
	option portal_host 'vpn.example.org'
	list portal_alt '203.0.113.7'
config server 'home'
	option name 'Home'
	option ifname 'dawn0'
	option port '4500'
	option subnet '10.77.0.0/24'
	option private_key 'k'
	option endpoint 'vpn.example.org'
config server 'cabin'
	option name 'Cabin'
	option ifname 'dawn1'
	option port '4600'
	option subnet '10.78.0.0/24'
	option enabled '0'
config person 'anna'
	option server 'home'
	option access 'both'
`

// a router where everything is as it should be
func healthy(t *testing.T) Inputs {
	c, err := uci.Parse(settings)
	if err != nil {
		t.Fatal(err)
	}
	fw, _ := uci.Parse("config rule 'dawnline_home_port'\nconfig zone 'dawnline_home_zone'\n")
	network, _ := uci.Parse("config interface 'dawn0'\n\toption proto 'amneziawg'\n\toption listen_port '4500'\n")
	free, age := int64(40960), int64(600)
	return Inputs{
		M: model.Load(c, nil), Loaded: true, Handler: true, Year: 2027, AgentRunning: true, FreeKB: &free, NftLoaded: true,
		ModelErrors: func() []string { return nil }, Firewall: fw, Network: network,
		Iface:   func(string) Iface { return Iface{Exists: true, Up: true} },
		Unread:  func(string) bool { return false },
		Peers:   func(*model.Server) Peers { return Peers{Expected: 2, Loaded: 2} },
		Replies: &Replies{OK: true}, Subnets: []Subnet{{"lan", "192.168.77.1/24"}, {"dawn0", "10.77.0.1/24"}},
		HomeNets: func(*model.Server) []string { return []string{"192.168.77.0/24"} },
		Endpoint: func(*model.Server, string) endpoint.Reads {
			return endpoint.Reads{IPs: []string{"203.0.113.7"}, WAN: "203.0.113.7"}
		},
		LikeHome: map[string]any{"active": true, "bridged": true, "dev": "br-lan", "address": "192.168.77.9", "transit": "169.254.7.2"},
		Needs:    map[string][]string{}, ResolverConfAge: &age, ResolverRunning: true,
		Portal: func() Portal {
			return Portal{Listening: true, IPs: []string{"203.0.113.7"}, WAN: "203.0.113.7", Cert: "/etc/ssl/acme/x.crt", Valid: true, Names: []string{"*.example.org"}}
		},
	}
}

func byID(list []Check) map[string]Check {
	out := map[string]Check{}
	for _, c := range list {
		out[c.ID] = c
	}
	return out
}

func TestAHealthyRouter(t *testing.T) {
	list := Run(healthy(t))
	var ids []string
	for _, c := range list {
		ids = append(ids, c.ID)
		// the plain HTTP links are a standing warning, the server turned off is skipped
		want := "ok"
		switch c.ID {
		case "portal_http":
			want = "warn"
		case "srv_cabin":
			want = "skip"
		}
		if c.Status != want || (c.Status == "ok") != (c.Problem == nil && c.Fix == nil) && c.ID != "srv_cabin" {
			t.Errorf("%s: %s %q fix %v problem %v", c.ID, c.Status, c.Detail, c.Fix, c.Problem)
		}
	}
	want := "awg clock agent flash nft policy data up_home peers_home fw_home reply_home subnet_home homenet_home ep_home home_home srv_cabin resolver portal portal_dns portal_reply portal_http cert"
	if got := strings.Join(ids, " "); got != want {
		t.Fatalf("the checks and their order:\n %s\n %s", got, want)
	}
	// two servers: each check of a server carries its name
	if c := byID(list)["up_home"]; c.Title != "Tunnel running (Home)" || c.Detail != "dawn0 is up, listening on UDP 4500." {
		t.Fatalf("a server's check: %+v", c)
	}
}

func TestWhatGoesWrong(t *testing.T) {
	for name, c := range map[string]struct {
		break_ func(in *Inputs)
		id     string
		status string
		fix    string
		detail string
	}{
		"a package is missing": {func(in *Inputs) { in.Missing = []string{"kmod-amneziawg"} }, "awg", "error", "install:awg", "kmod-amneziawg is missing."},
		"the firmware changed": {func(in *Inputs) {
			in.Missing, in.KernelWas, in.KernelIs = []string{"kmod-amneziawg"}, "6.6.1", "6.12.9"
		}, "awg", "error", "install:awg", "kernel 6.6.1 → 6.12.9"},
		"the module won't load":  {func(in *Inputs) { in.Loaded, in.WhyNotLoaded = false, "Exec format error." }, "awg", "error", "updates", "doesn't load: Exec format error. Reinstall"},
		"netifd has no protocol": {func(in *Inputs) { in.Handler = false }, "awg", "error", "netrestart", "netifd doesn't know"},
		"an update waits":        {func(in *Inputs) { in.WaitsForReboot = true }, "awg", "warn", "", "after a reboot"},
		"the clock is wrong":     {func(in *Inputs) { in.Year = 1970 }, "clock", "error", "", "Check NTP"},
		"the agent is gone":      {func(in *Inputs) { in.AgentRunning = false }, "agent", "error", "restart", ""},
		"little flash":           {func(in *Inputs) { kb := int64(1536); in.FreeKB = &kb }, "flash", "warn", "", "1.5 MB free"},
		"no flash":               {func(in *Inputs) { kb := int64(100); in.FreeKB = &kb }, "flash", "error", "", "0 MB free"},
		"no access rules":        {func(in *Inputs) { in.NftLoaded = false }, "nft", "error", "apply", "is missing"},
		"other policy routing":   {func(in *Inputs) { in.PolicyRouting = []string{"pref 1000 fwmark 0x1 → table 100"} }, "policy", "warn", "", "(pref 1000 fwmark 0x1 → table 100)"},
		"broken devices": {func(in *Inputs) {
			in.ModelErrors = func() []string { return []string{"a.", "b.", "c.", "d.", "e.", "f."} }
		}, "data", "error", "",
			"a. b. c. d. (2 more) Such devices"},
		"the tunnel is down": {func(in *Inputs) { in.Iface = func(string) Iface { return Iface{Exists: true} } }, "up_home", "error", "ifup:dawn0", "dawn0 is down."},
		"the tunnel has an error": {func(in *Inputs) {
			in.Iface = func(string) Iface { return Iface{Exists: true, Errors: []string{"NO_DEVICE"}} }
		}, "up_home", "error", "ifup:dawn0", "is down: NO_DEVICE."},
		"the tunnel is not there": {func(in *Inputs) { in.Iface = func(string) Iface { return Iface{} } }, "up_home", "error", "apply", "does not exist"},
		"the tunnel's protocol": {func(in *Inputs) {
			in.Iface = func(string) Iface { return Iface{Exists: true, Errors: []string{"INVALID_PROTO"}} }
		}, "up_home", "error", "netrestart", "netifd doesn't know"},
		"the tunnel is unreadable": {func(in *Inputs) { in.Unread = func(string) bool { return true } }, "peers_home", "warn", "", "could not be read"},
		"a device is missing": {func(in *Inputs) {
			in.Peers = func(*model.Server) Peers { return Peers{Expected: 3, Missing: 1, Loaded: 2} }
		}, "peers_home", "warn", "sync", "1 of 3 devices missing."},
		"a device too many": {func(in *Inputs) {
			in.Peers = func(*model.Server) Peers { return Peers{Expected: 1, Extra: 2, Loaded: 3} }
		}, "peers_home", "warn", "sync", "0 of 1 device missing, 2 loaded"},
		"no firewall rule":       {func(in *Inputs) { in.Firewall, _ = uci.Parse("config zone 'dawnline_home_zone'\n") }, "fw_home", "error", "apply", "is missing"},
		"answers are swallowed":  {func(in *Inputs) { in.Replies = &Replies{Diverts: []string{"pref 9 → table 100"}} }, "reply_home", "error", "apply", "Answers from UDP 4500 are swallowed"},
		"a proxy that is passed": {func(in *Inputs) { in.Replies = &Replies{OK: true, Diverts: []string{"pref 9 → table 100"}} }, "portal_reply", "ok", "", "Answers from TCP 4500 go straight out. A proxy"},
		"the port is another's": {func(in *Inputs) {
			in.Network, _ = uci.Parse("config interface 'wg0'\n\toption proto 'wireguard'\n\toption listen_port '4500'\n")
		}, "port_home", "error", "", "UDP 4500 is also used by wg0."},
		"the subnet is another's": {func(in *Inputs) { in.Subnets = append(in.Subnets, Subnet{"guest", "10.77.0.129/25"}) }, "subnet_home", "error", "", "10.77.0.0/24 overlaps guest (10.77.0.129/25)."},
		"a common home network":   {func(in *Inputs) { in.HomeNets = func(*model.Server) []string { return []string{"192.168.1.0/24"} } }, "homenet_home", "warn", "", "192.168.1.0/24 is one of the most common"},
		"the address is elsewhere": {func(in *Inputs) {
			in.Endpoint = func(*model.Server, string) endpoint.Reads {
				return endpoint.Reads{IPs: []string{"198.51.100.4"}, WAN: "203.0.113.7"}
			}
		}, "ep_home", "warn", "", "not this router"},
		"the home path needs a package": {func(in *Inputs) {
			in.LikeHome, in.Needs = map[string]any{"active": false}, map[string][]string{"home": {"kmod-veth"}}
		}, "home_home", "warn", "install:home", "Needs kmod-veth."},
		"the home path is unattached":    {func(in *Inputs) { in.LikeHome = map[string]any{"active": true, "bridged": false, "dev": "br-lan"} }, "home_home", "warn", "apply", "not attached to br-lan"},
		"the home path was refused":      {func(in *Inputs) { in.LikeHome = map[string]any{"active": false, "error": "No LAN detected."} }, "home_home", "warn", "apply", "No LAN detected. Internet traffic leaves"},
		"the home path is not set up":    {func(in *Inputs) { in.LikeHome = map[string]any{"active": false, "error": nil} }, "home_home", "warn", "apply", "Not set up. Internet traffic"},
		"the resolver stopped":           {func(in *Inputs) { in.ResolverRunning = false }, "resolver", "warn", "apply", "is not running"},
		"the resolver restarts":          {func(in *Inputs) { age := int64(3); in.ResolverRunning, in.ResolverConfAge = false, &age }, "resolver", "ok", "", "Restarting"},
		"the resolver beside the tunnel": {func(in *Inputs) { in.LikeHome = map[string]any{"active": false} }, "resolver", "ok", "", "on port 5354"},
		"no HTTPS on the router":         {func(in *Inputs) { in.Needs = map[string][]string{"https": {"openssl-util"}} }, "portal", "error", "install:https", "install openssl-util"},
		"the portal's port is taken": {func(in *Inputs) {
			in.Portal = func() Portal { return Portal{Owners: []string{"nginx"}, Listening: true} }
		}, "portal", "error", "", "already used by nginx"},
		"the portal is silent": {func(in *Inputs) { in.Portal = func() Portal { return Portal{} } }, "portal", "error", "restart", "Nothing listens on TCP 4500."},
		"the portal's name is elsewhere": {func(in *Inputs) {
			in.Portal = func() Portal {
				return Portal{Listening: true, IPs: []string{"198.51.100.4"}, WAN: "203.0.113.7", Valid: true, Names: []string{"vpn.example.org"}}
			}
		},
			"portal_dns", "warn", "", "points at 198.51.100.4, not this router (203.0.113.7)."},
		"the portal through Cloudflare": {func(in *Inputs) {
			in.Portal = func() Portal { return Portal{Listening: true, IPs: []string{"104.16.1.1"}, WAN: "203.0.113.7"} }
		}, "portal_dns", "ok", "", "Cloudflare"},
		"a self-signed certificate": {func(in *Inputs) {
			in.Portal = func() Portal { return Portal{Listening: true, SelfSigned: true} }
			in.Needs = map[string][]string{"acme": {"acme"}}
		}, "cert", "warn", "", "ACME can get"},
		"a certificate for another name": {func(in *Inputs) {
			in.Portal = func() Portal {
				return Portal{Listening: true, Cert: "/c.crt", Valid: true, Names: []string{"other.example.org"}}
			}
		}, "cert", "warn", "", "/c.crt does not cover vpn.example.org (it has other.example.org)"},
		"a certificate about to end": {func(in *Inputs) {
			in.Portal = func() Portal { return Portal{Listening: true, Cert: "/c.crt", Names: []string{"vpn.example.org"}} }
		}, "cert", "warn", "", "expires within 14 days"},
	} {
		in := healthy(t)
		c.break_(&in)
		got, has := byID(Run(in))[c.id]
		fix := ""
		if got.Fix != nil {
			fix = *got.Fix
		}
		// a common home network is advice, not a fault: it warns with no problem to put in a notice
		problem := c.status != "ok" && c.id != "homenet_home"
		if !has || got.Status != c.status || fix != c.fix || !strings.Contains(got.Detail, c.detail) || problem != (got.Problem != nil) {
			t.Errorf("%s: %s %s fix %q problem %v\n  %s", name, c.id, got.Status, fix, got.Problem != nil, got.Detail)
		}
	}
	// no server yet: only what the router itself needs, and the advice to set one up
	in := healthy(t)
	c, _ := uci.Parse("config settings 'settings'\n")
	in.M = model.Load(c, nil)
	var ids []string
	for _, x := range Run(in) {
		ids = append(ids, x.ID)
	}
	if strings.Join(ids, " ") != "clock agent flash server" {
		t.Fatalf("with no server: %v", ids)
	}
	if got := CommonHome([]string{"192.168.1.0/24", "10.37.12.0/24", "192.168.0.0/16", "odd"}); strings.Join(got, " ") != "192.168.1.0/24 192.168.0.0/16" {
		t.Fatalf("common home networks: %v", got)
	}
}

// The networks behind a server's routers: no check while none is written, then each in effect, or which is
// not and what it shares addresses with, or the route the router would not take.
func TestNetworksBehindRoutersAreChecked(t *testing.T) {
	c, err := uci.Parse(settings + `
config person 'boris'
	option name 'Boris'
	option server 'home'
	option access 'both'
config device 'r1'
	option person 'boris'
	option name 'Dacha'
	option kind 'router'
	option address '10.77.0.2'
config device 'r2'
	option person 'boris'
	option name 'Garage'
	option kind 'router'
	option address '10.77.0.3'
`)
	if err != nil {
		t.Fatal(err)
	}
	own := []string{"192.168.50.0/24"}
	run := func() (Check, bool) {
		m := model.Load(c, nil)
		in := Inputs{M: m, Behind: m.BehindOf(own), Own: own}
		return in.behind("home", "")
	}
	if _, has := run(); has {
		t.Error("a check with no network written")
	}
	c.SetList("r1", "behind_net", []string{"192.168.2.0/24", "172.20.0.0/16"})
	if got, has := run(); !has || got.ID != "sites_home" || got.Status != "ok" || got.Detail != "2 networks behind routers are carried by the tunnel." {
		t.Errorf("all in effect: %+v", got)
	}
	// each way a written network is not in effect, in its words
	c.SetList("r1", "behind_net", []string{"192.168.2.0/24", "10.77.0.128/25", "192.168.50.0/25", "the garage"})
	c.SetList("r2", "behind_net", []string{"192.168.2.128/25"})
	got, _ := run()
	for _, want := range []string{
		"10.77.0.128/25 behind Boris · Dacha shares addresses with the tunnel network of Home (10.77.0.0/24).",
		"192.168.50.0/25 behind Boris · Dacha shares addresses with 192.168.50.0/24, which the router has itself.",
		"the garage behind Boris · Dacha is not a network a router may have behind it.",
		"192.168.2.128/25 behind Boris · Garage shares addresses with 192.168.2.0/24 behind Dacha.",
		"Such a network is not in effect: change it in the server's Network settings.",
	} {
		if !strings.Contains(got.Detail, want) {
			t.Errorf("the check lacks %q:\n%s", want, got.Detail)
		}
	}
	if got.Status != "warn" || got.Problem == nil || *got.Problem != "A network behind a router isn’t in effect" {
		t.Errorf("networks not in effect: %+v", got)
	}
	// a router that waits for the admin's answer is not checked: nothing of it is in effect by design
	c.Set("r2", "waiting", "1")
	c.SetList("r1", "behind_net", []string{"192.168.2.0/24"})
	if got, _ := run(); got.Status != "ok" || got.Detail != "1 network behind routers is carried by the tunnel." {
		t.Errorf("with a waiting router: %+v", got)
	}
	// a route the router would not take
	m := model.Load(c, nil)
	in := Inputs{M: m, Behind: m.BehindOf(own), Own: own, RouteError: "192.168.2.0/24 dev dawn0: RTNETLINK answers: a made-up failure"}
	if got, _ := in.behind("home", ""); got.Status != "error" || got.Fix == nil || *got.Fix != "sync" || !strings.Contains(got.Detail, "a made-up failure") {
		t.Errorf("a route refused: %+v", got)
	}
}
