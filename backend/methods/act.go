package methods

import (
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/files"
	"github.com/tickcount/luci-app-dawnline/backend/i18n"
	"github.com/tickcount/luci-app-dawnline/backend/view"
)

var ifupFix = regexp.MustCompile(`^ifup:([a-z][a-z0-9_]{0,11})$`)

// healthFix runs a fix a check named and answers Health again with what the fix came to
// (dawnline.health fix): apply and sync are still the ucode backend's, the rest the service's own.
func healthFix(w *view.World, t *i18n.Catalog, d Deps, id, lang string) (map[string]any, error) {
	var result any
	switch {
	case id == "apply":
		if d.Apply != nil {
			result = d.Apply(lang)
		}
	case id == "sync":
		var warning any
		if d.Sync != nil {
			warning = d.Sync(lang)
		}
		result = map[string]any{"warning": warning}
	case id == "restart":
		if d.Background != nil {
			d.Background("sleep 1; /etc/init.d/dawnline restart")
		}
		result = map[string]any{"code": 0}
	// netifd learns protocol handlers (amneziawg) only when it starts; the answer goes out before the network blinks
	case id == "netrestart":
		if d.Background != nil {
			d.Background("sleep 1; /etc/init.d/network restart")
		}
		result = map[string]any{"ok": true, "background": true}
	case ifupFix.MatchString(id):
		name := ifupFix.FindStringSubmatch(id)[1]
		// only Dawnline's own tunnels: never another interface of the router
		mine := false
		for _, s := range w.M.Servers {
			mine = mine || (s.Ifname == name && s.PrivateKey != "")
		}
		if !mine {
			return nil, said{"%s is not one of Dawnline's tunnels.", []any{name}}
		}
		if d.Ifup != nil {
			d.Ifup(name)
		}
		result = map[string]any{"ok": true}
	default:
		return nil, errors.New("Unknown fix.")
	}
	out := serviceLog(w, t, d.RunDir, d.DataDir)
	out["checks"] = healthChecks(w, t, d)
	out["result"] = result
	return out, nil
}

// check[:app|amneziawg|packages] | app[@tag|:reinstall|:rollback|:lang:<code>|:nolang]
// | amneziawg[:auto|slava|grey[:ru]|:rollback] | pkgs:<name,…> (only packages Dawnline manages)
var updateTarget = regexp.MustCompile(`^(check(:(app|amneziawg|packages))?|app(@v?[0-9][0-9A-Za-z.+~-]{0,40}|:reinstall|:rollback|:lang:[a-z]{2,3}(_[A-Za-z]{2,4})?|:nolang)?|amneziawg(:rollback|:(auto|slava|grey)(:ru)?)?|pkgs:[a-z0-9][a-z0-9.+,-]*)$`)

// The packages Dawnline manages besides its own and AmneziaWG's.
var managedPackages = []string{"ip-full", "kmod-veth", "libustream-openssl", "openssl-util", "acme", "acme-acmesh-dnsapi", "luci-app-acme"}

// updatesRun starts an update job: the updater does the work in the background. It answers the new job
// once its worker has written it (a quick check may be over by then), else none (the page follows
// updates_status); never an older job. It waits two seconds at most.
func updatesRun(d Deps, what, lang string) (map[string]any, error) {
	if what == "" {
		what = "check"
	}
	if len(what) > 400 || !updateTarget.MatchString(what) {
		return nil, errors.New("Unknown update target.")
	}
	// checked here too, so a wrong name never becomes a failed job in the history
	if names, isPkgs := strings.CutPrefix(what, "pkgs:"); isPkgs {
		for _, n := range strings.Split(names, ",") {
			known := false
			for _, p := range managedPackages {
				known = known || p == n
			}
			if n == "" {
				return nil, errors.New("Unknown update target.")
			}
			if !known {
				return nil, said{"%s is not a package Dawnline manages", []any{n}}
			}
		}
	}
	if updating(d.RunDir) {
		return nil, errors.New("Another component action is already running")
	}
	type job struct {
		ID      any     `json:"id"`
		Started float64 `json:"started"`
	}
	var prev job
	files.ReadJSON(d.RunDir+"/update-job.json", &prev)
	began := clock()
	args := []string{"install", what}
	if rest, isCheck := strings.CutPrefix(what, "check"); isCheck {
		args = []string{"check"}
		if rest != "" {
			args = append(args, strings.TrimPrefix(rest, ":"))
		}
	}
	// the job speaks the admin's language, when its catalog is installed
	speak := ""
	if i18n.Use(d.Catalogs, lang) != nil {
		speak = strings.ToLower(strings.ReplaceAll(lang, "_", "-"))
	}
	if d.Updater != nil {
		d.Updater(speak, args)
	}
	for i := 0; i < 20; i++ {
		var j job
		var whole map[string]any
		if files.ReadJSON(d.RunDir+"/update-job.json", &j) && j.ID != prev.ID && j.Started >= float64(began) {
			files.ReadJSON(d.RunDir+"/update-job.json", &whole)
			return map[string]any{"started": true, "job": whole}, nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return map[string]any{"started": true, "job": nil}, nil
}
