package migrate

import (
	"os"
	"strings"
	"testing"

	"github.com/tickcount/luci-app-dawnline/backend/store"
)

// The one-time steps change what they must the first time and nothing the second.
func TestRun(t *testing.T) {
	dir := t.TempDir()
	conf := dir + "/dawnline"
	os.WriteFile(conf, []byte(`
config settings 'settings'
	option portal_title 'My VPN'
	option portal_443 '1'
	option domain 'vpn'

config server 'main'
	option mtu '1380'
	option subnet '10.9.0.0/29'

config server 'side'
	option mtu '1400'

config person 'alice'
	option code 'abcdef-ghijkl-mnopqr'
	option hours '07:00-23:00'

config person 'bob'
	option code 'XyZ12345'
	option words 'old words'
`), 0o600)
	os.WriteFile(dir+"/uhttpd", []byte("\nconfig uhttpd 'main'\n\toption home '/www'\n\toption error_page '/cgi-bin/dawnline-portal'\n"), 0o644)
	os.WriteFile(dir+"/cgi", []byte("#!/bin/sh\n"), 0o755)
	reloads := 0
	r := Router{Store: store.Store{Config: conf, RunDir: dir + "/run"}, NewCode: func() string { return "kamiro-telosu-bavine" },
		Uhttpd: dir + "/uhttpd", CGI: dir + "/cgi", ReloadUhttpd: func() { reloads++ }}
	r.Run()
	raw, _ := os.ReadFile(conf)
	got := string(raw)
	for _, want := range []string{"option code 'kamiro-telosu-bavine'", "option code 'abcdef-ghijkl-mnopqr'", "option subnet '10.9.0.0/29'", "option mtu '1400'",
		"list migrated 'auto_mtu'", "option domain 'vpn'"} {
		if !strings.Contains(got, want) {
			t.Errorf("%s is not there:\n%s", want, got)
		}
	}
	for _, gone := range []string{"XyZ12345", "old words", "1380", "portal_443", "portal_title", "option hours"} {
		if strings.Contains(got, gone) {
			t.Errorf("%s stays:\n%s", gone, got)
		}
	}
	if st, _ := os.Stat(conf); st.Mode().Perm() != 0o600 {
		t.Errorf("the settings are no longer private: %v", st.Mode().Perm())
	}
	web, _ := os.ReadFile(dir + "/uhttpd")
	if strings.Contains(string(web), "error_page") || !strings.Contains(string(web), "option home '/www'") || reloads != 1 {
		t.Errorf("the web server's configuration (%d reloads):\n%s", reloads, web)
	}
	if _, err := os.Stat(dir + "/cgi"); err == nil {
		t.Error("the old script stays")
	}
	// again: nothing is drawn or written
	r.NewCode = func() string { t.Error("a code drawn again"); return "x" }
	st, _ := os.Stat(conf)
	r.Run()
	if again, _ := os.Stat(conf); !again.ModTime().Equal(st.ModTime()) || reloads != 1 {
		t.Error("written again with nothing to do")
	}
	if raw, _ := os.ReadFile(conf); string(raw) != got {
		t.Error("the settings changed the second time")
	}
	// an admin's own 1380 after the step stays
	os.WriteFile(conf, []byte(strings.Replace(got, "option mtu '1400'", "option mtu '1380'", 1)), 0o600)
	r.Run()
	if raw, _ := os.ReadFile(conf); !strings.Contains(string(raw), "option mtu '1380'") {
		t.Error("an MTU chosen on purpose was taken away")
	}
}
