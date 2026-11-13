package apply

import (
	"encoding/json"
	"os"
	"sort"

	"github.com/tickcount/luci-app-dawnline/backend/health"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/servicelog"
)

// The networks behind people's routers, as the router's own routes: a packet for one leaves through the
// tunnel of the router it stands behind (the tunnel then picks the device by the peers' AllowedIPs).
//
// Reconciled, not patched: every route of ours carries one routing protocol number, so what the main table
// holds of them is read back and brought to what the settings and people's states want. Netifd takes a
// tunnel's routes away with its interface; the sync that follows the interface coming up puts them back.

// routeProto marks the routes Dawnline keeps (/etc/iproute2/rt_protos has no name for it).
const routeProto = "205"

// RoutesWanted is the networks that get a route, by the tunnel's interface, sorted: those behind the
// devices a tunnel was given (peers: each server's "ok"), so a route never leads into a tunnel that would
// drop the packet.
func RoutesWanted(m *model.Model, states, peers map[string]string, behind map[string][]string) map[string][]string {
	want := map[string][]string{}
	for _, id := range m.ServerIDs() {
		srv := m.Servers[id]
		if !srv.Enabled || !tunnelOK(srv) || peers[id] != "ok" {
			continue
		}
		for _, d := range health.TunnelDevices(m, id, states) {
			want[srv.Ifname] = append(want[srv.Ifname], behind[d.ID]...)
		}
		sort.Strings(want[srv.Ifname])
		if len(want[srv.Ifname]) == 0 {
			delete(want, srv.Ifname)
		}
	}
	return want
}

// IPRoute is a route as `ip -j -4 route show` prints it.
type IPRoute struct {
	Dst string `json:"dst"`
	Dev string `json:"dev"`
}

// RouteCmds is the `ip` arguments that turn the routes of ours there are into the wanted ones: the missing
// ones first, then the ones nobody has any more. None when they are as wanted.
func RouteCmds(want map[string][]string, have []IPRoute) [][]string {
	there, wanted := map[string]bool{}, map[string]bool{}
	for _, x := range have {
		there[x.Dev+" "+x.Dst] = true
	}
	var cmds [][]string
	ifnames := make([]string, 0, len(want))
	for ifname := range want {
		ifnames = append(ifnames, ifname)
	}
	sort.Strings(ifnames)
	for _, ifname := range ifnames {
		for _, n := range want[ifname] {
			if k := ifname + " " + n; !there[k] && !wanted[k] {
				cmds = append(cmds, []string{"-4", "route", "replace", n, "dev", ifname, "proto", routeProto, "scope", "link"})
			}
			wanted[ifname+" "+n] = true
		}
	}
	for _, x := range have {
		if !wanted[x.Dev+" "+x.Dst] {
			cmds = append(cmds, []string{"-4", "route", "del", x.Dst, "dev", x.Dev, "proto", routeProto})
		}
	}
	return cmds
}

// routes keeps the routes to the networks behind routers as RoutesWanted says: "" when they are, else what
// `ip` said of the first that failed. states is whose devices were loaded, peers what each tunnel answered.
func (r *Router) routes(m *model.Model, states, peers map[string]string, behind map[string][]string) string {
	out, code := r.Exec("ip", "-j", "-4", "route", "show", "proto", routeProto)
	var have []IPRoute
	if code == 0 {
		json.Unmarshal([]byte(trimmed(out)), &have)
	}
	failed := ""
	var added, removed []string
	for _, args := range RouteCmds(RoutesWanted(m, states, peers, behind), have) {
		said, code := r.Exec("ip", args...)
		what := args[3] + " dev " + args[5]
		switch {
		case code != 0 && args[2] == "replace":
			if failed == "" {
				failed = what + ": " + trimmed(said)
			}
		case args[2] == "replace":
			added = append(added, what)
		case code == 0:
			removed = append(removed, what)
		}
	}
	if len(added) > 0 || len(removed) > 0 {
		line := "networks behind routers:"
		if len(added) > 0 {
			line += " added " + someOf(added)
		}
		if len(removed) > 0 {
			line += " removed " + someOf(removed)
		}
		r.say("info", "routes", line)
	}
	// once per distinct failure, as the access table's
	path := r.RunDir + "/routes.err"
	was, werr := os.ReadFile(path)
	switch {
	case failed == "" && werr == nil:
		os.Remove(path)
	case failed != "" && (werr != nil || string(was) != failed):
		if r.Log != nil {
			r.Log.Write("dawnline", "error", "couldn't set a route to a network behind a router", failed, "Routes", servicelog.Extra{})
		}
		os.MkdirAll(r.RunDir, 0o755)
		os.WriteFile(path, []byte(failed), 0o644)
	}
	return failed
}
