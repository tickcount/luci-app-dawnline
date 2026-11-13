package methods

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	backend "github.com/tickcount/luci-app-dawnline/backend"
	"github.com/tickcount/luci-app-dawnline/backend/access"
	"github.com/tickcount/luci-app-dawnline/backend/endpoint"
	"github.com/tickcount/luci-app-dawnline/backend/files"
	"github.com/tickcount/luci-app-dawnline/backend/handout"
	"github.com/tickcount/luci-app-dawnline/backend/i18n"
	"github.com/tickcount/luci-app-dawnline/backend/ipnet"
	"github.com/tickcount/luci-app-dawnline/backend/journal"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/state"
	"github.com/tickcount/luci-app-dawnline/backend/view"
	"github.com/tickcount/luci-app-dawnline/backend/zone"
)

// The personal portal's answers (dawnline.portal):
//
//	GET  /<code>                          the app shell
//	GET  /<code>/assets/<file>            its script and styles (gzipped when the browser takes it)
//	GET  /<code>/api/state
//	POST /<code>/api/devices              { name, kind, public_key?, lan_bypass?, networks? }
//	GET  /<code>/api/devices/<id>/config
//	POST /<code>/api/devices/<id>         { action: rename|reconnect|bypass|networks|delete, name?, kind?, lan_bypass?, on?, networks?, cleared? }
//
// The personal link is the key: every request carries its code, there are no sessions. Without a valid
// code every path answers the same bare 404, so nothing tells a scanner there is a portal here. Wrong
// codes are counted per client (a blocked client gets the same 404 for a wrong code; a valid link always
// opens): per IPv4 address or IPv6 /64, behind Cloudflare per visitor, with a higher ceiling for all
// Cloudflare visitors together. POST bodies must be JSON from the same origin. The portal can only manage
// the person's own devices within their limits, and not those the admin turned off (Actor). Changes
// through a link are limited too, and the configurations themselves (keys, the disguise) only go over
// HTTPS: a plain-HTTP link shows the page, but gets them from its HTTPS twin.

const (
	portalFailLimit   = 8
	portalFailWindow  = 900
	portalSharedLimit = portalFailLimit * 25
	portalSharedKey   = "cloudflare"
	portalRateMax     = 2000
	portalActionLimit = 40
	portalBodyMax     = 8192
)

// PortalAssets is where the portal's script and styles are kept (outside any web root).
var PortalAssets = "/usr/share/dawnline/portal/assets"

// PortalRequest is one request to the portal.
type PortalRequest struct {
	Method, Path, Host             string
	HTTPS                          bool
	Remote, CFConnectingIP         string
	Origin, ContentType            string
	AcceptLanguage, AcceptEncoding string
	ContentLength                  int64
	Body                           io.Reader
	// Live: the page has a stream to follow (the shell tells it).
	Live bool
}

// PortalAnswer is what it gets.
type PortalAnswer struct {
	Status int
	Header [][2]string
	Body   []byte
}

type portalDone struct{ a PortalAnswer }

type portalCall struct {
	d       Deps
	q       PortalRequest
	t       *i18n.Catalog
	w       *view.World
	person  *model.Person
	base    string
	buckets []portalBucket
}

type portalBucket struct {
	key   string
	limit int
}

var (
	wordCode   = regexp.MustCompile(`^[a-z]{6}-[a-z]{6}-[a-z]{6}$`)
	assetName  = regexp.MustCompile(`^[a-z0-9-]+\.(js|css|png)$`)
	takesGzip  = regexp.MustCompile(`(^|[ ,])gzip([ ;,]|$)`)
	firstLang  = regexp.MustCompile(`^[ \t]*([A-Za-z][A-Za-z][A-Za-z]?)`)
	portOfHost = regexp.MustCompile(`:([0-9]+)$`)
	jsonType   = regexp.MustCompile(`^application/json`)
	bareFile   = regexp.MustCompile(`^/(luci-static|cgi-bin|ubus)(/|$)`)
	assetTypes = map[string]string{"js": "text/javascript", "css": "text/css", "png": "image/png"}
)

func (c *portalCall) answer(status int, extra [][2]string, body []byte) {
	h := [][2]string{{"X-Content-Type-Options", "nosniff"}, {"Referrer-Policy", "no-referrer"}, {"X-Frame-Options", "DENY"}, {"Cache-Control", "no-store"}}
	for _, kv := range extra {
		replaced := false
		for i := range h {
			if h[i][0] == kv[0] {
				h[i][1], replaced = kv[1], true
			}
		}
		if !replaced {
			h = append(h, kv)
		}
	}
	// HSTS pins the whole name: only when the visitor is on the standard port
	port := "443"
	if m := portOfHost.FindStringSubmatch(c.q.Host); m != nil {
		port = m[1]
	}
	if c.q.HTTPS && port == "443" {
		h = append(h, [2]string{"Strict-Transport-Security", "max-age=31536000"})
	}
	panic(portalDone{PortalAnswer{Status: status, Header: h, Body: body}})
}

func (c *portalCall) json(status int, v any) {
	raw, _ := json.Marshal(v)
	c.answer(status, [][2]string{{"Content-Type", "application/json"}}, raw)
}

func (c *portalCall) fail(status int, msg string) {
	c.json(status, map[string]any{"error": msg})
}

// refuse is fail for what a change said: its words in the visitor's language.
func (c *portalCall) refuse(status int, err error) {
	switch s := err.(type) {
	case access.Said:
		c.fail(status, fmt.Sprintf(c.t.T(s.Msg), s.Args...))
	case said:
		c.fail(status, fmt.Sprintf(c.t.T(s.msg), s.args...))
	default:
		c.fail(status, wordsOf(c.t, err, nil))
	}
}

// notFound is the one answer for anything without a valid code: a bare 404, or the redirect from
// Settings. Files always get the 404: a missing asset must not turn into someone's website.
func (c *portalCall) notFound() {
	parts := strings.Split(c.q.Path, "/")
	file := bareFile.MatchString(c.q.Path) || strings.Contains(parts[len(parts)-1], ".")
	if to := c.w.M.Settings.PortalRedirect; to != "" && !file {
		c.answer(302, [][2]string{{"Location", to}, {"Cache-Control", "no-store"}, {"Content-Type", "text/plain"}}, []byte("Moved\n"))
	}
	c.answer(404, [][2]string{{"Content-Type", "text/plain"}}, []byte("Not found\n"))
}

/* ---------- rate limiting ---------- */

// addrKey is the rate-limit key of an address: an IPv4 address, or the /64 of an IPv6 one ("": neither).
func addrKey(a string) string {
	ip, err := netip.ParseAddr(a)
	if err != nil {
		return ""
	}
	if ip.Is4() {
		return ip.String()
	}
	// an IPv4 address seen through an IPv6 socket
	if ip.Is4In6() {
		return ip.Unmap().String()
	}
	b := ip.As16()
	return fmt.Sprintf("%x:%x:%x:%x::/64", uint16(b[0])<<8|uint16(b[1]), uint16(b[2])<<8|uint16(b[3]), uint16(b[4])<<8|uint16(b[5]), uint16(b[6])<<8|uint16(b[7]))
}

// portalBuckets is what a request counts against: its client, and behind Cloudflare (the only proxy whose
// CF-Connecting-IP is believed) also the bucket all Cloudflare visitors share.
func portalBuckets(q PortalRequest) []portalBucket {
	if !endpoint.Cloudflare(q.Remote) {
		key := addrKey(q.Remote)
		if key == "" {
			key = q.Remote
		}
		return []portalBucket{{key, portalFailLimit}}
	}
	out := []portalBucket{{portalSharedKey, portalSharedLimit}}
	if v := addrKey(strings.TrimSpace(q.CFConnectingIP)); v != "" && !endpoint.Cloudflare(v) {
		out = append([]portalBucket{{v, portalFailLimit}}, out...)
	}
	return out
}

type portalRate struct {
	First int64 `json:"first"`
	Count int   `json:"count"`
}

func (c *portalCall) rates() map[string]*portalRate {
	st := map[string]*portalRate{}
	files.ReadJSON(c.d.RunDir+"/portal-rate.json", &st)
	now := time.Now().Unix()
	for k, v := range st {
		if v == nil || now-v.First > portalFailWindow {
			delete(st, k)
		}
	}
	return st
}

func (c *portalCall) blocked() bool {
	st := c.rates()
	for _, b := range c.buckets {
		if v := st[b.key]; v != nil && v.Count >= b.limit {
			return true
		}
	}
	return false
}

// wrongCode counts a well-formed guess; a bucket that just filled is told in the activity log.
func (c *portalCall) wrongCode() {
	var hit []string
	func() {
		defer files.Lock(c.d.RunDir, "portal-rate")()
		st := c.rates()
		now := time.Now().Unix()
		for _, b := range c.buckets {
			v := st[b.key]
			if v == nil {
				v = &portalRate{First: now}
				st[b.key] = v
			}
			if v.Count++; v.Count == b.limit {
				hit = append(hit, b.key)
			}
		}
		// bounded: an attacker with many addresses cannot grow the file without end
		if over := len(st) - portalRateMax; over > 0 {
			keys := make([]string, 0, len(st))
			for k := range st {
				keys = append(keys, k)
			}
			sort.Slice(keys, func(i, j int) bool { return st[keys[i]].First < st[keys[j]].First })
			for _, k := range keys[:over] {
				delete(st, k)
			}
		}
		os.MkdirAll(c.d.RunDir, 0o755)
		files.WriteJSON(c.d.RunDir+"/portal-rate.json", st, 0o600)
	}()
	for _, k := range hit {
		if k == portalSharedKey {
			k = "all Cloudflare visitors"
		}
		logged(c.d, journal.Event{"type": "portal_blocked", "detail": k})
	}
}

// action counts one more change through this link; refused beyond the limit a window.
func (c *portalCall) action() {
	over := false
	func() {
		defer files.Lock(c.d.RunDir, "portal-rate")()
		st := c.rates()
		key := "act:" + c.person.ID
		v := st[key]
		if v == nil {
			v = &portalRate{First: time.Now().Unix()}
			st[key] = v
		}
		v.Count++
		over = v.Count > portalActionLimit
		os.MkdirAll(c.d.RunDir, 0o755)
		files.WriteJSON(c.d.RunDir+"/portal-rate.json", st, 0o600)
	}()
	if over {
		c.fail(429, c.t.T("Too many changes in a short time. Try again in a few minutes."))
	}
}

/* ---------- pages ---------- */

var htmlEscape = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;")

// shell is the app shell; it reads the code from its own URL and sends it along.
func (c *portalCall) shell() {
	// the build's time joins the version: every update gives the assets new URLs, so they are kept for good
	var built int64
	if st, err := os.Stat(PortalAssets + "/portal.js"); err == nil {
		built = st.ModTime().Unix()
	}
	v := fmt.Sprintf("?v=%s.%d", backend.Version, built)
	title := "Dawnline"
	if srv := c.w.M.Servers[c.person.Server]; srv != nil && srv.Name != "" {
		title = srv.Name
	}
	// the icon goes in the page: a request of its own is one more round trip
	favicon := ""
	if icon, err := os.ReadFile(PortalAssets + "/icon.svg"); err == nil && len(icon) > 0 {
		favicon = `<link rel="icon" href="data:image/svg+xml;base64,` + base64.StdEncoding.EncodeToString(icon) + `" type="image/svg+xml">` + "\n"
	}
	live := ""
	if c.q.Live {
		live = ` data-live="1"`
	}
	page := `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex, nofollow">
<title>` + htmlEscape.Replace(title) + `</title>
` + favicon + `<link rel="stylesheet" href="` + c.base + `/assets/portal.css` + v + `">
</head>
<body>
<div id="app" data-base="` + htmlEscape.Replace(c.base) + `" data-title="` + htmlEscape.Replace(title) + `"` + live + `></div>
<script src="` + c.base + `/assets/portal.js` + v + `" defer></script>
</body>
</html>
`
	c.answer(200, [][2]string{{"Content-Type", "text/html; charset=utf-8"},
		{"Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; " +
			"connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"}}, []byte(page))
}

// asset is the script and the styles; the shell's ?v= changes with every build, so they never go stale.
func (c *portalCall) asset(name string) {
	m := assetName.FindStringSubmatch(name)
	if m == nil {
		c.notFound()
	}
	h := [][2]string{{"Content-Type", assetTypes[m[1]]}, {"Cache-Control", "private, max-age=31536000, immutable"}, {"Vary", "Accept-Encoding"}}
	// the build keeps a gzipped copy beside each: a third of the bytes for a browser that takes it
	if takesGzip.MatchString(strings.ToLower(c.q.AcceptEncoding)) {
		if gz, err := os.ReadFile(PortalAssets + "/" + name + ".gz"); err == nil {
			c.answer(200, append(h, [2]string{"Content-Encoding", "gzip"}), gz)
		}
	}
	data, err := os.ReadFile(PortalAssets + "/" + name)
	if err != nil {
		c.notFound()
	}
	c.answer(200, h, data)
}

/* ---------- the API ---------- */

// reload is the settings again after a change.
func (c *portalCall) reload() {
	c.w = c.d.World()
	if c.w == nil {
		c.fail(503, c.t.T("The router is still starting. Try again in a moment."))
	}
	if c.person = c.w.M.People[c.person.ID]; c.person == nil {
		c.notFound()
	}
}

// personState is the person's state for the page: a stop by the admin (pause, end of access) wins over
// their server being off, so they learn that their access is stopped.
func (c *portalCall) personState() string {
	st := state.Of(c.w.M, c.person, c.w.Usage, c.w.Now)
	if st == "server_off" {
		if own := state.Own(c.person, c.w.Usage, c.w.Now); own == "paused" || own == "expired" {
			return own
		}
	}
	return st
}

// needOpen refuses a change (or a configuration) while the person is stopped.
func (c *portalCall) needOpen() {
	switch c.personState() {
	case "paused":
		c.fail(403, c.t.T("Your access is paused."))
	case "expired":
		c.fail(403, c.t.T("Your access has ended."))
	}
}

// httpsURL is the same link over HTTPS (for a plain-HTTP visitor), or "" when this is it.
func (c *portalCall) httpsURL() string {
	if c.q.HTTPS {
		return ""
	}
	h := strings.SplitN(c.q.Host, ":", 2)[0]
	if strings.HasPrefix(c.q.Host, "[") {
		if i := strings.Index(c.q.Host, "]"); i > 0 {
			h = c.q.Host[:i+1]
		}
	}
	port := ""
	if p := c.w.M.Settings.PortalPort; p != 443 {
		port = ":" + strconv.Itoa(p)
	}
	return "https://" + h + port + c.base
}

// needHTTPS: keys and the disguise never travel in the clear; the answer names the HTTPS link to use.
func (c *portalCall) needHTTPS() {
	if u := c.httpsURL(); u != "" {
		c.json(403, map[string]any{"error": c.t.T("Open this link over HTTPS to get the connection settings."), "https_url": u})
	}
}

func (c *portalCall) notReady() {
	st := map[string]any{}
	if c.d.AWG != nil {
		st = c.d.AWG()
	}
	if c.d.AWG != nil && !(st["tools"] == true && st["kmod"] == true) {
		c.fail(503, c.t.T("Adding devices isn't available right now: the VPN server isn't ready. Ask whoever sent you this link."))
	}
}

// PortalState is everything a person's page shows, for a visitor at `peer` (which of the person's
// devices the page is open on), over HTTPS or not, at `host`.
func PortalState(w *view.World, d Deps, person *model.Person, peer, host string, https bool) map[string]any {
	c := &portalCall{d: d, w: w, person: person, base: "/" + person.Code, q: PortalRequest{Remote: peer, Host: host, HTTPS: https}}
	return c.state()
}

func (c *portalCall) state() map[string]any {
	m, p := c.w.M, c.person
	v := c.w.PersonOf(p, false)
	raw, _ := json.Marshal(v)
	var pv map[string]any
	json.Unmarshal(raw, &pv)
	st := c.personState()
	pv["state"] = st
	// day by day this month, for the page's chart
	pv["month_days"] = view.Spark(c.w.Usage.People[p.ID], 30, c.w.Now)
	// the device this page was opened from, through the tunnel or beside it
	var here any
	peer := strings.TrimPrefix(c.q.Remote, "::ffff:")
	if peer != "" {
		var near []string
		for _, dv := range v.Devices {
			if dv.Address == peer {
				here, near = dv.ID, nil
				break
			}
			if dv.Online && dv.Endpoint == peer {
				near = append(near, dv.ID)
			}
		}
		if here == nil && len(near) == 1 {
			here = near[0]
		}
	}
	server := map[string]any{"name": nil, "endpoint": "", "device_mesh": false, "awg_disguise": false, "preset": "off", "home": []string{},
		"routers": "off", "nets": "ask"}
	kinds := deviceKinds
	if srv := m.Servers[p.Server]; srv != nil {
		// what the page offers about routers: a router among the kinds, and whether it and its networks are asked
		server["routers"], server["nets"] = srv.PortalRouters, srv.PortalNets
		if srv.PortalRouters == "off" {
			kinds = without(deviceKinds, []string{"router"})
		}
		neutral := handout.ObfNeutral(srv.Obf)
		server["name"], server["endpoint"], server["device_mesh"], server["awg_disguise"] = srv.Name, m.EndpointHost(srv), srv.DeviceMesh, !neutral
		// which apps (and versions) connect: off, balanced (2.0), max (3.1); legacy = the old junk-only presets
		switch {
		case neutral:
		case srv.Preset == "balanced" || srv.Preset == "max":
			server["preset"] = srv.Preset
		default:
			server["preset"] = "legacy"
		}
		// the home networks a device with LAN Bypass still sends into the tunnel
		if p.Access == "both" && c.d.Home != nil {
			if home := c.d.Home(srv, p); home != nil {
				server["home"] = home
			}
		}
	}
	now := time.Unix(c.w.Now, 0).In(zone.Local())
	var https any
	if u := c.httpsURL(); u != "" {
		https = u
	}
	return map[string]any{
		"person": pv, "here": here, "server": server,
		"can_add": len(p.Devices) < p.DeviceLimit, "locked": st == "paused" || st == "expired",
		// over plain HTTP: where the configurations are (keys only travel encrypted)
		"https_url": https, "kinds": kinds,
		// the router's day and clock: access ends by them, not the browser's
		"today": now.Format("2006-01-02"), "now": c.w.Now, "version": backend.Version,
	}
}

// body is the JSON object a POST carries ({} without a body).
func (c *portalCall) body() map[string]any {
	if c.q.ContentLength <= 0 || c.q.Body == nil {
		return map[string]any{}
	}
	if c.q.ContentLength > portalBodyMax {
		c.fail(413, c.t.T("Request too large."))
	}
	raw, _ := io.ReadAll(io.LimitReader(c.q.Body, c.q.ContentLength))
	var v any
	if json.Unmarshal(raw, &v) != nil {
		c.fail(400, c.t.T("Invalid JSON."))
	}
	if obj, is := v.(map[string]any); is {
		return obj
	}
	return map[string]any{}
}

// withIP is a configuration as the portal sends it: with the server's address as an IP too, for an app
// that takes no name for AmneziaWG.
func (c *portalCall) withIP(cfg map[string]any) map[string]any {
	if am, ok := cfg["amnezia"].(map[string]any); ok && c.d.HostIP != nil {
		am["host_ip"] = nil
		if ip := c.d.HostIP(text(am["host"])); ip != "" {
			am["host_ip"] = ip
		}
	}
	return cfg
}

func (c *portalCall) ownDevice(id string) *model.Device {
	dev := c.w.M.Devices[id]
	if dev == nil || dev.Person != c.person.ID {
		c.fail(404, c.t.T("Device not found."))
	}
	return dev
}

func (c *portalCall) api(method string, segs []string) {
	lang := ""
	if m := firstLang.FindStringSubmatch(c.q.AcceptLanguage); m != nil {
		lang = m[1]
	}
	who := Actor{By: "portal", Person: c.person.ID}
	switch {
	case method == "GET" && len(segs) == 1 && segs[0] == "state":
		c.json(200, c.state())
	case method == "POST" && len(segs) == 1 && segs[0] == "devices":
		c.needOpen()
		c.needHTTPS()
		b := c.body()
		c.notReady()
		c.action()
		who.PublicKey = text(b["public_key"])
		res, err := DeviceCreateAs(c.d, map[string]any{"person": c.person.ID, "name": b["name"], "kind": text(b["kind"]), "lan_bypass": b["lan_bypass"] == true,
			"networks": b["networks"], "lang": lang}, who)
		if err != nil {
			c.refuse(400, err)
		}
		c.reload()
		// a router asked of the admin has no configuration yet: the page says it waits
		if res["waiting"] == true {
			c.json(200, map[string]any{"id": res["id"], "waiting": true, "state": c.state()})
		}
		cfg, _ := res["config"].(map[string]any)
		c.json(200, map[string]any{"id": res["id"], "config": c.withIP(cfg), "state": c.state()})
	case method == "GET" && len(segs) == 3 && segs[0] == "devices" && segs[2] == "config":
		dev := c.ownDevice(segs[1])
		c.needOpen()
		c.needHTTPS()
		if dev.Waiting {
			c.fail(409, c.t.T("This router waits for an answer to its request: it has no configuration yet."))
		}
		markIssued(c.d, c.w.M, dev.ID)
		c.json(200, c.withIP(configOf(c.d, c.w.M, dev.ID)))
	case method == "POST" && len(segs) == 2 && segs[0] == "devices":
		dev := c.ownDevice(segs[1])
		c.needOpen()
		b := c.body()
		out := map[string]any{"ok": true}
		var err error
		switch b["action"] {
		case "rename":
			c.action()
			_, err = DeviceUpdateAs(c.d, map[string]any{"id": dev.ID, "name": b["name"], "lang": lang}, who)
		case "reconnect":
			// set up from scratch: new keys and the new configuration, which the set-up sheet takes in
			c.action()
			c.needHTTPS()
			c.notReady()
			a := map[string]any{"id": dev.ID, "lang": lang}
			// what it is and LAN Bypass may change with the keys (the sheet asks again); left out, they stay
			if k, is := b["kind"].(string); is {
				a["kind"] = k
			}
			if on, is := b["lan_bypass"].(bool); is {
				a["lan_bypass"] = on
			}
			who.Defer = dev.Address == strings.TrimPrefix(c.q.Remote, "::ffff:")
			var cfg map[string]any
			if cfg, err = DeviceRotateAs(c.d, a, who); err == nil {
				out["config"] = c.withIP(cfg)
			}
		case "bypass":
			// LAN Bypass on or off, keys unchanged: the device takes its updated configuration
			c.action()
			c.needHTTPS()
			on, is := b["on"].(bool)
			if !is {
				c.fail(400, c.t.T("Unknown action."))
			}
			_, err = DeviceUpdateAs(c.d, map[string]any{"id": dev.ID, "lan_bypass": on, "lang": lang}, who)
		case "networks":
			// the networks behind a router as its owner wants them; turned-down ones they put away
			c.action()
			_, err = DeviceWishAs(c.d, map[string]any{"id": dev.ID, "networks": b["networks"], "cleared": b["cleared"], "lang": lang}, who)
		case "delete":
			c.action()
			_, err = DeviceDeleteAs(c.d, dev.ID, lang, who)
		default:
			c.fail(400, c.t.T("Unknown action."))
		}
		if err != nil {
			c.refuse(400, err)
		}
		c.reload()
		out["state"] = c.state()
		c.json(200, out)
	}
	c.fail(404, c.t.T("Not found."))
}

// Portal answers one request to the portal.
func Portal(d Deps, q PortalRequest) (out PortalAnswer) {
	lang := ""
	if m := firstLang.FindStringSubmatch(q.AcceptLanguage); m != nil {
		lang = m[1]
	}
	c := &portalCall{d: d, q: q, t: i18n.Use(d.Catalogs, lang), buckets: portalBuckets(q)}
	defer func() {
		r := recover()
		switch x := r.(type) {
		case nil:
		case portalDone:
			out = x.a
		default:
			// what broke, the path without its first part (the person's link code is a secret)
			if d.Log != nil {
				rest := ""
				if i := strings.Index(strings.TrimPrefix(q.Path, "/"), "/"); i >= 0 {
					rest = strings.TrimPrefix(q.Path, "/")[i:]
				}
				d.Log.Say("error", "portal", fmt.Sprintf("%s /<link>%s: 500 · %v", q.Method, rest, r))
			}
			out = PortalAnswer{Status: 500, Header: [][2]string{{"Content-Type", "text/plain"}}, Body: []byte("Error\n")}
		}
	}()
	c.w = d.World()
	if c.w == nil {
		c.answer(503, [][2]string{{"Content-Type", "text/plain"}}, []byte("Starting\n"))
	}
	m := c.w.M
	var segs []string
	for _, s := range strings.Split(q.Path, "/") {
		if s != "" {
			segs = append(segs, s)
		}
	}
	// Plain HTTP only for an IP address chosen in Settings (no certificate exists for it); names stay HTTPS-only.
	if !q.HTTPS {
		h := strings.SplitN(q.Host, ":", 2)[0]
		if strings.HasPrefix(q.Host, "[") {
			h = q.Host
		}
		_, isIP := ipnet.IP(h)
		chosen := false
		for _, x := range view.PortalHosts(m) {
			chosen = chosen || x == h
		}
		if !isIP || !chosen {
			c.notFound()
		}
	}
	// the link is /<word-code>[/assets/…|/api/…]: the code is the address
	if len(segs) < 1 || !wordCode.MatchString(segs[0]) {
		c.notFound()
	}
	for _, id := range m.PersonIDs() {
		if p := m.People[id]; p.Code == segs[0] {
			c.person = p
		}
	}
	// A wrong code is indistinguishable from a path that does not exist. Only well-formed guesses count
	// towards the limit, and a client over it is just no longer counted: a valid link always opens, so
	// guesses from a shared address cannot lock its owner out.
	if c.person == nil {
		if !c.blocked() {
			c.wrongCode()
		}
		c.notFound()
	}
	c.base = "/" + segs[0]
	rest := segs[1:]
	if len(rest) == 0 && q.Method == "GET" {
		c.shell()
	}
	if len(rest) == 2 && rest[0] == "assets" && q.Method == "GET" {
		c.asset(rest[1])
	}
	if len(rest) == 0 || rest[0] != "api" {
		c.notFound()
	}
	// CSRF: only same-origin JSON requests (a cross-site page cannot send application/json without CORS,
	// and it would need the code anyway)
	switch q.Method {
	case "POST":
		scheme := "http"
		if q.HTTPS {
			scheme = "https"
		}
		if !jsonType.MatchString(q.ContentType) || (q.Origin != "" && q.Origin != scheme+"://"+q.Host) {
			c.fail(403, c.t.T("Cross-site request refused."))
		}
	case "GET":
	default:
		c.fail(405, c.t.T("Method not allowed."))
	}
	c.api(q.Method, rest[1:])
	return out
}

// PortalHandler is Portal as a web server's handler; live: the pages it serves have a stream to follow.
func PortalHandler(d Deps, live bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		remote := r.RemoteAddr
		if host, _, err := net.SplitHostPort(remote); err == nil {
			remote = host
		}
		a := Portal(d, PortalRequest{Method: r.Method, Path: r.URL.Path, Host: r.Host, HTTPS: r.TLS != nil, Remote: remote,
			CFConnectingIP: r.Header.Get("Cf-Connecting-Ip"), Origin: r.Header.Get("Origin"), ContentType: r.Header.Get("Content-Type"),
			AcceptLanguage: r.Header.Get("Accept-Language"), AcceptEncoding: r.Header.Get("Accept-Encoding"),
			ContentLength: r.ContentLength, Body: r.Body, Live: live})
		for _, kv := range a.Header {
			w.Header().Set(kv[0], kv[1])
		}
		w.WriteHeader(a.Status)
		w.Write(a.Body)
	})
}
