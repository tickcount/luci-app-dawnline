package apply

import (
	"fmt"
	"os"
	"regexp"
	"strings"

	"github.com/tickcount/luci-app-dawnline/backend/health"
	"github.com/tickcount/luci-app-dawnline/backend/model"
)

// Our own answers leave by the main table: the portal's (TCP) and each tunnel's (UDP). Proxies on the
// router mark the router's own traffic in an output route chain, which diverts replies to outside clients
// into lo; a later output chain of our own (table inet dawnline_reply) clears exactly those marks on
// packets from our listening ports (dawnline.fw sync_reply_routes).

const replyTable = "dawnline_reply"

// Older versions kept answers out of proxies with `ip rule` at priority 90; it never matched.
var oldReplyRule = regexp.MustCompile(`(iif lo )?ipproto (tcp|udp) sport ([0-9]+) lookup main`)

// Diverts is the policy rules that send marked traffic into a table with `local default`, the way
// transparent proxies capture the router's own traffic.
func (r *Router) Diverts() []health.Divert {
	return health.ProxyDiverts(func(fam string) string {
		out, _ := r.Exec("ip", fam, "rule", "show")
		return out
	}, func(fam, name string) string {
		out, _ := r.Exec("ip", fam, "route", "show", "table", name)
		return out
	})
}

func (r *Router) replyLoaded() bool {
	_, code := r.Exec("nft", "list", "table", "inet", replyTable)
	return code == 0
}

// ReplyOK tells whether answers from our ports are kept out of these diverts right now (the watchdog's question).
func (r *Router) ReplyOK(m *model.Model, diverts []health.Divert) bool {
	s := health.ReplyScript(m, diverts)
	if s == "" {
		return true
	}
	was, _ := os.ReadFile(r.RunDir + "/reply.nft")
	return s == string(was) && r.replyLoaded()
}

// ReplyRoutes keeps the reply table in step with our ports and the proxies' diverts (an apply, and every
// tick: a proxy may start after Dawnline). Cheap when nothing changed.
func (r *Router) ReplyRoutes(m *model.Model) {
	sig := r.RunDir + "/reply.nft"
	for _, fam := range []string{"-4", "-6"} {
		out, _ := r.Exec("ip", fam, "rule", "show", "priority", "90")
		for _, line := range strings.Split(out, "\n") {
			if mm := oldReplyRule.FindStringSubmatch(line); mm != nil {
				args := []string{fam, "rule", "del", "priority", "90"}
				if mm[1] != "" {
					args = append(args, "iif", "lo")
				}
				r.Exec("ip", append(args, "ipproto", mm[2], "sport", mm[3], "lookup", "main")...)
			}
		}
	}
	s := health.ReplyScript(m, r.Diverts())
	if s == "" {
		if r.replyLoaded() {
			r.say("info", "nftables", "table inet "+replyTable+": removed (no proxy to keep Dawnline's answers out of)")
			r.Exec("nft", "delete", "table", "inet", replyTable)
		}
		os.Remove(sig)
		return
	}
	if was, _ := os.ReadFile(sig); s == string(was) && r.replyLoaded() {
		r.say("debug", "nftables", "table inet "+replyTable+": unchanged")
		return
	}
	if err := r.load("table inet " + replyTable + "\ndelete table inet " + replyTable + "\n" + s); err != "" {
		os.Remove(sig)
		r.say("error", "nftables", "table inet "+replyTable+": loading failed · "+err)
		return
	}
	r.say("info", "nftables", fmt.Sprintf("table inet %s: loaded · %d lines (Dawnline's own answers kept out of proxies)", replyTable, strings.Count(s, "\n")+1))
	for _, l := range strings.Split(strings.TrimRight(s, "\n"), "\n") {
		r.say("debug", "nftables", "table inet "+replyTable+": "+l)
	}
	os.MkdirAll(r.RunDir, 0o755)
	os.WriteFile(sig, []byte(s), 0o644)
}
