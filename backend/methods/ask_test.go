package methods

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/health"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/usage"
	"github.com/tickcount/luci-app-dawnline/backend/view"
)

// What a person asks for about a router on their own page, and the admin's answers: Lev, on the server
// where everyone reaches everyone, by each of the server's rules.
func TestRequestsFromThePortal(t *testing.T) {
	d, st, dir, ap, sy := sitesStand(t)
	lev := Actor{By: "portal", Person: "lev"}
	dev := func(id string) *model.Device {
		t.Helper()
		_, m, err := st.Read()
		if err != nil {
			t.Fatal(err)
		}
		if m.Devices[id] == nil {
			t.Fatalf("no device %s", id)
		}
		return m.Devices[id]
	}
	loaded := func(id string) bool {
		_, m, _ := st.Read()
		states := map[string]string{}
		for _, p := range m.PersonIDs() {
			states[p] = "active"
		}
		for _, x := range health.TunnelDevices(m, "open", states) {
			if x.ID == id {
				return true
			}
		}
		return false
	}
	nets := func(list ...string) []any {
		out := []any{}
		for _, n := range list {
			out = append(out, n)
		}
		return out
	}
	wish := func(id string, a map[string]any) string {
		a["id"] = id
		if _, err := DeviceWishAs(d, a, lev); err != nil {
			return err.Error()
		}
		return ""
	}
	answer := func(id, how string, more map[string]any) any {
		a := map[string]any{"id": id, "answer": how}
		for k, v := range more {
			a[k] = v
		}
		return ask(t, d, "device_answer", a)["error"]
	}
	counts := func(what string, applied, synced int) {
		t.Helper()
		if *ap != applied || *sy != synced {
			t.Errorf("%s: applied %d, synced %d, want %d and %d", what, *ap, *sy, applied, synced)
		}
	}
	// Kira's router has a network, the admin's doing
	if res := ask(t, d, "device_networks", map[string]any{"id": "kphone", "networks": nets("192.168.3.0/24")}); res["error"] != nil {
		t.Fatal(res["error"])
	}
	counts("the admin's own", 1, 0)

	// asked of the admin (the rule a server starts with): the router waits, its networks are only asked for
	if _, err := DeviceCreateAs(d, map[string]any{"person": "lev", "name": "Dacha", "kind": "router", "networks": nets("10.79.0.0/24")}, lev); err == nil ||
		err.Error() != "Network 10.79.0.0/24 is taken: 10.79.0.0/24 is the tunnel network of Open. The two ends of a tunnel need different addresses." {
		t.Errorf("the tunnel's own network: %v", err)
	}
	res, err := DeviceCreateAs(d, map[string]any{"person": "lev", "name": "Dacha", "kind": "router", "networks": nets("192.168.88.1/24", "192.168.3.128/25")}, lev)
	if err != nil {
		t.Fatal(err)
	}
	dacha, _ := res["id"].(string)
	if x := dev(dacha); res["waiting"] != true || res["config"] != nil || !x.Waiting || x.Behind != nil || x.Asked == 0 || x.CreatedBy != "portal" ||
		!reflect.DeepEqual(x.Ask, []string{"192.168.88.0/24", "192.168.3.128/25"}) {
		t.Fatalf("a router asked for: %v, %+v", res, x)
	}
	counts("a router that waits", 1, 0)
	if loaded(dacha) || !loaded("lphone") {
		t.Error("a router that waits is in the tunnel, or Lev's phone is not")
	}
	_, m, _ := st.Read()
	if cfg := configOf(d, m, dacha); cfg != nil {
		t.Errorf("a router that waits has a configuration: %v", cfg)
	}
	if _, err := DeviceRotateAs(d, map[string]any{"id": dacha}, lev); err == nil || !strings.Contains(err.Error(), "waits for an answer") {
		t.Errorf("new keys for a router that waits: %v", err)
	}
	// taken as it is, it would share addresses with Kira's: the admin is told whose, and nothing is written
	if got := answer(dacha, "accept", nil); got != "Network 192.168.3.128/25 is taken: 192.168.3.0/24 is behind Kphone (Kira). Two sites need different addresses." {
		t.Errorf("accepting a clash: %v", got)
	}
	if !dev(dacha).Waiting {
		t.Error("a refused answer took the router")
	}
	// Lev takes that one back; then the admin takes the router with what is left
	if got := wish(dacha, map[string]any{"networks": nets("192.168.88.0/24")}); got != "" || !reflect.DeepEqual(dev(dacha).Ask, []string{"192.168.88.0/24"}) {
		t.Errorf("a wish changed while it waits: %q, %v", got, dev(dacha).Ask)
	}
	if got := answer(dacha, "accept", nil); got != nil {
		t.Fatalf("accept: %v", got)
	}
	if x := dev(dacha); x.Waiting || x.Ask != nil || x.Asked != 0 || !reflect.DeepEqual(x.Behind, []string{"192.168.88.0/24"}) || !loaded(dacha) {
		t.Errorf("after the answer: %+v", x)
	}
	counts("accepted with a network", 2, 0)
	if got := answer(dacha, "accept", nil); got != "This device asks for nothing." {
		t.Errorf("an answer to nothing: %v", got)
	}
	if got := answer("lphone", "decline", nil); got != "This device asks for nothing." {
		t.Errorf("an answer to a phone: %v", got)
	}

	// one more network: asked for, turned down with a reason, put back, turned down, and put away by Lev
	if got := wish(dacha, map[string]any{"networks": nets("192.168.88.0/24", "192.168.89.0/24")}); got != "" {
		t.Fatal(got)
	}
	if x := dev(dacha); !reflect.DeepEqual(x.Ask, []string{"192.168.89.0/24"}) || !reflect.DeepEqual(x.Behind, []string{"192.168.88.0/24"}) || x.Asked == 0 {
		t.Errorf("one more asked for: %+v", x)
	}
	counts("a network asked for", 2, 0)
	if got := answer(dacha, "decline", map[string]any{"reason": "overlap"}); got != nil {
		t.Fatal(got)
	}
	if x := dev(dacha); x.Declined != "overlap" || !reflect.DeepEqual(x.DeclinedNets, []string{"192.168.89.0/24"}) || x.Ask != nil || x.Asked != 0 {
		t.Errorf("turned down: %+v", x)
	}
	if got := answer(dacha, "reopen", map[string]any{"networks": nets("192.168.89.0/24")}); got != nil {
		t.Fatal(got)
	}
	if x := dev(dacha); x.Declined != "" || x.DeclinedNets != nil || !reflect.DeepEqual(x.Ask, []string{"192.168.89.0/24"}) {
		t.Errorf("the question put back: %+v", x)
	}
	if got := answer(dacha, "decline", map[string]any{"reason": "because"}); got != nil || dev(dacha).Declined != "plain" {
		t.Errorf("a reason nobody knows: %v, %q", got, dev(dacha).Declined)
	}
	if got := wish(dacha, map[string]any{"networks": nets("192.168.88.0/24"), "cleared": nets("192.168.89.0/24")}); got != "" || dev(dacha).Declined != "" || dev(dacha).DeclinedNets != nil {
		t.Errorf("put away: %q, %+v", got, dev(dacha))
	}
	counts("answers that move no route", 2, 0)
	// accepted and undone: the network is asked for again, and its route goes
	wish(dacha, map[string]any{"networks": nets("192.168.88.0/24", "192.168.89.0/24")})
	if got := answer(dacha, "accept", nil); got != nil || !reflect.DeepEqual(dev(dacha).Behind, []string{"192.168.88.0/24", "192.168.89.0/24"}) {
		t.Fatalf("a network accepted: %v, %v", got, dev(dacha).Behind)
	}
	if got := answer(dacha, "reopen", map[string]any{"networks": nets("192.168.89.0/24")}); got != nil {
		t.Fatal(got)
	}
	if x := dev(dacha); !reflect.DeepEqual(x.Behind, []string{"192.168.88.0/24"}) || !reflect.DeepEqual(x.Ask, []string{"192.168.89.0/24"}) {
		t.Errorf("an accept undone: %+v", x)
	}
	counts("accepted and undone", 4, 0)
	// two asked for, each with its own answer: one taken, the other turned down, neither touching the other
	wish(dacha, map[string]any{"networks": nets("192.168.88.0/24", "192.168.89.0/24", "192.168.94.0/24")})
	if got := answer(dacha, "accept", map[string]any{"networks": nets("192.168.94.0/24")}); got != nil {
		t.Fatal(got)
	}
	if x := dev(dacha); !reflect.DeepEqual(x.Behind, []string{"192.168.88.0/24", "192.168.94.0/24"}) || !reflect.DeepEqual(x.Ask, []string{"192.168.89.0/24"}) || x.Asked == 0 {
		t.Errorf("one of two taken: %+v", x)
	}
	if got := answer(dacha, "accept", map[string]any{"networks": nets("192.168.99.0/24")}); got != "This device asks for nothing." {
		t.Errorf("an answer to a network nobody asked for: %v", got)
	}
	if got := answer(dacha, "decline", map[string]any{"networks": nets("192.168.89.0/24"), "reason": "unneeded"}); got != nil {
		t.Fatal(got)
	}
	if x := dev(dacha); x.Ask != nil || x.Declined != "unneeded" || !reflect.DeepEqual(x.DeclinedNets, []string{"192.168.89.0/24"}) {
		t.Errorf("the other turned down: %+v", x)
	}
	counts("each with its own answer", 5, 0)
	// taking a network away is Lev's own to do, at once; what was asked for goes with the list
	if got := wish(dacha, map[string]any{"networks": nets()}); got != "" || dev(dacha).Behind != nil || dev(dacha).Ask != nil {
		t.Errorf("all taken away: %q, %+v", got, dev(dacha))
	}
	counts("taken away", 6, 0)

	// networks at once: the server's owner said so
	if res := ask(t, d, "server_update", map[string]any{"id": "open", "values": map[string]any{"portal_nets": "free"}}); res["error"] != nil {
		t.Fatal(res["error"])
	}
	if got := wish(dacha, map[string]any{"networks": nets("192.168.90.0/24")}); got != "" || !reflect.DeepEqual(dev(dacha).Behind, []string{"192.168.90.0/24"}) || dev(dacha).Ask != nil {
		t.Errorf("at once: %q, %+v", got, dev(dacha))
	}
	counts("a network at once", 8, 0)
	// then everything is held against it, and Lev is not told whose the addresses are
	if got := wish(dacha, map[string]any{"networks": nets("192.168.90.0/24", "192.168.3.0/25")}); got != "Network 192.168.3.0/25 is taken on this server. Ask the admin which addresses are free." {
		t.Errorf("another person's network: %q", got)
	}
	// a router still waits for the admin, with its network asked for all the same
	res, err = DeviceCreateAs(d, map[string]any{"person": "lev", "name": "Cabin", "kind": "router", "networks": nets("192.168.92.0/24")}, lev)
	cabin, _ := res["id"].(string)
	if err != nil || !dev(cabin).Waiting || !reflect.DeepEqual(dev(cabin).Ask, []string{"192.168.92.0/24"}) {
		t.Fatalf("a router asked for where networks are free: %v", err)
	}
	// turned down, it stays for Lev to read why; the answer undone, it is asked for again; then taken
	if got := answer(cabin, "decline", map[string]any{"reason": "talk"}); got != nil || !dev(cabin).Waiting || dev(cabin).Declined != "talk" || loaded(cabin) {
		t.Errorf("a router turned down: %v, %+v", got, dev(cabin))
	}
	if got := answer(cabin, "accept", nil); got != "This device asks for nothing." {
		t.Errorf("accepting what was turned down: %v", got)
	}
	if got := answer(cabin, "reopen", map[string]any{"router": true}); got != nil || dev(cabin).Declined != "" || !dev(cabin).Waiting {
		t.Errorf("the router asked for again: %v, %+v", got, dev(cabin))
	}
	counts("a router turned down and back", 8, 0)
	if got := answer(cabin, "accept", nil); got != nil || dev(cabin).Waiting || !loaded(cabin) || !reflect.DeepEqual(dev(cabin).Behind, []string{"192.168.92.0/24"}) {
		t.Errorf("the router taken: %v, %+v", got, dev(cabin))
	}
	counts("a router taken with its network", 9, 0)
	// that undone: it waits again, out of the tunnel (its network stays written and is in effect nowhere)
	if got := answer(cabin, "reopen", map[string]any{"router": true}); got != nil || !dev(cabin).Waiting || loaded(cabin) {
		t.Errorf("a taken router put back: %v, %+v", got, dev(cabin))
	}
	counts("put back", 9, 1)
	if _, m, _ := st.Read(); m.BehindOf(nil)[cabin] != nil {
		t.Errorf("a waiting router's network is in effect: %v", m.BehindOf(nil)[cabin])
	}

	// routers at once, and no routers at all
	ask(t, d, "server_update", map[string]any{"id": "open", "values": map[string]any{"portal_routers": "free"}})
	res, err = DeviceCreateAs(d, map[string]any{"person": "lev", "name": "Garage", "kind": "router", "networks": nets("192.168.93.0/24")}, lev)
	garage, _ := res["id"].(string)
	if err != nil || res["config"] == nil || dev(garage).Waiting || !reflect.DeepEqual(dev(garage).Behind, []string{"192.168.93.0/24"}) || !loaded(garage) {
		t.Errorf("a router at once: %v, %v", err, res)
	}
	counts("a router at once", 11, 1)
	if _, err := DeviceRotateAs(d, map[string]any{"id": "lphone", "kind": "router"}, lev); err != nil {
		t.Errorf("a phone made a router where routers are free: %v", err)
	}
	ask(t, d, "server_update", map[string]any{"id": "open", "values": map[string]any{"portal_routers": "off"}})
	if _, err := DeviceCreateAs(d, map[string]any{"person": "lev", "name": "Shed", "kind": "router"}, lev); err == nil ||
		err.Error() != "The admin adds routers on this server. Ask them for one." {
		t.Errorf("a router where the owner adds them: %v", err)
	}
	// on Boris's server the rule is the one a server starts with: no device is made a router there
	if _, err := DeviceRotateAs(d, map[string]any{"id": "phone", "kind": "router"}, Actor{By: "portal", Person: "anna"}); err == nil ||
		err.Error() != "Add the router as a new device: a device cannot be made one here." {
		t.Errorf("a phone made a router: %v", err)
	}
	if res := ask(t, d, "server_update", map[string]any{"id": "open", "values": map[string]any{"portal_nets": "sometimes"}}); res["error"] != "Unknown choice for routers on people's pages." {
		t.Errorf("a rule nobody knows: %v", res["error"])
	}
	// "ask" is what an unset rule means: back to it, the options leave the file
	ask(t, d, "server_update", map[string]any{"id": "open", "values": map[string]any{"portal_routers": "ask", "portal_nets": "ask"}})
	if _, m, _ := st.Read(); m.Servers["open"].PortalRouters != "ask" || m.Servers["open"].PortalNets != "ask" {
		t.Errorf("the rules back: %q, %q", m.Servers["open"].PortalRouters, m.Servers["open"].PortalNets)
	}
	// the log has what was asked and answered, in order, each by who did it
	var said []string
	for _, e := range journalOf(t, dir) {
		if e["type"] == "device_changed" && (e["device"] == dacha || e["device"] == cabin) {
			said = append(said, e["by"].(string)+": "+e["detail"].(string))
		}
	}
	want := []string{
		"portal: asked=router, asked=192.168.88.0/24 192.168.3.128/25",
		"portal: withdrew=192.168.3.128/25",
		"admin: accepted=router, accepted=192.168.88.0/24",
		"portal: asked=192.168.89.0/24",
		"admin: declined=192.168.89.0/24, reason=overlap",
		"admin: reopened=192.168.89.0/24",
		"admin: declined=192.168.89.0/24, reason=plain",
		"portal: asked=192.168.89.0/24",
		"admin: accepted=192.168.89.0/24",
		"admin: reopened=192.168.89.0/24",
		"portal: asked=192.168.94.0/24",
		"admin: accepted=192.168.94.0/24",
		"admin: declined=192.168.89.0/24, reason=unneeded",
		"portal: networks=none",
		"portal: networks=192.168.90.0/24",
		"portal: asked=router, asked=192.168.92.0/24",
		"admin: declined=router, reason=talk",
		"admin: reopened=router",
		"admin: accepted=router, accepted=192.168.92.0/24",
		"admin: reopened=router",
	}
	if !reflect.DeepEqual(said, want) {
		t.Errorf("logged:\n%s\nwant:\n%s", strings.Join(said, "\n"), strings.Join(want, "\n"))
	}
}

// The same through a person's own link: what the page is told about routers, a router asked for, its
// networks changed while it waits, and no configuration until the admin answers.
func TestARouterThroughThePersonsLink(t *testing.T) {
	d, st, dir, _, _ := sitesStand(t)
	c, _, _ := st.Read()
	const code = "kamiro-telosu-bavine"
	c.Set("lev", "code", code)
	c.Set("settings", "portal_enabled", "1")
	os.WriteFile(dir+"/dawnline", []byte(c.Format()), 0o600)
	d.World = func() *view.World {
		_, m, _ := st.Read()
		return &view.World{M: m, Usage: usage.Empty(), Now: time.Now().Unix()}
	}
	call := func(method, path, body string) (int, map[string]any) {
		q := PortalRequest{Method: method, Path: "/" + code + path, Host: "vpn.example.org:4500", HTTPS: true, Remote: "198.51.100.9"}
		if method == "POST" {
			q.ContentType, q.Origin, q.Body, q.ContentLength = "application/json", "https://"+q.Host, strings.NewReader(body), int64(len(body))
		}
		a := Portal(d, q)
		var out map[string]any
		json.Unmarshal(a.Body, &out)
		return a.Status, out
	}
	rules := func() (routers, nets any, router bool) {
		status, state := call("GET", "/api/state", "")
		if status != 200 {
			t.Fatalf("the state: %d", status)
		}
		for _, k := range state["kinds"].([]any) {
			router = router || k == "router"
		}
		server := state["server"].(map[string]any)
		return server["routers"], server["nets"], router
	}
	if routers, nets, router := rules(); routers != "ask" || nets != "ask" || !router {
		t.Errorf("the rules a server starts with: %v, %v, router offered: %v", routers, nets, router)
	}
	status, res := call("POST", "/api/devices", `{"name":"Dacha","kind":"router","networks":["192.168.88.9/24"]}`)
	id, _ := res["id"].(string)
	if status != 200 || res["waiting"] != true || res["config"] != nil || id == "" {
		t.Fatalf("a router asked for: %d %v", status, res)
	}
	// the page's state has it as it stands: waiting, with what is asked for
	var mine map[string]any
	for _, x := range res["state"].(map[string]any)["person"].(map[string]any)["devices"].([]any) {
		if dv := x.(map[string]any); dv["id"] == id {
			mine = dv
		}
	}
	if mine == nil || mine["waiting"] != true || !reflect.DeepEqual(mine["ask"], []any{"192.168.88.0/24"}) || mine["behind"] != nil {
		t.Errorf("the device as the page has it: %v", mine)
	}
	if status, res = call("GET", "/api/devices/"+id+"/config", ""); status != 409 || res["error"] != "This router waits for an answer to its request: it has no configuration yet." {
		t.Errorf("its configuration: %d %v", status, res)
	}
	if status, res = call("POST", "/api/devices/"+id, `{"action":"reconnect"}`); status != 400 || res["error"] != "This router waits for an answer to its request: it has no configuration yet." {
		t.Errorf("set up again while it waits: %d %v", status, res)
	}
	if status, res = call("POST", "/api/devices/"+id, `{"action":"networks","networks":["192.168.88.0/24","192.168.89.0/24"]}`); status != 200 {
		t.Fatalf("its networks changed: %d %v", status, res)
	}
	if _, m, _ := st.Read(); !reflect.DeepEqual(m.Devices[id].Ask, []string{"192.168.88.0/24", "192.168.89.0/24"}) || m.Devices[id].Behind != nil {
		t.Errorf("what it asks for now: %+v", m.Devices[id])
	}
	if status, res = call("POST", "/api/devices/"+id, `{"action":"networks","networks":["8.8.8.0/24"]}`); status != 400 ||
		res["error"] != "Network 8.8.8.0/24 is not private (10.x, 172.16-31.x, 192.168.x)." {
		t.Errorf("a public network: %d %v", status, res)
	}
	if status, res = call("POST", "/api/devices/lphone", `{"action":"networks","networks":["192.168.95.0/24"]}`); status != 400 || res["error"] != "Only a router has networks behind it." {
		t.Errorf("a network behind a phone: %d %v", status, res)
	}
	// where the owner adds routers, the page does not offer one and the router takes none
	c, _, _ = st.Read()
	c.Set("open", "portal_routers", "off")
	os.WriteFile(dir+"/dawnline", []byte(c.Format()), 0o600)
	if routers, _, router := rules(); routers != "off" || router {
		t.Errorf("routers off: %v, router offered: %v", routers, router)
	}
	if status, res = call("POST", "/api/devices", `{"name":"Shed","kind":"router"}`); status != 400 || res["error"] != "The admin adds routers on this server. Ask them for one." {
		t.Errorf("a router where the owner adds them: %d %v", status, res)
	}
}
