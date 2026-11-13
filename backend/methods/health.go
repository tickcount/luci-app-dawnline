package methods

import (
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/awg"
	"github.com/tickcount/luci-app-dawnline/backend/endpoint"
	"github.com/tickcount/luci-app-dawnline/backend/files"
	"github.com/tickcount/luci-app-dawnline/backend/health"
	"github.com/tickcount/luci-app-dawnline/backend/i18n"
	"github.com/tickcount/luci-app-dawnline/backend/ipnet"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/roster"
	"github.com/tickcount/luci-app-dawnline/backend/state"
	"github.com/tickcount/luci-app-dawnline/backend/view"
	"github.com/tickcount/luci-app-dawnline/backend/zone"
)

var (
	dfFree   = regexp.MustCompile(`\n\S+\s+[0-9]+\s+[0-9]+\s+([0-9]+)\s`)
	markRule = regexp.MustCompile(`^(\d+):.*fwmark 0x([0-9a-f]+)(/0x[0-9a-f]+)?.* lookup (\S+)`)
	defRoute = regexp.MustCompile(`(^|\n)default [^\n]*`)
)

func run(name string, args ...string) (string, bool) {
	out, err := exec.Command(name, args...).Output()
	return string(out), err == nil
}

// policyRouting is policy routing by another package (mwan3, pbr): an fwmark rule ahead of Dawnline's
// (pref < 5205) whose table has a default route of its own sends marked tunnel traffic straight out.
func policyRouting(rules string, table func(name string) string) []string {
	out := []string{}
	for _, line := range strings.Split(rules, "\n") {
		m := markRule.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		var pref int
		fmt.Sscan(m[1], &pref)
		if pref >= 5205 {
			continue
		}
		def := defRoute.FindString(table(m[4]))
		if def == "" || strings.Contains(def, "local default") || strings.Contains(def, "dev dlx0") {
			continue
		}
		out = append(out, "pref "+m[1]+" fwmark 0x"+m[2]+" → table "+m[4])
	}
	return out
}

// tcpListening tells whether anything listens on a TCP port, by /proc/net/tcp and tcp6 (state 0A).
func tcpListening(port int, tables ...string) bool {
	hex := fmt.Sprintf(":%04X ", port)
	for _, t := range tables {
		for _, line := range strings.Split(t, "\n") {
			if strings.Index(line, hex) > 0 && strings.Contains(line, " 0A ") {
				return true
			}
		}
	}
	return false
}

// healthChecks gathers what Health's checks are made from and makes them.
func healthChecks(w *view.World, t *i18n.Catalog, d Deps) []health.Check {
	m := w.M
	in := health.Inputs{M: m, T: t, Needs: Needs(), Firewall: parseFile("/etc/config/firewall"), Network: parseFile("/etc/config/network")}
	in.ModelErrors = func() []string { return health.ModelErrors(m, t) }
	in.Unread = func(ifname string) bool { return w.Reads[ifname] == awg.Failed }
	states := map[string]string{}
	for id, p := range m.People {
		states[id] = state.Of(m, p, w.Usage, w.Now)
	}
	in.Peers = func(srv *model.Server) health.Peers {
		return health.PeerDiff(health.TunnelDevices(m, srv.ID, states), w.Peers, srv.Ifname)
	}
	// answers from our ports, and the proxies that would swallow them
	diverts := health.ProxyDiverts(func(fam string) string {
		out, _ := run("ip", fam, "rule", "show")
		return out
	}, func(fam, name string) string {
		out, _ := run("ip", fam, "route", "show", "table", name)
		return out
	})
	rep := &health.Replies{Diverts: []string{}}
	for _, x := range diverts {
		rep.Diverts = append(rep.Diverts, x.String())
	}
	if script := health.ReplyScript(m, diverts); script == "" {
		rep.OK = true
	} else {
		kept, _ := os.ReadFile(d.RunDir + "/reply.nft")
		_, loaded := run("nft", "list", "table", "inet", "dawnline_reply")
		rep.OK = string(kept) == script && loaded
	}
	in.Replies = rep
	// AmneziaWG, after loading an installed module that is not loaded yet
	state := roster.AwgState(d.Handler)
	if state["kmod"] == true && state["loaded"] == false {
		exec.Command("modprobe", "amneziawg").Run()
		state = roster.AwgState(d.Handler)
	}
	for _, p := range state["missing"].([]any) {
		in.Missing = append(in.Missing, p.(string))
	}
	in.Loaded, in.Handler = state["loaded"] == true, state["handler"] == true
	rel, _ := os.ReadFile("/proc/sys/kernel/osrelease")
	var rec struct {
		OSRelease string `json:"osrelease"`
	}
	if files.ReadJSON(d.DataDir+"/awg.json", &rec); rec.OSRelease != "" && rec.OSRelease != strings.TrimSpace(string(rel)) {
		in.KernelWas, in.KernelIs = rec.OSRelease, strings.TrimSpace(string(rel))
	}
	if len(in.Missing) == 0 && !in.Loaded {
		out, _ := exec.Command("sh", "-c", "modprobe amneziawg 2>&1; dmesg | grep -i amneziawg | tail -n 3").Output()
		in.WhyNotLoaded = strings.Trim(string(out), " \t\r\n\v\f")
	}
	in.WaitsForReboot = awg.SystemCaps(d.DataDir).Pending
	in.Year = time.Unix(w.Now, 0).In(zone.Local()).Year()
	// what counts traffic and enforces end dates and limits is this backend: it answers, so it runs
	in.AgentRunning = true
	df, ok := run("df", "-Pk", "/overlay")
	if !ok {
		df, _ = run("df", "-Pk", "/")
	}
	if f := dfFree.FindStringSubmatch(df); f != nil {
		var kb int64
		fmt.Sscan(f[1], &kb)
		in.FreeKB = &kb
	}
	_, in.NftLoaded = run("nft", "list", "table", "inet", "dawnline")
	rules, _ := run("ip", "-4", "rule", "show")
	in.PolicyRouting = policyRouting(rules, func(name string) string {
		out, _ := run("ip", "-4", "route", "show", "table", name)
		return out
	})
	in.Iface = func(ifname string) health.Iface {
		st := map[string]any(nil)
		if d.Bus != nil {
			st = d.Bus("network.interface."+ifname, "status", nil)
		}
		if st == nil {
			return health.Iface{}
		}
		f := health.Iface{Exists: true, Up: st["up"] == true}
		errs, _ := st["errors"].([]any)
		for _, e := range errs {
			if em, ok := e.(map[string]any); ok {
				f.Errors = append(f.Errors, text(em["code"]))
			}
		}
		return f
	}
	if d.Addresses != nil {
		for _, a := range d.Addresses() {
			in.Subnets = append(in.Subnets, health.Subnet{Iface: a.Iface, CIDR: a.CIDR})
		}
	}
	snap := d.Snapshot()
	// the networks behind people's routers: which are in effect here, and what the last sync said of their routes
	in.Behind, in.Own = snap.Behind(m), snap.Own(m)
	if said, err := os.ReadFile(d.RunDir + "/routes.err"); err == nil {
		in.RouteError = strings.TrimSpace(string(said))
	}
	in.HomeNets = func(srv *model.Server) []string {
		_, _, nets, _ := snap.ServerNet(srv)
		return nets
	}
	in.Endpoint = func(srv *model.Server, host string) endpoint.Reads { return endpointReads(d, srv, host) }
	in.LikeHome, _ = roster.LikeHome(d.RunDir)
	if st, err := os.Stat("/var/etc/dawnline-dns.conf"); err == nil {
		age := time.Now().Unix() - st.ModTime().Unix()
		in.ResolverConfAge = &age
		pid, _ := os.ReadFile("/var/run/dawnline-dns.pid")
		p := strings.TrimSpace(string(pid))
		in.ResolverRunning = p != "" && strings.Trim(p, "0123456789") == "" && exists("/proc/"+p)
	}
	in.Portal = func() health.Portal {
		s := m.Settings
		p := health.Portal{}
		for _, h := range listening("tcp") {
			if h.port == s.PortalPort {
				p.Owners = append(p.Owners, h.name)
			}
		}
		tcp, _ := os.ReadFile("/proc/net/tcp")
		tcp6, _ := os.ReadFile("/proc/net/tcp6")
		p.Listening = tcpListening(s.PortalPort, string(tcp), string(tcp6))
		if s.PortalHost != "" && d.Resolve != nil {
			p.IPs = d.Resolve(s.PortalHost)
		}
		if d.RouterWAN != nil {
			p.WAN = d.RouterWAN(m)
		}
		p.Cert, p.SelfSigned = PortalCert(s, d.DataDir)
		if c := certOf(p.Cert); c != nil {
			p.Valid = c.NotAfter.After(time.Now().Add(14 * 24 * time.Hour))
			if !p.SelfSigned {
				p.Names = c.DNSNames
			}
		}
		return p
	}
	return health.Run(in)
}

// acmeCert is an ACME certificate on the router and the names it covers.
type acmeCert struct {
	names []string
}

func acmeCerts() []acmeCert {
	var out []acmeCert
	entries, _ := os.ReadDir("/etc/ssl/acme")
	for _, e := range entries {
		base, is := strings.CutSuffix(e.Name(), ".fullchain.crt")
		if !is || base == "" || !exists("/etc/ssl/acme/"+base+".key") {
			continue
		}
		c := acmeCert{}
		if x := certOf("/etc/ssl/acme/" + e.Name()); x != nil {
			c.names = x.DNSNames
		}
		out = append(out, c)
	}
	return out
}

// portalCandidates is the addresses the portal could use in links, found on the router: names in ACME
// certificates, server endpoints, DDNS names, the current ones, and the WAN IP; each with where it points
// and whether a certificate covers it, the best first (dawnline.portalcert portal_candidates).
func portalCandidates(m *model.Model, d Deps) []map[string]any {
	wan := ""
	if d.RouterWAN != nil {
		wan = d.RouterWAN(m)
	}
	var names []string
	add := func(h string) {
		if _, ip := ipnet.IP(h); h == "" || ip || !endpoint.ValidHost(h) || strings.HasPrefix(h, "*.") {
			return
		}
		for _, n := range names {
			if n == h {
				return
			}
		}
		names = append(names, h)
	}
	certs := acmeCerts()
	for _, c := range certs {
		for _, n := range c.names {
			add(n)
		}
	}
	for _, id := range m.ServerIDs() {
		add(m.Servers[id].Endpoint)
	}
	if ddns := parseFile("/etc/config/ddns"); ddns != nil {
		for _, s := range ddns.OfType("service") {
			if on, _ := s.Get("enabled"); on != "0" {
				h, _ := s.Get("lookup_host")
				add(h)
				h, _ = s.Get("domain")
				add(h)
			}
		}
	}
	hosts := view.PortalHosts(m)
	for _, h := range hosts {
		add(h)
	}
	type cand struct {
		m     map[string]any
		score int
	}
	var list []cand
	put := func(host, kind string, ips []string, here, cf, cert bool) {
		score := 0
		if here {
			score += 4
		}
		if cert {
			score += 2
		}
		if kind == "name" {
			score++
		}
		if cf {
			score -= 8
		}
		list = append(list, cand{map[string]any{"host": host, "kind": kind, "ips": ips, "here": here, "cloudflare": cf, "cert": cert}, score})
	}
	// every name asked at once: each lookup may wait two seconds
	found := make([][]string, len(names))
	done := make(chan int)
	for i, h := range names {
		go func() {
			if d.Resolve != nil {
				found[i] = d.Resolve(h)
			}
			done <- i
		}()
	}
	for range names {
		<-done
	}
	for i, h := range names {
		ips := found[i]
		if ips == nil {
			ips = []string{}
		}
		here, cf, covered := false, false, false
		for _, ip := range ips {
			here = here || (wan != "" && ip == wan)
			cf = cf || endpoint.Cloudflare(ip)
		}
		for _, c := range certs {
			for _, n := range c.names {
				covered = covered || endpoint.Covers(n, h)
			}
		}
		put(h, "name", ips, here, cf, covered)
	}
	if wan != "" {
		put(wan, "ip", []string{wan}, true, false, false)
	}
	for _, h := range hosts {
		if _, ip := ipnet.IP(h); ip && h != wan {
			put(h, "ip", []string{h}, false, false, false)
		}
	}
	// best first: here with a certificate, then here, then the rest
	sort.SliceStable(list, func(i, j int) bool { return list[i].score > list[j].score })
	out := []map[string]any{}
	for _, c := range list {
		out = append(out, c.m)
	}
	return out
}

// portalInfo is the slow part of the portal's settings (DNS lookups and Health's checks of the portal),
// fetched after the page shows.
func portalInfo(w *view.World, t *i18n.Catalog, d Deps) map[string]any {
	checks := []health.Check{}
	for _, c := range healthChecks(w, t, d) {
		switch c.ID {
		case "portal", "portal_dns", "portal_reply", "portal_http", "cert":
			checks = append(checks, c)
		}
	}
	return map[string]any{"candidates": portalCandidates(w.M, d), "checks": checks}
}
