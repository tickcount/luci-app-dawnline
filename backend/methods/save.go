package methods

import (
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/tickcount/luci-app-dawnline/backend/endpoint"
	"github.com/tickcount/luci-app-dawnline/backend/files"
	"github.com/tickcount/luci-app-dawnline/backend/i18n"
	"github.com/tickcount/luci-app-dawnline/backend/ipnet"
	"github.com/tickcount/luci-app-dawnline/backend/journal"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
	"github.com/tickcount/luci-app-dawnline/backend/view"
)

// spec is one setting of dawnline.schema: its type, its range or choices, and whether the portal must
// restart when it changes.
type spec struct {
	kind     string
	min, max int
	values   []string
	restart  bool
}

var schema = map[string]spec{
	"portal_enabled": {kind: "bool", restart: true}, "portal_host": {kind: "host", restart: true}, "portal_alt": {kind: "hosts", restart: true},
	"portal_port": {kind: "int", min: 1, max: 65535, restart: true}, "portal_redirect": {kind: "url"},
	"portal_cert": {kind: "file", restart: true}, "portal_key": {kind: "file", restart: true},
	"default_device_limit": {kind: "int", min: 1, max: 32}, "hostnames": {kind: "bool"}, "domain": {kind: "domain"},
	"geo_enabled": {kind: "bool"}, "geo_provider": {kind: "enum", values: []string{"ipwho.is", "ipapi.co"}},
	"log_connections": {kind: "bool"}, "log_level": {kind: "enum", values: []string{"error", "warn", "info", "debug"}}, "watchdog": {kind: "bool"},
	"log_keep_days": {kind: "int", min: 0, max: 9999}, "log_max": {kind: "int", min: 100, max: 20000},
	"log_persist":     {kind: "enum", values: []string{"10min", "hourly", "off"}},
	"usage_keep_days": {kind: "int", min: 7, max: 1830}, "usage_keep_months": {kind: "int", min: 1, max: 120},
	"home_dns_fallback": {kind: "ipv4"}, "update_check": {kind: "bool"}, "update_interval": {kind: "enum", values: []string{"6h", "12h", "1d", "7d"}},
	"update_auto": {kind: "bool"}, "update_mode": {kind: "enum", values: []string{"immediate", "scheduled"}}, "update_time": {kind: "time"},
	"update_targets": {kind: "targets"}, "update_keep": {kind: "bool"}, "update_mirrors": {kind: "bool"},
}

// what the admin is told about a bad value, by setting
var badValue = map[string]string{
	"portal_host":          "Public address must be a hostname or IP address.",
	"portal_alt":           "Other addresses must be hostnames or IP addresses.",
	"portal_port":          "Choose a free port between 1 and 65535 (not 22, 53, 80 or 443).",
	"portal_redirect":      "Redirect must be a full http:// or https:// address.",
	"default_device_limit": "Default device limit must be 1-32.",
	"domain":               "Domain may use lowercase letters, digits, dashes and dots.",
	"geo_provider":         "Unknown location service.",
	"log_level":            "Choose a system log level: errors, warnings, normal or verbose.",
	"log_keep_days":        "Keep activity for 0 (no age limit) to 9999 days.",
	"log_max":              "Log size must be 100-20000 events.",
	"log_persist":          "Save the log every 10min, hourly or off.",
	"usage_keep_days":      "Daily traffic history must be 7-1830 days.",
	"usage_keep_months":    "Monthly traffic history must be 1-120 months.",
	"home_dns_fallback":    "Fallback DNS must be an IPv4 address (or empty for none).",
	"update_interval":      "Check every 6h, 12h, 1d or 7d.",
	"update_mode":          "Install updates immediately or scheduled.",
	"update_time":          "Enter a time as HH:MM, 00:00 to 23:59.",
}

func bad(key string) error {
	if msg, ok := badValue[key]; ok {
		return errors.New(msg)
	}
	return said{"Invalid value for %s.", []any{key}}
}

var (
	wholeNumber = regexp.MustCompile(`^[0-9]{1,9}$`)
	redirectURL = regexp.MustCompile(`^https?://[A-Za-z0-9.-]+(:[0-9]+)?(/[^\s"'<>]*)?$`)
	domainName  = regexp.MustCompile(`^[a-z0-9-]{1,32}(\.[a-z0-9-]{1,32})*$`)
	clockTime   = regexp.MustCompile(`^([01]?[0-9]|2[0-3]):[0-5][0-9]$`)
)

// validate checks a value the admin saves for a setting and returns what to store: a string, a list, or
// nil to remove the option (back to the default). dawnline.schema validate().
func validate(key string, val any) (any, error) {
	sp, known := schema[key]
	if !known {
		return nil, said{"Unknown setting %s.", []any{key}}
	}
	list, _ := val.([]any)
	switch sp.kind {
	case "hosts":
		var out []string
		for _, x := range list {
			s, isString := x.(string)
			h := strings.Trim(s, blank)
			// a typo must not vanish on Save: refused, like the main address
			if !isString || (h != "" && !endpoint.ValidHost(h)) {
				return nil, bad(key)
			}
			dup := false
			for _, o := range out {
				dup = dup || o == h
			}
			if h != "" && !dup {
				out = append(out, h)
			}
		}
		if len(out) == 0 {
			return nil, nil
		}
		return out, nil
	case "targets":
		var out []string
		for _, x := range list {
			s := text(x)
			dup := false
			for _, o := range out {
				dup = dup || o == s
			}
			if (s == "app" || s == "amneziawg" || s == "packages") && !dup {
				out = append(out, s)
			}
		}
		// an empty list is a choice too ("none"), unlike a missing option (the default)
		if len(out) == 0 {
			return []string{"none"}, nil
		}
		return out, nil
	}
	v := ""
	switch x := val.(type) {
	case bool:
		v = "0"
		if x {
			v = "1"
		}
	case string:
		v = strings.Trim(x, blank)
	case nil:
	default:
		v = str(num(val))
	}
	if sp.kind == "ipv4" && v == "" {
		return "none", nil
	}
	if v == "" {
		return nil, nil
	}
	switch sp.kind {
	case "bool":
		if v != "0" && v != "1" {
			return nil, said{"%s is 0 or 1.", []any{key}}
		}
	case "int":
		n, _ := strconv.Atoi(v)
		if !wholeNumber.MatchString(v) || n < sp.min || n > sp.max {
			return nil, bad(key)
		}
		v = strconv.Itoa(n)
	case "enum":
		ok := false
		for _, c := range sp.values {
			ok = ok || c == v
		}
		if !ok {
			return nil, bad(key)
		}
	case "host":
		if !endpoint.ValidHost(v) {
			return nil, bad(key)
		}
	case "url":
		if len(v) > 300 || !redirectURL.MatchString(v) {
			return nil, bad(key)
		}
	case "file":
		if !strings.HasPrefix(v, "/") || !exists(v) {
			return nil, said{"File %s does not exist.", []any{v}}
		}
	case "domain":
		if !domainName.MatchString(v) {
			return nil, bad(key)
		}
	case "ipv4":
		if _, ok := ipnet.IP(v); !ok {
			return nil, bad(key)
		}
	case "time":
		if !clockTime.MatchString(v) {
			return nil, bad(key)
		}
	}
	return v, nil
}

// flat is a stored or a new value as one string, to tell whether it changed: a list a line an entry.
func flat(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case []string:
		return strings.Join(x, "\n")
	}
	return ""
}

// shownValue is a value as the syslog line of a change says it.
func shownValue(v any) string {
	switch x := v.(type) {
	case string:
		if x != "" {
			return x
		}
	case []string:
		var kept []string
		for _, e := range x {
			if e != "" {
				kept = append(kept, e)
			}
		}
		if len(kept) == 0 {
			return "none"
		}
		return strings.Join(kept, " ")
	}
	return "default"
}

func isReserved(port int) bool {
	for _, r := range Reserved {
		if r == port {
			return true
		}
	}
	return false
}

func plainHTTP(s model.Settings) bool {
	for _, h := range append([]string{s.PortalHost}, s.PortalAlt...) {
		if _, ip := ipnet.IP(h); ip {
			return true
		}
	}
	return false
}

// checkPortal refuses a portal whose ports cannot be taken: its HTTPS port and, when links on IP addresses
// use plain HTTP, the next one. Neither may be the router's own, another program's, or forwarded away.
func checkPortal(now, was *model.Model, progs []held, fw *uci.Config) error {
	s := now.Settings
	if !s.PortalEnabled {
		return nil
	}
	port := s.PortalPort
	if port < 1 || port > 65535 || isReserved(port) {
		return errors.New("Choose a free port between 1 and 65535 (not 22, 53, 80 or 443).")
	}
	ports := []int{port}
	if plainHTTP(s) {
		hp := port + 1
		if hp < 1 || hp > 65535 || isReserved(hp) {
			return said{"Links on IP addresses use plain HTTP on the next port (%d), which the portal cannot take. Choose another portal port.", []any{hp}}
		}
		ports = append(ports, hp)
	}
	// only ports the portal does not hold already
	var mine []int
	if was.Settings.PortalEnabled {
		mine = append(mine, was.Settings.PortalPort)
		if plainHTTP(was.Settings) {
			mine = append(mine, was.Settings.PortalPort+1)
		}
	}
	for _, p := range ports {
		kept := false
		for _, h := range mine {
			kept = kept || h == p
		}
		if kept {
			continue
		}
		var owners []string
		for _, h := range progs {
			if h.port == p {
				owners = append(owners, h.name)
			}
		}
		if len(owners) > 0 {
			msg := "TCP %d is already used by %s. Choose another portal port."
			if p != port {
				msg = "TCP %d is already used by %s. Links on IP addresses use plain HTTP on the port after the portal's. Choose another portal port."
			}
			return said{msg, []any{p, strings.Join(owners, ", ")}}
		}
	}
	// a forwarded port never reaches the router: the portal would be unreachable
	zones := []string{"wan"}
	for _, id := range now.ServerIDs() {
		z, dup := now.Servers[id].WanZone, false
		for _, o := range zones {
			dup = dup || o == z
		}
		if !dup {
			zones = append(zones, z)
		}
	}
	for _, p := range ports {
		for _, z := range zones {
			for _, f := range forwards(fw, z, "tcp") {
				if f.from <= p && p <= f.to {
					return said{"TCP %d is sent on by port forward “%s”. Choose another portal port.", []any{p, f.name}}
				}
			}
		}
	}
	return nil
}

// settingsUpdate saves settings (`values`: key to value, "" back to the default); the portal is checked as
// it will be. The settings are taken in the schema's order, whatever order they came in.
func settingsUpdate(d Deps, a map[string]any) (map[string]any, error) {
	values, isObject := a["values"].(map[string]any)
	// no values at all is nothing to change, and no refusal; anything but an object is
	if a["values"] == nil {
		values, isObject = map[string]any{}, true
	}
	if !isObject {
		return nil, errors.New("Nothing to save.")
	}
	var unknown []string
	for k := range values {
		if _, known := schema[k]; !known && k != "log_category" {
			unknown = append(unknown, k)
		}
	}
	if len(unknown) > 0 {
		sort.Strings(unknown)
		return nil, said{"Unknown setting %s.", []any{unknown[0]}}
	}
	type change_ struct {
		key      string
		from, to any
	}
	var diff []change_
	restart := false
	var was, now *model.Model
	err := write(d, func(c *uci.Config, m *model.Model) error {
		was = m
		section := c.Add("settings", "settings")
		current := func(k string) any {
			v, has := section.Values[k]
			if !has {
				return nil
			}
			if v.IsList {
				return v.List
			}
			return v.Str
		}
		put := func(k string, to any) {
			if from := current(k); flat(to) != flat(from) {
				diff = append(diff, change_{k, from, to})
			}
			switch x := to.(type) {
			case nil:
				c.Delete("settings", k)
			case string:
				// an empty string is no value to a cursor: the option goes
				c.Set("settings", k, x)
			case []string:
				c.SetList("settings", k, x)
			}
		}
		for _, k := range Settings {
			val, given := values[k]
			if !given {
				continue
			}
			nv, err := validate(k, val)
			if err != nil {
				return err
			}
			if schema[k].restart && flat(nv) != flat(current(k)) {
				restart = true
			}
			put(k, nv)
		}
		if val, given := values["log_category"]; given {
			list, _ := val.([]any)
			var cats []string
			for _, x := range list {
				for _, known := range journal.Categories {
					if text(x) == known {
						cats = append(cats, known)
					}
				}
			}
			if len(cats) == 0 {
				cats = []string{""}
			}
			put("log_category", cats)
			// superseded by the category list
			c.Delete("settings", "log_connections")
		}
		var blocked map[string]any
		files.ReadJSON(d.RunDir+"/netifd-blocked.json", &blocked)
		now = model.Load(c, blocked)
		return checkPortal(now, m, listening("tcp"), parseFile("/etc/config/firewall"))
	})
	if err != nil {
		return nil, err
	}
	// every setting that changed, in syslog
	if len(diff) > 0 && d.Log != nil {
		var parts []string
		for _, x := range diff {
			parts = append(parts, x.key+": "+shownValue(x.from)+" → "+shownValue(x.to))
		}
		d.Log.Say("info", "settings", "admin changed settings · "+strings.Join(parts, ", "))
	}
	var warning any
	if restart {
		if d.Reload != nil {
			d.Reload()
		}
	} else if d.Sync != nil {
		warning = d.Sync(text(a["lang"]))
	}
	// the changes worth a line: the portal and the watchdog
	if d.Log != nil {
		n, w := now.Settings, was.Settings
		if n.PortalEnabled != w.PortalEnabled {
			if n.PortalEnabled {
				d.Log.Admin("portal", "turned on", "", "the personal portal", fmt.Sprintf("port %d", n.PortalPort))
			} else {
				d.Log.Admin("portal", "turned off", "", "the personal portal", "")
			}
		} else if n.PortalEnabled {
			var what []string
			if n.PortalPort != w.PortalPort {
				what = append(what, fmt.Sprintf("port %d", n.PortalPort))
			}
			if n.PortalHost != w.PortalHost {
				what = append(what, "address "+n.PortalHost)
			}
			if strings.Join(n.PortalAlt, " ") != strings.Join(w.PortalAlt, " ") {
				what = append(what, "other addresses")
			}
			if n.PortalCert != w.PortalCert || n.PortalKey != w.PortalKey {
				what = append(what, "certificate")
			}
			if n.PortalRedirect != w.PortalRedirect {
				what = append(what, "redirect")
			}
			if len(what) > 0 {
				d.Log.Admin("portal", "changed", "", "the personal portal", strings.Join(what, ", "))
			}
		}
		if n.Watchdog != w.Watchdog {
			if n.Watchdog {
				d.Log.Admin("dawnline", "turned on", "", "the watchdog", "")
			} else {
				d.Log.Admin("dawnline", "turned off", "", "the watchdog", "problems are only logged, nothing is repaired")
			}
		}
	}
	if d.Told != nil {
		d.Told()
	}
	out := map[string]any{}
	if w := d.World(); w != nil && w.M != nil {
		out = settingsGet(w, i18n.Use(d.Catalogs, text(a["lang"])), d)
	}
	if warning != nil && warning != "" {
		out["warning"] = warning
	}
	return out, nil
}

var _ = view.World{}
