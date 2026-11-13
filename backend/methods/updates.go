package methods

import (
	"errors"
	"os"
	"regexp"
	"sort"
	"strings"
	"syscall"
	"time"

	backend "github.com/tickcount/luci-app-dawnline/backend"
	"github.com/tickcount/luci-app-dawnline/backend/files"
	"github.com/tickcount/luci-app-dawnline/backend/github"
	"github.com/tickcount/luci-app-dawnline/backend/i18n"
	"github.com/tickcount/luci-app-dawnline/backend/view"
)

// Repo is where Dawnline's releases are.
const Repo = "tickcount/luci-app-dawnline"

var (
	releaseLine = regexp.MustCompile(`^DISTRIB_(RELEASE|TARGET|ARCH)='([^']*)'`)
	catalogFile = regexp.MustCompile(`^dawnline\.([A-Za-z_-]+)\.lmo$`)
)

// updating tells whether an update job runs: its worker holds the update lock for the whole job.
func updating(run string) bool {
	f, err := os.OpenFile(run+"/update.lock", os.O_WRONLY|os.O_APPEND|os.O_CREATE, 0o644)
	if err != nil {
		return true
	}
	defer f.Close()
	if syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB) != nil {
		return true
	}
	syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
	return false
}

// kept is the version a component had before its last update, when its files are still there.
func kept(dir, component, firmware string) any {
	var k struct {
		Version  string   `json:"version"`
		Build    any      `json:"build"`
		Firmware string   `json:"firmware"`
		Files    []string `json:"files"`
		Saved    any      `json:"saved"`
	}
	if !files.ReadJSON(dir+"/"+component+"/meta.json", &k) || k.Version == "" || len(k.Files) == 0 {
		return nil
	}
	for _, f := range k.Files {
		if !exists(f) {
			return nil
		}
	}
	// a kept AmneziaWG build is for one firmware only
	if component == "amneziawg" && k.Firmware != "" && firmware != "" && k.Firmware != firmware {
		return nil
	}
	return map[string]any{"version": k.Version, "build": k.Build, "saved": k.Saved}
}

// updatesStatus is the Components tab's data (dawnline.rpc.updates status): what is installed, the last
// check and job, the policy, what is kept for a rollback.
func updatesStatus(w *view.World, t *i18n.Catalog, d Deps) map[string]any {
	rel := map[string]string{}
	release, _ := os.ReadFile("/etc/openwrt_release")
	for _, line := range strings.Split(string(release), "\n") {
		if m := releaseLine.FindStringSubmatch(line); m != nil {
			rel[strings.ToLower(m[1])] = m[2]
		}
	}
	home := false
	for _, s := range w.M.Servers {
		home = home || s.LanLike
	}
	var check, job any
	files.ReadJSON(d.RunDir+"/update-check.json", &check)
	files.ReadJSON(d.RunDir+"/update-job.json", &job)
	// a running job whose worker is gone reads as failed
	if j, ok := job.(map[string]any); ok && j["state"] == "running" && !updating(d.RunDir) {
		j["state"], j["error"] = "failed", t.T("The update stopped unexpectedly.")
		if j["finished"] == nil {
			j["finished"] = time.Now().Unix()
		}
	}
	auto := map[string]any{}
	files.ReadJSON(d.DataDir+"/update-auto.json", &auto)
	var history []any
	files.ReadJSON(d.DataDir+"/update-history.json", &history)
	if history == nil {
		history = []any{}
	}
	if len(history) > 12 {
		history = history[:12]
	}
	// this firmware as the AmneziaWG builds name it
	firmware := ""
	if d.Board != nil {
		r, _ := d.Board()["release"].(map[string]any)
		target := strings.Split(text(r["target"]), "/")
		arch := text(r["arch"])
		if arch == "" {
			arch = rel["arch"]
		}
		if v := text(r["version"]); v != "" && len(target) == 2 && arch != "" {
			firmware = "_v" + v + "_" + arch + "_" + target[0] + "_" + target[1]
		}
	}
	langs := []string{}
	entries, _ := os.ReadDir(d.Catalogs)
	for _, e := range entries {
		if m := catalogFile.FindStringSubmatch(e.Name()); m != nil {
			langs = append(langs, m[1])
		}
	}
	sort.Strings(langs)
	tunnels := []string{}
	if network := parseFile("/etc/config/network"); network != nil {
		for _, s := range network.OfType("interface") {
			proto, _ := s.Get("proto")
			if off, _ := s.Get("disabled"); proto != "amneziawg" || off == "1" {
				continue
			}
			name := s.Name
			if n, ok := s.Get("_dawnline_name"); ok {
				name = n
			}
			tunnels = append(tunnels, name)
		}
	}
	return map[string]any{
		"version":  backend.Version,
		"firmware": map[string]any{"version": rel["release"], "target": rel["target"], "arch": rel["arch"]},
		"portal":   w.M.Settings.PortalEnabled, "home": home, "needs": Needs(), "check": check, "job": job, "now": time.Now().Unix(), "repo": Repo,
		"policy": w.M.Settings.Updates, "auto": auto,
		"kept":         map[string]any{"app": kept(d.DataDir+"/keep", "app", firmware), "amneziawg": kept(d.DataDir+"/keep", "amneziawg", firmware)},
		"translations": langs, "history": history, "tunnels": tunnels,
	}
}

// The AmneziaWG builds' repositories (dawnline.awg_builds SOURCES).
var awgRepos = map[string]string{"slava": "Slava-Shchipunov/awg-openwrt", "grey": "2Grey/awg-openwrt"}

var tagName = regexp.MustCompile(`^v?[0-9][0-9A-Za-z.+~-]{0,40}$`)

// shown is a release as the page gets it: what only the updater needs is left out.
func shown(r map[string]any, more map[string]any) map[string]any {
	out := map[string]any{}
	for k, v := range r {
		out[k] = v
	}
	out["digests"], out["ids"] = nil, nil
	for k, v := range more {
		out[k] = v
	}
	return out
}

// releases is Dawnline's releases for the Versions list, five a page.
func releases(gh *github.Client, page any) (map[string]any, error) {
	n := 1.0
	if page != nil {
		n = num(page)
	}
	if n != float64(int(n)) || n < 1 || n > 50 {
		return nil, errors.New("Unknown page.")
	}
	list, err := gh.Releases(Repo, int(n))
	if err != nil {
		return nil, err
	}
	out := []any{}
	for _, r := range list {
		m, _ := r.(map[string]any)
		out = append(out, shown(m, map[string]any{"body": nil}))
	}
	return map[string]any{"releases": out, "page": int(n)}, nil
}

// notes is a release's notes for What's new: Dawnline's by tag, or an AmneziaWG build's.
func notes(gh *github.Client, component, tag, build string) (map[string]any, error) {
	repo := Repo
	if component == "amneziawg" {
		if build == "" {
			build = "slava"
		}
		repo = awgRepos[build]
	}
	if repo == "" || !tagName.MatchString(tag) {
		return nil, errors.New("Unknown release.")
	}
	r, err := gh.Release(repo, tag)
	if err == nil && r == nil && component != "amneziawg" && !strings.HasPrefix(tag, "v") {
		r, err = gh.Release(repo, "v"+tag)
	}
	if err != nil {
		return nil, err
	}
	if r == nil {
		return nil, said{"No release %s in %s.", []any{tag, repo}}
	}
	return shown(r, map[string]any{"repo": repo}), nil
}

// changes is what changed between the installed Dawnline and a release, as points.
func changes(gh *github.Client, from, to string) (map[string]any, error) {
	if !tagName.MatchString(to) || (from != "" && !tagName.MatchString(from)) {
		return nil, errors.New("Unknown release.")
	}
	// the installed version as a tag when it was released (a build ahead of the releases has none)
	base := ""
	if from != "" {
		bare := strings.TrimPrefix(from, "v")
		for _, t := range []string{"v" + bare, bare} {
			if r, err := gh.Release(Repo, t); err != nil {
				return nil, err
			} else if base == "" && r != nil {
				base = t
			}
		}
	}
	items, err := gh.Changes(Repo, base, to)
	if err != nil {
		return nil, err
	}
	return map[string]any{"items": items}, nil
}

// Updating tells whether an update job runs.
func Updating(run string) bool { return updating(run) }
