// Package ipnet is IPv4 networks as Dawnline's settings and configurations write them, read exactly as
// the ucode backend reads them (dawnline.util ip2int, cidr_any, parse_cidr; dawnline.net collapse): the
// configurations devices hold are made of these, and a device must not be told to import again because
// two backends disagree on a prefix.
package ipnet

import (
	"fmt"
	"net/netip"
	"regexp"
	"sort"
	"strconv"
)

var (
	ipv4 = regexp.MustCompile(`^([0-9]+)\.([0-9]+)\.([0-9]+)\.([0-9]+)$`)
	cidr = regexp.MustCompile(`^([0-9.]+)(/([0-9]+))?$`)
)

// IP is "a.b.c.d" as a number; ok is false for anything else (an octet over 255 too).
func IP(s string) (uint32, bool) {
	m := ipv4.FindStringSubmatch(s)
	if m == nil {
		return 0, false
	}
	var n uint32
	for _, part := range m[1:] {
		o, err := strconv.ParseUint(part, 10, 32)
		if err != nil || o > 255 {
			return 0, false
		}
		n = n*256 + uint32(o)
	}
	return n, true
}

// String is a number as "a.b.c.d".
func String(n uint32) string {
	return fmt.Sprintf("%d.%d.%d.%d", n>>24&255, n>>16&255, n>>8&255, n&255)
}

// Net is an IPv4 network.
type Net struct {
	// Base is its first address, Prefix its length, IP the address it was written with.
	Base   uint32
	Prefix int
	IP     uint32
}

// Size is how many addresses it holds.
func (n Net) Size() uint64 { return 1 << (32 - n.Prefix) }

// Holds tells whether an address is in it.
func (n Net) Holds(ip uint32) bool {
	return uint64(ip) >= uint64(n.Base) && uint64(ip) < uint64(n.Base)+n.Size()
}

// Overlaps tells whether two networks share an address: one holds the other, or they are the same.
func (n Net) Overlaps(o Net) bool { return n.Holds(o.Base) || o.Holds(n.Base) }

func (n Net) String() string { return fmt.Sprintf("%s/%d", String(n.Base), n.Prefix) }

// Any reads "a.b.c.d[/len]" with any prefix 0 to 32 (a bare address is a /32).
func Any(s string) (Net, bool) {
	m := cidr.FindStringSubmatch(s)
	if m == nil {
		return Net{}, false
	}
	ip, ok := IP(m[1])
	if !ok {
		return Net{}, false
	}
	prefix := 32
	if m[2] != "" {
		p, err := strconv.ParseUint(m[3], 10, 31)
		if err != nil || p > 32 {
			return Net{}, false
		}
		prefix = int(p)
	}
	size := uint64(1) << (32 - prefix)
	return Net{Base: uint32(uint64(ip) - uint64(ip)%size), Prefix: prefix, IP: ip}, true
}

// Subnet reads "a.b.c.d/len" as a tunnel's or a home's subnet may be: a prefix 8 to 30, written out.
func Subnet(s string) (Net, bool) {
	m := cidr.FindStringSubmatch(s)
	if m == nil || m[2] == "" {
		return Net{}, false
	}
	n, ok := Any(s)
	if !ok || n.Prefix < 8 || n.Prefix > 30 {
		return Net{}, false
	}
	return n, true
}

// First is the first host of a subnet: the router's address in a tunnel's.
func (n Net) First() uint32 { return n.Base + 1 }

// Collapse drops the networks another of the list already covers, and answers the rest in address order.
// What is no network (or the default route) is left out.
func Collapse(list []string) []string {
	seen := map[string]bool{}
	var nets []Net
	for _, s := range list {
		if seen[s] {
			continue
		}
		seen[s] = true
		if n, ok := Any(s); ok && n.Prefix >= 1 {
			nets = append(nets, n)
		}
	}
	sort.SliceStable(nets, func(i, j int) bool {
		if nets[i].Prefix != nets[j].Prefix {
			return nets[i].Prefix < nets[j].Prefix
		}
		return nets[i].Base < nets[j].Base
	})
	var keep []Net
	for _, n := range nets {
		inside := false
		for _, k := range keep {
			if k.Holds(n.Base) {
				inside = true
				break
			}
		}
		if !inside {
			keep = append(keep, n)
		}
	}
	sort.SliceStable(keep, func(i, j int) bool { return keep[i].Base < keep[j].Base })
	out := make([]string, 0, len(keep))
	for _, n := range keep {
		out = append(out, n.String())
	}
	return out
}

var hexColons = regexp.MustCompile(`^[0-9A-Fa-f:.]+$`)

// Private6 tells whether an IPv6 address is one the tunnel's "everything but the local network" list
// leaves out: in fc00::/7, fe80::/10 or ff00::/8. False for anything that is no IPv6 address.
func Private6(s string) bool {
	if len(s) < 2 || len(s) > 45 || !hexColons.MatchString(s) {
		return false
	}
	a, err := netip.ParseAddr(s)
	if err != nil || !a.Is6() {
		return false
	}
	b := a.As16()
	g := uint16(b[0])<<8 | uint16(b[1])
	return g&0xfe00 == 0xfc00 || g&0xffc0 == 0xfe80 || g&0xff00 == 0xff00
}
