package apply

import (
	"encoding/json"
	"os"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/tickcount/luci-app-dawnline/backend/i18n"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/netview"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
	"github.com/tickcount/luci-app-dawnline/backend/usage"
)

// routed is a router that keeps the routes it is given, besides what stand keeps.
type routed struct {
	stand
	routes map[string]bool
	fail   string
	ran    []string
}

func (s *routed) exec(name string, args ...string) (string, int) {
	if name != "ip" {
		return s.stand.exec(name, args...)
	}
	line := strings.Join(args, " ")
	switch {
	case line == "-j -4 route show proto "+routeProto:
		var list []IPRoute
		for k := range s.routes {
			f := strings.Fields(k)
			list = append(list, IPRoute{Dev: f[0], Dst: f[1]})
		}
		sort.Slice(list, func(i, j int) bool { return list[i].Dev+list[i].Dst < list[j].Dev+list[j].Dst })
		raw, _ := json.Marshal(list)
		return string(raw), 0
	case strings.HasPrefix(line, "-4 route replace ") && strings.HasSuffix(line, " proto "+routeProto+" scope link"):
		s.ran = append(s.ran, line)
		if s.fail != "" && strings.Contains(line, s.fail) {
			return "RTNETLINK answers: a made-up failure\n", 2
		}
		s.routes[args[5]+" "+args[3]] = true
	case strings.HasPrefix(line, "-4 route del ") && strings.HasSuffix(line, " proto "+routeProto):
		s.ran = append(s.ran, line)
		delete(s.routes, args[5]+" "+args[3])
	default:
		return "unknown: ip " + line, 1
	}
	return "", 0
}

// Access's household on the golden's router, with two routers that have networks behind them and one
// whose network the router has itself.
func sites(t *testing.T) (*uci.Config, *netview.Snapshot) {
	t.Helper()
	text, err := os.ReadFile("../access/testdata/access.uci")
	if err != nil {
		t.Fatal(err)
	}
	c, err := uci.Parse(string(text))
	if err != nil {
		t.Fatal(err)
	}
	c.Set("bphone", "kind", "router")
	c.SetList("bphone", "behind_net", []string{"192.168.2.0/24", "172.20.0.0/16"})
	c.Set("kphone", "kind", "router")
	c.SetList("kphone", "behind_net", []string{"192.168.3.0/24"})
	c.Set("hphone", "kind", "router")
	c.SetList("hphone", "behind_net", []string{"192.168.50.0/24"})
	raw, err := os.ReadFile("../netview/testdata/trace.json")
	if err != nil {
		t.Fatal(err)
	}
	var router struct {
		Routes json.RawMessage         `json:"routes"`
		Addrs  json.RawMessage         `json:"addrs"`
		Links  map[string]netview.Link `json:"links"`
	}
	if err := json.Unmarshal(raw, &router); err != nil {
		t.Fatal(err)
	}
	return c, netview.Take(netview.Sources{Routes: func() []byte { return router.Routes }, Addrs: func() []byte { return router.Addrs },
		Links: func() map[string]netview.Link { return router.Links }})
}

func TestRoutesFollowTheTunnels(t *testing.T) {
	c, snap := sites(t)
	dir := t.TempDir()
	s := &routed{stand: stand{dir: dir, refuse: map[string]bool{}, down: map[string]bool{}, confs: map[string]string{}}, routes: map[string]bool{}}
	r := &Router{RunDir: dir, HostsFile: dir + "/hosts/dawnline", DHCP: dir + "/no-dhcp", Exec: s.exec, Snapshot: func() *netview.Snapshot { return snap }}
	words := i18n.Use("", "")
	have := func() []string {
		out := []string{}
		for k := range s.routes {
			out = append(out, k)
		}
		sort.Strings(out)
		return out
	}
	sync := func() Result {
		s.ran = nil
		return r.Sync(model.Load(c, nil), &usage.Usage{}, 1700000000, false, words)
	}
	// each router's networks leave through its own tunnel; what the router has itself gets no route
	res := sync()
	all := []string{"dawn0 172.20.0.0/16", "dawn0 192.168.2.0/24", "dawn2 192.168.3.0/24"}
	if !reflect.DeepEqual(have(), all) || res.Routes != "" || res.Warning != "" {
		t.Fatalf("routes %v, %q, %q", have(), res.Routes, res.Warning)
	}
	// the tunnel is told whose they are, and nobody else gets more than an address
	if conf := s.confs["dawn0"]; !strings.Contains(conf, "AllowedIPs = 10.77.0.5/32, 192.168.2.0/24, 172.20.0.0/16\n") ||
		strings.Count(conf, "/32\n") != strings.Count(conf, "AllowedIPs = ")-1 {
		t.Errorf("dawn0's devices:\n%s", conf)
	}
	if conf := s.confs["dawn1"]; strings.Contains(conf, "192.168.50.0/24") {
		t.Errorf("dawn1 was given a network the router has itself:\n%s", conf)
	}
	// nothing moved: nothing is run
	if sync(); len(s.ran) != 0 {
		t.Errorf("ran %v with nothing to do", s.ran)
	}
	// its owner paused: the route goes with the device
	c.Set("boris", "paused", "1")
	if sync(); !reflect.DeepEqual(have(), []string{"dawn2 192.168.3.0/24"}) {
		t.Errorf("with Boris paused: %v", have())
	}
	c.Delete("boris", "paused")
	// a tunnel that refuses its devices, and one that is down: no route leads into either
	s.refuse["dawn0"], s.down["dawn2"] = true, true
	if sync(); len(have()) != 0 {
		t.Errorf("into tunnels that hold nobody: %v", have())
	}
	s.refuse["dawn0"], s.down["dawn2"] = false, false
	// a route that will not go in is told, once in the log's file, and the others still go in
	s.fail = "192.168.2.0/24"
	res = sync()
	if !reflect.DeepEqual(have(), []string{"dawn0 172.20.0.0/16", "dawn2 192.168.3.0/24"}) || !strings.Contains(res.Routes, "192.168.2.0/24 dev dawn0: RTNETLINK answers: a made-up failure") ||
		!strings.Contains(res.Warning, "192.168.2.0/24 dev dawn0") {
		t.Errorf("a route refused: %v, %q, %q", have(), res.Routes, res.Warning)
	}
	if kept, _ := os.ReadFile(dir + "/routes.err"); string(kept) != res.Routes {
		t.Errorf("kept %q", kept)
	}
	s.fail = ""
	if res = sync(); !reflect.DeepEqual(have(), all) || res.Routes != "" {
		t.Errorf("after the failure: %v, %q", have(), res.Routes)
	}
	if _, err := os.Stat(dir + "/routes.err"); err == nil {
		t.Error("the failure is still kept")
	}
	// a network taken off, a router that is one no more, and a route of ours nobody wants
	c.SetList("bphone", "behind_net", []string{"172.20.0.0/16"})
	c.Set("kphone", "kind", "phone")
	s.routes["dawn9 192.168.99.0/24"] = true
	if sync(); !reflect.DeepEqual(have(), []string{"dawn0 172.20.0.0/16"}) {
		t.Errorf("after the changes: %v", have())
	}
	// a router that waits for the admin's answer: no device of the tunnel, no route to what it asks for
	c.Set("kphone", "kind", "router")
	c.Set("kphone", "waiting", "1")
	if sync(); !reflect.DeepEqual(have(), []string{"dawn0 172.20.0.0/16"}) || strings.Contains(s.confs["dawn2"], "10.79.0.2/32") || !strings.Contains(s.confs["dawn2"], "10.79.0.3/32") {
		t.Errorf("with Kira's router waiting: %v\n%s", have(), s.confs["dawn2"])
	}
	// the plan of a sync names them too
	p := r.Plan(model.Load(c, nil), &usage.Usage{}, 1700000000)
	if !reflect.DeepEqual(p.Routes, map[string][]string{"dawn0": {"172.20.0.0/16"}}) {
		t.Errorf("the plan's routes: %v", p.Routes)
	}
}

func TestRouteCommands(t *testing.T) {
	want := map[string][]string{"dawn1": {"192.168.3.0/24"}, "dawn0": {"172.20.0.0/16", "192.168.2.0/24"}}
	have := []IPRoute{{Dst: "192.168.2.0/24", Dev: "dawn0"}, {Dst: "192.168.2.0/24", Dev: "dawn1"}, {Dst: "10.9.0.0/24", Dev: "dawn7"}}
	got := RouteCmds(want, have)
	exp := [][]string{
		{"-4", "route", "replace", "172.20.0.0/16", "dev", "dawn0", "proto", routeProto, "scope", "link"},
		{"-4", "route", "replace", "192.168.3.0/24", "dev", "dawn1", "proto", routeProto, "scope", "link"},
		{"-4", "route", "del", "192.168.2.0/24", "dev", "dawn1", "proto", routeProto},
		{"-4", "route", "del", "10.9.0.0/24", "dev", "dawn7", "proto", routeProto},
	}
	if !reflect.DeepEqual(got, exp) {
		t.Errorf("commands:\n%v\nwant\n%v", got, exp)
	}
	if got := RouteCmds(want, []IPRoute{{Dst: "172.20.0.0/16", Dev: "dawn0"}, {Dst: "192.168.2.0/24", Dev: "dawn0"}, {Dst: "192.168.3.0/24", Dev: "dawn1"}}); len(got) != 0 {
		t.Errorf("as wanted, yet %v", got)
	}
}
