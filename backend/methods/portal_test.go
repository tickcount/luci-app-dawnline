package methods

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/store"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
	"github.com/tickcount/luci-app-dawnline/backend/usage"
	"github.com/tickcount/luci-app-dawnline/backend/view"
)

// What a person does through their link: each change lands in the settings as theirs, within their
// limits, and never on what is not theirs.
func TestPortalChanges(t *testing.T) {
	dir := t.TempDir()
	text, _ := os.ReadFile("../access/testdata/access.uci")
	c, _ := uci.Parse(string(text))
	var who, code, mine, theirs string
	for _, s := range c.OfType("device") {
		p, _ := s.Get("person")
		if who == "" {
			who, mine = p, s.Name
		} else if p != who && theirs == "" {
			theirs = s.Name
		}
	}
	code = "kamiro-telosu-bavine"
	c.Set(who, "code", code)
	c.Set(who, "device_limit", "5")
	c.Set("settings", "portal_enabled", "1")
	os.WriteFile(dir+"/dawnline", []byte(c.Format()), 0o600)
	st := &store.Store{Config: dir + "/dawnline", RunDir: dir}
	var later []string
	d := Deps{Store: st, Config: dir + "/dawnline", RunDir: dir, DataDir: dir + "/data",
		World: func() *view.World {
			_, m, _ := st.Read()
			return &view.World{M: m, Usage: usage.Empty(), Now: time.Now().Unix()}
		},
		AWG:        func() map[string]any { return map[string]any{"tools": true, "kmod": true} },
		Background: func(script string) { later = append(later, script) }}
	load := func() *model.Model { _, m, _ := st.Read(); return m }
	n := len(load().People[who].Devices)
	ask := func(method, path, body, remote string, https bool) (int, map[string]any) {
		q := PortalRequest{Method: method, Path: "/" + code + path, Host: "vpn.example.org:4500", HTTPS: https, Remote: remote}
		if !https {
			q.Host = "203.0.113.7:4501"
		}
		if method == "POST" {
			q.ContentType, q.Origin, q.Body, q.ContentLength = "application/json", "https://"+q.Host, strings.NewReader(body), int64(len(body))
			if !https {
				q.Origin = "http://" + q.Host
			}
		}
		a := Portal(d, q)
		var out map[string]any
		json.Unmarshal(a.Body, &out)
		return a.Status, out
	}
	// a new device: theirs, made by the portal, its configuration in the answer and the state after
	status, res := ask("POST", "/api/devices", `{"name":"Tablet","kind":"tablet","lan_bypass":true}`, "198.51.100.9", true)
	id, _ := res["id"].(string)
	dev := load().Devices[id]
	if status != 200 || dev == nil || dev.Person != who || dev.CreatedBy != "portal" || !dev.LanBypass || dev.Kind != "tablet" {
		t.Fatalf("a new device: %d %v", status, res["error"])
	}
	cfg, _ := res["config"].(map[string]any)
	state, _ := res["state"].(map[string]any)
	person, _ := state["person"].(map[string]any)
	if !strings.Contains(cfg["conf"].(string), "[Interface]") || len(person["devices"].([]any)) != n+1 {
		t.Errorf("the answer to a new device: %v", res)
	}
	// with the browser's own key the private key never reaches the router
	const pub = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbA="
	status, res = ask("POST", "/api/devices", `{"name":"Desk","kind":"computer","public_key":"zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzA="}`, "198.51.100.9", true)
	laptop, _ := res["id"].(string)
	if dev := load().Devices[laptop]; status != 200 || dev == nil || dev.PublicKey != "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzA=" || dev.PrivateKey != "" {
		t.Fatalf("a device with the browser's key: %d %v", status, res["error"])
	}
	_ = pub
	// the limit holds the portal (the admin is not held to it)
	if n != 3 {
		t.Fatalf("the household changed: %d devices", n)
	}
	if status, res = ask("POST", "/api/devices", `{"name":"One more","kind":"phone"}`, "198.51.100.9", true); status != 400 || res["error"] != "Device limit reached (5)." {
		t.Errorf("over the limit: %d %v", status, res)
	}
	if state, _ := ask("GET", "/api/state", "", "198.51.100.9", true); state != 200 {
		t.Errorf("the state: %d", state)
	}
	// a rename, LAN Bypass, and what is somebody else's
	if status, _ = ask("POST", "/api/devices/"+id, `{"action":"rename","name":"Big tablet"}`, "198.51.100.9", true); status != 200 || load().Devices[id].Name != "Big tablet" {
		t.Errorf("a rename: %d", status)
	}
	if status, _ = ask("POST", "/api/devices/"+id, `{"action":"bypass","on":false}`, "198.51.100.9", true); status != 200 || load().Devices[id].LanBypass {
		t.Errorf("LAN Bypass off: %d", status)
	}
	if theirs != "" {
		if status, res = ask("POST", "/api/devices/"+theirs, `{"action":"delete"}`, "198.51.100.9", true); status != 404 || load().Devices[theirs] == nil {
			t.Errorf("another person's device: %d %v", status, res)
		}
	}
	// set up again from the device itself: the keys change now, and are loaded a moment after the answer
	was := load().Devices[id].PublicKey
	later = nil
	status, res = ask("POST", "/api/devices/"+id, `{"action":"reconnect","kind":"phone"}`, load().Devices[id].Address, true)
	now := load().Devices[id]
	if status != 200 || now.PublicKey == was || now.Kind != "phone" || len(later) != 1 || !strings.Contains(later[0], "dawnline sync") || res["config"] == nil {
		t.Errorf("set up again: %d, later %v, %v", status, later, res["error"])
	}
	// keys never travel in the clear: the answer names the HTTPS link
	status, res = ask("GET", "/api/devices/"+id+"/config", "", "198.51.100.9", false)
	if status != 403 || res["https_url"] != "https://203.0.113.7:4500/"+code {
		t.Errorf("a configuration over plain HTTP: %d %v", status, res)
	}
	if status, res = ask("GET", "/api/state", "", "198.51.100.9", false); status != 200 || res["https_url"] != "https://203.0.113.7:4500/"+code {
		t.Errorf("the state over plain HTTP: %d %v", status, res["https_url"])
	}
	// a device the admin turned off is not the portal's to change
	c2, _, _ := st.Read()
	c2.Set(id, "disabled", "1")
	os.WriteFile(dir+"/dawnline", []byte(c2.Format()), 0o600)
	if status, res = ask("POST", "/api/devices/"+id, `{"action":"rename","name":"Mine again"}`, "198.51.100.9", true); status != 400 || res["error"] != "The admin has turned this device off." {
		t.Errorf("a device turned off: %d %v", status, res)
	}
	// a person the admin paused sees their page and changes nothing
	c2.Set(who, "paused", "1")
	os.WriteFile(dir+"/dawnline", []byte(c2.Format()), 0o600)
	if status, res = ask("POST", "/api/devices/"+laptop, `{"action":"delete"}`, "198.51.100.9", true); status != 403 || res["error"] != "Your access is paused." || load().Devices[laptop] == nil {
		t.Errorf("a paused person's change: %d %v", status, res)
	}
	if status, res = ask("GET", "/api/state", "", "198.51.100.9", true); status != 200 || res["locked"] != true {
		t.Errorf("a paused person's page: %d %v", status, res["locked"])
	}
	c2.Delete(who, "paused")
	os.WriteFile(dir+"/dawnline", []byte(c2.Format()), 0o600)
	if status, _ = ask("POST", "/api/devices/"+laptop, `{"action":"delete"}`, "198.51.100.9", true); status != 200 || load().Devices[laptop] != nil {
		t.Errorf("a delete: %d", status)
	}
	// the activity log says who did it
	raw, _ := os.ReadFile(dir + "/events.json")
	if !strings.Contains(string(raw), `"by":"portal"`) || !strings.Contains(string(raw), "device_removed") || strings.Contains(string(raw), `"by":"admin"`) {
		t.Errorf("the activity log: %.300s", raw)
	}
	_ = mine
}

// Wrong codes are counted a client, and a client over the limit is told nothing new; a link is held to
// forty changes a quarter hour; a valid link always opens.
func TestPortalLimits(t *testing.T) {
	dir := t.TempDir()
	text, _ := os.ReadFile("../access/testdata/access.uci")
	c, _ := uci.Parse(string(text))
	who := c.OfType("person")[0].Name
	c.Set(who, "code", "kamiro-telosu-bavine")
	var dev string
	for _, s := range c.OfType("device") {
		if p, _ := s.Get("person"); p == who && dev == "" {
			dev = s.Name
		}
	}
	os.WriteFile(dir+"/dawnline", []byte(c.Format()), 0o600)
	st := &store.Store{Config: dir + "/dawnline", RunDir: dir}
	d := Deps{Store: st, Config: dir + "/dawnline", RunDir: dir, DataDir: dir + "/data", World: func() *view.World {
		_, m, _ := st.Read()
		return &view.World{M: m, Usage: usage.Empty(), Now: time.Now().Unix()}
	}}
	get := func(path, remote, cf string) PortalAnswer {
		return Portal(d, PortalRequest{Method: "GET", Path: path, Host: "vpn.example.org:4500", HTTPS: true, Remote: remote, CFConnectingIP: cf})
	}
	for i := 0; i < 20; i++ {
		if a := get("/zzzzzz-zzzzzz-zzzzzz", "2001:db8:1:2:3:4:5:"+string(rune('a'+i%6)), ""); a.Status != 404 || string(a.Body) != "Not found\n" {
			t.Fatalf("a wrong code: %d %q", a.Status, a.Body)
		}
	}
	var rates map[string]struct{ Count int }
	raw, _ := os.ReadFile(dir + "/portal-rate.json")
	json.Unmarshal(raw, &rates)
	// one /64 is one client; counted to the limit and no further
	if len(rates) != 1 || rates["2001:db8:1:2::/64"].Count != portalFailLimit {
		t.Errorf("the count of wrong codes: %s", raw)
	}
	log, _ := os.ReadFile(dir + "/events.json")
	if strings.Count(string(log), "portal_blocked") != 1 || !strings.Contains(string(log), "2001:db8:1:2::/64") {
		t.Errorf("a blocked client is told once: %.300s", log)
	}
	// the link's owner opens it from that very address all the same
	if a := get("/kamiro-telosu-bavine", "2001:db8:1:2::9", ""); a.Status != 200 || !strings.Contains(string(a.Body), `data-base="/kamiro-telosu-bavine"`) {
		t.Errorf("a valid link from a blocked address: %d", a.Status)
	}
	// behind Cloudflare the visitor is who it says, and only then
	get("/zzzzzz-zzzzzz-zzzzzz", "173.245.48.5", "198.51.100.77")
	get("/zzzzzz-zzzzzz-zzzzzz", "198.51.100.200", "198.51.100.78")
	raw, _ = os.ReadFile(dir + "/portal-rate.json")
	json.Unmarshal(raw, &rates)
	if rates["198.51.100.77"].Count != 1 || rates["cloudflare"].Count != 1 || rates["198.51.100.200"].Count != 1 || rates["198.51.100.78"].Count != 0 {
		t.Errorf("the buckets: %s", raw)
	}
	// what is no link at all is not counted, and files never become a redirect
	c.Set("settings", "portal_redirect", "https://example.org/")
	os.WriteFile(dir+"/dawnline", []byte(c.Format()), 0o600)
	if a := get("/", "203.0.113.50", ""); a.Status != 302 {
		t.Errorf("the redirect: %d", a.Status)
	}
	if a := get("/favicon.ico", "203.0.113.50", ""); a.Status != 404 {
		t.Errorf("a file: %d", a.Status)
	}
	raw, _ = os.ReadFile(dir + "/portal-rate.json")
	if strings.Contains(string(raw), "203.0.113.50") {
		t.Error("a path that is no link was counted")
	}
	// plain HTTP only for an address chosen in Settings
	plain := func(host string) int {
		return Portal(d, PortalRequest{Method: "GET", Path: "/kamiro-telosu-bavine", Host: host, Remote: "203.0.113.50"}).Status
	}
	if plain("203.0.113.7:4501") != 200 || plain("vpn.example.org:4501") != 302 || plain("198.51.100.1:4501") != 302 {
		t.Error("plain HTTP is open for more than the chosen address, or closed for it")
	}
	// forty changes a quarter hour through one link
	last := 0
	for i := 0; i <= portalActionLimit; i++ {
		body := `{"action":"bypass","on":` + map[bool]string{true: "true", false: "false"}[i%2 == 0] + `}`
		last = Portal(d, PortalRequest{Method: "POST", Path: "/kamiro-telosu-bavine/api/devices/" + dev, Host: "vpn.example.org:4500", HTTPS: true, Remote: "203.0.113.60",
			ContentType: "application/json", Origin: "https://vpn.example.org:4500", Body: strings.NewReader(body), ContentLength: int64(len(body))}).Status
		if i < portalActionLimit && last != 200 {
			t.Fatalf("change %d: %d", i, last)
		}
	}
	if last != 429 {
		t.Errorf("the forty-first change: %d", last)
	}
}
