// Package model is Dawnline's settings as the backend works with them: the servers, the people, their
// devices, the circles and the home services, read from /etc/config/dawnline with every default filled in
// and every value brought to its type.
//
// It reads exactly what the ucode model reads (dawnline.core load(), dawnline.schema get()): the same
// defaults, the same leniency with what older versions and hands have written. testdata holds the two to
// each other: each *.json is what ucode made of the *.uci beside it (scripts/ucode-golden.sh).
//
// Reading only, and no state of the router: who is online, what is used, which tunnel is up live elsewhere.
package model

import (
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/uci"
	"github.com/tickcount/luci-app-dawnline/backend/zone"
)

// What a value may be (dawnline.core).
var (
	Access      = []string{"lan", "internet", "both"}
	Kinds       = []string{"computer", "phone", "tablet", "router", "other"}
	MobileKinds = []string{"phone", "tablet"}
	Mesh        = []string{"off", "all", "circles"}
	// PortalRouters is what a person may do about a router on their own page: nothing (the admin adds
	// it), ask for one, or add one at once. PortalNets: ask for a network behind it, or add one at once.
	PortalRouters = []string{"off", "ask", "free"}
	PortalNets    = []string{"ask", "free"}
	// Declined is why the admin turned a person's request down, as the settings keep it: the networks
	// share addresses with one here, they are not needed here, the person should talk to the admin
	// first, or no reason given. Each page words it in its reader's language.
	Declined = []string{"overlap", "unneeded", "talk", "plain"}
	// ObfKeys are the AmneziaWG disguise options a server stores.
	ObfKeys = []string{"jc", "jmin", "jmax", "s1", "s2", "s3", "s4", "h1", "h2", "h3", "h4", "i1", "i2", "i3", "i4", "i5",
		"header_protection_key", "content_padding_addition", "rekey_after_time", "rekey_timeout", "reject_after_time",
		"keepalive_timeout", "max_handshake_attempts", "random_trailers", "disable_cookies"}
)

// circleColors is how many colours a circle may have.
const circleColors = 8

// Model is the whole of the settings.
type Model struct {
	Settings Settings            `json:"settings"`
	Servers  map[string]*Server  `json:"servers"`
	People   map[string]*Person  `json:"people"`
	Devices  map[string]*Device  `json:"devices"`
	Services map[string]*Service `json:"services"`
	Circles  map[string]*Circle  `json:"circles"`

	// The ids in the file's order: what is done for each server, person or device is done in the order the
	// admin made them, the same on every run.
	serverIDs, personIDs, deviceIDs []string
	circleIDs, serviceIDs           []string
}

// ServerIDs, PersonIDs and DeviceIDs are the ids in the file's order.
func (m *Model) ServerIDs() []string { return m.serverIDs }
func (m *Model) PersonIDs() []string { return m.personIDs }
func (m *Model) DeviceIDs() []string { return m.deviceIDs }

// WithoutServers is the same settings with no server at all (what a teardown works from).
func (m *Model) WithoutServers() *Model {
	out := *m
	out.Servers, out.serverIDs = map[string]*Server{}, nil
	return &out
}

// CircleIDs and ServiceIDs are the circles and the services in the file's order: the order they are listed in.
func (m *Model) CircleIDs() []string  { return m.circleIDs }
func (m *Model) ServiceIDs() []string { return m.serviceIDs }

// Settings is the `settings` section.
type Settings struct {
	PortalEnabled      bool      `json:"portal_enabled"`
	PortalPort         int       `json:"portal_port"`
	PortalHost         string    `json:"portal_host"`
	PortalAlt          []string  `json:"portal_alt"`
	PortalCert         string    `json:"portal_cert"`
	PortalKey          string    `json:"portal_key"`
	PortalRedirect     string    `json:"portal_redirect"`
	DefaultDeviceLimit int       `json:"default_device_limit"`
	GeoEnabled         bool      `json:"geo_enabled"`
	GeoProvider        string    `json:"geo_provider"`
	Hostnames          bool      `json:"hostnames"`
	Domain             string    `json:"domain"`
	LogConnections     bool      `json:"log_connections"`
	LogLevel           string    `json:"log_level"`
	Watchdog           bool      `json:"watchdog"`
	HomeDNSFallback    string    `json:"home_dns_fallback"`
	Updates            Updates   `json:"updates"`
	Retention          Retention `json:"retention"`
}

// Updates is when and what Dawnline updates on its own.
type Updates struct {
	Check    bool     `json:"check"`
	Interval string   `json:"interval"`
	Auto     bool     `json:"auto"`
	Mode     string   `json:"mode"`
	Time     string   `json:"time"`
	Targets  []string `json:"targets"`
	Keep     bool     `json:"keep"`
	Mirrors  bool     `json:"mirrors"`
}

// Retention is how long the log and the traffic history are kept, as written: who applies it reads the
// values by their own rules. A value is a string, a list of strings, or nil when it is not set.
type Retention struct {
	LogKeepDays     any `json:"log_keep_days"`
	LogMax          any `json:"log_max"`
	LogCategory     any `json:"log_category"`
	LogConnections  any `json:"log_connections"`
	LogPersist      any `json:"log_persist"`
	UsageKeepDays   any `json:"usage_keep_days"`
	UsageKeepMonths any `json:"usage_keep_months"`
}

// Server is one AmneziaWG server.
type Server struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Ifname      string   `json:"ifname"`
	Port        int      `json:"port"`
	Subnet      string   `json:"subnet"`
	Endpoint    string   `json:"endpoint"`
	MTU         int      `json:"mtu"` // 0: worked out
	DNS         []string `json:"dns"`
	Keepalive   int      `json:"keepalive"`
	PrivateKey  string   `json:"private_key"`
	PublicKey   string   `json:"public_key"`
	Preset      string   `json:"preset"`
	LanZone     string   `json:"lan_zone"`
	WanZone     string   `json:"wan_zone"`
	AutoWan     bool     `json:"auto_wan"`
	WanDevice   string   `json:"wan_device"`
	AutoLan     bool     `json:"auto_lan"`
	LanDevices  []string `json:"lan_devices"`
	DetectedWan string   `json:"detected_wan"`
	DetectedLan string   `json:"detected_lan"`
	LanLike     bool     `json:"lan_like"`
	Mesh        string   `json:"mesh"`
	// PortalRouters and PortalNets are what people may do about routers on their own pages (see the lists).
	PortalRouters string            `json:"portal_routers"`
	PortalNets    string            `json:"portal_nets"`
	Enabled       bool              `json:"enabled"`
	Obf           map[string]string `json:"obf"`
	DeviceMesh    bool              `json:"device_mesh"`
	// Blocked: why the server is kept down (another tunnel has its interface's name), when it is.
	Blocked any `json:"blocked,omitempty"`
}

// Person is someone with access.
type Person struct {
	ID          string   `json:"id"`
	Server      string   `json:"server"`
	Name        string   `json:"name"`
	Access      string   `json:"access"`
	DeviceLimit int      `json:"device_limit"`
	Code        string   `json:"code"`
	CodeSet     int      `json:"code_set"`
	Expires     string   `json:"expires"`
	QuotaGB     float64  `json:"quota_gb"`
	QuotaPeriod string   `json:"quota_period"`
	Paused      bool     `json:"paused"`
	DNSMode     string   `json:"dns_mode"`
	BonusGB     float64  `json:"bonus_gb"`
	BonusUntil  int      `json:"bonus_until"`
	Services    []string `json:"services"`
	HomeNets    []string `json:"home_nets"`
	Circle      string   `json:"circle"`
	Note        string   `json:"note"`
	Created     int      `json:"created"`
	// Devices are the ids of the person's devices, in the file's order.
	Devices []string `json:"devices"`
}

// Device is one device of a person.
type Device struct {
	ID           string `json:"id"`
	Person       string `json:"person"`
	Name         string `json:"name"`
	Kind         string `json:"kind"`
	Address      string `json:"address"`
	PublicKey    string `json:"public_key"`
	PrivateKey   string `json:"private_key"`
	PresharedKey string `json:"preshared_key"`
	Created      int    `json:"created"`
	CreatedBy    string `json:"created_by"`
	Disabled     bool   `json:"disabled"`
	MTU          int    `json:"mtu"` // 0: the server's
	// Keepalive is nil for the server's.
	Keepalive *int `json:"keepalive"`
	LanBypass bool `json:"lan_bypass"`
	// Behind is the networks behind a router, as written: BehindOf tells which of them are in effect.
	Behind []string `json:"behind,omitempty"`
	// What its owner asked for on their own page and the admin has not answered: Waiting, the router itself
	// (added there, it is no device of the tunnel until the admin takes it); Ask, networks behind it
	// besides the ones it has; Asked, when (the later of the two).
	Waiting bool     `json:"waiting,omitempty"`
	Ask     []string `json:"ask,omitempty"`
	Asked   int      `json:"asked,omitempty"`
	// Declined is why the admin turned the last of that down ("": nothing is turned down), DeclinedNets
	// the networks it was about (none: the router itself). The owner reads it until they clear it or ask again.
	Declined     string   `json:"declined,omitempty"`
	DeclinedNets []string `json:"declined_nets,omitempty"`
}

// Circle is a group of people whose devices reach each other.
type Circle struct {
	ID     string `json:"id"`
	Server string `json:"server"`
	Name   string `json:"name"`
	Color  int    `json:"color"`
}

// Service is something at home a person may be let reach.
type Service struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Address string   `json:"address"`
	Ports   []string `json:"ports"`
}

// Load builds the model from the parsed file. `blocked` is which servers are kept down and why
// (/var/run/dawnline/netifd-blocked.json: nil when there is none).
func Load(c *uci.Config, blocked map[string]any) *Model {
	set := c.Section("settings")
	if set == nil {
		set = &uci.Section{Values: map[string]uci.Value{}}
	}
	m := &Model{
		Settings: settings(set),
		Servers:  map[string]*Server{}, People: map[string]*Person{}, Devices: map[string]*Device{},
		Services: map[string]*Service{}, Circles: map[string]*Circle{},
	}
	for _, r := range c.OfType("server") {
		id := r.Name
		srv := &Server{
			ID: id, Name: text(r, "name", id), Ifname: text(r, "ifname", id),
			Port: toInt(r, "port", 51820), Subnet: text(r, "subnet", ""), Endpoint: text(r, "endpoint", ""),
			MTU: toInt(r, "mtu", 0), DNS: list(r, "dns"), Keepalive: toInt(r, "keepalive", 25),
			PrivateKey: text(r, "private_key", ""), PublicKey: text(r, "public_key", ""),
			Preset: text(r, "preset", "standard"), LanZone: text(r, "lan_zone", "lan"), WanZone: text(r, "wan_zone", "wan"),
			AutoWan: truth(r, "auto_wan", true), WanDevice: text(r, "wan_device", ""),
			AutoLan: truth(r, "auto_lan", true), LanDevices: list(r, "lan_device"),
			DetectedWan: text(r, "detected_wan", ""), DetectedLan: text(r, "detected_lan", ""),
			LanLike: truth(r, "lan_like", true), Enabled: truth(r, "enabled", true), Obf: map[string]string{},
		}
		// Older files: device_mesh 0/1.
		if mesh, _ := r.Get("mesh"); has(Mesh, mesh) {
			srv.Mesh = mesh
		} else if truth(r, "device_mesh", true) {
			srv.Mesh = "all"
		} else {
			srv.Mesh = "off"
		}
		// a router and its networks are asked of the admin unless the admin said otherwise
		srv.PortalRouters, srv.PortalNets = "ask", "ask"
		if v, _ := r.Get("portal_routers"); has(PortalRouters, v) {
			srv.PortalRouters = v
		}
		if v, _ := r.Get("portal_nets"); has(PortalNets, v) {
			srv.PortalNets = v
		}
		for _, k := range ObfKeys {
			if v, ok := r.Get(k); ok && v != "" {
				srv.Obf[k] = v
			}
		}
		srv.DeviceMesh = srv.Mesh != "off"
		if why, kept := blocked[id]; kept && why != nil && why != false {
			srv.Blocked = why
		}
		if _, twice := m.Servers[id]; !twice {
			m.serverIDs = append(m.serverIDs, id)
		}
		m.Servers[id] = srv
	}
	for _, r := range c.OfType("person") {
		id := r.Name
		p := &Person{
			ID: id, Server: text(r, "server", ""), Name: text(r, "name", id), Access: "internet",
			DeviceLimit: toInt(r, "device_limit", m.Settings.DefaultDeviceLimit),
			Code:        text(r, "code", ""), CodeSet: toInt(r, "code_set", 0), Expires: text(r, "expires", ""),
			QuotaGB: num(r, "quota_gb", 0), QuotaPeriod: "month", Paused: truth(r, "paused", false),
			DNSMode: "device", BonusGB: num(r, "bonus_gb", 0),
			BonusUntil: toInt(r, "bonus_until", 0), Services: list(r, "service"), HomeNets: list(r, "home_net"),
			Circle: text(r, "circle", ""), Note: text(r, "note", ""), Created: toInt(r, "created", 0), Devices: []string{},
		}
		if a, _ := r.Get("access"); has(Access, a) {
			p.Access = a
		}
		if v, _ := r.Get("quota_period"); v == "total" {
			p.QuotaPeriod = "total"
		}
		if v, _ := r.Get("dns_mode"); v == "home" {
			p.DNSMode = "home"
		}
		// Extra data from before limit months lasted until the 1st of the month after the one it was given in.
		if p.BonusUntil == 0 {
			month, _ := r.Get("bonus_month")
			p.BonusUntil = monthEnd(month)
		}
		if _, twice := m.People[id]; !twice {
			m.personIDs = append(m.personIDs, id)
		}
		m.People[id] = p
	}
	for _, r := range c.OfType("device") {
		id := r.Name
		d := &Device{
			ID: id, Person: text(r, "person", ""), Name: text(r, "name", id), Kind: "other",
			Address: text(r, "address", ""), PublicKey: text(r, "public_key", ""), PrivateKey: text(r, "private_key", ""),
			PresharedKey: text(r, "preshared_key", ""), Created: toInt(r, "created", 0), CreatedBy: text(r, "created_by", "admin"),
			Disabled: truth(r, "disabled", false), MTU: toInt(r, "mtu", 0), LanBypass: truth(r, "lan_bypass", false),
		}
		if k, _ := r.Get("kind"); has(Kinds, k) {
			d.Kind = k
		}
		if nets := list(r, "behind_net"); len(nets) > 0 {
			d.Behind = nets
		}
		// a request is a router's: on anything else the lines mean nothing
		if d.Kind == "router" {
			d.Waiting = truth(r, "waiting", false)
			if nets := list(r, "ask_net"); len(nets) > 0 {
				d.Ask = nets
			}
			if d.Waiting || d.Ask != nil {
				d.Asked = toInt(r, "asked", 0)
			}
			if v, _ := r.Get("declined"); v != "" {
				d.Declined = "plain"
				if has(Declined, v) {
					d.Declined = v
				}
				if nets := list(r, "declined_net"); len(nets) > 0 {
					d.DeclinedNets = nets
				}
			}
		}
		// Its own keep-alive, when it has one that is a number.
		if v, ok := r.Get("keepalive"); ok && v != "" {
			if n, isNumber := number(v); isNumber {
				k := int(n)
				d.Keepalive = &k
			}
		}
		if _, twice := m.Devices[id]; !twice {
			m.deviceIDs = append(m.deviceIDs, id)
		}
		m.Devices[id] = d
		if p := m.People[d.Person]; p != nil {
			p.Devices = append(p.Devices, id)
		}
	}
	for _, r := range c.OfType("circle") {
		id := r.Name
		m.circleIDs = append(m.circleIDs, id)
		m.Circles[id] = &Circle{ID: id, Server: text(r, "server", ""), Name: text(r, "name", id), Color: toInt(r, "color", 0) % circleColors}
	}
	for _, r := range c.OfType("service") {
		id := r.Name
		m.serviceIDs = append(m.serviceIDs, id)
		m.Services[id] = &Service{ID: id, Name: text(r, "name", id), Address: text(r, "address", ""), Ports: list(r, "port")}
	}
	return m
}

/* ---------- values, read as dawnline.core reads them ---------- */

func has(set []string, v string) bool {
	for _, x := range set {
		if x == v {
			return true
		}
	}
	return false
}

// text is an option's string, or the default when it is not set.
func text(r *uci.Section, key, dflt string) string {
	if v, ok := r.Get(key); ok {
		return v
	}
	return dflt
}

// A number as ucode reads one from a string: spaces round it, a sign, then a decimal (which begins with a
// digit) or 0x, 0b, 0o and their digits. Empty is zero.
var numeric = regexp.MustCompile(`^[+-]?(0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|[0-9]+(\.[0-9]*)?([eE][+-]?[0-9]+)?)$`)

func number(s string) (float64, bool) {
	t := strings.TrimSpace(s)
	if t == "" {
		return 0, true
	}
	if !numeric.MatchString(t) {
		return 0, false
	}
	sign, digits := 1.0, strings.TrimLeft(t, "+-")
	if strings.HasPrefix(t, "-") {
		sign = -1
	}
	if len(digits) > 1 && digits[0] == '0' && strings.ContainsRune("xXbBoO", rune(digits[1])) {
		base := map[byte]int{'x': 16, 'X': 16, 'b': 2, 'B': 2, 'o': 8, 'O': 8}[digits[1]]
		n, err := strconv.ParseInt(digits[2:], base, 64)
		return sign * float64(n), err == nil
	}
	f, err := strconv.ParseFloat(strings.TrimSuffix(digits, "."), 64)
	return sign * f, err == nil
}

// toInt is an option as a whole number (what is after the point is dropped), or the default when it is
// not set, empty or no number.
func toInt(r *uci.Section, key string, dflt int) int {
	v, ok := r.Get(key)
	if !ok || v == "" {
		return dflt
	}
	n, isNumber := number(v)
	if !isNumber {
		return dflt
	}
	return int(n)
}

func num(r *uci.Section, key string, dflt float64) float64 {
	v, ok := r.Get(key)
	if !ok || v == "" {
		return dflt
	}
	n, isNumber := number(v)
	if !isNumber {
		return dflt
	}
	return n
}

// truth is an option as yes or no: 1, true, yes and on are yes, anything else that is written is no.
func truth(r *uci.Section, key string, dflt bool) bool {
	v, ok := r.Get(key)
	if !ok || v == "" {
		return dflt
	}
	return v == "1" || v == "true" || v == "yes" || v == "on"
}

var separators = regexp.MustCompile(`[\s,]+`)

// list is a list option's entries, or an option's string cut at spaces and commas.
func list(r *uci.Section, key string) []string {
	v, ok := r.Values[key]
	if !ok {
		return []string{}
	}
	if v.IsList {
		return append([]string{}, v.List...)
	}
	return separators.Split(strings.TrimSpace(v.Str), -1)
}

var yearMonth = regexp.MustCompile(`^([0-9]{4})-([0-9]{2})$`)

// monthEnd is the first moment after a calendar month ("YYYY-MM") in the router's time; 0 for anything else.
func monthEnd(month string) int {
	g := yearMonth.FindStringSubmatch(month)
	if g == nil {
		return 0
	}
	y, _ := strconv.Atoi(g[1])
	mon, _ := strconv.Atoi(g[2])
	return int(time.Date(y, time.Month(mon)+1, 1, 0, 0, 0, 0, zone.Local()).Unix())
}
