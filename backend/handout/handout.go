// Package handout is what a device is given: its configuration (the .conf and what the AmneziaVPN key is
// made of) and the fingerprint that tells whether the one it holds is still the one it would get. As
// dawnline.awg client_config, allowed_ips and config_fingerprint make them, character for character: a
// fingerprint that differed between the two backends would tell every device to import again.
//
// Pure: the settings and the home networks in, text out. The home networks are the router's own (which
// interfaces are home, and what they reach): the caller reads them and hands them in.
package handout

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/tickcount/luci-app-dawnline/backend/ipnet"
	"github.com/tickcount/luci-app-dawnline/backend/model"
)

// ObfKeys is the disguise's settings in the order a configuration lists them (dawnline.core OBF_KEYS).
var ObfKeys = []string{"jc", "jmin", "jmax", "s1", "s2", "s3", "s4", "h1", "h2", "h3", "h4", "i1", "i2", "i3", "i4", "i5",
	"header_protection_key", "content_padding_addition", "rekey_after_time", "rekey_timeout", "reject_after_time",
	"keepalive_timeout", "max_handshake_attempts", "random_trailers", "disable_cookies"}

// What each is called in a .conf (dawnline.awg OBF_CONF).
var obfConf = map[string]string{
	"jc": "Jc", "jmin": "Jmin", "jmax": "Jmax", "s1": "S1", "s2": "S2", "s3": "S3", "s4": "S4",
	"h1": "H1", "h2": "H2", "h3": "H3", "h4": "H4", "i1": "I1", "i2": "I2", "i3": "I3", "i4": "I4", "i5": "I5",
	"header_protection_key": "HeaderProtectionKey", "content_padding_addition": "ContentPaddingAddition",
	"rekey_after_time": "RekeyAfterTime", "rekey_timeout": "RekeyTimeout", "reject_after_time": "RejectAfterTime",
	"keepalive_timeout": "KeepaliveTimeout", "max_handshake_attempts": "MaxHandshakeAttempts",
	"random_trailers": "RandomTrailers", "disable_cookies": "DisableCookies",
}

// Bypass4 is every IPv4 address but the private ranges, and Bypass6 every IPv6 one outside fc00::/7,
// fe80::/10 and ff00::/8: what a device with its own local network kept outside sends into the tunnel
// (tests/ucode/awg.test.uc proves each is exactly that complement).
var Bypass4 = []string{
	"0.0.0.0/5", "8.0.0.0/7", "11.0.0.0/8", "12.0.0.0/6", "16.0.0.0/4", "32.0.0.0/3", "64.0.0.0/3", "96.0.0.0/6",
	"100.0.0.0/10", "100.128.0.0/9", "101.0.0.0/8", "102.0.0.0/7", "104.0.0.0/5", "112.0.0.0/4", "128.0.0.0/3", "160.0.0.0/5",
	"168.0.0.0/8", "169.0.0.0/9", "169.128.0.0/10", "169.192.0.0/11", "169.224.0.0/12", "169.240.0.0/13", "169.248.0.0/14",
	"169.252.0.0/15", "169.255.0.0/16", "170.0.0.0/7", "172.0.0.0/12", "172.32.0.0/11", "172.64.0.0/10", "172.128.0.0/9",
	"173.0.0.0/8", "174.0.0.0/7", "176.0.0.0/4", "192.0.0.0/9", "192.128.0.0/11", "192.160.0.0/13", "192.169.0.0/16",
	"192.170.0.0/15", "192.172.0.0/14", "192.176.0.0/12", "192.192.0.0/10", "193.0.0.0/8", "194.0.0.0/7", "196.0.0.0/6",
	"200.0.0.0/5", "208.0.0.0/4",
}
var Bypass6 = []string{"::/1", "8000::/2", "c000::/3", "e000::/4", "f000::/5", "f800::/6", "fe00::/9", "fec0::/10"}

// AllowedIPs is what a device sends into the tunnel. Home only: the person's home networks, the tunnel
// network or the router's address, and the DNS. Internet: everything, or with the device's own local
// network kept outside everything but that, every DNS server it is given and for home access what Home
// only gets. `home` is the home networks the person reaches; dev may be nil.
//
// What is behind other people's routers is part of what a device reaches: a device that sends only some
// networks into the tunnel gets those too (as the settings have them: which of them the router has taken
// is the router's to know, and a network it has not is dropped there).
func AllowedIPs(m *model.Model, srv *model.Server, p *model.Person, dev *model.Device, home []string) []string {
	if p.Access != "lan" && (dev == nil || !dev.LanBypass) {
		return []string{"0.0.0.0/0", "::/0"}
	}
	reach := func() []string {
		nets := append([]string{}, home...)
		// With devices reaching each other, the whole tunnel network (the router's address is in it);
		// otherwise only the router's own address.
		if srv.DeviceMesh && srv.Subnet != "" {
			nets = append(nets, srv.Subnet)
		} else if a := model.ServerAddress(srv); a != "" {
			nets = append(nets, a+"/32")
		}
		id := ""
		if dev != nil {
			id = dev.ID
		}
		return append(nets, m.BehindReach(p, id, m.BehindOf(nil))...)
	}
	dns := m.ClientDNS(srv, p)
	if p.Access == "lan" {
		nets := reach()
		if len(dns) > 0 && dns[0] != "" {
			nets = append(nets, dns[0]+"/32")
		}
		return ipnet.Collapse(nets)
	}
	// Every DNS server stays in the tunnel: a private one left out would be asked on whatever network
	// the device is on (a public one is in the rest).
	nets := append([]string{}, Bypass4...)
	var nets6 []string
	seen6 := map[string]bool{}
	for _, a := range dns {
		if _, ok := ipnet.IP(a); ok {
			nets = append(nets, a+"/32")
		} else if ipnet.Private6(a) && !seen6[a] {
			seen6[a] = true
			nets6 = append(nets6, a+"/128")
		}
	}
	if p.Access == "both" {
		nets = append(nets, reach()...)
	}
	out := append(ipnet.Collapse(nets), Bypass6...)
	return append(out, nets6...)
}

// ObfNeutral tells whether the disguise's settings change nothing on the wire (plain WireGuard).
func ObfNeutral(o map[string]string) bool {
	for _, k := range ObfKeys {
		v := o[k]
		if v == "" {
			continue
		}
		want := "0"
		switch k {
		case "h1":
			want = "1"
		case "h2":
			want = "2"
		case "h3":
			want = "3"
		case "h4":
			want = "4"
		}
		if v != want {
			return false
		}
	}
	return true
}

// clientObf is the disguise a device's configuration carries. The junk a device sends is its own: within
// the preset's ranges the count and sizes are shifted a little by the device (the same way every time, so
// the configuration keeps its fingerprint), so two phones of one family do not share one profile. What
// the server must agree on stays the server's.
func clientObf(srv *model.Server, dev *model.Device) map[string]string {
	o := map[string]string{}
	for k, v := range srv.Obf {
		o[k] = v
	}
	num := func(s string) (int64, bool) {
		f, ok := model.Number(s)
		return int64(f), ok && s != ""
	}
	jc, ok := num(o["jc"])
	if ObfNeutral(o) || !ok || jc <= 0 {
		return o
	}
	key := srv.ID + "/" + dev.ID + "/" + srv.Obf["h1"]
	seed := int64(2166136261)
	for i := 0; i < len(key); i++ {
		seed = ((seed ^ int64(key[i])) * 16777619) & 0x7fffffff
	}
	pick := func(n int64) int64 {
		seed = (seed*1103515245 + 12345) & 0x7fffffff
		return seed % n
	}
	jmin, _ := num(o["jmin"])
	jmax, _ := num(o["jmax"])
	o["jc"] = strconv.FormatInt(max(1, min(10, jc+pick(3)-1)), 10)
	if jmax > jmin+32 {
		lo := jmin + pick(17)
		hi := jmax - pick(17)
		if hi <= lo {
			hi = lo + 32
		}
		o["jmin"], o["jmax"] = strconv.FormatInt(lo, 10), strconv.FormatInt(hi, 10)
	}
	return o
}

// Amnezia is what the AmneziaVPN key is made of.
type Amnezia struct {
	Host                string            `json:"host"`
	Port                int               `json:"port"`
	MTU                 string            `json:"mtu"`
	DNS                 []string          `json:"dns"`
	AllowedIPs          []string          `json:"allowed_ips"`
	ClientIP            string            `json:"client_ip"`
	ClientPrivKey       string            `json:"client_priv_key"`
	ClientPubKey        string            `json:"client_pub_key"`
	PSKKey              string            `json:"psk_key"`
	ServerPubKey        string            `json:"server_pub_key"`
	PersistentKeepAlive string            `json:"persistent_keep_alive"`
	Obfuscation         map[string]string `json:"obfuscation"`
}

// Config is a device's configuration.
type Config struct {
	Name          string  `json:"name"`
	Person        string  `json:"person"`
	Server        string  `json:"server"`
	Filename      string  `json:"filename"`
	Conf          string  `json:"conf"`
	HasPrivateKey bool    `json:"has_private_key"`
	Amnezia       Amnezia `json:"amnezia"`
}

// ClientConfig is the configuration a device gets now, or nil when it has no server.
func ClientConfig(m *model.Model, dev *model.Device, home []string) *Config {
	p := m.People[dev.Person]
	if p == nil {
		return nil
	}
	srv := m.Servers[p.Server]
	if srv == nil {
		return nil
	}
	host := m.EndpointHost(srv)
	ep := host
	if strings.Contains(host, ":") && !strings.HasPrefix(host, "[") {
		ep = "[" + host + "]"
	}
	allowed := AllowedIPs(m, srv, p, dev, home)
	dns := m.ClientDNS(srv, p)
	mtu := model.DeviceMTU(srv, dev)
	priv := dev.PrivateKey
	if priv == "" {
		priv = "<private key stays on your device>"
	}
	lines := []string{"[Interface]", "PrivateKey = " + priv, "Address = " + dev.Address + "/32"}
	if len(dns) > 0 {
		lines = append(lines, "DNS = "+strings.Join(dns, ", "))
	}
	lines = append(lines, fmt.Sprintf("MTU = %d", mtu))
	// "Off" is plain WireGuard: neutral values are left out, so any WireGuard app accepts the file.
	obf := clientObf(srv, dev)
	if !ObfNeutral(obf) {
		for _, k := range ObfKeys {
			if obf[k] != "" {
				lines = append(lines, obfConf[k]+" = "+obf[k])
			}
		}
	}
	lines = append(lines, "", "[Peer]", "PublicKey = "+srv.PublicKey)
	if dev.PresharedKey != "" {
		lines = append(lines, "PresharedKey = "+dev.PresharedKey)
	}
	lines = append(lines, "AllowedIPs = "+strings.Join(allowed, ", "), fmt.Sprintf("Endpoint = %s:%d", ep, srv.Port))
	keepalive := ""
	if lo, hi, on := model.KeepaliveRange(srv, dev); on {
		keepalive = strconv.Itoa(lo)
		if hi != lo {
			keepalive = fmt.Sprintf("%d-%d", lo, hi)
		}
		lines = append(lines, "PersistentKeepalive = "+keepalive)
	}
	alive := keepalive
	if alive == "" {
		alive = "0"
	}
	return &Config{
		Name: dev.Name, Person: p.Name, Server: srv.Name,
		// The file name is the tunnel's name in WireGuard apps: the server's.
		Filename:      TunnelName(srv.Name) + ".conf",
		Conf:          strings.Join(lines, "\n") + "\n",
		HasPrivateKey: dev.PrivateKey != "",
		Amnezia: Amnezia{
			Host: host, Port: srv.Port, MTU: strconv.Itoa(mtu), DNS: dns, AllowedIPs: allowed,
			ClientIP: dev.Address, ClientPrivKey: dev.PrivateKey, ClientPubKey: dev.PublicKey,
			PSKKey: dev.PresharedKey, ServerPubKey: srv.PublicKey, PersistentKeepAlive: alive, Obfuscation: obf,
		},
	}
}

// Fingerprint is what a device holds, minus what is its own alone (its private key, its junk's count and
// sizes): it changes when the device must import again. "" for a device with no server.
func Fingerprint(m *model.Model, dev *model.Device, home []string) string {
	c := ClientConfig(m, dev, home)
	if c == nil {
		return ""
	}
	var keep []string
	for _, l := range strings.Split(c.Conf, "\n") {
		own := false
		for _, k := range []string{"PrivateKey ", "Jc ", "Jmin ", "Jmax "} {
			own = own || strings.HasPrefix(l, k)
		}
		if !own {
			keep = append(keep, l)
		}
	}
	h := uint32(2166136261)
	for _, b := range []byte(strings.Join(keep, "\n")) {
		h = (h ^ uint32(b)) * 16777619
	}
	return fmt.Sprintf("%08x", h)
}

// Cyrillic letters written in Latin, from а (dawnline.util translit).
var cyrillic = []string{"a", "b", "v", "g", "d", "e", "zh", "z", "i", "y", "k", "l", "m", "n", "o", "p", "r", "s", "t", "u",
	"f", "kh", "ts", "ch", "sh", "shch", "", "y", "", "e", "yu", "ya"}
var cyrillicMore = map[rune]string{0x451: "yo", 0x456: "i", 0x457: "yi", 0x454: "ye", 0x491: "g"}

// Translit writes Cyrillic letters in Latin ("Мама" → "mama"); other characters are left alone.
func Translit(s string) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 0x410 && r <= 0x42f:
			r += 0x20
		case r == 0x401:
			r = 0x451
		case r == 0x406:
			r = 0x456
		case r == 0x407:
			r = 0x457
		case r == 0x404:
			r = 0x454
		case r == 0x490:
			r = 0x491
		}
		if r >= 0x430 && int(r-0x430) < len(cyrillic) {
			b.WriteString(cyrillic[r-0x430])
		} else if t, ok := cyrillicMore[r]; ok {
			b.WriteString(t)
		} else {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// Names Windows keeps for devices: no file may be called that.
var winDevices = map[string]bool{"con": true, "prn": true, "aux": true, "nul": true}

// TunnelName is a server's name as a tunnel's (a file's) name: Latin letters and digits, at most 15.
func TunnelName(name string) string {
	var b strings.Builder
	gap := false
	for _, c := range []byte(Translit(name)) {
		if c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' {
			if gap {
				b.WriteByte('-')
			}
			gap = false
			b.WriteByte(c)
		} else {
			gap = true
		}
	}
	// a gap at either end is trimmed: one before the first letter was written as a dash above
	l := strings.Trim(b.String(), "-")
	if len(l) > 15 {
		l = l[:15]
	}
	l = strings.TrimRight(l, "-")
	low := strings.ToLower(l)
	if l == "" || winDevices[low] || (len(low) == 4 && (strings.HasPrefix(low, "com") || strings.HasPrefix(low, "lpt")) && low[3] >= '1' && low[3] <= '9') {
		return "dawnline"
	}
	return l
}
