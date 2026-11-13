package methods

import (
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/tickcount/luci-app-dawnline/backend/files"
	"github.com/tickcount/luci-app-dawnline/backend/i18n"
	"github.com/tickcount/luci-app-dawnline/backend/ipnet"
	"github.com/tickcount/luci-app-dawnline/backend/journal"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
	"github.com/tickcount/luci-app-dawnline/backend/usage"
	"github.com/tickcount/luci-app-dawnline/backend/view"
)

// Settings is every setting dawnline.schema knows, in its order: what settings_get shows as written.
var Settings = []string{"portal_enabled", "portal_host", "portal_alt", "portal_port", "portal_redirect", "portal_cert", "portal_key",
	"default_device_limit", "hostnames", "domain", "geo_enabled", "geo_provider", "log_connections", "log_level", "watchdog", "log_keep_days",
	"log_max", "log_persist", "usage_keep_days", "usage_keep_months", "home_dns_fallback", "update_check", "update_interval", "update_auto",
	"update_mode", "update_time", "update_targets", "update_keep", "update_mirrors"}

// Reserved are the ports the router itself holds: nothing of Dawnline's may take them.
var Reserved = []int{22, 53, 80, 443}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func size(path string) int64 {
	st, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return st.Size()
}

// luciACME is what tells luci-app-acme is there: its menu file, which every version names after the package, and
// its view where each version put it (view/acme.js before 25.12, view/acme/acme.js since). Looking for the old view
// alone said «not installed» of an installed one (the owner's screenshot, 2026-11-12).
var luciACME = []string{
	"/usr/share/luci/menu.d/luci-app-acme.json",
	"/www/luci-static/resources/view/acme/acme.js",
	"/www/luci-static/resources/view/acme.js",
}

// anyExists tells whether one of the paths exists.
func anyExists(paths ...string) bool {
	for _, p := range paths {
		if exists(p) {
			return true
		}
	}
	return false
}

// Needs is the packages a feature needs that are missing, by feature (dawnline.health needs()): checked by
// files, so cheap enough for every page load.
func Needs() map[string][]string {
	tls := false
	for _, d := range []string{"/lib", "/usr/lib"} {
		entries, _ := os.ReadDir(d)
		for _, e := range entries {
			tls = tls || strings.HasPrefix(e.Name(), "libustream-ssl.s")
		}
	}
	rel, _ := os.ReadFile("/proc/sys/kernel/osrelease")
	kver := strings.TrimSpace(string(rel))
	kmod := func(name string) bool {
		return exists("/sys/module/"+name) || exists("/lib/modules/"+kver+"/"+name+".ko")
	}
	type need struct {
		has bool
		pkg string
	}
	miss := func(list ...need) []string {
		out := []string{}
		for _, n := range list {
			if !n.has {
				out = append(out, n.pkg)
			}
		}
		return out
	}
	return map[string][]string{
		"https": miss(need{exists("/usr/bin/openssl"), "openssl-util"}, need{tls, "libustream-openssl"}),
		"acme": miss(need{exists("/usr/lib/acme/client/acme.sh"), "acme"}, need{exists("/usr/lib/acme/client/dnsapi/dns_cf.sh"), "acme-acmesh-dnsapi"},
			need{anyExists(luciACME...), "luci-app-acme"}),
		"home": miss(need{exists("/usr/libexec/ip-full"), "ip-full"}, need{kmod("veth"), "kmod-veth"}),
		"awg":  miss(need{exists("/usr/bin/awg") && exists("/lib/netifd/proto/amneziawg.sh"), "amneziawg-tools"}, need{kmod("amneziawg"), "kmod-amneziawg"}),
	}
}

func certOf(path string) *x509.Certificate {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	block, _ := pem.Decode(raw)
	if block == nil {
		return nil
	}
	c, _ := x509.ParseCertificate(block.Bytes)
	return c
}

// covers tells a certificate name that covers host: the same name, or a wildcard one level up.
func covers(name, host string) bool {
	if name == host {
		return true
	}
	dot := strings.Index(host, ".")
	return strings.HasPrefix(name, "*.") && dot > 0 && host[dot:] == name[1:]
}

// PortalCert is the certificate the portal uses (dawnline.portalcert portal_cert): the one set, an ACME one
// for its address, or Dawnline's self-signed one (made by the service when it starts the portal).
func PortalCert(s model.Settings, dataDir string) (cert string, selfSigned bool) {
	if s.PortalCert != "" && s.PortalKey != "" && exists(s.PortalCert) && exists(s.PortalKey) {
		return s.PortalCert, false
	}
	if h := s.PortalHost; h != "" {
		for _, base := range []string{"/etc/ssl/acme/" + h, "/etc/acme/" + h + "_ecc/" + h} {
			if exists(base+".fullchain.crt") && exists(base+".key") {
				return base + ".fullchain.crt", false
			}
		}
		// an ACME certificate issued for several names, the portal's among them
		entries, _ := os.ReadDir("/etc/ssl/acme")
		for _, e := range entries {
			base, is := strings.CutSuffix(e.Name(), ".fullchain.crt")
			if !is || base == "" || !exists("/etc/ssl/acme/"+base+".key") {
				continue
			}
			if c := certOf("/etc/ssl/acme/" + e.Name()); c != nil {
				for _, n := range c.DNSNames {
					if covers(n, h) {
						return "/etc/ssl/acme/" + e.Name(), false
					}
				}
			}
		}
	}
	return dataDir + "/portal.crt", true
}

// PortalCertAndKey is the certificate and the key the portal serves with. Dawnline's own self-signed pair
// is made here when it is not there yet (run: a command runner, as the service has openssl for it).
func PortalCertAndKey(s model.Settings, dataDir string, run func(name string, args ...string) (string, int)) (cert, key string) {
	cert, self := PortalCert(s, dataDir)
	switch base, acme := strings.CutSuffix(cert, ".fullchain.crt"); {
	case !self && cert == s.PortalCert:
		return cert, s.PortalKey
	case !self && acme:
		return cert, base + ".key"
	}
	key = dataDir + "/portal.key"
	if !exists(cert) || !exists(key) {
		os.MkdirAll(dataDir, 0o700)
		cn := s.PortalHost
		if cn == "" {
			cn = "dawnline"
		}
		run("openssl", "req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-days", "3650", "-subj", "/CN="+cn, "-keyout", key, "-out", cert)
		os.Chmod(key, 0o600)
	}
	return cert, key
}

var (
	blanks     = regexp.MustCompile(`[ \t]+`)
	portSuffix = regexp.MustCompile(`:([0-9]+)$`)
	portRange  = regexp.MustCompile(`^(\d+)([-:](\d+))?$`)
	listSep    = regexp.MustCompile(`[ ,]+`)
)

// ourPortal tells a command line that is our own portal's: its uhttpd, or this backend told to serve it.
func ourPortal(cmd string) bool {
	return strings.Contains(cmd, "/usr/share/dawnline/portal") ||
		(strings.Contains(cmd, "/usr/libexec/dawnline/dawnlined") && strings.Contains(cmd, "-portal-port"))
}

type held struct {
	port int
	name string
}

// programs is who listens on which port of a protocol ("tcp", "udp"), in netstat's order, our own portal left out.
func programs(netstat, proto string, cmdline func(pid string) string) []held {
	var out []held
	seen := map[int]bool{}
	for _, line := range strings.Split(netstat, "\n") {
		f := blanks.Split(strings.TrimSpace(line), -1)
		if len(f) < 4 || (f[0] != proto && f[0] != proto+"6") {
			continue
		}
		m := portSuffix.FindStringSubmatch(f[3])
		pid, name, has := strings.Cut(f[len(f)-1], "/")
		if m == nil || !has || name == "" {
			continue
		}
		port, _ := strconv.Atoi(m[1])
		if seen[port] || ourPortal(cmdline(pid)) {
			continue
		}
		seen[port] = true
		out = append(out, held{port, name})
	}
	return out
}

type forward struct {
	from, to int
	name     string
}

// forwards is the port forwards of a protocol from a zone that are not Dawnline's (dawnline.core
// wan_forwards): a forwarded port never reaches the router itself.
func forwards(fw *uci.Config, zone, want string) []forward {
	var out []forward
	if fw == nil {
		return nil
	}
	for _, r := range fw.OfType("redirect") {
		get := func(k string) string { v, _ := r.Get(k); return v }
		target := get("target")
		if target == "" {
			target = "DNAT"
		}
		if strings.HasPrefix(r.Name, "dawnline_") || get("enabled") == "0" || target != "DNAT" || get("src") != zone {
			continue
		}
		// fw4's default is "tcp udp"
		proto := "tcp udp"
		if v, ok := r.Values["proto"]; ok {
			proto = v.Str
			if v.IsList {
				proto = strings.Join(v.List, " ")
			}
		}
		takes := false
		for _, p := range listSep.Split(proto, -1) {
			takes = takes || p == want || p == "all" || p == "any"
		}
		if !takes {
			continue
		}
		name := get("name")
		if _, named := r.Values["name"]; !named {
			name = r.Name
		}
		for _, p := range listSep.Split(get("src_dport"), -1) {
			if m := portRange.FindStringSubmatch(p); m != nil {
				from, _ := strconv.Atoi(m[1])
				to := from
				if m[3] != "" {
					to, _ = strconv.Atoi(m[3])
				}
				out = append(out, forward{from, to, name})
			}
		}
	}
	return out
}

// tcpTaken is the TCP ports the portal cannot take and who holds them: the router's own, other programs,
// port forwards from WAN (dawnline.rpc.common tcp_taken). `who` in the page's language.
func tcpTaken(m *model.Model, t *i18n.Catalog, progs []held, fw *uci.Config) []map[string]any {
	out := []map[string]any{}
	seen := map[int]bool{}
	hold := func(p int, who string) {
		if !seen[p] {
			seen[p] = true
			out = append(out, map[string]any{"from": p, "to": p, "who": who})
		}
	}
	for _, p := range Reserved {
		hold(p, t.T("the router itself"))
	}
	for _, p := range progs {
		hold(p.port, fmt.Sprintf(t.T("%s on this router"), p.name))
	}
	zones := []string{"wan"}
	for _, id := range m.ServerIDs() {
		z, dup := m.Servers[id].WanZone, false
		for _, o := range zones {
			dup = dup || o == z
		}
		if !dup {
			zones = append(zones, z)
		}
	}
	for _, z := range zones {
		for _, f := range forwards(fw, z, "tcp") {
			out = append(out, map[string]any{"from": f.from, "to": f.to, "who": fmt.Sprintf(t.T("port forward “%s”"), f.name)})
		}
	}
	return out
}

func parseFile(path string) *uci.Config {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	c, _ := uci.Parse(string(raw))
	return c
}

// logsInfo is what the log and the traffic history hold right now (Settings → Logs & history).
func logsInfo(w *view.World, d Deps) map[string]any {
	var ev []map[string]any
	if !files.ReadJSON(d.RunDir+"/events.json", &ev) {
		files.ReadJSON(d.DataDir+"/events.json", &ev)
	}
	by := map[string]int{}
	for _, c := range journal.Categories {
		by[c] = 0
	}
	for _, e := range ev {
		by[journal.CategoryOf(text(e["type"]))]++
	}
	days := map[string]bool{}
	for _, group := range []map[string]*usage.Record{w.Usage.Devices, w.Usage.People} {
		for _, rec := range group {
			if rec != nil {
				for k := range rec.Days {
					days[k] = true
				}
			}
		}
	}
	keys := make([]string, 0, len(days))
	for k := range days {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	since := ""
	if len(keys) > 0 {
		since = keys[0]
	}
	var oldest any = 0
	if len(ev) > 0 {
		oldest = ev[0]["ts"]
	}
	return map[string]any{
		"policy": policy(w), "events": len(ev), "oldest": oldest, "by_category": by,
		"log_ram": size(d.RunDir + "/events.json"), "log_flash": size(d.DataDir + "/events.json"), "usage_flash": size(d.DataDir + "/usage.json"),
		"usage_since": since, "usage_days": len(keys), "geo_flash": size(d.DataDir + "/geo.json"),
	}
}

// policy is what the log and the traffic history keep (dawnline.live policy()).
func policy(w *view.World) map[string]any {
	pol, keep := journal.PolicyOf(w.M.Settings.Retention), usage.PolicyOf(w.M.Settings.Retention)
	cats := pol.Categories
	if cats == nil {
		cats = []string{}
	}
	return map[string]any{"keep_days": pol.KeepDays, "max": pol.Max, "categories": cats, "persist": pol.Persist, "usage_days": keep.Days, "usage_months": keep.Months}
}

// settingsGet is the Settings page's data: the settings as written and as they take effect, and what the
// page shows beside them.
func settingsGet(w *view.World, t *i18n.Catalog, d Deps) map[string]any {
	out := map[string]any{}
	var section *uci.Section
	if c := parseFile(d.Config); c != nil {
		section = c.Section("settings")
	}
	for _, k := range Settings {
		out[k] = ""
		if section != nil {
			if v, ok := section.Values[k]; ok {
				out[k] = v.Str
				if v.IsList {
					out[k] = v.List
				}
			}
		}
	}
	pol := policy(w)
	out["log_category"] = pol["categories"]
	var cert any
	if s := w.M.Settings; s.PortalEnabled {
		path, self := PortalCert(s, d.DataDir)
		expires := ""
		if c := certOf(path); c != nil {
			// as `openssl x509 -enddate` writes it
			expires = c.NotAfter.UTC().Format("Jan _2 15:04:05 2006") + " GMT"
		}
		cert = map[string]any{"path": path, "self_signed": self, "expires": expires}
	}
	services := []any{}
	for _, id := range w.M.ServiceIDs() {
		services = append(services, w.M.Services[id])
	}
	var geo struct {
		IPs map[string]json.RawMessage `json:"ips"`
	}
	if !files.ReadJSON(d.RunDir+"/geo.json", &geo) {
		files.ReadJSON(d.DataDir+"/geo.json", &geo)
	}
	return map[string]any{
		"settings": out, "needs": Needs(), "effective": w.M.Settings, "services": services, "cert": cert,
		"tcp_taken":          tcpTaken(w.M, t, listening("tcp"), parseFile("/etc/config/firewall")),
		"portal_public_port": w.M.Settings.PortalPort, "geo_cached": len(geo.IPs), "logs": logsInfo(w, d),
	}
}

var backupFile = regexp.MustCompile(`^dawnline-([0-9]{8}-[0-9]{6})(-([a-z0-9-]+))?\.tar\.gz$`)

// backupRead is a backup's file, in base64 (the page saves it).
func backupRead(dir, name string) (map[string]any, error) {
	if !backupFile.MatchString(name) {
		return nil, errors.New("Invalid backup name.")
	}
	raw, err := os.ReadFile(dir + "/" + name)
	if err != nil {
		return nil, errors.New("Backup not found.")
	}
	return map[string]any{"data": base64.StdEncoding.EncodeToString(raw)}, nil
}

// listening is the programs that listen on the router now, by netstat.
func listening(proto string) []held {
	flag := "-lntp"
	if proto == "udp" {
		flag = "-lnup"
	}
	netstat, _ := exec.Command("netstat", flag).Output()
	return programs(string(netstat), proto, func(pid string) string {
		raw, _ := os.ReadFile("/proc/" + pid + "/cmdline")
		return string(raw)
	})
}

// "  12: 00000000:1194 00000000:0000 07 …": the local address, then the remote one (none).
var udpUnconnected = regexp.MustCompile(`^ *[0-9]+: [0-9A-F]+:([0-9A-F]{4}) [0-9A-F]+:0000 `)

// udpBound is the UDP ports an unconnected socket is bound to, as /proc/net/udp and udp6 list them: nothing
// else can listen there.
func udpBound(tables ...string) []int {
	var out []int
	seen := map[int]bool{}
	for _, t := range tables {
		for _, line := range strings.Split(t, "\n") {
			if m := udpUnconnected.FindStringSubmatch(line); m != nil {
				p, _ := strconv.ParseInt(m[1], 16, 32)
				if !seen[int(p)] {
					seen[int(p)] = true
					out = append(out, int(p))
				}
			}
		}
	}
	return out
}

// udpTaken is the UDP ports a server cannot listen on and who holds them: other servers, tunnel interfaces,
// programs on the router and port forwards from its WAN zone (dawnline.rpc.servers udp_taken). Its own port
// is not counted.
func udpTaken(m *model.Model, srv *model.Server, t *i18n.Catalog, network, fw *uci.Config, bound []int, progs []held) []map[string]any {
	out := []map[string]any{}
	seen := map[int]bool{}
	hold := func(p int, who string) {
		if p > 0 && !seen[p] {
			seen[p] = true
			out = append(out, map[string]any{"from": p, "to": p, "who": who})
		}
	}
	for _, id := range m.ServerIDs() {
		if o := m.Servers[id]; id != srv.ID {
			hold(o.Port, fmt.Sprintf(t.T("server “%s”"), o.Name))
		}
	}
	if network != nil {
		for _, s := range network.OfType("interface") {
			if lp, _ := s.Get("listen_port"); lp != "" && s.Name != srv.Ifname {
				p, _ := strconv.Atoi(strings.TrimSpace(lp))
				hold(p, fmt.Sprintf(t.T("interface %s"), s.Name))
			}
		}
	}
	names := map[int]string{}
	for _, p := range progs {
		names[p.port] = p.name
	}
	for _, p := range bound {
		if p == srv.Port {
			continue
		}
		if n := names[p]; n != "" {
			hold(p, fmt.Sprintf(t.T("%s on this router"), n))
		} else {
			hold(p, t.T("another program on this router"))
		}
	}
	for _, f := range forwards(fw, srv.WanZone, "udp") {
		out = append(out, map[string]any{"from": f.from, "to": f.to, "who": fmt.Sprintf(t.T("port forward “%s”"), f.name)})
	}
	return out
}

// Address is one IPv4 address of a netifd interface, with its prefix ("192.168.1.1/24").
type Address struct {
	Iface, CIDR string
}

// takenNetworks is the networks a tunnel network must not overlap, by name: the router's and the servers'.
func takenNetworks(m *model.Model, addrs []Address) []map[string]any {
	out := []map[string]any{}
	seen := map[string]bool{}
	add := func(name, cidr string) {
		if n, ok := ipnet.Subnet(cidr); ok && !seen[n.String()] {
			seen[n.String()] = true
			out = append(out, map[string]any{"name": name, "cidr": n.String()})
		}
	}
	for _, a := range addrs {
		add(a.Iface, a.CIDR)
	}
	for _, id := range m.ServerIDs() {
		add(m.Servers[id].Name, m.Servers[id].Subnet)
	}
	return out
}

// serverPorts is what the ports and the network of an existing server must avoid (the AmneziaWG card checks
// as you type).
func serverPorts(w *view.World, t *i18n.Catalog, d Deps, id string) map[string]any {
	srv := w.M.Servers[id]
	if srv == nil {
		return map[string]any{"error": t.T("Unknown server.")}
	}
	fw := parseFile("/etc/config/firewall")
	udp, _ := os.ReadFile("/proc/net/udp")
	udp6, _ := os.ReadFile("/proc/net/udp6")
	var addrs []Address
	if d.Addresses != nil {
		addrs = d.Addresses()
	}
	networks := []map[string]any{}
	for _, n := range takenNetworks(w.M, addrs) {
		// everything but this server's own
		if n["cidr"] != srv.Subnet {
			networks = append(networks, n)
		}
	}
	return map[string]any{
		"udp_taken": udpTaken(w.M, srv, t, parseFile("/etc/config/network"), fw, udpBound(string(udp), string(udp6)), listening("udp")),
		"tcp_taken": tcpTaken(w.M, t, listening("tcp"), fw), "networks": networks,
	}
}
