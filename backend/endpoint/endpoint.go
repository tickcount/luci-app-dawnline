// Package endpoint tells what a public address points at and whether that reaches this router, as
// dawnline.health does for Health and for the "as you type" check on a server's page: the facts
// (endpoint_facts) and the facts in words in the reader's language (endpoint_words). Held to ucode's own
// output on made-up reads (testdata/trace.uc, scripts/ucode-golden.sh).
package endpoint

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/tickcount/luci-app-dawnline/backend/i18n"
	"github.com/tickcount/luci-app-dawnline/backend/ipnet"
)

// Reads is what the facts are made from, read on the router: the name's addresses, the WAN's IPv4 ("" none)
// and the router's public IPv6 addresses (Known6 false: not read, or `ip` could not tell).
type Reads struct {
	IPs     []string
	WAN     string
	Router6 []string
	Known6  bool
}

// Facts is what a public address points at.
type Facts struct {
	Host       string   `json:"host"`
	IPs        []string `json:"ips"`
	IPs4       []string `json:"ips4"`
	IPs6       []string `json:"ips6"`
	WAN        *string  `json:"wan"`
	Kind       string   `json:"kind"`
	Cloudflare bool     `json:"cloudflare"`
	Here       bool     `json:"here"`
	V6Only     bool     `json:"v6_only"`
	Router6    []string `json:"router6"`
	Foreign6   []string `json:"foreign6"`
	Here6      bool     `json:"here6"`
}

// Cloudflare's published ranges (https://www.cloudflare.com/ips/).
var (
	cf4 = []string{"173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20",
		"188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22"}
	cf6 = regexp.MustCompile(`(?i)^(2400:cb00:|2606:4700:|2803:f800:|2405:b500:|2405:8100:|2a06:98c[0-7]:|2c0f:f248:)`)
)

// Cloudflare tells an address in Cloudflare's network (its proxies and edge).
func Cloudflare(a string) bool {
	n, ok := ipnet.IP(a)
	if !ok {
		return cf6.MatchString(a)
	}
	for _, r := range cf4 {
		if c, _ := ipnet.Any(r); c.Holds(n) {
			return true
		}
	}
	return false
}

// Kind is what kind of IPv4 the WAN has: public, cgnat (100.64/10), private (behind another router), none.
func Kind(wan string) string {
	n, ok := ipnet.IP(wan)
	if !ok {
		return "none"
	}
	for i, p := range []string{"100.64.0.0/10", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"} {
		if r, _ := ipnet.Any(p); r.Holds(n) {
			if i == 0 {
				return "cgnat"
			}
			return "private"
		}
	}
	return "public"
}

// Full6 is an IPv6 address as its 32 hex digits, so two spellings of one address compare equal; "" when it is none.
func Full6(s string) string {
	halves := strings.Split(strings.ToLower(s), "::")
	if len(halves) > 2 {
		return ""
	}
	var head, tail []string
	if halves[0] != "" {
		head = strings.Split(halves[0], ":")
	}
	if len(halves) == 2 && halves[1] != "" {
		tail = strings.Split(halves[1], ":")
	}
	gap := 8 - len(head) - len(tail)
	if (len(halves) == 2 && gap < 1) || (len(halves) != 2 && gap != 0) {
		return ""
	}
	groups := append([]string{}, head...)
	for i := 0; i < gap; i++ {
		groups = append(groups, "0")
	}
	groups = append(groups, tail...)
	out := ""
	for _, g := range groups {
		if len(g) < 1 || len(g) > 4 || strings.Trim(g, "0123456789abcdef") != "" {
			return ""
		}
		out += "0000"[len(g):] + g
	}
	return out
}

// Own6 is the router's public IPv6 addresses among those `ip -6 -j addr show scope global` lists: unique
// local ones (fc00::/7) and failed duplicates do not count, nothing reaches them from outside.
func Own6(links []struct {
	Info []struct {
		Family    string `json:"family"`
		Local     string `json:"local"`
		DADFailed bool   `json:"dadfailed"`
	} `json:"addr_info"`
}) []string {
	out := []string{}
	for _, l := range links {
		for _, a := range l.Info {
			if k := Full6(a.Local); k != "" && a.Family == "inet6" && !a.DADFailed && !strings.HasPrefix(k, "fc") && !strings.HasPrefix(k, "fd") {
				out = append(out, a.Local)
			}
		}
	}
	return out
}

// Of makes the facts of what was read.
func Of(host string, r Reads) Facts {
	f := Facts{Host: host, IPs: r.IPs, IPs4: []string{}, IPs6: []string{}, Kind: Kind(r.WAN)}
	if f.IPs == nil {
		f.IPs = []string{}
	}
	if r.WAN != "" {
		f.WAN = &r.WAN
	}
	for _, a := range f.IPs {
		if _, v4 := ipnet.IP(a); v4 {
			f.IPs4 = append(f.IPs4, a)
			f.Here = f.Here || (r.WAN != "" && a == r.WAN)
		} else {
			f.IPs6 = append(f.IPs6, a)
		}
		f.Cloudflare = f.Cloudflare || Cloudflare(a)
	}
	f.V6Only = len(f.IPs4) == 0 && len(f.IPs6) > 0
	if r.Known6 {
		f.Router6 = r.Router6
		if f.Router6 == nil {
			f.Router6 = []string{}
		}
		own := map[string]bool{}
		for _, a := range r.Router6 {
			own[Full6(a)] = true
		}
		f.Foreign6 = []string{}
		for _, a := range f.IPs6 {
			if !own[Full6(a)] {
				f.Foreign6 = append(f.Foreign6, a)
			}
		}
		f.Here6 = len(f.IPs6) > 0 && len(f.Foreign6) == 0
	}
	return f
}

// aaaa is the name's IPv6 addresses that do not reach this router from outside, in words, or "".
func aaaa(f Facts, t *i18n.Catalog) string {
	n := int64(len(f.Foreign6))
	if n == 0 {
		return ""
	}
	bad := strings.Join(f.Foreign6, ", ")
	if len(f.Router6) == 0 {
		return fmt.Sprintf(t.N(n, "%s AAAA → %s, but this router has no public IPv6 address: devices that prefer IPv6 will fail to connect. Remove this AAAA record or set up IPv6 on the router.",
			"%s AAAA → %s, but this router has no public IPv6 address: devices that prefer IPv6 will fail to connect. Remove these AAAA records or set up IPv6 on the router."), f.Host, bad)
	}
	return fmt.Sprintf(t.N(n, "%s AAAA → %s is not a public address of this router: devices that prefer IPv6 will fail to connect. Fix or remove this AAAA record.",
		"%s AAAA → %s are not public addresses of this router: devices that prefer IPv6 will fail to connect. Fix or remove these AAAA records."), f.Host, bad)
}

// unreached6 is an IPv6-only name none of whose addresses is a public one of the router, in words, or "".
func unreached6(f Facts, t *i18n.Catalog) string {
	n := len(f.Foreign6)
	if n == 0 || n < len(f.IPs6) {
		return ""
	}
	all := strings.Join(f.IPs6, ", ")
	if len(f.Router6) == 0 {
		return fmt.Sprintf(t.T("%s → %s: IPv6 only, but this router has no public IPv6 address: no device can connect. Check your DNS / DDNS, or set up IPv6 on the router."), f.Host, all)
	}
	return fmt.Sprintf(t.N(int64(n), "%s → %s: IPv6 only, and not a public address of this router: no device can connect. Check your DNS / DDNS.",
		"%s → %s: IPv6 only, and not public addresses of this router: no device can connect. Check your DNS / DDNS."), f.Host, all)
}

// Words is the facts as a status (ok, warn, error) and a whole sentence in t's language. note names what
// must get through ("UDP 4500").
func Words(f Facts, note string, t *i18n.Catalog) (status, text string) {
	wan := ""
	if f.WAN != nil {
		wan = *f.WAN
	}
	if f.Host == "" {
		return "error", t.T("No public address: devices will not know where to connect.")
	}
	if len(f.IPs) == 0 {
		return "error", fmt.Sprintf(t.T("%s does not resolve."), f.Host)
	}
	if f.Cloudflare {
		return "error", fmt.Sprintf(t.T("%s → %s (Cloudflare). %s reaches the router only if this name is DNS-only there, or use the router's IP."), f.Host, strings.Join(f.IPs, ", "), note)
	}
	v6 := aaaa(f, t)
	if f.V6Only {
		if none := unreached6(f, t); none != "" {
			return "warn", none
		}
		if v6 != "" {
			return "warn", v6
		}
		if f.Kind == "public" {
			return "warn", fmt.Sprintf(t.T("%s → %s: IPv6 only, so only devices with IPv6 connect (the router's IPv4 %s has no name)."), f.Host, strings.Join(f.IPs6, ", "), wan)
		}
		return "ok", fmt.Sprintf(t.T("%s → %s: IPv6 only, so only devices with IPv6 connect."), f.Host, strings.Join(f.IPs6, ", "))
	}
	v4 := ""
	switch {
	case f.Kind == "cgnat":
		v4 = fmt.Sprintf(t.T("The WAN address %s is CGNAT (shared by the ISP): %s cannot be forwarded to this router from outside unless the ISP gives a public address or IPv6."), wan, note)
	case f.Kind == "private":
		v4 = fmt.Sprintf(t.T("The WAN address %s is private: this router is behind another one. Forward %s on it, or devices cannot connect."), wan, note)
	case wan != "" && !f.Here:
		v4 = fmt.Sprintf(t.T("%s points at %s, not this router (WAN %s). Check your DNS / DDNS."), f.Host, strings.Join(f.IPs4, ", "), wan)
	}
	// two separate facts, each a sentence of its own: the IPv4 one first
	switch {
	case v4 != "" && v6 != "":
		return "warn", v4 + " " + v6
	case v4 != "" || v6 != "":
		return "warn", v4 + v6
	}
	// without the router's WAN address only the facts: names and addresses, no words
	if f.Here {
		at := []string{wan}
		if f.Here6 {
			at = append(at, f.IPs6...)
		}
		return "ok", fmt.Sprintf(t.T("%s points at this router (%s)."), f.Host, strings.Join(at, ", "))
	}
	return "ok", f.Host + " → " + strings.Join(f.IPs, ", ")
}

var label = regexp.MustCompile(`^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$`)
var v6 = regexp.MustCompile(`^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$`)

// ValidHost tells a host name or an IP address, as a public address or the portal's name may be given.
func ValidHost(s string) bool {
	if len(s) > 253 {
		return false
	}
	if _, ok := ipnet.IP(s); ok || (v6.MatchString(s) && !strings.Contains(s, ":::")) {
		return true
	}
	for _, l := range strings.Split(s, ".") {
		if len(l) > 63 || !label.MatchString(l) {
			return false
		}
	}
	return true
}

// Covers tells a certificate name that covers host: the same name, or a wildcard one level up.
func Covers(name, host string) bool {
	if name == host {
		return true
	}
	dot := strings.Index(host, ".")
	return strings.HasPrefix(name, "*.") && dot > 0 && host[dot:] == name[1:]
}
