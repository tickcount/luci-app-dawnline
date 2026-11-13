// Package cli is the `dawnline` command (dawnlined run as `dawnlined cli …`; /usr/bin/dawnline hands its
// words over). What the service itself needs works with no backend running: the apply when it starts, the
// sync and the log's lines when a tunnel comes up or goes down, the portal's certificate. What an admin
// types about people and devices goes through the running backend, the same door the pages use.
package cli

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	backend "github.com/tickcount/luci-app-dawnline/backend"
	"github.com/tickcount/luci-app-dawnline/backend/apply"
	"github.com/tickcount/luci-app-dawnline/backend/awg"
	"github.com/tickcount/luci-app-dawnline/backend/files"
	"github.com/tickcount/luci-app-dawnline/backend/github"
	"github.com/tickcount/luci-app-dawnline/backend/i18n"
	"github.com/tickcount/luci-app-dawnline/backend/ipnet"
	"github.com/tickcount/luci-app-dawnline/backend/methods"
	"github.com/tickcount/luci-app-dawnline/backend/migrate"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/netview"
	"github.com/tickcount/luci-app-dawnline/backend/pkgmgr"
	"github.com/tickcount/luci-app-dawnline/backend/servicelog"
	"github.com/tickcount/luci-app-dawnline/backend/store"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
	"github.com/tickcount/luci-app-dawnline/backend/updater"
	"github.com/tickcount/luci-app-dawnline/backend/usage"
	"github.com/tickcount/luci-app-dawnline/backend/view"
	"github.com/tickcount/luci-app-dawnline/backend/zone"
)

// Env is where the command works.
type Env struct {
	RunDir, DataDir, Config string
	Out, Err                io.Writer
	// Run runs a command: what it said (both streams) and its exit code.
	Run func(name string, args ...string) (string, int)
	// Call asks the running backend (ubus object dawnline): its answer, or why there is none.
	Call func(method string, args map[string]any) (map[string]any, error)
	Now  func() time.Time
}

// System is the router's own.
func System() *Env {
	run := func(name string, args ...string) (string, int) {
		out, err := exec.Command(name, args...).CombinedOutput()
		if err == nil {
			return string(out), 0
		}
		if ee, isExit := err.(*exec.ExitError); isExit {
			return string(out), ee.ExitCode()
		}
		return string(out), 127
	}
	return &Env{RunDir: "/var/run/dawnline", DataDir: "/etc/dawnline", Config: "/etc/config/dawnline", Out: os.Stdout, Err: os.Stderr, Run: run, Now: time.Now,
		Call: func(method string, args map[string]any) (map[string]any, error) {
			if args == nil {
				args = map[string]any{}
			}
			raw, _ := json.Marshal(args)
			out, err := exec.Command("ubus", "-t", "90", "call", "dawnline", method, string(raw)).Output()
			if err != nil {
				return nil, fmt.Errorf("Dawnline's backend does not answer (is the service running? /etc/init.d/dawnline start)")
			}
			var res map[string]any
			if json.Unmarshal(out, &res) != nil {
				res = map[string]any{}
			}
			return res, nil
		}}
}

type refusal struct{ msg string }

func die(format string, args ...any) { panic(refusal{fmt.Sprintf(format, args...)}) }

func (e *Env) store() store.Store { return store.Store{Config: e.Config, RunDir: e.RunDir} }

func (e *Env) log() *servicelog.Log {
	return &servicelog.Log{RunDir: e.RunDir, Level: func() string {
		if _, m, err := e.store().Read(); err == nil {
			return m.Settings.LogLevel
		}
		return "info"
	}}
}

// logical is the netifd interface on each device, as netifd says it.
func (e *Env) logical() map[string]netview.Logical {
	out := map[string]netview.Logical{}
	said, code := e.Run("ubus", "call", "network.interface", "dump")
	var res struct {
		Interface []struct {
			L3     string `json:"l3_device"`
			Device string `json:"device"`
			Name   string `json:"interface"`
			Proto  string `json:"proto"`
		} `json:"interface"`
	}
	if code != 0 || json.Unmarshal([]byte(said), &res) != nil {
		return out
	}
	for _, i := range res.Interface {
		dev := i.L3
		if dev == "" {
			dev = i.Device
		}
		if _, seen := out[dev]; dev == "" || seen {
			continue
		}
		out[dev] = netview.Logical{Name: i.Name, Proto: i.Proto}
	}
	return out
}

// router is the router an apply works on.
func (e *Env) router() *apply.Router {
	return &apply.Router{RunDir: e.RunDir, HostsFile: "/tmp/hosts/dawnline", DHCP: "/etc/config/dhcp", Log: e.log(),
		Network: "/etc/config/network", Firewall: "/etc/config/firewall", Exec: e.Run,
		Snapshot: func() *netview.Snapshot { return netview.Take(netview.System(e.logical)) },
		Remember: func(address string) {
			e.store().Transact(func(c *uci.Config, _ *model.Model) error {
				if c.Section("settings") == nil {
					c.Add("settings", "settings")
				}
				c.Set("settings", "lan_address", address)
				return nil
			})
		}}
}

func (e *Env) load() (*model.Model, string, error) {
	c, m, err := e.store().Read()
	if err != nil {
		return nil, "", err
	}
	saved := ""
	if s := c.Section("settings"); s != nil {
		saved, _ = s.Get("lan_address")
	}
	return m, saved, nil
}

func (e *Env) out(v any) {
	if s, is := v.(string); is {
		fmt.Fprintln(e.Out, s)
		return
	}
	raw, _ := json.MarshalIndent(v, "", "\t")
	fmt.Fprintln(e.Out, string(raw))
}

// table prints fixed-width columns: a header, then a line a row.
func (e *Env) table(cols []string, rows [][]string) {
	w := make([]int, len(cols))
	for i, c := range cols {
		w[i] = len([]rune(c))
	}
	for _, r := range rows {
		for i, v := range r {
			if n := len([]rune(v)); n > w[i] {
				w[i] = n
			}
		}
	}
	line := func(r []string) {
		var parts []string
		for i, v := range r {
			parts = append(parts, v+strings.Repeat(" ", w[i]-len([]rune(v))))
		}
		e.out(strings.TrimRight(strings.Join(parts, "  "), " "))
	}
	line(cols)
	for _, r := range rows {
		line(r)
	}
}

func ago(secs int64) string {
	switch {
	case secs < 3600:
		return fmt.Sprintf("%dm", secs/60)
	case secs < 86400:
		return fmt.Sprintf("%dh", secs/3600)
	}
	return fmt.Sprintf("%dd", secs/86400)
}

const help = `
Usage: dawnline <command>

  apply                     Reconcile router configuration and runtime state
  sync                      Push devices and access rules to the tunnels
  status                    People and devices with live state (JSON)
  health                    Run health checks (JSON)
  person ls [--json]        Everyone: id, name, access, state, devices, last seen
  person add <name> [--slug s] [--access lan|internet|both] [--devices n]
                            [--expires YYYY-MM-DD] [--quota GB] [--server id]
  person link <id>          Print the personal portal link
  person rm <id> [--yes]    Remove a person and their devices (--yes when they have any)
  device ls [person] [--json]
  device add <person> <name> [--kind phone|computer|tablet|router] [--conf]
  device conf <id>          Print a device configuration (.conf)
  device rm <id>            Remove a device
  backup                    Create a backup in /etc/dawnline/backups
  portal-cert               Print the certificate and key the portal uses
  portal-http-port          Print the plain-HTTP port when an IP is among the portal addresses
  log [-n N] [--since 2h|3d|date] [--level error|down|repair|up|info] [--src awg|dawnline|portal] [--json]
                            Service log: tunnel and service starts, stops, repairs (newest first)
  teardown                  Remove everything Dawnline created on the router
  version

Exit codes: 0 done, 1 refused or failed, 2 unknown command. health exits 1 when a check fails.`

var flags = map[string]bool{"json": true, "yes": true, "conf": true}

// Main runs one command and returns its exit code.
func (e *Env) Main(argv []string) (code int) {
	opts := map[string]string{}
	var args []string
	for i := 0; i < len(argv); i++ {
		a := argv[i]
		if a == "-n" {
			a = "--n"
		}
		if name, is := strings.CutPrefix(a, "--"); is {
			if flags[name] {
				opts[name] = "1"
			} else if i++; i < len(argv) {
				opts[name] = argv[i]
			} else {
				opts[name] = ""
			}
			continue
		}
		args = append(args, a)
	}
	for len(args) < 4 {
		args = append(args, "")
	}
	cmd := args[0]
	if cmd == "" {
		cmd = "help"
	}
	defer func() {
		if r := recover(); r != nil {
			msg := fmt.Sprint(r)
			if ref, is := r.(refusal); is {
				msg = ref.msg
			}
			fmt.Fprintf(e.Err, "dawnline: %s\n", msg)
			// run from the init script or cron, stderr goes nowhere: syslog keeps why
			e.log().Say("error", "cli", "dawnline "+cmd+" failed: "+msg)
			code = 1
		}
	}()
	// what the backend answers, or its refusal as this command's
	ask := func(method string, a map[string]any) map[string]any {
		res, err := e.Call(method, a)
		if err != nil {
			die("%s", err.Error())
		}
		if msg, _ := res["error"].(string); msg != "" {
			die("%s", msg)
		}
		return res
	}
	warned := func(res map[string]any) {
		if w, _ := res["warning"].(string); w != "" {
			fmt.Fprintf(e.Err, "dawnline: %s\n", w)
		}
	}
	people := func() []map[string]any {
		// The stream's own topic, as the pages read it: made once somebody looks, so the first question
		// may come before it is there.
		var doc map[string]any
		for try := 0; try < 8 && doc == nil; try++ {
			if try > 0 {
				time.Sleep(400 * time.Millisecond)
			}
			res := ask("sync", map[string]any{"topics": []string{"people"}})
			docs, _ := res["docs"].(map[string]any)
			doc, _ = docs["people"].(map[string]any)
		}
		if doc == nil {
			die("Dawnline's backend has not looked at the tunnels yet: try again in a moment.")
		}
		items, _ := doc["items"].(map[string]any)
		var ids []string
		order, _ := doc["order"].([]any)
		for _, id := range order {
			if s, is := id.(string); is && items[s] != nil {
				ids = append(ids, s)
			}
		}
		if len(ids) != len(items) {
			ids = ids[:0]
			for id := range items {
				ids = append(ids, id)
			}
			sort.Strings(ids)
		}
		var out []map[string]any
		for _, id := range ids {
			if m, is := items[id].(map[string]any); is {
				m["id"] = id
				// a person's devices are kept the same way: by id, with their order
				if devs, keyed := m["devices"].(map[string]any); keyed {
					byID, _ := devs["items"].(map[string]any)
					list := []any{}
					order, _ := devs["order"].([]any)
					for _, did := range order {
						if d, is := byID[fmt.Sprint(did)].(map[string]any); is {
							d["id"] = did
							list = append(list, d)
						}
					}
					m["devices"] = list
				}
				out = append(out, m)
			}
		}
		return out
	}
	str := func(v any) string {
		switch x := v.(type) {
		case string:
			return x
		case float64:
			return strconv.FormatFloat(x, 'f', -1, 64)
		}
		return ""
	}
	thePerson := func(id string) map[string]any {
		if id == "" {
			die("Which person? Give their id (dawnline person ls).")
		}
		for _, p := range people() {
			if p["id"] == id {
				return p
			}
		}
		die("Unknown person: %s.", id)
		return nil
	}
	now := e.Now().Unix()
	switch {
	case cmd == "apply":
		st := e.store()
		migrate.Router{Store: st, NewCode: methods.NewCode, Uhttpd: "/etc/config/uhttpd", CGI: "/www/cgi-bin/dawnline-portal", Log: e.log(),
			ReloadUhttpd: func() { e.Run("/etc/init.d/uhttpd", "reload") }}.Run()
		_, tool := os.Stat("/usr/bin/awg")
		_, proto := os.Stat("/lib/netifd/proto/amneziawg.sh")
		full := e.router().Apply(e.load, usage.Load(e.RunDir, e.DataDir, false), nil, tool == nil && proto == nil, awg.SystemCaps(e.DataDir))
		res := map[string]any{"network": full.Network, "firewall": full.Firewall, "like_home": full.LikeHome, "peers": full.Peers, "warning": nil}
		if full.Warning != "" {
			res["warning"] = full.Warning
		}
		e.out(res)
	case cmd == "sync":
		m, _, err := e.load()
		if err != nil {
			die("%s", err.Error())
		}
		r := e.router().Sync(m, usage.Load(e.RunDir, e.DataDir, false), now, false, nil)
		res := map[string]any{"peers": r.Peers, "states": r.States, "table": nil, "warning": nil}
		if r.Table != "" {
			res["table"] = r.Table
		}
		if r.Warning != "" {
			res["warning"] = r.Warning
		}
		e.out(res)
	case cmd == "status":
		e.out(people())
	case cmd == "health":
		res := ask("health", nil)
		checks, _ := res["checks"].([]any)
		e.out(checks)
		for _, c := range checks {
			if m, _ := c.(map[string]any); m["status"] == "error" {
				return 1
			}
		}
	case cmd == "person" && args[1] == "ls":
		list := people()
		sort.SliceStable(list, func(i, j int) bool { return str(list[i]["name"]) < str(list[j]["name"]) })
		if opts["json"] != "" {
			e.out(list)
			break
		}
		var rows [][]string
		for _, p := range list {
			devs, _ := p["devices"].([]any)
			online, _ := p["online"].(float64)
			count := strconv.Itoa(len(devs))
			seen := "never"
			if online > 0 {
				count += fmt.Sprintf(" (%d online)", int(online))
				seen = "now"
			} else if last, _ := p["last_seen"].(float64); last > 0 {
				seen = ago(now-int64(last)) + " ago"
			}
			rows = append(rows, []string{str(p["id"]), str(p["name"]), str(p["server"]), str(p["access"]), str(p["state"]), count, seen})
		}
		e.table([]string{"ID", "NAME", "SERVER", "ACCESS", "STATE", "DEVICES", "LAST SEEN"}, rows)
	case cmd == "person" && args[1] == "add":
		a := map[string]any{"name": args[2], "slug": opts["slug"], "server": opts["server"], "access": opts["access"], "device_limit": opts["devices"],
			"expires": opts["expires"], "quota_gb": opts["quota"]}
		if opts["access"] == "" {
			a["access"] = "internet"
		}
		res := ask("person_create", a)
		id := str(res["id"])
		e.out(fmt.Sprintf("Added %s (%s)", args[2], id))
		links := ask("person_links", map[string]any{"id": id})
		if url := str(links["url"]); url != "" {
			e.out(url)
		} else {
			e.out("No personal link: the portal is off.")
		}
		warned(res)
	case cmd == "person" && args[1] == "link":
		p := thePerson(args[2])
		if url := str(ask("person_links", map[string]any{"id": p["id"]})["url"]); url != "" {
			e.out(url)
		} else {
			e.out("No personal link: the portal is off.")
		}
	case cmd == "person" && args[1] == "rm":
		p := thePerson(args[2])
		devs, _ := p["devices"].([]any)
		n := len(devs)
		s := "s"
		if n == 1 {
			s = ""
		}
		if n > 0 && opts["yes"] == "" {
			die("%s has %d device%s: add --yes to remove them too.", str(p["name"]), n, s)
		}
		res := ask("person_delete", map[string]any{"id": p["id"]})
		if n > 0 {
			e.out(fmt.Sprintf("Removed %s and %d device%s.", str(p["name"]), n, s))
		} else {
			e.out(fmt.Sprintf("Removed %s.", str(p["name"])))
		}
		warned(res)
	case cmd == "device" && args[1] == "ls":
		type row struct {
			m      map[string]any
			person string
		}
		var rows []row
		for _, p := range people() {
			if args[2] != "" && p["id"] != args[2] {
				continue
			}
			devs, _ := p["devices"].([]any)
			for _, d := range devs {
				if m, is := d.(map[string]any); is {
					rows = append(rows, row{m, str(p["id"])})
				}
			}
		}
		if args[2] != "" && len(rows) == 0 {
			thePerson(args[2])
		}
		sort.SliceStable(rows, func(i, j int) bool {
			if rows[i].person != rows[j].person {
				return rows[i].person < rows[j].person
			}
			return str(rows[i].m["name"]) < str(rows[j].m["name"])
		})
		if opts["json"] != "" {
			out := []map[string]any{}
			for _, r := range rows {
				hs, _ := r.m["handshake"].(float64)
				out = append(out, map[string]any{"id": r.m["id"], "person": r.person, "name": r.m["name"], "kind": r.m["kind"], "address": r.m["address"],
					"disabled": r.m["disabled"] == true, "online": r.m["online"] == true, "handshake": hs})
			}
			e.out(out)
			break
		}
		var lines [][]string
		for _, r := range rows {
			st := "never connected"
			hs, _ := r.m["handshake"].(float64)
			switch {
			case r.m["disabled"] == true:
				st = "off"
			case r.m["online"] == true:
				st = "online"
			case hs > 0:
				st = "seen " + ago(now-int64(hs)) + " ago"
			}
			lines = append(lines, []string{str(r.m["id"]), r.person, str(r.m["name"]), str(r.m["kind"]), str(r.m["address"]), st})
		}
		e.table([]string{"ID", "PERSON", "NAME", "KIND", "ADDRESS", "STATE"}, lines)
	case cmd == "device" && args[1] == "add":
		p := thePerson(args[2])
		if args[3] == "" {
			die("Which name? dawnline device add <person> <name>.")
		}
		kind := opts["kind"]
		if kind == "" {
			kind = "phone"
		}
		res := ask("device_create", map[string]any{"person": p["id"], "name": args[3], "kind": kind})
		id := str(res["id"])
		if opts["conf"] != "" {
			conf, _ := res["config"].(map[string]any)
			fmt.Fprint(e.Out, str(conf["conf"]))
		} else {
			e.out(fmt.Sprintf("%s  (dawnline device conf %s prints its configuration)", id, id))
		}
		warned(res)
	case cmd == "device" && args[1] == "conf":
		res := ask("device_config", map[string]any{"id": args[2]})
		fmt.Fprint(e.Out, str(res["conf"]))
	case cmd == "device" && args[1] == "rm":
		name, owner := "", ""
		for _, p := range people() {
			devs, _ := p["devices"].([]any)
			for _, d := range devs {
				if m, _ := d.(map[string]any); m["id"] == args[2] && args[2] != "" {
					name, owner = str(m["name"]), str(p["name"])
				}
			}
		}
		if name == "" {
			die("Unknown device.")
		}
		res := ask("device_delete", map[string]any{"id": args[2]})
		e.out(fmt.Sprintf("Removed %s (%s).", name, owner))
		warned(res)
	case cmd == "backup":
		// with no backend needed: the updater makes one before it replaces Dawnline itself
		st := e.store()
		name, err := methods.BackupCreate(methods.Deps{Store: &st, RunDir: e.RunDir, DataDir: e.DataDir, Config: e.Config}, opts["reason"])
		if err != nil {
			die("%s", err.Error())
		}
		e.out(name)
	case cmd == "portal-cert":
		_, m, err := e.store().Read()
		if err != nil {
			die("%s", err.Error())
		}
		cert, key := methods.PortalCertAndKey(m.Settings, e.DataDir, e.Run)
		e.out(cert + " " + key)
	case cmd == "portal-http-port":
		_, m, err := e.store().Read()
		if err != nil {
			die("%s", err.Error())
		}
		for _, h := range view.PortalHosts(m) {
			if _, is := ipnet.IP(h); is {
				e.out(strconv.Itoa(m.Settings.PortalPort + 1))
				break
			}
		}
	case cmd == "log":
		return e.showLog(opts)
	case cmd == "iface-event":
		e.ifaceEvent(args[1], args[2])
	case cmd == "teardown":
		_, m, err := e.store().Read()
		if err != nil {
			die("%s", err.Error())
		}
		e.router().Teardown(m)
		migrate.Router{Store: e.store(), Uhttpd: "/etc/config/uhttpd", CGI: "/www/cgi-bin/dawnline-portal", Log: e.log(),
			ReloadUhttpd: func() { e.Run("/etc/init.d/uhttpd", "reload") }}.UhttpdOnly()
		e.Run("sh", "-c", "grep -qs /usr/libexec/dawnline/heartbeat /etc/crontabs/root && { sed -i '\\#/usr/libexec/dawnline/heartbeat#d' /etc/crontabs/root; /etc/init.d/cron restart >/dev/null 2>&1; }")
	case cmd == "version":
		e.out(backend.Version)
	case cmd == "help" || cmd == "-h":
		e.out("Dawnline " + backend.Version + "\n" + help)
	default:
		fmt.Fprintf(e.Err, "dawnline: unknown command \"%s\" (dawnline help)\n", strings.TrimSpace(args[0]+" "+args[1]))
		return 2
	}
	return 0
}

var (
	sinceRel  = regexp.MustCompile(`^([0-9]+)([mhd])$`)
	sinceDate = regexp.MustCompile(`^([0-9]{4})-([0-9]{2})-([0-9]{2})$`)
)

// showLog prints the service log, newest first.
func (e *Env) showLog(opts map[string]string) int {
	n, _ := strconv.Atoi(opts["n"])
	var since int64
	if s := opts["since"]; s != "" {
		if m := sinceRel.FindStringSubmatch(s); m != nil {
			k, _ := strconv.ParseInt(m[1], 10, 64)
			since = e.Now().Unix() - k*map[string]int64{"m": 60, "h": 3600, "d": 86400}[m[2]]
		} else if m := sinceDate.FindStringSubmatch(s); m != nil {
			y, _ := strconv.Atoi(m[1])
			mo, _ := strconv.Atoi(m[2])
			d, _ := strconv.Atoi(m[3])
			since = time.Date(y, time.Month(mo), d, 0, 0, 0, 0, zone.Local()).Unix()
		} else {
			die("--since takes 30m, 2h, 3d or a date like 2026-10-18.")
		}
	}
	level, src := opts["level"], opts["src"]
	if level != "" && !strings.Contains(" info up down repair error ", " "+level+" ") {
		die("--level takes error, down, repair, up or info.")
	}
	if src != "" && !strings.Contains(" awg dawnline portal ", " "+src+" ") {
		die("--src takes awg, dawnline or portal.")
	}
	raw, err := os.ReadFile(e.RunDir + "/service.log")
	if err != nil {
		raw, _ = os.ReadFile(e.DataDir + "/service.log")
	}
	lines := strings.Split(string(raw), "\n")
	log := []map[string]any{}
	for i := len(lines) - 1; i >= 0 && (n == 0 || len(log) < n); i-- {
		var ent map[string]any
		if lines[i] == "" || json.Unmarshal([]byte(lines[i]), &ent) != nil {
			continue
		}
		ts, _ := ent["ts"].(float64)
		if (since != 0 && int64(ts) < since) || (level != "" && ent["level"] != level) || (src != "" && ent["src"] != src) {
			continue
		}
		log = append(log, ent)
	}
	if opts["json"] != "" {
		e.out(log)
		return 0
	}
	str := func(v any) string { s, _ := v.(string); return s }
	for _, ent := range log {
		ts, _ := ent["ts"].(float64)
		t := time.Unix(int64(ts), 0).In(zone.Local())
		text := str(ent["msg"])
		if who := str(ent["who"]); ent["by"] == "admin" {
			parts := []string{"You", str(ent["msg"]), str(ent["kind"]), who}
			if note := str(ent["note"]); note != "" {
				parts = append(parts, "· "+note)
			}
			var kept []string
			for _, p := range parts {
				if p != "" {
					kept = append(kept, p)
				}
			}
			text = strings.Join(kept, " ")
		} else if who != "" {
			text = who + " " + text
		}
		e.out(fmt.Sprintf("%02d-%02d %02d:%02d  %-8s %-6s %s", int(t.Month()), t.Day(), t.Hour(), t.Minute(), str(ent["src"]), str(ent["level"]), text))
		if d := str(ent["detail"]); d != "" {
			e.out("    " + strings.ReplaceAll(d, "\n", "\n    "))
		}
	}
	return 0
}

var ifaceName = regexp.MustCompile(`^[a-z][a-z0-9_]{0,15}$`)

// ifaceErrors is why a tunnel is down, from netifd and the last related syslog lines.
func (e *Env) ifaceErrors(ifname string) string {
	var parts []string
	said, _ := e.Run("ubus", "call", "network.interface."+ifname, "status")
	var st struct {
		Errors []struct {
			Code string   `json:"code"`
			Data []string `json:"data"`
		} `json:"errors"`
	}
	json.Unmarshal([]byte(said), &st)
	var errs []string
	for _, x := range st.Errors {
		one := x.Code
		if len(x.Data) > 0 {
			one += " (" + strings.Join(x.Data, " ") + ")"
		}
		errs = append(errs, one)
	}
	if len(errs) > 0 {
		parts = append(parts, "netifd: "+strings.Join(errs, ", "))
	}
	lines, _ := e.Run("sh", "-c", "logread -l 400 2>/dev/null | grep -E '"+ifname+"|amneziawg' | grep -iE 'error|fail|invalid|unrecogni|cannot|unable|not found|refused|denied' | tail -n 6")
	if l := strings.Trim(lines, " \t\r\n\v\f"); l != "" {
		parts = append(parts, l)
	}
	return strings.Join(parts, "\n")
}

// ifaceEvent is the iface hotplug script's word: a tunnel started, stopped or failed to start.
func (e *Env) ifaceEvent(action, ifname string) {
	if !ifaceName.MatchString(ifname) {
		die("Bad interface.")
	}
	log := e.log()
	now := e.Now().Unix()
	// Dawnline leaves a note before it takes a tunnel down itself; anything else is unexpected.
	var intent map[string]any
	if action == "ifdown" {
		path := e.RunDir + "/iface-intent.json"
		all := map[string]map[string]any{}
		files.ReadJSON(path, &all)
		if it := all[ifname]; it != nil {
			ts, _ := it["ts"].(float64)
			used, wasUsed := it["used"].(float64)
			if float64(now)-ts < 120 && !(wasUsed && used != 0 && float64(now)-used >= 15) {
				intent = it
				if !wasUsed || used == 0 {
					it["used"] = float64(now)
					files.WriteJSON(path, all, 0o600)
				}
			}
		}
	}
	who := ifname
	if name, _ := intent["name"].(string); name != "" {
		who = name
	}
	if _, m, err := e.store().Read(); err == nil {
		for _, srv := range m.Servers {
			if srv.Ifname == ifname {
				who = srv.Name
			}
		}
	}
	fails := e.RunDir + "/ifup-failed.json"
	type fail struct {
		Logged int64 `json:"logged"`
		Count  int   `json:"count"`
		Since  int64 `json:"since"`
		Last   int64 `json:"last"`
	}
	switch action {
	case "ifup":
		func() {
			defer files.Lock(e.RunDir, "ifup-failed")()
			all := map[string]*fail{}
			files.ReadJSON(fails, &all)
			if all[ifname] != nil {
				delete(all, ifname)
				files.WriteJSON(fails, all, 0o600)
			}
		}()
		msg := "started"
		if port, code := e.Run("awg", "show", ifname, "listen-port"); code == 0 && strings.TrimSpace(port) != "" {
			msg = "started · accepting connections on port " + strings.TrimSpace(port)
		}
		log.Write("awg", "up", msg, "", who, servicelog.Extra{})
	case "ifdown":
		// stops Dawnline made itself are explained by the admin's own line; only an AmneziaWG update gets one here
		if intent != nil {
			if intent["reason"] == "update" {
				log.Write("awg", "info", "restarting for the AmneziaWG update", "", who, servicelog.Extra{})
			}
			return
		}
		detail := "Dawnline didn't stop it: the router's network restarted, someone stopped it by hand, or it failed."
		if more := e.ifaceErrors(ifname); more != "" {
			detail += "\n" + more
		}
		log.Write("awg", "down", "stopped unexpectedly", detail, who, servicelog.Extra{})
	case "ifup-failed":
		// netifd retries a tunnel that fails to start every few seconds: one line an interface every ten
		// minutes, with how many attempts failed meanwhile
		var n int
		var mins int64
		func() {
			defer files.Lock(e.RunDir, "ifup-failed")()
			all := map[string]*fail{}
			files.ReadJSON(fails, &all)
			f := all[ifname]
			if f == nil || now-f.Last > 600 {
				f = &fail{Since: now}
				all[ifname] = f
			}
			f.Count++
			f.Last = now
			if now-f.Logged >= 600 {
				n, mins = f.Count, (now-f.Since)/60
				f.Logged, f.Since, f.Count = now, now, 0
			}
			os.MkdirAll(e.RunDir, 0o755)
			files.WriteJSON(fails, all, 0o600)
		}()
		if n > 0 {
			msg := "couldn't start"
			if n > 1 {
				msg = fmt.Sprintf("couldn't start · %d failed attempts in %d min", n, mins)
			}
			log.Write("awg", "error", msg, e.ifaceErrors(ifname), who, servicelog.Extra{})
		}
	}
}

var catalogFile = regexp.MustCompile(`^dawnline\.([A-Za-z_-]+)\.lmo$`)

// Updater runs the update worker's command line on this router and returns its exit code.
func Updater(args []string) int {
	e := System()
	sh := func(cmd string) (string, int) { return e.Run("sh", "-c", cmd) }
	_, m, err := e.store().Read()
	if err != nil {
		fmt.Fprintf(os.Stderr, "updater: %s\n", err.Error())
		return 1
	}
	t := i18n.Use(i18n.Dir, os.Getenv("DAWNLINE_LANG"))
	pkg := pkgmgr.System(sh)
	pkg.T = t.T
	return updater.Main(&updater.Env{RunDir: e.RunDir, DataDir: e.DataDir, Version: backend.Version, Policy: m.Settings.Updates, Pkg: pkg, T: t,
		GH: &github.Client{RunDir: e.RunDir}, Fetch: github.HTTPFetch, Run: sh, Log: e.log(), Pid: os.Getpid(),
		Board: func() (string, string, string) {
			said, _ := e.Run("ubus", "call", "system", "board")
			var b struct {
				Release struct {
					Version, Target, Arch string
				} `json:"release"`
			}
			json.Unmarshal([]byte(said), &b)
			return b.Release.Version, b.Release.Target, b.Release.Arch
		},
		Langs: func() []string {
			var out []string
			entries, _ := os.ReadDir(i18n.Dir)
			for _, f := range entries {
				if m := catalogFile.FindStringSubmatch(f.Name()); m != nil {
					out = append(out, m[1])
				}
			}
			sort.Strings(out)
			return out
		}}, args, os.Stdout, os.Stderr)
}
