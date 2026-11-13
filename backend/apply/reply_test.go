package apply

import (
	"os"
	"strings"
	"testing"

	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
)

// The reply table follows the proxies: loaded when one diverts the router's own traffic, left alone while
// nothing changed, taken away with the proxy; the rules older versions left are removed.
func TestReplyRoutes(t *testing.T) {
	text, _ := os.ReadFile("../access/testdata/access.uci")
	c, err := uci.Parse(string(text))
	if err != nil {
		t.Fatal(err)
	}
	m := model.Load(c, nil)
	dir := t.TempDir()
	proxy, loaded, refuse := true, false, false
	var ran []string
	var script string
	r := &Router{RunDir: dir, Exec: func(name string, args ...string) (string, int) {
		line := name + " " + strings.Join(args, " ")
		switch {
		case line == "ip -4 rule show priority 90":
			return "90:\tfrom all iif lo ipproto udp sport 51820 lookup main\n", 0
		case line == "ip -6 rule show priority 90":
			return "90:\tfrom all ipproto tcp sport 8443 lookup main\n", 0
		case line == "ip -4 rule show" && proxy:
			return "0:\tfrom all lookup local\n1000:\tfrom all fwmark 0x1/0xff lookup 100\n32766:\tfrom all lookup main\n", 0
		case line == "ip -4 route show table 100":
			return "local default dev lo scope host\n", 0
		case strings.HasPrefix(line, "ip ") && strings.Contains(line, " show"):
			return "", 0
		case line == "nft list table inet dawnline_reply":
			if loaded {
				return "", 0
			}
			return "", 1
		case name == "nft" && args[0] == "-f":
			raw, _ := os.ReadFile(args[1])
			script = string(raw)
			if refuse {
				return args[1] + ":1:1-5: Error: a made-up failure", 1
			}
			loaded = true
			return "", 0
		case line == "nft delete table inet dawnline_reply":
			loaded = false
		}
		ran = append(ran, line)
		return "", 0
	}}
	sig := func() string { raw, _ := os.ReadFile(dir + "/reply.nft"); return string(raw) }

	r.ReplyRoutes(m)
	if want := "ip -4 rule del priority 90 iif lo ipproto udp sport 51820 lookup main; ip -6 rule del priority 90 ipproto tcp sport 8443 lookup main"; strings.Join(ran, "; ") != want {
		t.Errorf("the old rules: %v", ran)
	}
	if !loaded || !strings.HasPrefix(script, "table inet dawnline_reply\ndelete table inet dawnline_reply\ntable inet dawnline_reply {\n") ||
		!strings.Contains(script, "tcp sport { 4500, 4501 } meta mark & 0xff == 0x1 meta mark set meta mark & 0xffffff00\n") ||
		!strings.Contains(script, "udp sport { 4500, 4600, 4700 } meta mark & 0xff == 0x1") {
		t.Errorf("the table was not loaded as it should be:\n%s", script)
	}
	if sig() == "" || !strings.HasSuffix(script, sig()) || !r.ReplyOK(m, r.Diverts()) {
		t.Error("what was loaded is not remembered")
	}
	script = ""
	r.ReplyRoutes(m)
	if script != "" {
		t.Error("loaded again with nothing changed")
	}
	// the table went (fw4 restarted, say): loaded again
	loaded = false
	if r.ReplyOK(m, r.Diverts()) {
		t.Error("fine without the table")
	}
	r.ReplyRoutes(m)
	if !loaded {
		t.Error("not loaded again")
	}
	// a load that fails forgets what was loaded, so the next tick tries again
	c.Set("home", "port", "4555")
	m = model.Load(c, nil)
	refuse = true
	r.ReplyRoutes(m)
	if sig() != "" {
		t.Error("a failed load is remembered")
	}
	refuse = false
	r.ReplyRoutes(m)
	if !strings.Contains(sig(), "4555") {
		t.Error("not loaded after the failure")
	}
	// the proxy is gone: so is the table
	proxy = false
	r.ReplyRoutes(m)
	if loaded || sig() != "" || !r.ReplyOK(m, r.Diverts()) {
		t.Error("the table stays without a proxy")
	}
	left, _ := os.ReadDir(dir)
	for _, e := range left {
		t.Errorf("%s stays in the state directory", e.Name())
	}
}
