package methods

import (
	"os"
	"os/exec"
	"strings"

	"github.com/tickcount/luci-app-dawnline/backend/apply"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/roster"
	"github.com/tickcount/luci-app-dawnline/backend/watchdog"
)

// sysSaid is the last lines of syslog that explain a failure of something.
func sysSaid(pattern, only string, n string) string {
	out, _ := exec.Command("sh", "-c", "logread -l 400 2>/dev/null | grep -E "+shq(pattern)+" | grep -iE "+shq(only)+" | tail -n "+n).Output()
	return strings.Trim(string(out), " \t\r\n\v\f")
}

func shq(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

// WatchdogFacts reads the router for the watchdog's probes (package watchdog): r is the router an apply
// works on, reapply the full apply.
func WatchdogFacts(d Deps, m *model.Model, r *apply.Router, reapply func()) watchdog.Facts {
	st := roster.AwgState(d.Handler)
	f := watchdog.Facts{Tools: st["tools"] == true, Kmod: st["kmod"] == true, Loaded: st["loaded"] == true, Handler: st["handler"] == true}
	for _, p := range st["missing"].([]any) {
		f.Missing = append(f.Missing, p.(string))
	}
	f.Owner = r.NetifdOwner
	f.Iface = func(ifname string) watchdog.Iface {
		if d.Bus == nil {
			return watchdog.Iface{}
		}
		s := d.Bus("network.interface."+ifname, "status", nil)
		return watchdog.Iface{Exists: s != nil, Up: s != nil && s["up"] == true}
	}
	f.IfaceErrors = func(ifname string) string {
		var parts []string
		if d.Bus != nil {
			var errs []string
			list, _ := d.Bus("network.interface."+ifname, "status", nil)["errors"].([]any)
			for _, e := range list {
				if em, ok := e.(map[string]any); ok {
					one := text(em["code"])
					if data, _ := em["data"].([]any); len(data) > 0 {
						var words []string
						for _, w := range data {
							words = append(words, text(w))
						}
						one += " (" + strings.Join(words, " ") + ")"
					}
					errs = append(errs, one)
				}
			}
			if len(errs) > 0 {
				parts = append(parts, "netifd: "+strings.Join(errs, ", "))
			}
		}
		// only what explains a failure, not the ordinary "is now up/down" lines
		if lines := sysSaid(ifname+"|amneziawg", "error|fail|invalid|unrecogni|cannot|unable|not found|refused|denied", "6"); lines != "" {
			parts = append(parts, lines)
		}
		return strings.Join(parts, "\n")
	}
	udp, _ := os.ReadFile("/proc/net/udp")
	udp6, _ := os.ReadFile("/proc/net/udp6")
	bound := udpBound(string(udp), string(udp6))
	f.UDPListening = func(port int) bool {
		for _, p := range bound {
			if p == port {
				return true
			}
		}
		return false
	}
	if f.Tools && f.Kmod && f.Loaded && f.Handler {
		f.Drift = r.NetifdDrift(m)
	}
	f.NftPresent = r.Present()
	keyed := false
	for _, srv := range m.Servers {
		keyed = keyed || srv.PrivateKey != ""
	}
	if keyed {
		f.Firewall = r.FirewallDrift(m)
	}
	if s := m.Settings; s.PortalEnabled {
		others := false
		for _, h := range listening("tcp") {
			others = others || h.port == s.PortalPort
		}
		tcp, _ := os.ReadFile("/proc/net/tcp")
		tcp6, _ := os.ReadFile("/proc/net/tcp6")
		f.PortalCan, f.PortalListening = !others, tcpListening(s.PortalPort, string(tcp), string(tcp6))
	}
	f.ResolverConf = exists("/var/etc/dawnline-dns.conf")
	f.ResolverRunning = r.ResolverRunning()
	f.Said = func(what string) string {
		switch what {
		case "modprobe":
			out, _ := exec.Command("sh", "-c", "modprobe amneziawg 2>&1; dmesg 2>/dev/null | grep -i amneziawg | grep -iE 'error|fail|invalid|unknown|disagrees|taint' | tail -n 4").Output()
			return strings.Trim(string(out), " \t\r\n\v\f")
		case "portal":
			return sysSaid("dawnline", "portal.*(error|fail|cert|key|bind|address)", "4")
		}
		return ""
	}
	f.Reapply = reapply
	f.Run = func(name string, args ...string) { exec.Command(name, args...).Run() }
	// procd keeps unchanged instances and starts missing ones
	f.StartServices = func() { exec.Command("/etc/init.d/dawnline", "start").Run() }
	f.BlockedNote, f.BlockedFix = apply.BlockedNote, apply.BlockedFix
	return f
}
