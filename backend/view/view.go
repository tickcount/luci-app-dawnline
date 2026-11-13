// Package view is a person and their devices as the pages show them: the settings joined with what the
// tunnels say now, the counters and what was handed out. As dawnline.view makes them (device_view,
// person_view), field for field: the admin's status and the person's own page are both made of these.
//
// Pure: everything it reads comes in the World; the moment is the World's too.
package view

import (
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/awg"
	"github.com/tickcount/luci-app-dawnline/backend/handout"
	"github.com/tickcount/luci-app-dawnline/backend/ipnet"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/state"
	"github.com/tickcount/luci-app-dawnline/backend/usage"
	"github.com/tickcount/luci-app-dawnline/backend/zone"
)

// Issued is what a device was last given: its configuration's fingerprint, and when.
type Issued struct {
	FP string  `json:"fp"`
	TS float64 `json:"ts"`
}

// World is everything a view is made from.
type World struct {
	M     *model.Model
	Usage *usage.Usage
	// Peers is what the tunnels say, by public key; Reads how each tunnel's read went (awg.Read, awg.Failed).
	Peers map[string]awg.Peer
	Reads map[string]string
	// Online is the watcher's word on who is online; nil without a watcher (a recent handshake decides then,
	// within Windows[id] seconds, 190 by default).
	Online  map[string]bool
	Windows map[string]int64
	// Link is each device's link trouble; Setup what its link does right now (nil: no watcher tells).
	Link  map[string]any
	Setup map[string]any
	// Issued is what each device was last given; Reconnect when each was set up again.
	Issued    map[string]Issued
	Reconnect map[string]float64
	// Home is the home networks a person reaches on their server (the router's own; nil: none).
	Home func(srv *model.Server, p *model.Person) []string
	// Now is the moment (unix seconds).
	Now int64
}

// Device is a device as the pages show it.
type Device struct {
	ID            string       `json:"id"`
	Name          string       `json:"name"`
	Kind          string       `json:"kind"`
	Address       string       `json:"address"`
	Disabled      bool         `json:"disabled"`
	Created       int          `json:"created"`
	CreatedBy     string       `json:"created_by"`
	Online        bool         `json:"online"`
	Handshake     int64        `json:"handshake"`
	Endpoint      string       `json:"endpoint"`
	Active        bool         `json:"active"`
	Month         usage.Pair   `json:"month"`
	Total         usage.Pair   `json:"total"`
	Spark         []usage.Pair `json:"spark"`
	Hostname      string       `json:"hostname"`
	BrowserKey    bool         `json:"browser_key"`
	ConfigStale   bool         `json:"config_stale"`
	ConfigIssued  float64      `json:"config_issued"`
	LanBypass     bool         `json:"lan_bypass"`
	MTU           int          `json:"mtu"`
	Keepalive     *int         `json:"keepalive"`
	MTUUsed       *int         `json:"mtu_used"`
	KeepaliveUsed *int         `json:"keepalive_used"`
	Link          any          `json:"link"`
	Setup         any          `json:"setup"`
	// Behind is the networks behind a router, as the settings have them; then what its owner asked for on
	// their own page and how it stands (model.Device has each).
	Behind       []string `json:"behind,omitempty"`
	Waiting      bool     `json:"waiting,omitempty"`
	Ask          []string `json:"ask,omitempty"`
	Asked        int      `json:"asked,omitempty"`
	Declined     string   `json:"declined,omitempty"`
	DeclinedNets []string `json:"declined_nets,omitempty"`
}

// Person is a person as the pages show them. The fields from HasLink on are the admin's only.
type Person struct {
	ID            string     `json:"id"`
	Name          string     `json:"name"`
	Server        string     `json:"server"`
	Access        string     `json:"access"`
	DeviceLimit   int        `json:"device_limit"`
	Expires       string     `json:"expires"`
	QuotaGB       float64    `json:"quota_gb"`
	QuotaPeriod   string     `json:"quota_period"`
	QuotaUsed     float64    `json:"quota_used"`
	QuotaLimit    float64    `json:"quota_limit"`
	QuotaMonth    usage.Pair `json:"quota_month"`
	QuotaResets   int64      `json:"quota_resets"`
	QuotaResetDay string     `json:"quota_reset_day"`
	BonusGB       float64    `json:"bonus_gb"`
	DNSMode       string     `json:"dns_mode"`
	Paused        bool       `json:"paused"`
	State         string     `json:"state"`
	Month         usage.Pair `json:"month"`
	Total         usage.Pair `json:"total"`
	Online        int        `json:"online"`
	LastSeen      int64      `json:"last_seen"`
	Devices       []Device   `json:"devices"`

	HasLink  *bool     `json:"has_link,omitempty"`
	Note     *string   `json:"note,omitempty"`
	Services *[]string `json:"services,omitempty"`
	HomeNets *[]string `json:"home_nets,omitempty"`
	Circle   *string   `json:"circle,omitempty"`
	Created  *int      `json:"created,omitempty"`
	CodeSet  *int      `json:"code_set,omitempty"`
}

func dayKey(ts int64) string { return time.Unix(ts, 0).In(zone.Local()).Format("2006-01-02") }

// dayAgo is the day `days` before ts, counted from local noon, so a 23- or 25-hour day around a change of
// the clocks neither skips nor repeats a day.
func dayAgo(days int, ts int64) string {
	t := time.Unix(ts, 0).In(zone.Local())
	noon := time.Date(t.Year(), t.Month(), t.Day(), 12, 0, 0, 0, zone.Local()).Unix()
	return dayKey(noon - int64(days)*86400)
}

// recent is [rx, tx] of the last `days` days, today included.
func recent(rec *usage.Record, days int, ts int64) usage.Pair {
	var out usage.Pair
	if rec == nil {
		return out
	}
	for i := 0; i < days; i++ {
		if v, ok := rec.Days[dayAgo(i, ts)]; ok {
			out[0] += v[0]
			out[1] += v[1]
		}
	}
	return out
}

// Spark is each day's [rx, tx] for the last n days, oldest first.
func Spark(rec *usage.Record, n int, ts int64) []usage.Pair {
	out := make([]usage.Pair, 0, n)
	for i := n - 1; i >= 0; i-- {
		var v usage.Pair
		if rec != nil {
			v = rec.Days[dayAgo(i, ts)]
		}
		out = append(out, v)
	}
	return out
}

var notLabel = regexp.MustCompile(`[^a-z0-9]+`)

// HostLabel is a device's name as a DNS label ("Galaxy S24" → "galaxy-s24"): at most 40 characters,
// "device" when nothing is left.
func HostLabel(name string) string {
	l := notLabel.ReplaceAllString(strings.ToLower(handout.Translit(name)), "-")
	l = strings.Trim(l, "-")
	if len(l) > 40 {
		l = l[:40]
	}
	l = strings.TrimRight(l, "-")
	if l == "" {
		return "device"
	}
	return l
}

// Labels is the DNS labels of a person's devices, unique within the person: two devices whose names give
// one label get -2, -3 by age.
func Labels(m *model.Model, p *model.Person) map[string]string {
	devs := make([]*model.Device, 0, len(p.Devices))
	for _, id := range p.Devices {
		if d := m.Devices[id]; d != nil {
			devs = append(devs, d)
		}
	}
	sort.SliceStable(devs, func(i, j int) bool {
		if devs[i].Created != devs[j].Created {
			return devs[i].Created < devs[j].Created
		}
		return devs[i].ID < devs[j].ID
	})
	out, used := map[string]string{}, map[string]bool{}
	for _, d := range devs {
		base := HostLabel(d.Name)
		l := base
		for n := 2; used[l]; n++ {
			b := base
			if len(b) > 37 {
				b = b[:37]
			}
			l = b + "-" + itoa(n)
		}
		used[l] = true
		out[d.ID] = l
	}
	return out
}

func itoa(n int) string {
	if n < 10 {
		return string(rune('0' + n))
	}
	return itoa(n/10) + string(rune('0'+n%10))
}

var code = regexp.MustCompile(`^[a-z]{6}-[a-z]{6}-[a-z]{6}$`)

// PortalHosts is every address of the portal, the main one first.
func PortalHosts(m *model.Model) []string {
	var out []string
	for _, h := range append([]string{m.Settings.PortalHost}, m.Settings.PortalAlt...) {
		dup := false
		for _, o := range out {
			dup = dup || o == h
		}
		if h != "" && !dup {
			out = append(out, h)
		}
	}
	return out
}

// PortalLink is a person's link on one address: https for names, plain http for IP addresses; "" when the
// page would not answer (no portal, no server, no code).
func PortalLink(m *model.Model, p *model.Person, host string) string {
	if !m.Settings.PortalEnabled || host == "" || m.Servers[p.Server] == nil || !code.MatchString(p.Code) {
		return ""
	}
	port := func(n, std int) string {
		if n == std {
			return ""
		}
		return ":" + itoa(n)
	}
	if _, ip := ipnet.IP(host); ip {
		return "http://" + host + port(m.Settings.PortalPort+1, 80) + "/" + p.Code
	}
	h := host
	if strings.Contains(h, ":") && !strings.HasPrefix(h, "[") {
		h = "[" + h + "]"
	}
	return "https://" + h + port(m.Settings.PortalPort, 443) + "/" + p.Code
}

var endpoint = regexp.MustCompile(`^\[?([^\]]+)\]?:[0-9]+$`)

func endpointIP(ep string) string {
	if m := endpoint.FindStringSubmatch(ep); m != nil {
		return m[1]
	}
	return ep
}

// DeviceOf is one device's view. labels is its person's (Labels), worked out once for all their devices.
func (w *World) DeviceOf(d *model.Device, labels map[string]string) Device {
	m := w.M
	var u *usage.Record
	if w.Usage != nil {
		u = w.Usage.Devices[d.ID]
	}
	peer, has := w.Peers[d.PublicKey]
	p := m.People[d.Person]
	var srv *model.Server
	if p != nil {
		srv = m.Servers[p.Server]
	}
	// Set up again (Reconnect): a handshake from before it does not count.
	hs := peer.Handshake
	if hs == 0 && u != nil {
		hs = int64(u.Handshake)
	}
	if since := w.Reconnect[d.ID]; since != 0 && float64(hs) <= since {
		hs = 0
	}
	online := false
	if hs > 0 && has {
		if w.Online != nil {
			online = w.Online[d.ID]
		} else {
			window := int64(model.OnlineWindow)
			if v, ok := w.Windows[d.ID]; ok {
				window = v
			}
			online = peer.Handshake > 0 && w.Now-peer.Handshake < window
		}
	}
	v := Device{
		ID: d.ID, Name: d.Name, Kind: d.Kind, Address: d.Address, Disabled: d.Disabled, Created: d.Created, CreatedBy: d.CreatedBy,
		Online: online, Handshake: hs, Active: has,
		Month: recent(u, 30, w.Now), Spark: Spark(u, 7, w.Now),
		BrowserKey: d.PrivateKey == "", LanBypass: d.LanBypass, MTU: d.MTU, Keepalive: d.Keepalive, Behind: d.Behind,
		Waiting: d.Waiting, Ask: d.Ask, Asked: d.Asked, Declined: d.Declined, DeclinedNets: d.DeclinedNets,
	}
	if ep := endpointIP(peer.Endpoint); ep != "" {
		v.Endpoint = ep
	} else if u != nil && u.Endpoint != nil {
		v.Endpoint = *u.Endpoint
	}
	if u != nil && u.Total != nil {
		v.Total = *u.Total
	}
	// The same label /tmp/hosts carries, so what is shown resolves.
	if m.Settings.Hostnames && p != nil {
		l := labels[d.ID]
		if l == "" {
			l = "device"
		}
		v.Hostname = l + "." + p.ID + "." + m.Settings.Domain
	}
	if was, ok := w.Issued[d.ID]; ok {
		var home []string
		if w.Home != nil && srv != nil {
			home = w.Home(srv, p)
		}
		// Its configuration changed since it was last shown or downloaded.
		v.ConfigStale = was.FP != handout.Fingerprint(m, d, home)
		v.ConfigIssued = was.TS
	}
	if srv != nil {
		mtu, ka := model.DeviceMTU(srv, d), model.DeviceKeepalive(srv, d)
		v.MTUUsed, v.KeepaliveUsed = &mtu, &ka
	}
	if l, ok := w.Link[d.ID]; ok {
		v.Link = l
	}
	// Without a watcher nobody tells data from a bare handshake: a session that lives counts as flowing.
	if w.Setup != nil {
		if s, ok := w.Setup[d.ID]; ok {
			v.Setup = s
		}
	} else if online {
		v.Setup = map[string]any{"state": "flowing", "since": hs}
	}
	return v
}

// PersonOf is one person's view with their devices, oldest first. admin adds what only the admin sees.
func (w *World) PersonOf(p *model.Person, admin bool) Person {
	m := w.M
	var u *usage.Record
	if w.Usage != nil {
		u = w.Usage.People[p.ID]
	}
	labels := Labels(m, p)
	devs := make([]Device, 0, len(p.Devices))
	for _, id := range p.Devices {
		if d := m.Devices[id]; d != nil {
			devs = append(devs, w.DeviceOf(d, labels))
		}
	}
	sort.SliceStable(devs, func(i, j int) bool { return devs[i].Created < devs[j].Created })
	v := Person{
		ID: p.ID, Name: p.Name, Server: p.Server, Access: p.Access, DeviceLimit: p.DeviceLimit, Expires: p.Expires,
		QuotaGB: p.QuotaGB, QuotaPeriod: p.QuotaPeriod,
		QuotaUsed: state.Usage(p, w.Usage, w.Now), QuotaLimit: state.QuotaBytes(p, w.Now),
		DNSMode: p.DNSMode, Paused: p.Paused, State: state.Of(m, p, w.Usage, w.Now),
		Month: recent(u, 30, w.Now), Devices: devs,
	}
	// Their limit month: what it has counted, and when it ends (0: none runs).
	if lm := usage.LimitMonth(u, w.Now); lm != nil {
		end := usage.MonthAfter(int64(lm.Start))
		v.QuotaMonth, v.QuotaResets, v.QuotaResetDay = usage.Pair{lm.Rx, lm.Tx}, end, dayKey(end)
	}
	if p.BonusGB > 0 && w.Now < int64(p.BonusUntil) {
		v.BonusGB = p.BonusGB
	}
	if u != nil && u.Total != nil {
		v.Total = *u.Total
	}
	for _, d := range devs {
		if d.Online {
			v.Online++
		}
		if d.Handshake > v.LastSeen {
			v.LastSeen = d.Handshake
		}
	}
	if admin {
		// The code and the links themselves are another call's (admins only).
		hosts := PortalHosts(m)
		link := len(hosts) > 0 && PortalLink(m, p, hosts[0]) != ""
		services, nets := p.Services, p.HomeNets
		v.HasLink, v.Note, v.Services, v.HomeNets, v.Circle, v.Created, v.CodeSet = &link, &p.Note, &services, &nets, &p.Circle, &p.Created, &p.CodeSet
	}
	return v
}

// Day is one day of traffic.
type Day struct {
	Day string  `json:"day"`
	Rx  float64 `json:"rx"`
	Tx  float64 `json:"tx"`
}

// Series is the daily traffic of these records for the last `days` days, oldest first.
func Series(recs []*usage.Record, days int, ts int64) []Day {
	out := make([]Day, 0, days)
	for i := days - 1; i >= 0; i-- {
		d := Day{Day: dayAgo(i, ts)}
		for _, r := range recs {
			if r == nil {
				continue
			}
			if v, ok := r.Days[d.Day]; ok {
				d.Rx += v[0]
				d.Tx += v[1]
			}
		}
		out = append(out, d)
	}
	return out
}

// LastHours is the last 24 hours of router-wide traffic by the hour, oldest first, the hour of ts last.
func LastHours(hours map[string]usage.Pair, ts int64) []usage.Pair {
	out := make([]usage.Pair, 0, 24)
	for i := 23; i >= 0; i-- {
		out = append(out, hours[time.Unix(ts-int64(i)*3600, 0).In(zone.Local()).Format("2006-01-02 15")])
	}
	return out
}

// Totals is the router's sums: its people and devices, who is online, today's and the month's traffic.
type Totals struct {
	People  int        `json:"people"`
	Devices int        `json:"devices"`
	Online  int        `json:"online"`
	Active  int        `json:"active"`
	Today   usage.Pair `json:"today"`
	Month   usage.Pair `json:"month"`
}

// TotalsOf sums up the people's views and the people's counters.
func (w *World) TotalsOf(people []Person) Totals {
	t := Totals{People: len(people)}
	for _, p := range people {
		t.Devices += len(p.Devices)
		t.Online += p.Online
		if p.State == state.Active {
			t.Active++
		}
	}
	if w.Usage != nil {
		today := dayAgo(0, w.Now)
		for _, r := range w.Usage.People {
			if r == nil {
				continue
			}
			if v, ok := r.Days[today]; ok {
				t.Today[0] += v[0]
				t.Today[1] += v[1]
			}
			m := recent(r, 30, w.Now)
			t.Month[0] += m[0]
			t.Month[1] += m[1]
		}
	}
	return t
}

// Server is what of a server's view follows from the settings, the tunnels and the counters alone. What
// the router itself must be asked (whether its interface is up, why it is kept down) is not here yet.
type Server struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Ifname     string `json:"ifname"`
	Port       int    `json:"port"`
	Subnet     string `json:"subnet"`
	Endpoint   string `json:"endpoint"`
	PublicKey  string `json:"public_key"`
	Enabled    bool   `json:"enabled"`
	LanLike    bool   `json:"lan_like"`
	DeviceMesh bool   `json:"device_mesh"`
	Mesh       string `json:"mesh"`
	// PortalRouters and PortalNets are what people may do about routers on their own pages.
	PortalRouters string         `json:"portal_routers"`
	PortalNets    string         `json:"portal_nets"`
	Preset        string         `json:"preset"`
	MTU           int            `json:"mtu"`
	Keepalive     int            `json:"keepalive"`
	DNS           []string       `json:"dns"`
	MTUs          map[string]int `json:"mtus"`
	Address       *string        `json:"address"`
	Peers         int            `json:"peers"`
	Online        int            `json:"online"`
	HPK           bool           `json:"hpk"`
	Series        []Day          `json:"series"`
	// Reached is the newest handshake from a public address that is not the router's own: proof that the
	// port is reachable from the internet. Up and Uptime are its interface's, as netifd says.
	Reached float64           `json:"reached"`
	Up      bool              `json:"up"`
	Uptime  int64             `json:"uptime"`
	Home    []HomeNet         `json:"home"`
	Obf     map[string]string `json:"obf"`
}

// HomeNet is one interface of a server's home network, for the per-person picker.
type HomeNet struct {
	Dev  string   `json:"dev"`
	Nets []string `json:"nets"`
}

// Router is what a server's view asks of the router itself.
type Router struct {
	// Own is the router's own addresses; Iface a netifd interface's state; Homes a server's home interfaces.
	Own   map[string]bool
	Iface func(ifname string) (up bool, uptime int64)
	Homes func(srv *model.Server) []HomeNet
}

// ServerOf is a server's view, all but why it is kept down (a sentence in the reader's language) and its
// last minutes of speed (the agent's file); `days` is how long its chart is. Without a Router, what the
// router must be asked is left empty.
func (w *World) ServerOf(srv *model.Server, days int, r *Router) Server {
	m := w.M
	ids := map[string]string{}
	for id, d := range m.Devices {
		ids[d.PublicKey] = id
	}
	v := Server{
		ID: srv.ID, Name: srv.Name, Ifname: srv.Ifname, Port: srv.Port, Subnet: srv.Subnet, Endpoint: m.EndpointHost(srv),
		PublicKey: srv.PublicKey, Enabled: srv.Enabled, LanLike: srv.LanLike, DeviceMesh: srv.DeviceMesh, Mesh: srv.Mesh,
		PortalRouters: srv.PortalRouters, PortalNets: srv.PortalNets,
		Preset: srv.Preset, MTU: srv.MTU, Keepalive: srv.Keepalive, DNS: srv.DNS,
		MTUs: map[string]int{
			"computer": model.DeviceMTU(srv, &model.Device{Kind: "computer"}),
			"phone":    model.DeviceMTU(srv, &model.Device{Kind: "phone"}),
		},
		HPK: srv.Obf["header_protection_key"] != "",
	}
	if a := model.ServerAddress(srv); a != "" {
		v.Address = &a
	}
	if t, ok := model.TunnelOf(srv); ok {
		for key, p := range w.Peers {
			if p.Ifname != t.Ifname {
				continue
			}
			v.Peers++
			id := ids[key]
			if w.Online != nil {
				if w.Online[id] {
					v.Online++
				}
			} else if p.Handshake > 0 {
				window := int64(model.OnlineWindow)
				if x, ok := w.Windows[id]; ok {
					window = x
				}
				if w.Now-p.Handshake < window {
					v.Online++
				}
			}
		}
	}
	var recs []*usage.Record
	if w.Usage != nil {
		for id, p := range m.People {
			if p.Server == srv.ID {
				recs = append(recs, w.Usage.People[id])
			}
		}
	}
	v.Series = Series(recs, days, w.Now)
	v.Obf = map[string]string{}
	for k, x := range srv.Obf {
		// the header protection key is a secret every device shares: only whether there is one is told
		if k != "header_protection_key" {
			v.Obf[k] = x
		}
	}
	v.Home = []HomeNet{}
	if r == nil {
		return v
	}
	if srv.PrivateKey != "" && r.Iface != nil {
		v.Up, v.Uptime = r.Iface(srv.Ifname)
	}
	if r.Homes != nil {
		if h := r.Homes(srv); h != nil {
			v.Home = h
		}
	}
	if w.Usage != nil {
		for id, d := range m.Devices {
			if p := m.People[d.Person]; p == nil || p.Server != srv.ID || w.Usage.Devices[id] == nil {
				continue
			}
			for ip, ts := range w.Usage.Devices[id].IPs {
				if IsPublic(ip) && !r.Own[ip] && ts > v.Reached {
					v.Reached = ts
				}
			}
		}
	}
	return v
}

// Place is where an address is, as the places' cache holds it.
type Place struct {
	Lat     *float64 `json:"lat"`
	Lon     *float64 `json:"lon"`
	City    string   `json:"city"`
	Country string   `json:"country"`
	CC      string   `json:"cc"`
	ASN     float64  `json:"asn"`
	Org     string   `json:"org"`
	Fail    any      `json:"fail,omitempty"`
}

// PlaceCache is the places' cache (geo.json).
type PlaceCache struct {
	IPs  map[string]*Place `json:"ips"`
	Home *Place            `json:"home"`
}

// Point is one address a device was seen from, on the map.
type Point struct {
	Person  string   `json:"person"`
	Device  string   `json:"device"`
	IP      string   `json:"ip"`
	TS      float64  `json:"ts"`
	Online  bool     `json:"online"`
	Lat     *float64 `json:"lat"`
	Lon     *float64 `json:"lon"`
	City    string   `json:"city"`
	Country string   `json:"country"`
	CC      string   `json:"cc"`
	ASN     float64  `json:"asn"`
	Org     string   `json:"org"`
}

// Places is the map's data: the router's own place and a point for each address a device was seen from.
type Places struct {
	Enabled  bool       `json:"enabled"`
	Provider *string    `json:"provider,omitempty"`
	Cached   *int       `json:"cached,omitempty"`
	Home     *HomePlace `json:"home"`
	Points   []Point    `json:"points"`
}

// HomePlace is where the router itself is.
type HomePlace struct {
	Lat     *float64 `json:"lat"`
	Lon     *float64 `json:"lon"`
	City    string   `json:"city"`
	Country string   `json:"country"`
	CC      string   `json:"cc"`
	ASN     float64  `json:"asn"`
	Org     string   `json:"org"`
}

var private4 = []string{"0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.168.0.0/16", "198.18.0.0/15", "224.0.0.0/3"}
var (
	hex6     = regexp.MustCompile(`^[0-9a-f:]+$`)
	private6 = regexp.MustCompile(`^(fe[89ab]|f[cd]|::1$|::$)`)
)

// IsPublic tells whether a geolocation service can say something about an address.
func IsPublic(ip string) bool {
	if ip == "" {
		return false
	}
	if n, ok := ipnet.IP(ip); ok {
		for _, r := range private4 {
			if net, _ := ipnet.Any(r); net.Holds(n) {
				return false
			}
		}
		return true
	}
	l := strings.ToLower(ip)
	return hex6.MatchString(l) && !private6.MatchString(l)
}

// PlacesOf is the map's data. own is the router's own public addresses: a device at home that reaches the
// server through one (NAT loopback) shows up from there, and home is not a place people connect from.
// The points stand in the devices' order, a device's newest address first.
func (w *World) PlacesOf(cache *PlaceCache, own map[string]bool) Places {
	m := w.M
	if !m.Settings.GeoEnabled {
		return Places{Points: []Point{}}
	}
	if cache == nil {
		cache = &PlaceCache{}
	}
	points := []Point{}
	for _, id := range m.DeviceIDs() {
		d := m.Devices[id]
		if w.Usage == nil || w.Usage.Devices[id] == nil {
			continue
		}
		peer, has := w.Peers[d.PublicKey]
		cur := endpointIP(peer.Endpoint)
		online := false
		if has {
			if w.Online != nil {
				online = w.Online[id]
			} else {
				window := int64(model.OnlineWindow)
				if x, ok := w.Windows[id]; ok {
					window = x
				}
				online = peer.Handshake > 0 && w.Now-peer.Handshake < window
			}
		}
		var mine []Point
		for ip, ts := range w.Usage.Devices[id].IPs {
			pl := cache.IPs[ip]
			if !IsPublic(ip) || own[ip] || pl == nil || (pl.Fail != nil && pl.Fail != false && pl.Fail != float64(0)) {
				continue
			}
			mine = append(mine, Point{Person: d.Person, Device: id, IP: ip, TS: ts, Online: online && ip == cur,
				Lat: pl.Lat, Lon: pl.Lon, City: pl.City, Country: pl.Country, CC: pl.CC, ASN: pl.ASN, Org: pl.Org})
		}
		sort.Slice(mine, func(i, j int) bool {
			if mine[i].TS != mine[j].TS {
				return mine[i].TS > mine[j].TS
			}
			return mine[i].IP < mine[j].IP
		})
		points = append(points, mine...)
	}
	provider, cached := m.Settings.GeoProvider, len(cache.IPs)
	v := Places{Enabled: true, Provider: &provider, Cached: &cached, Points: points}
	if h := cache.Home; h != nil && h.Lat != nil {
		v.Home = &HomePlace{Lat: h.Lat, Lon: h.Lon, City: h.City, Country: h.Country, CC: h.CC, ASN: h.ASN, Org: h.Org}
	}
	return v
}
