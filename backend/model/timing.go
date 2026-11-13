// What follows from the settings about time and tunnels: a device's keep-alive, how long it may go
// between two handshakes, how long after one it still counts as online, and which tunnel a server has.
// As dawnline.core, dawnline.awg and dawnline.live work them out (tests/ucode/awg.test.uc has the cases
// these are held to). Pure: the settings in, numbers out.

package model

import (
	"net/netip"
	"regexp"
	"strconv"
	"strings"
)

const (
	// OnlineWindow is how long after its handshake a device counts as online, at the least: a WireGuard
	// session is dropped 180 s after its handshake and a device that is there renews it every 2 minutes
	// (a little slack for a renewal that needs a retry).
	OnlineWindow = 190
	// SleepWindow is the same for a phone or a tablet: asleep, its system holds the tunnel's timers and its
	// session lapses for minutes and comes back by itself. That silence is sleep, not leaving.
	SleepWindow = 600
	// A device's own keep-alive is taken within this range (seconds; 0 is off).
	keepaliveMax = 600
)

// DeviceKeepalive is the keep-alive a device's configuration carries, in seconds (0: off): its own when the
// admin set one, else the server's.
func DeviceKeepalive(srv *Server, dev *Device) int {
	if dev != nil && dev.Keepalive != nil && *dev.Keepalive >= 0 && *dev.Keepalive <= keepaliveMax {
		return *dev.Keepalive
	}
	return srv.Keepalive
}

// KeepaliveRange is that keep-alive as the device sends it, lo to hi seconds; ok is false when it is off.
// With header protection (AmneziaWG 3.1, whose apps take ranges) it is jittered over ten seconds, since a
// fixed beat would be the one regular thing left.
func KeepaliveRange(srv *Server, dev *Device) (lo, hi int, ok bool) {
	k := DeviceKeepalive(srv, dev)
	if k <= 0 {
		return 0, 0, false
	}
	if srv.Obf["header_protection_key"] != "" {
		return k, k + 10, true
	}
	return k, k, true
}

// IdleHandshake is the longest an idle device goes between two handshakes, in seconds; ok is false when
// its keep-alive is off (an idle device then sends nothing at all). Its keep-alives are what it sends, and
// the first one after its key's rekey time (WireGuard's 120 s; past 180 s the key is refused anyway)
// starts a handshake: up to one keep-alive past that time, or each keep-alive once they are further apart.
func IdleHandshake(srv *Server, dev *Device) (int, bool) {
	lo, hi, ok := KeepaliveRange(srv, dev)
	if !ok {
		return 0, false
	}
	rekey := 120
	if _, top, given := uintRange(srv.Obf["rekey_after_time"], 65535); given && top != 0 {
		rekey = top
	}
	rekey = min(rekey, 180)
	if lo > rekey {
		return hi, true
	}
	return rekey + hi, true
}

// OnlineWindowOf is how long after its last handshake a device still counts as online, in seconds:
// OnlineWindow, or 30 s more than an idle device goes between handshakes when that is longer (it renews
// its session only with its keep-alive, and a fixed window would see it leave and come back between two).
// A phone or a tablet never less than SleepWindow.
func OnlineWindowOf(srv *Server, dev *Device) int {
	w := OnlineWindow
	if srv != nil {
		if h, ok := IdleHandshake(srv, dev); ok {
			w = max(w, h+30)
		}
	}
	if dev != nil && has(MobileKinds, dev.Kind) {
		w = max(w, SleepWindow)
	}
	return w
}

// uintOf is a whole number as AmneziaWG writes one, up to top.
func uintOf(s string, top int) (int, bool) {
	if s == "" || len(s) > 10 {
		return 0, false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return 0, false
		}
	}
	n, err := strconv.Atoi(s)
	return n, err == nil && n <= top
}

// uintRange is a number or a range as AmneziaWG writes them ("5", "5-15"), each end up to top.
func uintRange(v string, top int) (lo, hi int, ok bool) {
	p := strings.Split(strings.TrimSpace(v), "-")
	if len(p) > 2 {
		return 0, 0, false
	}
	lo, ok = uintOf(p[0], top)
	if !ok {
		return 0, 0, false
	}
	hi = lo
	if len(p) == 2 {
		if hi, ok = uintOf(p[1], top); !ok {
			return 0, 0, false
		}
	}
	return lo, hi, lo <= hi
}

// Tunnel is a server's link.
type Tunnel struct {
	Ifname string
	Subnet string
	// Address is the router's own in the tunnel: the subnet's first.
	Address string
}

var ifname = regexp.MustCompile(`^[a-z][a-z0-9_]{0,11}$`)

// ValidIfname tells a server's interface name: also a netifd section and an nftables string, so nothing else.
func ValidIfname(s string) bool { return ifname.MatchString(s) }

// TunnelOf is the server's tunnel: it has one when it has its keys, is not kept down, and its interface's
// name and subnet are usable.
func TunnelOf(srv *Server) (Tunnel, bool) {
	if srv == nil || srv.PrivateKey == "" || srv.Blocked != nil || !ValidIfname(srv.Ifname) {
		return Tunnel{}, false
	}
	p, ok := parseCIDR(srv.Subnet)
	if !ok {
		return Tunnel{}, false
	}
	return Tunnel{Ifname: srv.Ifname, Subnet: srv.Subnet, Address: p.Masked().Addr().Next().String()}, true
}

// TunnelIfnames is the interfaces of the servers that run: turned on, with a tunnel that is Dawnline's.
// What the tunnels' reader is asked for.
func (m *Model) TunnelIfnames() []string {
	out := []string{}
	for _, id := range m.serverIDs {
		srv := m.Servers[id]
		if !srv.Enabled {
			continue
		}
		if t, ok := TunnelOf(srv); ok {
			out = append(out, t.Ifname)
		}
	}
	return out
}

var cidr = regexp.MustCompile(`^[0-9.]+/[0-9]+$`)

// parseCIDR reads "a.b.c.d/len" with a prefix a tunnel can have (8 to 30).
func parseCIDR(s string) (netip.Prefix, bool) {
	if !cidr.MatchString(s) {
		return netip.Prefix{}, false
	}
	p, err := netip.ParsePrefix(s)
	if err != nil || !p.Addr().Is4() || p.Bits() < 8 || p.Bits() > 30 {
		return netip.Prefix{}, false
	}
	return p, true
}
