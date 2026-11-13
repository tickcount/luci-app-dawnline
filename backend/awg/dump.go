// Package awg is the backend's one door to AmneziaWG: what the tunnels say of their peers.
//
// This file reads `awg show <ifname> dump`, as dawnline.awg dump() does: Dawnline's own tunnels only, each
// on its own (never `all`: another AmneziaWG interface on the router is not ours to read, and a long one
// would slow a read that runs every second). The tool and /sys are reached through Reader's two functions,
// so a test stands in for both.
package awg

import (
	"os"
	"os/exec"
	"strconv"
	"strings"
)

// Peer is a device as its tunnel sees it.
type Peer struct {
	Ifname string `json:"ifname"`
	// Endpoint is where it last spoke from ("203.0.113.7:41821"), empty when it never did.
	Endpoint string `json:"endpoint"`
	// Handshake is when its session was last made (unix seconds), 0 for never.
	Handshake int64 `json:"handshake"`
	// Rx and Tx are the bytes received from it and sent to it since the tunnel last added it.
	Rx int64 `json:"rx"`
	Tx int64 `json:"tx"`
}

// Iface is a tunnel's own line.
type Iface struct {
	PublicKey string `json:"public_key"`
	Port      int    `json:"port"`
	// Ifindex is the link's index: a new one each time the tunnel is set up, so it is the epoch of its
	// peers' counters.
	Ifindex int `json:"ifindex"`
}

// How a tunnel's read went.
const (
	Read = "read"
	// Down: the interface does not exist; its peers and their counters are gone with it.
	Down = "down"
	// Failed: it exists but could not be read, or was set up again during the read: that says nothing
	// about its peers.
	Failed = "error"
)

// Dump is one look at the tunnels. Ifaces and Peers hold only what was read; OK is false when any tunnel's
// read failed.
type Dump struct {
	OK     bool              `json:"ok"`
	Reads  map[string]string `json:"reads"`
	Ifaces map[string]Iface  `json:"ifaces"`
	Peers  map[string]Peer   `json:"peers"`
}

// Reader reads tunnels. The zero value is not usable: System() is the router's.
type Reader struct {
	// Show is `awg show <ifname> dump`: its output, and whether it ran and ended well.
	Show func(ifname string) (string, bool)
	// Index is the interface's index while it exists.
	Index func(ifname string) (int, bool)
}

// System reads the router's own tunnels.
func System() Reader {
	return Reader{
		Show: func(ifname string) (string, bool) {
			out, err := exec.Command("awg", "show", ifname, "dump").Output()
			return string(out), err == nil
		},
		Index: func(ifname string) (int, bool) {
			raw, err := os.ReadFile("/sys/class/net/" + ifname + "/ifindex")
			if err != nil {
				return 0, false
			}
			n, err := strconv.Atoi(strings.TrimSpace(string(raw)))
			return n, err == nil
		},
	}
}

// Dump reads these tunnels.
func (r Reader) Dump(ifnames []string) Dump {
	d := Dump{OK: true, Reads: map[string]string{}, Ifaces: map[string]Iface{}, Peers: map[string]Peer{}}
	for _, ifname := range ifnames {
		// Read around the call: a link set up again in between gave counters of either one.
		before, there := r.Index(ifname)
		// Not there (a tunnel netifd could not bring up, AmneziaWG gone after an upgrade): no process to
		// learn it. One that appears is read next time.
		if !there {
			d.Reads[ifname] = Down
			continue
		}
		out, ran := r.Show(ifname)
		after, still := r.Index(ifname)
		// Gone during the read: its peers and their counters are gone with it.
		if !still {
			d.Reads[ifname] = Down
			continue
		}
		var iface *Iface
		var peers map[string]Peer
		if ran {
			iface, peers = Parse(out, ifname)
		}
		if iface == nil || after != before {
			d.Reads[ifname] = Failed
			d.OK = false
			continue
		}
		iface.Ifindex = after
		d.Reads[ifname] = Read
		d.Ifaces[ifname] = *iface
		for k, p := range peers {
			d.Peers[k] = p
		}
	}
	return d
}

// Parse reads a dump's lines. They are told apart by their shape, not their length (each AmneziaWG
// generation adds fields to the interface line): an interface line carries its private and public key and
// a port; a peer line the peer's key, a preshared key or "(none)", and an endpoint. The interface is nil
// when the dump has no such line.
func Parse(out, ifname string) (*Iface, map[string]Peer) {
	var iface *Iface
	peers := map[string]Peer{}
	for _, line := range strings.Split(out, "\n") {
		f := strings.Split(line, "\t")
		if len(f) < 4 || !ValidKey(f[0]) {
			continue
		}
		second := ValidKey(f[1])
		if second && digits(f[2]) {
			port, _ := strconv.Atoi(f[2])
			iface = &Iface{PublicKey: f[1], Port: port}
			continue
		}
		if len(f) >= 8 && (second || f[1] == "(none)") {
			p := Peer{Ifname: ifname, Handshake: count(f[4]), Rx: count(f[5]), Tx: count(f[6])}
			if f[2] != "(none)" {
				p.Endpoint = f[2]
			}
			peers[f[0]] = p
		}
	}
	return iface, peers
}

func digits(s string) bool {
	if s == "" {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// count is a counter or a moment of the dump; what is no number counts as none.
func count(s string) int64 {
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0
	}
	return n
}

// ValidKey tells a WireGuard key: 32 bytes in base64, so 43 letters and "=", the last letter one of those
// that end 32 bytes.
func ValidKey(s string) bool {
	if len(s) != 44 || s[43] != '=' || !strings.ContainsRune("AEIMQUYcgkosw048", rune(s[42])) {
		return false
	}
	for i := 0; i < 42; i++ {
		c := s[i]
		if !(c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '+' || c == '/') {
			return false
		}
	}
	return true
}
