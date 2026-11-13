package apply

import (
	"os"
	"regexp"
	"strings"

	"github.com/tickcount/luci-app-dawnline/backend/awg"
	"github.com/tickcount/luci-app-dawnline/backend/model"
)

// A full apply with nothing applied: every step runs on copies of the files it would write, the commands
// that only ask the router something are run, and the ones that would change it are noted instead. For
// holding Go's apply to what a router runs now: after the ucode backend applied, it must find nothing to do.

var (
	asksOnly = regexp.MustCompile(`^ip (-n dawnline )?(-j |-4 |-6 )*(neigh|link|rule|route|addr) show\b[^;|&]*( 2>/dev/null)?$`)
	secret   = regexp.MustCompile(`((private|preshared|protection)_?key) '[^']*'`)
)

func asks(name string, args []string) bool {
	line := strings.Join(args, " ")
	switch name {
	case "sh":
		return len(args) == 2 && args[0] == "-c" && asksOnly.MatchString(args[1])
	case "ip":
		return asksOnly.MatchString("ip " + line)
	case "nft":
		return len(args) > 0 && args[0] == "list"
	case "ubus":
		return len(args) == 3 && args[0] == "call" && strings.HasPrefix(args[1], "network.interface.") && args[2] == "status"
	}
	return false
}

// changes is the lines two texts differ in ("-" gone, "+" new), keys never shown.
func changes(was, now string) []string {
	out := []string{}
	if was == now {
		return out
	}
	count := map[string]int{}
	for _, l := range strings.Split(was, "\n") {
		count[l]++
	}
	var added []string
	for _, l := range strings.Split(now, "\n") {
		if count[l] > 0 {
			count[l]--
		} else {
			added = append(added, l)
		}
	}
	for _, l := range strings.Split(was, "\n") {
		if count[l] > 0 {
			count[l]--
			out = append(out, "- "+secret.ReplaceAllString(l, "$1 '***'"))
		}
	}
	for _, l := range added {
		out = append(out, "+ "+secret.ReplaceAllString(l, "$1 '***'"))
	}
	return out
}

// ApplyPlan is what a full apply would do now, with nothing done: which files would change (their lines),
// which commands would be run, what the home-like path would come to. The runtime sync is Plan's.
func (r *Router) ApplyPlan(m *model.Model, saved string, tools bool, caps awg.Caps) map[string]any {
	dir, err := os.MkdirTemp("", "dawnline-plan-")
	if err != nil {
		return map[string]any{"error": err.Error()}
	}
	defer os.RemoveAll(dir)
	read := func(path string) string {
		raw, _ := os.ReadFile(path)
		return string(raw)
	}
	etc := r.varEtc()
	os.MkdirAll(dir+"/run", 0o755)
	os.MkdirAll(dir+"/etc", 0o755)
	for _, f := range []string{"netifd-blocked.json", "netifd-no-awg", "iface-intent.json", "loop.json", "reply.nft", "net.sig"} {
		if raw, err := os.ReadFile(r.RunDir + "/" + f); err == nil {
			os.WriteFile(dir+"/run/"+f, raw, 0o600)
		}
	}
	for _, f := range []string{"dawnline-dns.conf", "dawnline-dns.resolv", "dawnline-ns.nft"} {
		if raw, err := os.ReadFile(etc + "/" + f); err == nil {
			os.WriteFile(dir+"/etc/"+f, raw, 0o600)
		}
	}
	os.WriteFile(dir+"/network", []byte(read(r.Network)), 0o600)
	os.WriteFile(dir+"/firewall", []byte(read(r.Firewall)), 0o600)
	would := []string{}
	d := *r
	d.RunDir, d.VarEtc, d.Network, d.Firewall, d.Log, d.Remember, d.dry = dir+"/run", dir+"/etc", dir+"/network", dir+"/firewall", nil, nil, true
	d.ResolverPid = r.resolverPid()
	d.Exec = func(name string, args ...string) (string, int) {
		if asks(name, args) {
			return r.Exec(name, args...)
		}
		line := name + " " + strings.Join(args, " ")
		if name == "sh" && len(args) == 2 {
			line = args[1]
		}
		would = append(would, strings.ReplaceAll(line, dir+"/etc", etc))
		return "", 0
	}
	out := map[string]any{}
	out["network"] = d.Netifd(m, tools, caps)
	out["network_lines"] = changes(read(r.Network), read(dir+"/network"))
	out["firewall"] = d.Fw(m)
	out["firewall_lines"] = changes(read(r.Firewall), read(dir+"/firewall"))
	at := len(would)
	lp := d.LoopEnsure(m, saved, false)
	switch {
	case lp.Off:
		out["like_home"] = "off"
	case lp.Error != nil:
		out["like_home"] = lp.Error
	default:
		out["like_home"] = lp.Plan
	}
	out["like_home_runs"] = append([]string{}, would[at:]...)
	out["like_home_state"] = changes(read(r.RunDir+"/loop.json"), read(dir+"/run/loop.json"))
	out["resolver"] = d.SyncResolver(m)
	out["resolver_lines"] = append(changes(read(etc+"/dawnline-dns.conf"), read(dir+"/etc/dawnline-dns.conf")),
		changes(read(etc+"/dawnline-dns.resolv"), read(dir+"/etc/dawnline-dns.resolv"))...)
	at = len(would)
	d.ReplyRoutes(m)
	out["reply_runs"] = append([]string{}, would[at:]...)
	out["reply_lines"] = changes(read(r.RunDir+"/reply.nft"), read(dir+"/run/reply.nft"))
	sig := r.NetSignature(m)
	out["signature"] = sig == read(r.RunDir+"/net.sig")
	if sig != read(r.RunDir+"/net.sig") {
		out["signature_now"], out["signature_kept"] = sig, read(r.RunDir+"/net.sig")
	}
	out["would_run"] = would
	return out
}
