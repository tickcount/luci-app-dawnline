package apply

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/awg"
	"github.com/tickcount/luci-app-dawnline/backend/disguise"
	"github.com/tickcount/luci-app-dawnline/backend/files"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/servicelog"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
)

// netifd: one AmneziaWG interface a server, named after its ifname and marked `_dawnline` = the server's
// id (dawnline.netifd). Only interfaces Dawnline made are changed or removed: a name another interface has
// is left alone, and the server is kept down and said so (netifd-blocked.json: a code with its values).

// opt is one option of an interface: a string, a list, or nothing (the option goes).
type opt struct {
	key  string
	val  string
	list []string
}

// put sets an option only when it differs (nothing deletes it); true when something changed.
func put(c *uci.Config, sec string, o opt) bool {
	cur, has := c.Section(sec).Values[o.key]
	if o.val == "" && len(o.list) == 0 {
		if has {
			c.Delete(sec, o.key)
			return true
		}
		return false
	}
	if o.list != nil {
		if has && cur.IsList && strings.Join(cur.List, "\n") == strings.Join(o.list, "\n") {
			return false
		}
		c.SetList(sec, o.key, o.list)
		return true
	}
	if has && !cur.IsList && cur.Str == o.val {
		return false
	}
	c.Set(sec, o.key, o.val)
	return true
}

// options is what is written into network.<ifname> apart from the markers: what netifd sets the tunnel up from.
func options(srv *model.Server) []opt {
	prefix := ""
	if i := strings.Index(srv.Subnet, "/"); i >= 0 {
		prefix = srv.Subnet[i+1:]
	}
	o := []opt{{key: "proto", val: "amneziawg"}, {key: "private_key", val: srv.PrivateKey}, {key: "listen_port", val: strconv.Itoa(srv.Port)},
		{key: "addresses", list: []string{model.ServerAddress(srv) + "/" + prefix}}, {key: "mtu", val: strconv.Itoa(model.TunnelMTU(srv))}}
	for _, k := range model.ObfKeys {
		v := srv.Obf[k]
		// DisableCookies is the devices' alone: on the server it would turn off WireGuard's own defence
		// against a flood of handshakes. Nothing takes it off an interface that had it.
		if k == "disable_cookies" {
			v = ""
		}
		o = append(o, opt{key: "awg_" + k, val: v})
	}
	off := opt{key: "disabled"}
	auto := opt{key: "auto"}
	if !srv.Enabled {
		off.val, auto.val = "1", "0"
	}
	return append(o, off, auto)
}

// optsText is options as a log line's words (secrets masked, nothing as "-").
func optsText(list []opt) string {
	var out []string
	for _, o := range list {
		s := "-"
		if o.list != nil {
			s = strings.Join(o.list, " ")
		} else if o.val != "" {
			s = o.val
		}
		if strings.Contains(o.key, "private_key") || strings.Contains(o.key, "preshared_key") || strings.Contains(o.key, "protection_key") ||
			strings.Contains(o.key, "privatekey") || strings.Contains(o.key, "presharedkey") || strings.Contains(o.key, "protectionkey") {
			s = "***"
		}
		out = append(out, o.key+"="+s)
	}
	return strings.Join(out, ", ")
}

// unsupported is why this AmneziaWG cannot run a server's disguise values, or nil when it can
// (dawnline.awg obf_unsupported).
func unsupported(o map[string]string, c awg.Caps) map[string]any {
	has := func(keys ...string) bool {
		for _, k := range keys {
			if o[k] != "" {
				return true
			}
		}
		return false
	}
	installed := c.Kmod
	if installed == nil {
		installed = c.Tools
	}
	ranged := false
	for _, k := range []string{"h1", "h2", "h3", "h4"} {
		ranged = ranged || strings.Contains(o[k], "-")
	}
	switch {
	case has("header_protection_key", "content_padding_addition", "rekey_after_time", "rekey_timeout", "reject_after_time", "keepalive_timeout",
		"max_handshake_attempts", "random_trailers", "disable_cookies") && !c.V3:
		return map[string]any{"code": "disguise", "need": "3.1", "installed": installed}
	case (has("s3", "s4", "i1", "i2", "i3", "i4", "i5") || ranged) && !c.V2:
		return map[string]any{"code": "disguise", "need": "2.0", "installed": installed}
	}
	return nil
}

// blockedNote is why a server is kept down, for the service log (dawnline.awg blocked_note).
func blockedNote(why map[string]any) string {
	switch why["code"] {
	case "ifname":
		return fmt.Sprintf(`has an invalid interface name "%v"`, why["ifname"])
	case "taken":
		return fmt.Sprintf("can't use the network interface %v: it exists and isn't Dawnline's", why["ifname"])
	case "disguise":
		if in, _ := why["installed"].(string); in != "" {
			return fmt.Sprintf("is kept down: its disguise needs AmneziaWG %v (installed: %s)", why["need"], in)
		}
		return fmt.Sprintf("is kept down: its disguise needs AmneziaWG %v (installed: none)", why["need"])
	case "disguise_invalid":
		return "is kept down: its disguise has values AmneziaWG cannot take"
	}
	return "is kept down"
}

func blockedFix(why map[string]any) string {
	switch why["code"] {
	case "disguise":
		return "Install that AmneziaWG build in Settings → Updates, or switch the disguise in Settings → Disguise."
	case "disguise_invalid":
		return "Choose a disguise in Settings → Disguise: it replaces the values set by hand."
	}
	return "Choose another interface name in the server settings."
}

// intent notes why Dawnline itself is about to take a tunnel down, so the hotplug log can tell that from
// a tunnel that stopped on its own. reason: settings | off | removed. Kept for two minutes.
func (r *Router) intent(ifname, reason, name string) {
	path := r.RunDir + "/iface-intent.json"
	all := map[string]map[string]any{}
	files.ReadJSON(path, &all)
	now := time.Now().Unix()
	for k, v := range all {
		if ts, _ := v["ts"].(float64); float64(now)-ts >= 120 {
			delete(all, k)
		}
	}
	all[ifname] = map[string]any{"reason": reason, "name": name, "ts": now}
	os.MkdirAll(r.RunDir, 0o755)
	files.WriteJSON(path, all, 0o600)
}

// commit writes a configuration file in place whole, under a hidden name first.
func commit(path string, c *uci.Config) error {
	var b [4]byte
	rand.Read(b[:])
	tmp := filepath.Join(filepath.Dir(path), "."+filepath.Base(path)+".dl-"+hex.EncodeToString(b[:]))
	mode := os.FileMode(0o644)
	if st, err := os.Stat(path); err == nil {
		mode = st.Mode().Perm()
	}
	if err := os.WriteFile(tmp, []byte(c.Format()), mode); err != nil {
		os.Remove(tmp)
		return err
	}
	os.Chmod(tmp, mode)
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return err
	}
	return nil
}

// ack records a configuration's new checksum after Dawnline committed and applied it itself, so a later
// `reload_config` does not treat it as changed and restart services that reload on any network change.
func (r *Router) ack(conf string) {
	const md5f = "/var/run/config.md5"
	if r.dry {
		return
	}
	raw, err := os.ReadFile(md5f)
	if err != nil {
		return
	}
	sum, _ := r.Exec("sh", "-c", "uci show "+conf+" | md5sum | cut -d' ' -f1")
	sum = strings.TrimSpace(sum)
	if sum == "" {
		return
	}
	path := "/var/run/config.check/" + conf
	lines := strings.Split(strings.Trim(string(raw), " \t\r\n\v\f"), "\n")
	found := false
	for i, l := range lines {
		if strings.HasSuffix(l, "  "+path) {
			lines[i], found = sum+"  "+path, true
		}
	}
	if !found {
		lines = append(lines, sum+"  "+path)
	}
	os.WriteFile(md5f, []byte(strings.Join(lines, "\n")+"\n"), 0o644)
}

// Netifd brings the router's network configuration in line with the servers; true when it changed. tools
// tells whether amneziawg-tools is there (without its protocol script, changing or bringing up an
// interface would only stop a tunnel that still runs); caps what this AmneziaWG can run. Each server that
// cannot have its interface is marked Blocked in m, as the rest of an apply works from the same model.
func (r *Router) Netifd(m *model.Model, tools bool, caps awg.Caps) bool {
	text, _ := os.ReadFile(r.Network)
	c, err := uci.Parse(string(text))
	if err != nil {
		r.say("error", "network", r.Network+" does not parse: nothing was changed · "+err.Error())
		return false
	}
	changed := false
	var touched []string
	want := map[string]bool{}
	was := map[string]any{}
	files.ReadJSON(r.RunDir+"/netifd-blocked.json", &was)
	blocked := map[string]any{}
	block := func(srv *model.Server, why map[string]any, detail string) {
		blocked[srv.ID] = why
		srv.Blocked = why
		a, _ := json.Marshal(was[srv.ID])
		b, _ := json.Marshal(why)
		if string(a) != string(b) && r.Log != nil {
			r.Log.Write("dawnline", "error", blockedNote(why), detail, srv.Name, servicelog.Extra{})
		}
	}
	flag := r.RunDir + "/netifd-no-awg"
	_, flagged := os.Stat(flag)
	keyed := false
	for _, s := range m.Servers {
		keyed = keyed || s.PrivateKey != ""
	}
	if tools && flagged == nil {
		os.Remove(flag)
	} else if !tools && keyed && flagged != nil {
		if r.Log != nil {
			r.Log.Write("dawnline", "error", "isn't installed: tunnels were left as they are", "Install it in Dawnline → Components.", "AmneziaWG", servicelog.Extra{})
		}
		os.MkdirAll(r.RunDir, 0o755)
		os.WriteFile(flag, []byte(strconv.FormatInt(time.Now().Unix(), 10)), 0o644)
	}
	for _, id := range m.ServerIDs() {
		srv := m.Servers[id]
		if srv.PrivateKey == "" {
			continue
		}
		ifn := srv.Ifname
		if !model.ValidIfname(ifn) {
			block(srv, map[string]any{"code": "ifname", "ifname": ifn}, "Interface name: 1-12 lowercase letters, digits or _.")
			continue
		}
		// whose the section is: nobody's, this server's, or someone else's
		if s := c.Section(ifn); s != nil {
			if owner := s.Values["_dawnline"].Str; owner != id {
				block(srv, map[string]any{"code": "taken", "ifname": ifn}, "Dawnline never changes interfaces it did not create. Choose another interface name for this server.")
				continue
			}
		}
		// disguise values AmneziaWG refuses or crashes on never reach the kernel, and a disguise this build
		// cannot run would come up as a tunnel no device reaches: down, and said so
		var why map[string]any
		if tools {
			if len(disguise.Unsafe(srv.Obf)) > 0 {
				why = map[string]any{"code": "disguise_invalid"}
			} else {
				why = unsupported(srv.Obf, caps)
			}
		}
		if why != nil {
			block(srv, why, blockedFix(why))
			continue
		}
		srv.Blocked = nil
		want[ifn] = true
		if !tools {
			continue
		}
		created := false
		if s := c.Section(ifn); s == nil || s.Type != "interface" {
			c.DeleteSection(ifn)
			c.Add("interface", ifn)
			created = true
		}
		mine := created
		var diff []opt
		for _, o := range options(srv) {
			if put(c, ifn, o) {
				mine = true
				diff = append(diff, o)
			}
		}
		if mine {
			how := "updated"
			if created {
				how = "created"
			}
			r.say("info", "network", fmt.Sprintf("interface %s (%s): %s · %s", ifn, srv.Name, how, optsText(diff)))
		} else {
			r.say("debug", "network", fmt.Sprintf("interface %s (%s): unchanged · %s", ifn, srv.Name, optsText(options(srv))))
		}
		// the markers are saved, but netifd does not read them: a renamed server keeps its tunnel and every session in it
		if put(c, ifn, opt{key: "_dawnline", val: id}) {
			changed = true
		}
		if put(c, ifn, opt{key: "_dawnline_name", val: srv.Name}) {
			changed = true
		}
		if mine {
			changed = true
			touched = append(touched, ifn)
			reason := "settings"
			if !srv.Enabled {
				reason = "off"
			}
			r.intent(ifn, reason, srv.Name)
		}
	}
	a, _ := json.Marshal(blocked)
	b, _ := json.Marshal(was)
	if string(a) != string(b) {
		os.MkdirAll(r.RunDir, 0o755)
		files.WriteJSON(r.RunDir+"/netifd-blocked.json", blocked, 0o644)
	}
	// interfaces Dawnline made for servers that are no more
	var stale []string
	for _, s := range c.OfType("interface") {
		if s.Values["_dawnline"].Str != "" && !want[s.Name] {
			stale = append(stale, s.Name)
		}
	}
	for _, ifn := range stale {
		name := c.Section(ifn).Values["_dawnline_name"].Str
		shown := name
		if name == "" {
			name, shown = ifn, "a removed server"
		}
		r.intent(ifn, "removed", name)
		r.say("info", "network", fmt.Sprintf("interface %s (%s): removed, ifdown %s", ifn, shown, ifn))
		r.Exec("ifdown", ifn)
		c.DeleteSection(ifn)
		changed = true
	}
	if changed {
		if err := commit(r.Network, c); err != nil {
			r.say("error", "network", r.Network+" could not be written · "+err.Error())
			return false
		}
		r.ack("network")
	}
	// only the markers changed: nothing for netifd to read
	if len(touched) > 0 || len(stale) > 0 {
		r.say("info", "network", "ubus call network reload")
		r.Exec("ubus", "call", "network", "reload")
		for _, ifn := range touched {
			if srv := m.Servers[c.Section(ifn).Values["_dawnline"].Str]; srv != nil && srv.Enabled {
				r.say("info", "network", "ifup "+ifn)
				r.Exec("ifup", ifn)
			}
		}
	}
	return changed
}

// NetifdOwner is whose an interface of the network configuration is: has false when there is none, id ""
// when it is not Dawnline's.
func (r *Router) NetifdOwner(ifname string) (id string, has bool) {
	text, _ := os.ReadFile(r.Network)
	c, err := uci.Parse(string(text))
	if err != nil || c.Section(ifname) == nil {
		return "", false
	}
	return c.Section(ifname).Values["_dawnline"].Str, true
}

// NetifdDrift is what of each running server's interface differs from what Netifd writes, by option name
// (a LuCI or uci edit of network.<ifname>, which would otherwise last until the next apply): an empty list
// when it is as Dawnline set it. Only enabled servers whose section exists and is theirs (a missing one is
// the tunnel probe's); the markers are not compared, netifd does not read them. Nothing is saved.
func (r *Router) NetifdDrift(m *model.Model) map[string][]string {
	out := map[string][]string{}
	text, _ := os.ReadFile(r.Network)
	c, err := uci.Parse(string(text))
	if err != nil {
		return out
	}
	for _, id := range m.ServerIDs() {
		srv := m.Servers[id]
		s := c.Section(srv.Ifname)
		if !srv.Enabled || !tunnelOK(srv) || s == nil || s.Values["_dawnline"].Str != id || s.Type != "interface" {
			continue
		}
		diff := []string{}
		for _, o := range options(srv) {
			if put(c, srv.Ifname, o) {
				diff = append(diff, o.key)
			}
		}
		out[id] = diff
	}
	return out
}

// BlockedNote and BlockedFix word why a server is kept down, for the service log.
func BlockedNote(why map[string]any) string { return blockedNote(why) }
func BlockedFix(why map[string]any) string  { return blockedFix(why) }
