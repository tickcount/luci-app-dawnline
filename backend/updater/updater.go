package updater

import (
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/files"
	"github.com/tickcount/luci-app-dawnline/backend/github"
	"github.com/tickcount/luci-app-dawnline/backend/i18n"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/pkgmgr"
	"github.com/tickcount/luci-app-dawnline/backend/servicelog"
	"github.com/tickcount/luci-app-dawnline/backend/zone"
)

const usage = `Usage:
  updater check [app|amneziawg|packages]
  updater install app | app@<tag> | app:reinstall | app:rollback
  updater install amneziawg[:auto|slava|grey[:ru]] | amneziawg:rollback
  updater install pkgs:<name,…>
  updater auto
`

// Env is where a job works.
type Env struct {
	RunDir, DataDir string
	// Version is the installed Dawnline; Policy the settings' (Settings → Updates).
	Version string
	Policy  model.Updates
	Pkg     *pkgmgr.Manager
	GH      *github.Client
	Fetch   github.Fetch
	// T is the job's language (the phases and errors of a job the admin started; nil: English).
	T *i18n.Catalog
	// Run runs a shell command: what it said (both streams) and its exit code.
	Run func(cmd string) (string, int)
	// Board is the firmware as `ubus call system board` tells it (release version, target, arch).
	Board func() (version, target, arch string)
	// Langs is the languages of the translations installed here.
	Langs func() []string
	Log   *servicelog.Log
	Now   func() time.Time
	Pid   int
	// Sleep waits (a test does not).
	Sleep func(time.Duration)
}

type failure struct{ msg string }

// Job is update-job.json.
type Job struct {
	ID        string         `json:"id"`
	Action    string         `json:"action"`
	Component any            `json:"component"`
	State     string         `json:"state"`
	Started   int64          `json:"started"`
	Finished  any            `json:"finished"`
	Pid       int            `json:"pid"`
	Auto      bool           `json:"auto"`
	Phase     string         `json:"phase"`
	From      any            `json:"from"`
	To        any            `json:"to"`
	Log       []string       `json:"log"`
	Error     any            `json:"error"`
	Result    map[string]any `json:"result"`
	Current   string         `json:"current,omitempty"`
}

type worker struct {
	e *Env
	// quiet: an automatic run only shows up as a job once it installs something
	quiet bool
	job   Job
	// what to restart once the job is over (never in the middle of it)
	after map[string]bool
	work  string
}

func (w *worker) now() int64 { return w.e.Now().Unix() }

func (w *worker) t(msg string) string { return w.e.T.T(msg) }

func (w *worker) die(format string, args ...any) {
	panic(failure{fmt.Sprintf(w.t(format), args...)})
}

func (w *worker) save() {
	if !w.quiet {
		files.WriteJSON(w.e.RunDir+"/update-job.json", w.job, 0o644)
	}
}

func (w *worker) log(msg string) {
	t := w.e.Now().In(zone.Local())
	w.job.Log = append(w.job.Log, fmt.Sprintf("%02d:%02d:%02d %s", t.Hour(), t.Minute(), t.Second(), msg))
	if n := len(w.job.Log); n > 400 {
		w.job.Log = w.job.Log[n-400:]
	}
	w.save()
}

func (w *worker) logf(format string, args ...any) { w.log(fmt.Sprintf(w.t(format), args...)) }

func (w *worker) phase(format string, args ...any) {
	w.job.Phase = fmt.Sprintf(w.t(format), args...)
	w.log(w.job.Phase)
}

// run is a command with what it said in the log.
func (w *worker) run(cmd string) (string, int) {
	out, code := w.e.Run(cmd)
	for _, line := range strings.Split(strings.Trim(out, " \t\r\n\v\f"), "\n") {
		if strings.Trim(line, " \t\r\n\v\f") != "" {
			w.log("  " + line)
		}
	}
	return out, code
}

func (w *worker) versions(from, to string) {
	w.job.From, w.job.To = orNil(from), orNil(to)
	w.save()
}

func orNil(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (w *worker) slog(src, level, msg, detail, who string) {
	if w.e.Log != nil {
		w.e.Log.Write(src, level, msg, detail, who, servicelog.Extra{})
	}
}

func (w *worker) history(e map[string]any) { historyAdd(w.e.DataDir, w.now(), e) }

/* ---------- check results ---------- */

type checkFile struct {
	Components map[string]map[string]any `json:"components"`
	Time       int64                     `json:"time"`
}

func (w *worker) checks() map[string]map[string]any {
	var c checkFile
	files.ReadJSON(w.e.RunDir+"/update-check.json", &c)
	if c.Components == nil {
		c.Components = map[string]map[string]any{}
	}
	return c.Components
}

// saveCheck puts components' results into the check file (the others stay as they were).
func (w *worker) saveCheck(res map[string]map[string]any) {
	c := checkFile{Components: w.checks()}
	for k, v := range res {
		v["time"] = w.now()
		c.Components[k] = v
	}
	c.Time = w.now()
	files.WriteJSON(w.e.RunDir+"/update-check.json", c, 0o644)
}

func str(v any) string { s, _ := v.(string); return s }

func num(v any) int {
	switch x := v.(type) {
	case int:
		return x
	case int64:
		return int(x)
	case float64:
		return int(x)
	}
	return 0
}

// foundIn is what a check found, as short names ("Dawnline 0.3.3", "2 system packages"): kept in the
// history and shown later, so English whatever the job's language.
func foundIn(res map[string]map[string]any) []string {
	var found []string
	if a := res["app"]; a != nil && a["update"] == true {
		found = append(found, "Dawnline "+str(a["latest"]))
	}
	if a := res["amneziawg"]; a != nil && a["update"] == true && a["installed"] != nil {
		found = append(found, "AmneziaWG "+str(a["latest"]))
	}
	if p := res["packages"]; p != nil && num(p["updates"]) > 0 {
		if n := num(p["updates"]); n == 1 {
			found = append(found, "1 system package")
		} else {
			found = append(found, fmt.Sprintf("%d system packages", n))
		}
	}
	return found
}

func (w *worker) checking(name string) string {
	switch name {
	case "app":
		return "Checking Dawnline"
	case "amneziawg":
		return "Checking AmneziaWG"
	}
	return "Checking system packages"
}

func (w *worker) updating(name string) string {
	switch name {
	case "app":
		return "Updating Dawnline"
	case "amneziawg":
		return "Updating AmneziaWG"
	}
	return "Updating system packages"
}

func (w *worker) check(name string) map[string]any {
	switch name {
	case "app":
		return w.checkApp()
	case "amneziawg":
		return w.checkAwg()
	}
	return w.checkPkgs(true)
}

func (w *worker) runChecks(which []string) map[string]map[string]any {
	res := map[string]map[string]any{}
	for _, name := range which {
		w.phase(w.checking(name))
		func() {
			defer func() {
				if r := recover(); r != nil {
					msg := fmt.Sprint(r)
					if f, is := r.(failure); is {
						msg = f.msg
					}
					w.logf("Error: %s", msg)
					res[name] = map[string]any{"error": msg, "status": ""}
				}
			}()
			res[name] = w.check(name)
		}()
	}
	w.saveCheck(res)
	return res
}

type autoState struct {
	InstallDay string `json:"install_day,omitempty"`
	Check      int64  `json:"check,omitempty"`
	Announced  string `json:"announced"`
}

func (w *worker) autoState() autoState {
	var st autoState
	files.ReadJSON(w.e.DataDir+"/update-auto.json", &st)
	return st
}

func (w *worker) autoSave(st autoState) {
	os.MkdirAll(w.e.DataDir, 0o700)
	files.WriteJSON(w.e.DataDir+"/update-auto.json", st, 0o600)
}

// noteFound: one line in Activity a new finding (the same finding is not repeated).
func (w *worker) noteFound(res map[string]map[string]any, st *autoState, auto bool) {
	found := foundIn(res)
	sig := strings.Join(found, ", ")
	if len(found) > 0 && sig != st.Announced {
		if auto {
			w.slog("dawnline", "info", "updates available · "+sig, "", "Components")
		}
		w.history(map[string]any{"kind": "found", "items": found, "auto": auto})
	}
	st.Announced = sig
}

/* ---------- installs ---------- */

// splitTarget: "app@v1" → app, "@v1"; "amneziawg:slava:ru" → amneziawg, "slava:ru"; "app" → app, "".
func splitTarget(s string) (name, arg string) {
	i, at := strings.Index(s, ":"), strings.Index(s, "@")
	cut := i
	if i < 0 || (at >= 0 && at < i) {
		cut = at
	}
	if cut < 0 {
		return s, ""
	}
	if s[cut] == ':' {
		return s[:cut], s[cut+1:]
	}
	return s[:cut], s[cut:]
}

func appStatus(installed, latest string) string {
	if latest == "" {
		return "latest"
	}
	switch c := VersionCmp(installed, latest); {
	case c < 0:
		return "outdated"
	case c > 0:
		return "dev"
	}
	return "latest"
}

// logUpdate is a line in the service log for each finished update (Dawnline's own is told when it starts again).
func (w *worker) logUpdate(name string, r map[string]any) {
	switch name {
	case "amneziawg":
		before, _ := r["before"].(map[string]any)
		after, _ := r["after"].(map[string]any)
		b, a := str(before["kmod-amneziawg"]), str(after["kmod-amneziawg"])
		msg := fmt.Sprintf("installed the %s build", str(r["build"]))
		switch {
		case b != "" && a != "" && b != a && w.job.Auto:
			msg = fmt.Sprintf("updated automatically · %s → %s", b, a)
		case b != "" && a != "" && b != a:
			msg = fmt.Sprintf("updated · %s → %s", b, a)
		case a != "":
			msg = fmt.Sprintf("installed the %s build · %s", str(r["build"]), a)
		}
		w.slog("awg", "up", msg, "", "AmneziaWG")
	case "pkgs":
		updated, _ := r["updated"].([]string)
		installed, _ := r["installed"].([]string)
		if all := append(append([]string{}, updated...), installed...); len(all) > 0 {
			msg := "updated · "
			if w.job.Auto {
				msg = "updated automatically · "
			}
			w.slog("dawnline", "up", msg+strings.Join(all, ", "), "", "System packages")
		}
	}
}

func (w *worker) install(what []string) {
	if w.job.Result == nil {
		w.job.Result = map[string]any{}
	}
	for _, target := range what {
		name, arg := splitTarget(target)
		var r map[string]any
		w.job.Current = name
		switch name {
		case "app":
			w.phase(w.updating(name))
			r = w.installApp(arg)
		case "amneziawg":
			w.phase(w.updating(name))
			r = w.installAwg(arg)
		case "pkgs":
			w.phase(w.updating(name))
			r = w.installPkgs(arg)
		default:
			w.die("Unknown component %s", name)
		}
		w.job.Result[name] = r
		w.logUpdate(name, r)
		// installed components are current now: no stale "Update available"
		c := w.checks()
		switch {
		case name == "pkgs" && r["check"] != nil:
			w.saveCheck(map[string]map[string]any{"packages": r["check"].(map[string]any)})
		case name == "app" && str(r["to"]) != "" && c["app"] != nil:
			s := appStatus(str(r["to"]), str(c["app"]["latest"]))
			a := c["app"]
			a["installed"], a["update"], a["status"] = r["to"], s == "outdated", s
			w.saveCheck(map[string]map[string]any{"app": a})
		case name == "amneziawg" && r["after"] != nil:
			a := c["amneziawg"]
			if a == nil {
				a = map[string]any{}
			}
			after := r["after"].(map[string]any)
			a["installed"], a["packages"], a["update"], a["status"] = after["amneziawg-tools"], after, false, "latest"
			if r["build"] != nil {
				a["current"] = r["build"]
			}
			w.saveCheck(map[string]map[string]any{"amneziawg": a})
		}
		w.history(map[string]any{"kind": "install", "component": target, "from": r["from"], "to": r["to"], "state": "done", "auto": w.job.Auto,
			"took": w.now() - w.job.Started})
		w.job.Current = ""
	}
}

var clock = regexp.MustCompile(`^([0-9]{1,2}):([0-9]{2})$`)

var intervals = map[string]int64{"6h": 6 * 3600, "12h": 12 * 3600, "1d": 86400, "7d": 7 * 86400}

// slot is the scheduled slot now is in (up to an hour after the set time, also across midnight).
func slot(pol model.Updates, now time.Time) (time.Time, bool) {
	hm := clock.FindStringSubmatch(pol.Time)
	if hm == nil {
		return time.Time{}, false
	}
	var h, mi int
	fmt.Sscan(hm[1], &h)
	fmt.Sscan(hm[2], &mi)
	for _, day := range []time.Time{now, now.Add(-24 * time.Hour)} {
		d := day.In(zone.Local())
		at := time.Unix(day.Unix()-int64(d.Hour()*3600+d.Minute()*60+d.Second())+int64(h*3600+mi*60), 0)
		if !now.Before(at) && now.Sub(at) < time.Hour {
			return at, true
		}
	}
	return time.Time{}, false
}

func dayOf(t time.Time) string { return t.In(zone.Local()).Format("2006-01-02") }

// due is what an automatic run should do now: "install" (the scheduled window, once a slot), "check"
// (the interval has passed), or "".
func due(pol model.Updates, st autoState, now time.Time) string {
	if pol.Auto && pol.Mode == "scheduled" && len(pol.Targets) > 0 {
		if at, in := slot(pol, now); in && st.InstallDay != dayOf(at) {
			return "install"
		}
	}
	every := intervals[pol.Interval]
	if every == 0 {
		every = 86400
	}
	if pol.Check && now.Unix()-st.Check >= every {
		return "check"
	}
	return ""
}

func has(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// auto is Settings → Updates: check when due, install what is allowed (scheduled or right away).
func (w *worker) auto() {
	pol := w.e.Policy
	st := w.autoState()
	what := due(pol, st, w.e.Now())
	if what == "" {
		return
	}
	now := w.now()
	var res map[string]map[string]any
	if what == "check" || now-st.Check >= 3600 {
		res = w.runChecks(Targets)
		st.Check = now
		w.noteFound(res, &st, true)
	} else {
		res = w.checks()
	}
	if what == "install" {
		at, in := slot(pol, w.e.Now())
		if !in {
			at = w.e.Now()
		}
		st.InstallDay = dayOf(at)
	}
	w.autoSave(st)
	if !pol.Auto || (what != "install" && pol.Mode != "immediate") {
		return
	}
	var todo []string
	// packages first, Dawnline last: it restarts the service and itself
	if p := res["packages"]; has(pol.Targets, "packages") && p != nil && num(p["updates"]) > 0 {
		var names []string
		pkgs, _ := p["pkgs"].(map[string]any)
		for name, v := range pkgs {
			one, _ := v.(map[string]any)
			with, _ := one["with"].([]any)
			withS, _ := one["with"].([]string)
			if one["latest"] != nil || len(with) > 0 || len(withS) > 0 {
				names = append(names, name)
			}
		}
		sort.Strings(names)
		if len(names) > 0 {
			todo = append(todo, "pkgs:"+strings.Join(names, ","))
		}
	}
	if a := res["amneziawg"]; has(pol.Targets, "amneziawg") && a != nil && a["update"] == true && a["installed"] != nil {
		// only the same build, same generation: anything else needs a person to decide
		if cur := str(a["current"]); cur != "" && a["gen_change"] != true {
			ru := ""
			if a["ru"] == true {
				ru = ":ru"
			}
			todo = append(todo, "amneziawg:"+cur+ru)
		} else if latest := str(a["latest"]); latest != "" {
			w.slog("awg", "info", latest+" needs a manual switch in Components", "", "AmneziaWG")
		} else {
			w.slog("awg", "info", "a new build needs a manual switch in Components", "", "AmneziaWG")
		}
	}
	if a := res["app"]; has(pol.Targets, "app") && a != nil && a["update"] == true {
		todo = append(todo, "app")
	}
	if len(todo) == 0 {
		return
	}
	w.quiet = false
	w.job.Action, w.job.Component, w.job.Auto, w.job.Log = "install", strings.Join(todo, " "), true, nil
	w.logf("Automatic update: %s", strings.Join(todo, ", "))
	w.install(todo)
}

var plainVersion = regexp.MustCompile(`[^A-Za-z0-9.-]`)

// restarts is what the job asked for, in one go, after its final state is saved. Dawnline's own package is
// restarted by postupdate, a shell that also checks the new version and rolls back to the kept one when
// it does not come up.
func (w *worker) restarts() {
	if w.after["app"] {
		w.e.Run("/usr/libexec/dawnline/postupdate '" + plainVersion.ReplaceAllString(str(w.job.To), "") + "' </dev/null >/dev/null 2>&1 &")
		return
	}
	var cmds []string
	if w.after["apply"] {
		cmds = append(cmds, "/usr/bin/dawnline apply")
	}
	// LuCI's own web server reads a language's catalogs once: a new translation needs a fresh one
	if w.after["uhttpd"] || w.after["luci"] {
		cmds = append(cmds, "/etc/init.d/uhttpd restart")
	}
	if w.after["apply"] || w.after["uhttpd"] {
		cmds = append(cmds, "/etc/init.d/dawnline restart")
	}
	if len(cmds) > 0 {
		w.e.Run("( sleep 2; " + strings.Join(cmds, "; ") + " ) </dev/null >/dev/null 2>&1 &")
	}
}

var who = map[string]string{"app": "Dawnline", "amneziawg": "AmneziaWG", "pkgs": "System packages", "packages": "System packages"}

// main is the job the command line asks for, to its final state: done, or failed with the error in the
// log and the history.
func (w *worker) main() {
	defer func() {
		r := recover()
		if r == nil {
			return
		}
		msg := fmt.Sprint(r)
		if f, is := r.(failure); is {
			msg = f.msg
		} else if f, is := r.(pkgmgr.Failure); is {
			msg = f.Msg
		}
		w.quiet = false
		w.job.State, w.job.Error = "failed", msg
		w.logf("Error: %s", msg)
		name := w.job.Current
		if name == "" {
			name, _ = splitTarget(strings.SplitN(str(w.job.Component), " ", 2)[0])
		}
		if w.job.Action != "check" {
			src, said, subject := "dawnline", "update failed", who[name]
			if name == "amneziawg" {
				src = "awg"
			}
			if w.job.Auto {
				said = "automatic update failed"
			}
			if subject == "" {
				subject = "Dawnline"
			}
			w.slog(src, "error", said, msg, subject)
			w.history(map[string]any{"kind": "install", "component": name, "from": w.job.From, "to": w.job.To, "state": "failed", "auto": w.job.Auto, "error": msg,
				"took": w.now() - w.job.Started})
		} else {
			component := str(w.job.Component)
			if component == "" {
				component = "all"
			}
			w.history(map[string]any{"kind": "error", "component": component, "state": "failed", "error": msg})
		}
	}()
	switch w.job.Action {
	case "check":
		which := Targets
		if c := str(w.job.Component); c != "" {
			which = []string{c}
		}
		for _, x := range which {
			if !has(Targets, x) {
				w.die("Unknown component %s", x)
			}
		}
		res := w.runChecks(which)
		w.job.Result = map[string]any{}
		for k, v := range res {
			w.job.Result[k] = v
		}
		st := w.autoState()
		w.noteFound(res, &st, false)
		if len(which) == len(Targets) {
			st.Check = w.now()
		}
		w.autoSave(st)
	case "install":
		w.install([]string{str(w.job.Component)})
	case "auto":
		w.auto()
	}
	w.job.State = "done"
	w.phase("Finished")
}

// Main runs the updater's command line and returns its exit code. out and errs take the usage.
func Main(e *Env, args []string, out, errs interface{ Write([]byte) (int, error) }) int {
	first := ""
	if len(args) > 0 {
		first = args[0]
	}
	// No command, one it does not know, or an install of nothing: the usage and out, before anything is
	// read or written. Asked for help: the same, on the other stream.
	if first == "-h" || first == "--help" || first == "help" {
		out.Write([]byte(usage))
		return 0
	}
	if (first != "check" && first != "install" && first != "auto") || (first == "install" && (len(args) < 2 || args[1] == "")) {
		errs.Write([]byte(usage))
		return 2
	}
	if e.Now == nil {
		e.Now = time.Now
	}
	if e.Sleep == nil {
		e.Sleep = time.Sleep
	}
	w := &worker{e: e, quiet: first == "auto", after: map[string]bool{}, work: fmt.Sprintf("/tmp/dawnline-update.%d", e.Pid)}
	now := w.now()
	w.job = Job{ID: fmt.Sprintf("%d-%d", now, e.Pid), Action: first, State: "running", Started: now, Pid: e.Pid, Log: []string{}}
	if len(args) > 1 {
		w.job.Component = args[1]
	}
	os.MkdirAll(e.RunDir, 0o755)
	// one job at a time (the page refuses a second one; an automatic run just skips its turn)
	var held *os.File
	for i := 0; i < 10 && held == nil; i++ {
		if held = lock(e.RunDir); held == nil {
			e.Sleep(100 * time.Millisecond)
		}
	}
	if held == nil {
		return 0
	}
	defer held.Close()
	os.MkdirAll(w.work, 0o700)
	w.save()
	w.main()
	os.RemoveAll(w.work)
	w.job.Finished, w.job.Current = w.now(), ""
	w.save()
	w.restarts()
	return 0
}
