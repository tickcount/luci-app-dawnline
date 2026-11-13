package disguise

import (
	crand "crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
)

// Pair is one disguise value by its name; a preset is a row of them, in the order they are written.
type Pair struct{ Key, Value string }

// randInt is a whole number from lo to hi, both in, as dawnline.util rand_int draws it.
func randInt(lo, hi int) int {
	var b [4]byte
	crand.Read(b[:])
	n := int(binary.BigEndian.Uint32(b[:]) & 0x7fffffff)
	return lo + n%(hi-lo+1)
}

// A name of the server's own for its signature packets, as tags: <r N> random bytes, <rc N> random
// letters, <b 0x..> fixed bytes.
func dnsName() string {
	tld := []string{"com", "net", "org", "io"}[randInt(0, 3)]
	n := randInt(5, 9)
	return fmt.Sprintf("<b 0x%02x><rc %d><b 0x%02x%s00>", n, n, len(tld), hex.EncodeToString([]byte(tld)))
}

// Signature packets shaped like DNS, made fresh for each server: a query and an answer about a name of
// its own, with its own TTL and address. The same fixed bytes on every router would be one rule to match.
func dnsQuery() string {
	// id, flags (standard query, recursion desired), 1 question, name, type A, class IN
	return "<r 2><b 0x01000001000000000000>" + dnsName() + "<b 0x00010001>"
}

func dnsAnswer() string {
	// id, flags (answer, authoritative, recursion), 1 question, 1 answer, name, A IN, pointer, A IN, ttl, 4 bytes
	return "<r 2><b 0x85800001000100000000>" + dnsName() + fmt.Sprintf("<b 0x00010001c00c00010001%08x0004><r 4>", randInt(300, 86400))
}

// Methods are the disguises a server may be given: none, AmneziaWG 2.0's, AmneziaWG 3.1's.
var Methods = []string{"off", "balanced", "max"}

// Preset makes the disguise values of a method (dawnline.awg obf_preset):
//
//	off      plain WireGuard-compatible packets
//	balanced AmneziaWG 2.0: junk packets, random headers, padded cookie and data packets, DNS-shaped
//	         signature packets
//	max      AmneziaWG 3.1: protected headers, random trailers, padding, jittered timers and a DNS-like
//	         first packet, the values AmneziaVPN itself uses for 3.1 servers
func Preset(name string) []Pair {
	i := strconv.Itoa
	switch name {
	case "max":
		// 32 random bytes, as `awg genkey` makes them
		key := make([]byte, 32)
		crand.Read(key)
		return []Pair{
			{"jc", i(randInt(4, 6))}, {"jmin", "10"}, {"jmax", "50"},
			{"s1", "12"}, {"s2", "12"}, {"s3", "12"}, {"s4", "12"},
			{"h1", "1"}, {"h2", "2"}, {"h3", "3"}, {"h4", "4"},
			{"i1", dnsQuery()}, {"i2", dnsAnswer()},
			{"header_protection_key", base64.StdEncoding.EncodeToString(key)},
			{"content_padding_addition", "10-100"},
			{"rekey_after_time", "100-120"}, {"rekey_timeout", "3-7"}, {"reject_after_time", "150-180"},
			{"keepalive_timeout", "5-15"}, {"max_handshake_attempts", "15-20"},
			{"random_trailers", "on"}, {"disable_cookies", "on"},
		}
	case "off":
		return []Pair{{"jc", "0"}, {"jmin", "0"}, {"jmax", "0"}, {"s1", "0"}, {"s2", "0"}, {"h1", "1"}, {"h2", "2"}, {"h3", "3"}, {"h4", "4"}}
	}
	jmin := randInt(64, 128)
	s1, s2 := randInt(15, 64), randInt(15, 64)
	// a handshake initiation and response never share a size
	for s1+56 == s2 {
		s2 = randInt(15, 64)
	}
	o := []Pair{{"jc", i(randInt(4, 8))}, {"jmin", i(jmin)}, {"jmax", i(jmin + randInt(150, 400))}, {"s1", i(s1)}, {"s2", i(s2)}}
	used := map[int]bool{}
	for _, k := range []string{"h1", "h2", "h3", "h4"} {
		v := randInt(5, 2147483647)
		for used[v] {
			v = randInt(5, 2147483647)
		}
		used[v] = true
		o = append(o, Pair{k, i(v)})
	}
	// AmneziaWG 2.0: padded cookie and data packets (S4 costs MTU, kept small) and DNS-shaped signature
	// packets before each handshake: what 1.0 traffic lacks and gets recognised by
	return append(o, Pair{"s3", i(randInt(8, 48))}, Pair{"s4", i(randInt(4, 16))}, Pair{"i1", dnsQuery()}, Pair{"i2", dnsAnswer()})
}

// Junk packets may be tiny; the ceiling keeps them under the path MTU.
var bounds = []struct {
	key    string
	lo, hi int64
}{{"jc", 0, 10}, {"jmin", 0, 1024}, {"jmax", 0, 1024}, {"s1", 0, 64}, {"s2", 0, 64}, {"s3", 0, 64}, {"s4", 0, 32}}

// plus is a value as ucode's unary plus reads it, for the one check that adds two of them.
func plus(s string) (float64, bool) {
	s = strings.Trim(s, space)
	if n, err := strconv.ParseInt(s, 0, 64); err == nil {
		return float64(n), true
	}
	n, err := strconv.ParseFloat(s, 64)
	return n, err == nil
}

// Errors is what is wrong with the disguise values of a server Dawnline sets up: what AmneziaWG refuses
// (Unsafe), and Dawnline's own bounds on top. Its presets pass it. dawnline.awg obf_errors.
func Errors(o map[string]string) []string {
	errs := Unsafe(o)
	for _, b := range bounds {
		if o[b.key] == "" {
			continue
		}
		if n, ok := uint(strings.Trim(o[b.key], space), 65535); ok && (n < b.lo || n > b.hi) {
			errs = append(errs, fmt.Sprintf("%s must be from %d to %d.", Conf[b.key], b.lo, b.hi))
		}
	}
	_, has1 := o["s1"]
	_, has2 := o["s2"]
	if a, ok1 := plus(o["s1"]); has1 && has2 && ok1 {
		if b, ok2 := plus(o["s2"]); ok2 && a+56 == b {
			errs = append(errs, "S2 must not be S1 + 56: the handshake initiation and response would have the same size.")
		}
	}
	return errs
}
