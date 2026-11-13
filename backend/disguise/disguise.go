// Package disguise checks a server's disguise values (AmneziaWG's obfuscation) as dawnline.awg does.
//
// Unsafe is obf_unsafe: what AmneziaWG would refuse, crash on or break devices with. Its sentences are in
// English, as ucode writes them for a reader with no language; held to ucode's own output on made-up values
// (testdata/trace.uc, scripts/ucode-golden.sh).
package disguise

import (
	"fmt"
	"strings"

	"github.com/tickcount/luci-app-dawnline/backend/awg"
)

// Conf names a value as .conf files do (dawnline.awg OBF_CONF).
var Conf = map[string]string{
	"jc": "Jc", "jmin": "Jmin", "jmax": "Jmax", "s1": "S1", "s2": "S2", "s3": "S3", "s4": "S4",
	"h1": "H1", "h2": "H2", "h3": "H3", "h4": "H4", "i1": "I1", "i2": "I2", "i3": "I3", "i4": "I4", "i5": "I5",
	"header_protection_key": "HeaderProtectionKey", "content_padding_addition": "ContentPaddingAddition",
	"rekey_after_time": "RekeyAfterTime", "rekey_timeout": "RekeyTimeout", "reject_after_time": "RejectAfterTime",
	"keepalive_timeout": "KeepaliveTimeout", "max_handshake_attempts": "MaxHandshakeAttempts",
	"random_trailers": "RandomTrailers", "disable_cookies": "DisableCookies",
}

const space = " \t\r\n\v\f"

// uint is a whole number in digits up to top; ok false for anything else.
func uint(s string, top int64) (int64, bool) {
	if s == "" || len(s) > 10 {
		return 0, false
	}
	var n int64
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return 0, false
		}
		n = n*10 + int64(s[i]-'0')
	}
	return n, n <= top
}

// span is a number or a range as AmneziaWG writes them ("5", "5-15"), each end up to top.
func span(v string, top int64) (lo, hi int64, ok bool) {
	p := strings.Split(strings.Trim(v, space), "-")
	if len(p) > 2 {
		return 0, 0, false
	}
	if lo, ok = uint(p[0], top); !ok {
		return 0, 0, false
	}
	hi = lo
	if len(p) == 2 {
		if hi, ok = uint(p[1], top); !ok {
			return 0, 0, false
		}
	}
	return lo, hi, lo <= hi
}

// tagOK tells one tag of a signature packet both the kernel and amneziawg-go read.
func tagOK(tag string) bool {
	if tag == "t" {
		return true
	}
	key, val, found := strings.Cut(tag, " ")
	if !found {
		return false
	}
	switch key {
	case "b":
		return len(val) > 2 && len(val)%2 == 0 && val[:2] == "0x" && strings.TrimLeft(val[2:], "0123456789abcdefABCDEF") == ""
	case "r", "rc", "rd":
		n, ok := uint(val, 1000)
		return ok && n >= 1
	}
	return false
}

// tagError is what is wrong with signature packet name holding s, or "".
func tagError(name, s string) string {
	if strings.ContainsAny(s, "#\n\r") {
		return name + " may not contain # or a line break."
	}
	for a := strings.Index(s, "<"); a >= 0; a = strings.Index(s, "<") {
		b := strings.Index(s[a:], ">")
		if b < 0 {
			return name + " has a tag that is not closed with >."
		}
		tag := s[a+1 : a+b]
		if !tagOK(tag) {
			if len(tag) > 24 {
				tag = tag[:24] + "…"
			}
			return fmt.Sprintf("%s: <%s> is not a tag AmneziaWG apps accept: use <b 0x…> with an even number of hex digits, <r N>, <rc N> or <rd N> with N from 1 to 1000, or <t>.", name, tag)
		}
		s = s[a+b+1:]
	}
	return ""
}

// Unsafe lists what in disguise values o must never be handed to the kernel; empty when they are safe.
func Unsafe(o map[string]string) []string {
	errs := []string{}
	given := func(k string) bool { return o[k] != "" }
	// a value not given counts as 0
	num := func(k string) (int64, bool) {
		if !given(k) {
			return 0, true
		}
		return uint(strings.Trim(o[k], space), 65535)
	}
	for _, k := range []string{"jc", "jmin", "jmax", "s1", "s2", "s3", "s4"} {
		if _, ok := num(k); !ok {
			errs = append(errs, Conf[k]+" must be a whole number from 0 to 65535.")
		}
	}
	if given("jmin") && given("jmax") {
		lo, ok1 := num("jmin")
		hi, ok2 := num("jmax")
		if ok1 && ok2 && lo > hi {
			errs = append(errs, "Jmin must not be larger than Jmax.")
		}
	}
	// packet types: a number or a range each, apart from the others; one not given keeps WireGuard's own
	type rng struct {
		lo, hi int64
		ok     bool
	}
	var hs [4]rng
	for i := 0; i < 4; i++ {
		k := fmt.Sprintf("h%d", i+1)
		hs[i] = rng{int64(i + 1), int64(i + 1), true}
		if given(k) {
			lo, hi, ok := span(o[k], 4294967295)
			hs[i] = rng{lo, hi, ok}
			if !ok {
				errs = append(errs, Conf[k]+" must be a number or a range like 100-200, up to 4294967295.")
			}
		}
	}
	for i := 0; i < 4; i++ {
		for j := i + 1; j < 4; j++ {
			if hs[i].ok && hs[j].ok && hs[i].lo <= hs[j].hi && hs[j].lo <= hs[i].hi {
				errs = append(errs, fmt.Sprintf("%s and %s overlap: each packet type needs values of its own.", Conf[fmt.Sprintf("h%d", i+1)], Conf[fmt.Sprintf("h%d", j+1)]))
			}
		}
	}
	// header protection: a 32-byte key, and every padding at least the 12 bytes of its nonce
	if given("header_protection_key") {
		if !awg.ValidKey(o["header_protection_key"]) {
			errs = append(errs, "The header protection key is not a key.")
		}
		for _, k := range []string{"s1", "s2", "s3", "s4"} {
			if n, ok := num(k); ok && n < 12 {
				errs = append(errs, Conf[k]+" must be at least 12 with header protection.")
			}
		}
	}
	// 3.1 timers and counts: 0 alone is the kernel's default, a 0 in a range would fire at once
	for _, k := range []string{"rekey_after_time", "rekey_timeout", "reject_after_time", "keepalive_timeout", "max_handshake_attempts"} {
		var lo, hi int64
		ok := true
		if given(k) {
			lo, hi, ok = span(o[k], 65535)
		}
		if !ok || (lo == 0 && hi > 0) {
			errs = append(errs, Conf[k]+" must be a number or a range like 5-15, from 1 to 65535.")
		} else if k == "reject_after_time" && hi > 180 {
			errs = append(errs, "RejectAfterTime must be at most 180 seconds.")
		}
	}
	if given("content_padding_addition") {
		if _, _, ok := span(o["content_padding_addition"], 65535); !ok {
			errs = append(errs, Conf["content_padding_addition"]+" must be a number or a range like 10-100, up to 65535.")
		}
	}
	for _, k := range []string{"random_trailers", "disable_cookies"} {
		if v := o[k]; given(k) && v != "on" && v != "off" && v != "1" && v != "0" {
			errs = append(errs, Conf[k]+" must be on or off.")
		}
	}
	// signature packets: their tags, and all of them in one device's configuration (one QR code)
	total := 0
	for _, k := range []string{"i1", "i2", "i3", "i4", "i5"} {
		if !given(k) {
			continue
		}
		total += len(o[k])
		if e := tagError(Conf[k], o[k]); e != "" {
			errs = append(errs, e)
		}
	}
	if total > 2000 {
		errs = append(errs, fmt.Sprintf("I1-I5 together must be at most 2000 characters, not %d.", total))
	}
	return errs
}
