// The `settings` section read by its schema (dawnline.schema SETTINGS and get()): each setting has a type,
// a default and, for a number, a range; a value that is missing or not of its type reads as the default.
// The words the admin is told about a bad value stay with whoever saves settings; this only reads.

package model

import (
	"net/netip"
	"regexp"
	"strconv"
	"strings"

	"github.com/tickcount/luci-app-dawnline/backend/uci"
)

// The update policy's choices (dawnline.updates).
var (
	updateIntervals = []string{"6h", "12h", "1d", "7d"}
	updateTargets   = []string{"app", "amneziawg", "packages"}
)

func settings(s *uci.Section) Settings {
	return Settings{
		PortalEnabled:      flag(s, "portal_enabled", false),
		PortalPort:         ranged(s, "portal_port", 8443, 1, 65535),
		PortalHost:         word(s, "portal_host", ""),
		PortalAlt:          words(s, "portal_alt", []string{}),
		PortalCert:         word(s, "portal_cert", ""),
		PortalKey:          word(s, "portal_key", ""),
		PortalRedirect:     word(s, "portal_redirect", ""),
		DefaultDeviceLimit: ranged(s, "default_device_limit", 3, 1, 32),
		// Off until the admin turns it on: lookups send people's addresses to a third party.
		GeoEnabled:     flag(s, "geo_enabled", false),
		GeoProvider:    choice(s, "geo_provider", "ipwho.is", []string{"ipwho.is", "ipapi.co"}),
		Hostnames:      flag(s, "hostnames", true),
		Domain:         word(s, "domain", "lan"),
		LogConnections: flag(s, "log_connections", true),
		LogLevel:       choice(s, "log_level", "info", []string{"error", "warn", "info", "debug"}),
		Watchdog:       flag(s, "watchdog", true),
		// Written as "none" for no fallback; not set means the default.
		HomeDNSFallback: fallbackDNS(s),
		Updates:         updates(s),
		Retention: Retention{
			LogKeepDays: raw(s, "log_keep_days"), LogMax: raw(s, "log_max"), LogCategory: raw(s, "log_category"),
			LogConnections: raw(s, "log_connections"), LogPersist: raw(s, "log_persist"),
			UsageKeepDays: raw(s, "usage_keep_days"), UsageKeepMonths: raw(s, "usage_keep_months"),
		},
	}
}

// raw is a value as it is written: a string, a list, or nil.
func raw(s *uci.Section, key string) any {
	v, ok := s.Values[key]
	switch {
	case !ok:
		return nil
	case v.IsList:
		return append([]string{}, v.List...)
	}
	return v.Str
}

// flag is a yes or no (schema's: 1 on true yes enabled, 0 off false no disabled, any case; else the default).
func flag(s *uci.Section, key string, dflt bool) bool {
	v, _ := s.Get(key)
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "on", "true", "yes", "enabled":
		return true
	case "0", "off", "false", "no", "disabled":
		return false
	}
	return dflt
}

var wholeNumber = regexp.MustCompile(`^-?[0-9]{1,9}$`)

// ranged is a whole number within its range, or the default.
func ranged(s *uci.Section, key string, dflt, lo, hi int) int {
	v, _ := s.Get(key)
	v = strings.TrimSpace(v)
	if !wholeNumber.MatchString(v) {
		return dflt
	}
	n, _ := strconv.Atoi(v)
	if n < lo || n > hi {
		return dflt
	}
	return n
}

// word is a string setting, or the default when it is not set or empty.
func word(s *uci.Section, key, dflt string) string {
	if v, ok := s.Get(key); ok && v != "" {
		return v
	}
	return dflt
}

// words is a list setting without its empty entries (one written as an option is a list of one).
func words(s *uci.Section, key string, dflt []string) []string {
	v, ok := s.Values[key]
	if !ok {
		return dflt
	}
	in := v.List
	if !v.IsList {
		in = []string{v.Str}
	}
	out := []string{}
	for _, x := range in {
		if x != "" {
			out = append(out, x)
		}
	}
	return out
}

func choice(s *uci.Section, key, dflt string, values []string) string {
	if v, ok := s.Get(key); ok && has(values, v) {
		return v
	}
	return dflt
}

func fallbackDNS(s *uci.Section) string {
	v, ok := s.Get("home_dns_fallback")
	switch {
	case !ok || v == "":
		return "1.1.1.1"
	case v == "none":
		return ""
	}
	if a, err := netip.ParseAddr(v); err == nil && a.Is4() {
		return v
	}
	return "1.1.1.1"
}

// on is the update policy's yes or no (dawnline.updates: 1 true on yes; anything else written is no).
func on(s *uci.Section, key string, dflt bool) bool {
	v, ok := s.Get(key)
	if !ok || v == "" {
		return dflt
	}
	return v == "1" || v == "true" || v == "on" || v == "yes"
}

var clock = regexp.MustCompile(`^([01]?[0-9]|2[0-3]):[0-5][0-9]$`)

func updates(s *uci.Section) Updates {
	u := Updates{
		Check: on(s, "update_check", true), Interval: "1d", Auto: on(s, "update_auto", true), Mode: "scheduled",
		Time: "04:00", Keep: on(s, "update_keep", false), Mirrors: on(s, "update_mirrors", true),
		// AmneziaWG is left out by default: a new kernel module restarts every tunnel.
		Targets: []string{"app", "packages"},
	}
	if v, _ := s.Get("update_interval"); has(updateIntervals, v) {
		u.Interval = v
	}
	if v, _ := s.Get("update_mode"); v == "immediate" {
		u.Mode = "immediate"
	}
	if v, _ := s.Get("update_time"); clock.MatchString(v) {
		u.Time = v
	}
	if v, ok := s.Values["update_targets"]; ok && (v.IsList || v.Str != "") {
		in := v.List
		if !v.IsList {
			in = []string{v.Str}
		}
		u.Targets = []string{}
		for _, x := range in {
			if has(updateTargets, x) {
				u.Targets = append(u.Targets, x)
			}
		}
	}
	return u
}
