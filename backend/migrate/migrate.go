// Package migrate is the one-time steps for routers set up by older versions (dawnline.migrate). Each one
// checks first and writes nothing when there is nothing to do; a full apply runs them before it takes its
// own lock (changes to the settings go through the store and its config lock).
package migrate

import (
	"os"
	"regexp"

	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/servicelog"
	"github.com/tickcount/luci-app-dawnline/backend/store"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
)

// Router is where the steps work.
type Router struct {
	Store store.Store
	// NewCode draws a personal code of words.
	NewCode func() string
	// Uhttpd is the LuCI web server's configuration, CGI the portal's old script under it.
	Uhttpd, CGI string
	// ReloadUhttpd has the web server read its configuration again.
	ReloadUhttpd func()
	Log          *servicelog.Log
}

var wordCode = regexp.MustCompile(`^[a-z]{6}-[a-z]{6}-[a-z]{6}$`)

const cgiURL = "/cgi-bin/dawnline-portal"

func (r Router) settings() *uci.Config {
	c, _, err := r.Store.Read()
	if err != nil {
		return nil
	}
	return c
}

func (r Router) note(msg, who string) {
	if r.Log != nil {
		r.Log.Write("dawnline", "info", msg, "", who, servicelog.Extra{})
	}
}

// wordCodes: every personal code is a word code; older random ones are replaced (their links stop working).
func (r Router) wordCodes() {
	old := func(s *uci.Section) bool {
		code, has := s.Get("code")
		return has && !wordCode.MatchString(code)
	}
	c := r.settings()
	if c == nil {
		return
	}
	any := false
	for _, s := range c.OfType("person") {
		any = any || old(s)
	}
	if !any {
		return
	}
	err := r.Store.Transact(func(w *uci.Config, _ *model.Model) error {
		for _, s := range w.OfType("person") {
			if old(s) {
				w.Set(s.Name, "code", r.NewCode())
				w.Delete(s.Name, "words")
			}
		}
		return nil
	})
	if err == nil {
		r.note("moved to word codes", "Personal links")
	}
}

// uhttpd: older versions answered on 443 at home through LuCI's web server (its error page ran the
// portal's CGI). The portal keeps its own port now: that is removed, with the old setting itself.
func (r Router) uhttpd() {
	if raw, err := os.ReadFile(r.Uhttpd); err == nil {
		if c, err := uci.Parse(string(raw)); err == nil {
			if page, _ := c.Section("main").Get("error_page"); c.Section("main") != nil && page == cgiURL {
				c.Delete("main", "error_page")
				mode := os.FileMode(0o644)
				if st, err := os.Stat(r.Uhttpd); err == nil {
					mode = st.Mode().Perm()
				}
				tmp := r.Uhttpd + ".dl-new"
				if os.WriteFile(tmp, []byte(c.Format()), mode) == nil && os.Rename(tmp, r.Uhttpd) == nil {
					if r.ReloadUhttpd != nil {
						r.ReloadUhttpd()
					}
					if r.Log != nil {
						r.Log.Say("info", "portal", "portal removed from the LuCI web server")
					}
				} else {
					os.Remove(tmp)
				}
			}
		}
	}
	if r.CGI != "" {
		os.Remove(r.CGI)
	}
	r.dropSetting("portal_443")
}

func (r Router) dropSetting(key string) {
	c := r.settings()
	if c == nil || c.Section("settings") == nil {
		return
	}
	if _, has := c.Section("settings").Values[key]; !has {
		return
	}
	r.Store.Transact(func(w *uci.Config, _ *model.Model) error {
		w.Delete("settings", key)
		return nil
	})
}

// dropPersonOption removes an option older versions kept on a person, from everyone who still has it.
func (r Router) dropPersonOption(key string) {
	c := r.settings()
	if c == nil {
		return
	}
	has := func(s *uci.Section) bool {
		_, kept := s.Values[key]
		return kept
	}
	any := false
	for _, s := range c.OfType("person") {
		any = any || has(s)
	}
	if !any {
		return
	}
	r.Store.Transact(func(w *uci.Config, _ *model.Model) error {
		for _, s := range w.OfType("person") {
			if has(s) {
				w.Delete(s.Name, key)
			}
		}
		return nil
	})
}

// done lists the steps that cannot tell from the settings whether they ran (settings.migrated).
func done(c *uci.Config) []string {
	s := c.Section("settings")
	if s == nil {
		return nil
	}
	v := s.Values["migrated"]
	if v.IsList {
		return v.List
	}
	if v.Str != "" {
		return []string{v.Str}
	}
	return nil
}

// autoMTU: 1380 was every server's stored MTU before it became automatic (by device type and disguise).
// Once only: an admin may choose 1380 again on purpose.
func (r Router) autoMTU() {
	c := r.settings()
	if c == nil {
		return
	}
	for _, d := range done(c) {
		if d == "auto_mtu" {
			return
		}
	}
	any := false
	err := r.Store.Transact(func(w *uci.Config, _ *model.Model) error {
		for _, s := range w.OfType("server") {
			if mtu, _ := s.Get("mtu"); mtu == "1380" {
				w.Delete(s.Name, "mtu")
				any = true
			}
		}
		if w.Section("settings") == nil {
			w.Add("settings", "settings")
		}
		w.SetList("settings", "migrated", append(append([]string{}, done(w)...), "auto_mtu"))
		return nil
	})
	if err == nil && any {
		r.note("MTU is now automatic", "Servers")
	}
}

// Run is all of them, in order.
func (r Router) Run() {
	r.wordCodes()
	r.uhttpd()
	r.autoMTU()
	// the portal names itself after the server now: its own title setting is gone
	r.dropSetting("portal_title")
	// nobody is limited by the time of day any more: the hours older versions kept for a person are gone
	r.dropPersonOption("hours")
}

// UhttpdOnly is the uhttpd step alone (an uninstall runs it too).
func (r Router) UhttpdOnly() { r.uhttpd() }
