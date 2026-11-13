package updater

import (
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"

	"github.com/tickcount/luci-app-dawnline/backend/files"
	"github.com/tickcount/luci-app-dawnline/backend/github"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
)

func (w *worker) must(ok bool, err error, format string, args ...any) {
	if err != nil {
		panic(err)
	}
	if !ok {
		w.die(format, args...)
	}
}

func (w *worker) download(url, dest, want string) bool {
	return github.Download(w.e.Fetch, url, dest, want, w.e.Policy.Mirrors, w.log, w.t) != ""
}

/* ---------- Dawnline itself ---------- */

func (w *worker) checkApp() map[string]any {
	v := w.e.Version
	r := w.e.GH.Latest(Repo)
	if r == nil {
		return map[string]any{"installed": v, "latest": nil, "update": false, "repo": Repo, "status": "", "note": fmt.Sprintf(w.t("Cannot reach github.com/%s"), Repo)}
	}
	tag := str(r["tag"])
	latest := strings.TrimPrefix(tag, "v")
	st := appStatus(v, latest)
	switch st {
	case "outdated":
		w.logf("Dawnline update is available: %s → %s", v, latest)
	case "dev":
		w.logf("Installed Dawnline %s is newer than the release %s", v, latest)
	default:
		w.logf("Dawnline is up to date (%s)", v)
	}
	return map[string]any{"installed": v, "latest": latest, "tag": tag, "repo": Repo, "url": r["url"], "published": r["published"], "update": st == "outdated", "status": st}
}

var (
	unsafeTag = regexp.MustCompile(`[^A-Za-z0-9.-]`)
	sumLine   = regexp.MustCompile(`^([0-9a-f]{64})[ \t]+\*?(\S+)$`)
)

// wantSHA is the sha256 a release publishes for a file: GitHub's own (API), else the release's
// sha256sums.txt fetched straight from GitHub (never a mirror).
func (w *worker) wantSHA(tag, asset, dir string) string {
	if want := w.e.GH.AssetSHA256(Repo, tag, asset); want != "" {
		return want
	}
	sums := dir + "/sha256sums-" + unsafeTag.ReplaceAllString(tag, "_") + ".txt"
	if github.Download(w.e.Fetch, "https://github.com/"+Repo+"/releases/download/"+tag+"/sha256sums.txt", sums, "", false, w.log, w.t) == "" {
		return ""
	}
	raw, _ := os.ReadFile(sums)
	for _, line := range strings.Split(string(raw), "\n") {
		if m := sumLine.FindStringSubmatch(strings.Trim(line, " \t\r\n\v\f")); m != nil && m[2] == asset {
			return m[1]
		}
	}
	return ""
}

// fetchFile downloads one file of a release, verified against its sha256. optional: a release without it
// (one from before the translations) gives "".
func (w *worker) fetchFile(tag, asset, dir string, optional bool) string {
	w.phase("Downloading %s", asset)
	want := w.wantSHA(tag, asset, dir)
	if want == "" && optional {
		w.logf("Release %s has no %s: it stays as it is", tag, asset)
		return ""
	}
	if want == "" {
		w.die("Release %s publishes no checksum for %s: not installing an unverified package", tag, asset)
	}
	f := dir + "/" + asset
	if !w.download("https://github.com/"+Repo+"/releases/download/"+tag+"/"+asset, f, want) {
		w.die("Download failed: %s", asset)
	}
	w.logf("sha256 matches the release (%s…)", want[:12])
	return f
}

func (w *worker) langs() []string {
	if w.e.Langs == nil {
		return nil
	}
	return w.e.Langs()
}

// fetchRelease is a release's package and the translations installed here, verified.
func (w *worker) fetchRelease(tag, dir string) []string {
	ver := strings.TrimPrefix(tag, "v")
	out := []string{w.fetchFile(tag, "luci-app-dawnline-"+ver+"."+w.e.Pkg.Ext(), dir, false)}
	for _, l := range w.langs() {
		if f := w.fetchFile(tag, "luci-i18n-dawnline-"+l+"-"+ver+"."+w.e.Pkg.Ext(), dir, true); f != "" {
			out = append(out, f)
		}
	}
	return out
}

// tagOf is the release tag of a version: tags may or may not carry the v.
func (w *worker) tagOf(ver string) string {
	for _, t := range []string{"v" + ver, ver} {
		if r, _ := w.e.GH.Release(Repo, t); r != nil {
			return t
		}
	}
	return "v" + ver
}

func (w *worker) backup() {
	w.phase("Backing up configuration")
	w.e.Run("/usr/bin/dawnline backup --reason pre-update >/dev/null 2>&1")
}

// setLang adds the translation `lang` of the installed version from its release, or (lang "") removes the
// installed ones. LuCI reads its catalogs once per web server process: it restarts after the job.
func (w *worker) setLang(lang string) map[string]any {
	v := w.e.Version
	if lang == "" {
		var have []string
		for _, l := range w.langs() {
			have = append(have, "luci-i18n-dawnline-"+l)
		}
		if len(have) > 0 {
			w.phase("Removing the translation")
			if !w.e.Pkg.Remove(have, w.log) {
				w.die("The translation could not be removed")
			}
		}
	} else {
		tag := w.tagOf(v)
		f := w.fetchFile(tag, "luci-i18n-dawnline-"+lang+"-"+v+"."+w.e.Pkg.Ext(), w.work, true)
		if f == "" {
			w.die("Release %s has no translation into %s: install a release that has one", tag, lang)
		}
		w.phase("Installing the translation")
		ok, err := w.e.Pkg.InstallFiles([]string{f}, false, w.log)
		w.must(ok, err, "Installation failed")
	}
	w.after["luci"] = true
	return map[string]any{"from": v, "to": v, "lang": orNil(lang)}
}

// installApp: arg "" (latest) | @<tag> | reinstall | rollback | lang:<code> | nolang
func (w *worker) installApp(arg string) map[string]any {
	v := w.e.Version
	if arg == "nolang" {
		return w.setLang("")
	}
	if l, is := strings.CutPrefix(arg, "lang:"); is {
		return w.setLang(l)
	}
	out := map[string]any{"from": v, "to": nil}
	if arg == "rollback" {
		k := kept(w.e.DataDir, "app")
		if k == nil {
			w.die("No previous Dawnline version is kept on the router")
		}
		out["to"] = k.Version
		w.versions(v, k.Version)
		w.backup()
		w.phase("Rolling back to %s", k.Version)
		ok, err := w.e.Pkg.InstallFiles(k.Files, true, w.log)
		w.must(ok, err, "Installation failed")
		forget(w.e.DataDir, "app")
		w.after["app"] = true
		return out
	}
	tag, force := "", false
	switch {
	case arg == "reinstall":
		tag, force = w.tagOf(v), true
	case strings.HasPrefix(arg, "@"):
		tag = arg[1:]
		force = VersionCmp(strings.TrimPrefix(tag, "v"), v) <= 0
	default:
		c := w.checkApp()
		if c["latest"] == nil {
			panic(failure{str(c["note"])})
		}
		if c["update"] != true {
			out["to"] = v
			return out
		}
		tag = str(c["tag"])
	}
	to := strings.TrimPrefix(tag, "v")
	out["to"] = to
	w.versions(v, to)
	paths := w.fetchRelease(tag, w.work)
	// The version being replaced, for Roll back (downloaded again: the package manager keeps no package
	// files). Always for an automatic run: nobody is there to recover a router whose new version does not
	// come up (postupdate rolls back to it on its own).
	if k := kept(w.e.DataDir, "app"); (w.e.Policy.Keep || w.job.Auto) && to != v && (k == nil || k.Version != v) {
		w.phase("Keeping Dawnline %s for rollback", v)
		func() {
			defer func() {
				if r := recover(); r != nil {
					msg := fmt.Sprint(r)
					if f, is := r.(failure); is {
						msg = f.msg
					}
					w.logf("Warning: could not keep %s: %s", v, msg)
				}
			}()
			os.MkdirAll(w.work+"/keep", 0o700)
			keep(w.e.DataDir, "app", v, w.fetchRelease(w.tagOf(v), w.work+"/keep"), nil, nil)
		}()
	}
	w.backup()
	w.phase("Installing package")
	ok, err := w.e.Pkg.InstallFiles(paths, force, w.log)
	w.must(ok, err, "Installation failed")
	w.after["app"] = true
	return out
}

/* ---------- system packages ---------- */

// PkgNames is what Dawnline itself adds to OpenWrt (the rest of LuCI, rpcd and uhttpd is the stock system).
var PkgNames = []string{"ip-full", "kmod-veth", "libustream-openssl", "openssl-util", "acme", "acme-acmesh-dnsapi", "luci-app-acme"}

// Packages released together with each of the above, updated as a set so OpenSSL never ends up half old
// and half new.
var families = [][2]*regexp.Regexp{
	{regexp.MustCompile(`^ip-full$`), regexp.MustCompile(`^ip-`)},
	{regexp.MustCompile(`^(libustream-openssl|openssl-util)$`), regexp.MustCompile(`^(libustream-openssl|libopenssl|openssl-util$)`)},
	{regexp.MustCompile(`^(acme|luci-app-acme$)`), regexp.MustCompile(`^acme`)},
}

// WithFamily is the packages to update for these names: each one plus its upgradable family. Pure.
func WithFamily(names []string, up map[string]string) []string {
	set := map[string]bool{}
	for _, n := range names {
		if _, has := up[n]; has {
			set[n] = true
		}
		for _, f := range families {
			if f[0].MatchString(n) {
				for u := range up {
					if f[1].MatchString(u) {
						set[u] = true
					}
				}
				break
			}
		}
	}
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// checkPkgs; refresh: update the package lists first (a check by hand or on schedule).
func (w *worker) checkPkgs(refresh bool) map[string]any {
	if refresh {
		w.phase("Refreshing package lists")
		w.e.Pkg.Refresh(nil)
	}
	up := w.e.Pkg.Upgradable()
	res := map[string]any{}
	all := map[string]bool{}
	for _, p := range PkgNames {
		v := w.e.Pkg.Version(p)
		set := []string{}
		if v != "" {
			set = WithFamily([]string{p}, up)
		}
		with := []string{}
		for _, x := range set {
			all[x] = true
			if x != p {
				with = append(with, x)
			}
		}
		var latest any
		if l, has := up[p]; has && v != "" {
			latest = l
		}
		res[p] = map[string]any{"installed": orNil(v), "latest": latest, "with": with}
	}
	names := make([]string, 0, len(all))
	for k := range all {
		names = append(names, k)
	}
	sort.Strings(names)
	n := len(names)
	status := "latest"
	if n > 0 {
		status = "outdated"
		w.log(fmt.Sprintf(w.e.T.N(int64(n), "%d package update in the feeds: %s", "%d package updates in the feeds: %s"), n, strings.Join(names, ", ")))
	} else {
		w.logf("System packages are up to date")
	}
	return map[string]any{"pkgs": res, "updates": n, "status": status}
}

var (
	needsApply  = regexp.MustCompile(`^(openssl-util|libustream|ip-full|kmod-veth)`)
	needsUhttpd = regexp.MustCompile(`^(libustream|libopenssl)`)
)

// installPkgs: arg name,name,… (only names Dawnline manages): missing ones are installed, present ones
// updated with their family.
func (w *worker) installPkgs(arg string) map[string]any {
	var names []string
	for _, n := range strings.Split(arg, ",") {
		if n != "" {
			names = append(names, n)
		}
	}
	for _, n := range names {
		if !has(PkgNames, n) {
			w.die("%s is not a package Dawnline manages", n)
		}
	}
	if len(names) == 0 {
		w.die("Nothing to install")
	}
	w.phase("Refreshing package lists")
	w.e.Pkg.Refresh(w.log)
	var missing, present []string
	for _, n := range names {
		if w.e.Pkg.Version(n) == "" {
			missing = append(missing, n)
		} else {
			present = append(present, n)
		}
	}
	have := WithFamily(present, w.e.Pkg.Upgradable())
	if len(have) > 0 {
		w.phase("Updating %s", strings.Join(have, ", "))
		ok, err := w.e.Pkg.Upgrade(have, w.log)
		w.must(ok, err, "Update failed")
	}
	if len(missing) > 0 {
		w.phase("Installing %s", strings.Join(missing, ", "))
		ok, err := w.e.Pkg.Add(missing, w.log)
		w.must(ok, err, "Installation failed")
	}
	// the portal's HTTPS and the home-like link: a piece that just arrived lets them start
	arrived, touched := false, false
	for _, n := range missing {
		arrived = arrived || needsApply.MatchString(n)
	}
	for _, n := range append(append([]string{}, missing...), have...) {
		touched = touched || needsUhttpd.MatchString(n)
	}
	if arrived {
		w.after["apply"], w.after["uhttpd"] = true, true
	} else if touched {
		w.after["uhttpd"] = true
	}
	if have == nil {
		have = []string{}
	}
	if missing == nil {
		missing = []string{}
	}
	return map[string]any{"updated": have, "installed": missing, "check": w.checkPkgs(false)}
}

/* ---------- AmneziaWG ---------- */

func (w *worker) firmware() (Firmware, bool) {
	version, target, arch := "", "", ""
	if w.e.Board != nil {
		version, target, arch = w.e.Board()
	}
	release, _ := os.ReadFile("/etc/openwrt_release")
	return FirmwareOf(version, target, arch, string(release), w.e.Pkg.Ext())
}

func (w *worker) awgInstalled() map[string]any {
	out := map[string]any{}
	for _, p := range AwgPackages {
		out[p] = orNil(w.e.Pkg.Version(p))
	}
	return out
}

// fetchBuild downloads one package of a build to dir, verified when GitHub publishes its sha256 (then
// mirrors may serve it); without a sha256 only github.com itself. The path, or "".
func (w *worker) fetchBuild(fw Firmware, name, src, dir string) string {
	file := fw.Asset(name)
	dest := dir + "/" + src + "_" + file
	repo := Sources[src].Repo
	if w.download("https://github.com/"+repo+"/releases/download/"+fw.Tag+"/"+file, dest, w.e.GH.AssetSHA256(repo, fw.Tag, file)) {
		return dest
	}
	return ""
}

var series = regexp.MustCompile(`^v([0-9]+\.[0-9]+)\.`)

// newerSeriesTag is the newest tag of the same OpenWrt series (24.10.x) in a repository, if newer than ours.
func (w *worker) newerSeriesTag(repo, tag string) string {
	m := series.FindStringSubmatch(tag)
	if m == nil {
		return ""
	}
	best := ""
	list, _ := w.e.GH.Releases(repo, 1)
	for _, x := range list {
		r, _ := x.(map[string]any)
		t := str(r["tag"])
		if !strings.HasPrefix(t, "v"+m[1]+".") {
			continue
		}
		if c, ok := w.e.Pkg.Cmp(t[1:], tag[1:]); !ok || c <= 0 {
			continue
		}
		if best != "" {
			if c, ok := w.e.Pkg.Cmp(t[1:], best[1:]); !ok || c <= 0 {
				continue
			}
		}
		best = t
	}
	return best
}

func (w *worker) checkAwg() map[string]any {
	installed := w.awgInstalled()
	ru := w.e.Pkg.Version(AwgRU) != ""
	cur := str(installed["amneziawg-tools"])
	base := func(note string) map[string]any {
		return map[string]any{"installed": orNil(cur), "gen": orNil(Gen(cur)), "packages": installed, "current": nil, "ru": ru, "sources": map[string]any{},
			"update": false, "status": "", "note": w.t(note)}
	}
	fw, ok := w.firmware()
	if !ok {
		return base("Cannot detect the firmware target")
	}
	if fw.Snapshot {
		return base("This is a SNAPSHOT firmware: the AmneziaWG projects publish builds for releases only")
	}
	dir := w.work + "/check"
	os.MkdirAll(dir, 0o700)
	sources := map[string]any{}
	versions := map[string]string{}
	found := false
	for _, id := range Order {
		src := Sources[id]
		w.logf("Looking for the %s build for OpenWrt %s", src.Label, fw.Tag[1:])
		v := ""
		var date any
		if f := w.fetchBuild(fw, "amneziawg-tools", id, dir); f != "" {
			v = w.e.Pkg.FileVersion(f)
			if r, _ := w.e.GH.Release(src.Repo, fw.Tag); r != nil {
				date = r["published"]
			}
		}
		s := map[string]any{"label": src.Label, "repo": src.Repo, "tag": fw.Tag, "version": orNil(v), "gen": orNil(Gen(v)), "date": date}
		// a newer firmware may already get 3.1 from this source
		if Gen(v) != "3.1" {
			if nt := w.newerSeriesTag(src.Repo, fw.Tag); nt != "" {
				if nf := w.fetchBuild(fw.ForTag(nt), "amneziawg-tools", id, dir); nf != "" && Gen(w.e.Pkg.FileVersion(nf)) == "3.1" {
					s["newer"] = map[string]any{"tag": nt, "gen": "3.1"}
				}
			}
		}
		sources[id], versions[id] = s, v
		found = found || v != ""
	}
	// The installed build: the source whose package matches. Unknown stays unknown (an automatic update
	// never switches a build it could not identify).
	current := ""
	for _, id := range Order {
		if current == "" && cur != "" && versions[id] == cur {
			current = id
		}
	}
	mine := versions[current]
	st := ""
	if cur != "" && mine != "" {
		if c, known := w.e.Pkg.Cmp(cur, mine); known {
			st = map[int]string{-1: "outdated", 0: "latest", 1: "dev"}[c]
		}
	}
	// an update that waits for a reboot: Components says so after a check
	pending := Pending(record(w.e.DataDir), bootID(), moduleCore())
	switch {
	case cur == "":
		w.logf("AmneziaWG is not installed")
	case current == "":
		w.logf("AmneziaWG %s: no source publishes this build for this firmware any more", cur)
	case st == "outdated":
		w.logf("AmneziaWG update is available: %s → %s", cur, mine)
	default:
		w.logf("AmneziaWG is up to date (%s)", cur)
	}
	var note any
	switch {
	case !found:
		note = fmt.Sprintf(w.t("No AmneziaWG build for OpenWrt %s yet"), fw.Tag[1:])
	case pending:
		note = w.t("The AmneziaWG update is installed and starts after a reboot.")
	}
	return map[string]any{"installed": orNil(cur), "gen": orNil(Gen(cur)), "packages": installed, "current": orNil(current), "ru": ru, "release": fw.Tag,
		"sources": sources, "latest": orNil(mine), "status": st, "update": cur == "" || st == "outdated",
		// an update that changes the generation (2.0 → 3.1) breaks older apps: never automatic
		"gen_change": cur != "" && mine != "" && Gen(cur) != Gen(mine), "pending": pending, "note": note}
}

func exists(path string) bool { _, err := os.Stat(path); return err == nil }

// reloadModule: every AmneziaWG interface is brought down, the module swapped and the interfaces brought
// up again. False when the old module stays loaded: the tunnels come back on it and the installed one
// starts with the next boot.
func (w *worker) reloadModule() bool {
	var ifaces []string
	names := map[string]string{}
	if raw, err := os.ReadFile("/etc/config/network"); err == nil {
		if c, err := uci.Parse(string(raw)); err == nil {
			for _, s := range c.OfType("interface") {
				proto, _ := s.Get("proto")
				if off, _ := s.Get("disabled"); proto == "amneziawg" && off != "1" && s.Name != "" {
					ifaces = append(ifaces, s.Name)
					names[s.Name], _ = s.Get("_dawnline_name")
				}
			}
		}
	}
	n := len(ifaces)
	w.job.Phase = fmt.Sprintf(w.e.T.N(int64(n), "Reloading the kernel module (%d tunnel restarts)", "Reloading the kernel module (%d tunnels restart)"), n)
	w.log(w.job.Phase)
	// why each goes down, so the log does not call it unexpected
	path := w.e.RunDir + "/iface-intent.json"
	all := map[string]map[string]any{}
	files.ReadJSON(path, &all)
	for _, i := range ifaces {
		name := names[i]
		if name == "" {
			name = i
		}
		all[i] = map[string]any{"reason": "update", "name": name, "ts": w.now()}
	}
	files.WriteJSON(path, all, 0o600)
	for _, i := range ifaces {
		w.e.Run("ifdown '" + i + "' >/dev/null 2>&1")
	}
	if exists("/sys/module/amneziawg") {
		w.run("rmmod amneziawg")
	}
	swapped := !exists("/sys/module/amneziawg")
	if swapped {
		w.run("modprobe amneziawg")
		if !exists("/sys/module/amneziawg") {
			w.die("The new AmneziaWG kernel module doesn't load on this firmware: the tunnels stay down until it does (see the log above)")
		}
	}
	for _, i := range ifaces {
		w.e.Run("ifup '" + i + "' >/dev/null 2>&1")
	}
	return swapped
}

// settle, after packages changed: the module loaded, netifd knowing the protocol, Dawnline set up again.
// It returns whether the module that runs is the installed one.
func (w *worker) settle(before, after map[string]any, was Module) bool {
	b, a := str(before["kmod-amneziawg"]), str(after["kmod-amneziawg"])
	fresh := true
	switch {
	// a new module package, one over a module loaded by hand, or an earlier update that still waits for a boot
	case a != "" && (a != b || was.Pending) && (b != "" || was.Core != 0):
		fresh = w.reloadModule()
	case a != "" && b == "":
		w.phase("Loading the kernel module")
		if _, code := w.run("modprobe amneziawg"); code != 0 && !exists("/sys/module/amneziawg") {
			w.die("AmneziaWG is installed, but its kernel module doesn't load on this firmware")
		}
	}
	// netifd reads its protocol handlers when it starts
	if out, _ := w.run("ubus call network get_proto_handlers"); !strings.Contains(out, `"amneziawg"`) {
		w.phase("Restarting the network so it knows AmneziaWG (connections drop for a few seconds)")
		w.run("/etc/init.d/network restart")
	}
	w.after["apply"] = true
	return fresh
}

func (w *worker) finishAwg(out map[string]any, source, tag any, was Module) map[string]any {
	after := w.awgInstalled()
	out["after"] = after
	reloaded := w.settle(out["before"].(map[string]any), after, was)
	out["reloaded"] = reloaded
	writeRecord(w.e.DataDir, source, tag, after, was, reloaded)
	if !reloaded {
		w.logf("The old kernel module stays loaded (another AmneziaWG interface may use it): the AmneziaWG update is installed and starts after a reboot.")
	}
	return out
}

// pick is the first source that publishes every package for this firmware.
func (w *worker) pick(fw Firmware) string {
	for _, id := range Order {
		assets := w.e.GH.Assets(Sources[id].Repo, fw.Tag)
		all := assets != nil
		for _, p := range AwgPackages {
			all = all && has(assets, fw.Asset(p))
		}
		if all {
			return id
		}
	}
	return ""
}

// installAwg: arg [auto|slava|grey][:ru] | rollback
func (w *worker) installAwg(arg string) map[string]any {
	before := w.awgInstalled()
	was := moduleNow(w.e.DataDir, str(before["kmod-amneziawg"]))
	from := str(before["amneziawg-tools"])
	out := map[string]any{"from": orNil(from), "to": nil, "before": before}
	fw, ok := w.firmware()
	if !ok {
		w.die("Cannot detect the firmware target")
	}
	if arg == "rollback" {
		k := kept(w.e.DataDir, "amneziawg")
		if k == nil {
			w.die("No previous AmneziaWG build is kept on the router")
		}
		if f := str(k.Firmware); f != "" && f != fw.Postfix {
			w.die("The kept AmneziaWG build was made for another firmware: it would not load on this one")
		}
		out["to"], out["build"] = k.Version, k.Build
		w.versions(from, k.Version)
		w.phase("Rolling back to %s", k.Version)
		ok, err := w.e.Pkg.InstallFiles(k.Files, true, w.log)
		w.must(ok, err, "Package installation failed")
		forget(w.e.DataDir, "amneziawg")
		return w.finishAwg(out, k.Build, fw.Tag, was)
	}
	parts := strings.Split(arg, ":")
	id := parts[0]
	if id == "" {
		id = "auto"
	}
	wantRU := len(parts) > 1 && parts[1] == "ru"
	if id == "auto" {
		if id = w.pick(fw); id == "" {
			w.die("No AmneziaWG build for OpenWrt %s (%s) yet", fw.Tag[1:], fw.Postfix)
		}
	}
	src, known := Sources[id]
	if !known {
		w.die("Unknown AmneziaWG build %s", id)
	}
	out["build"] = id
	names := append([]string{}, AwgPackages...)
	if wantRU {
		names = append(names, AwgRU)
	}
	var paths []string
	for _, p := range names {
		w.phase("Downloading %s from %s", p, src.Repo)
		f := w.fetchBuild(fw, p, id, w.work)
		if f == "" {
			w.die("No %s build for OpenWrt %s in %s, or it could not be verified", p, fw.Tag[1:], src.Repo)
		}
		paths = append(paths, f)
	}
	to := w.e.Pkg.FileVersion(paths[1])
	out["to"] = orNil(to)
	w.versions(from, to)
	// the build being replaced, for Roll back: from another source that still publishes it
	if w.e.Policy.Keep && from != "" && to != from {
		dir := w.work + "/keep"
		os.MkdirAll(dir, 0o700)
		other := ""
		for _, sid := range Order {
			if sid == id || other != "" {
				continue
			}
			if f := w.fetchBuild(fw, "amneziawg-tools", sid, dir); f != "" && w.e.Pkg.FileVersion(f) == from {
				other = sid
			}
		}
		if other != "" {
			w.phase("Keeping AmneziaWG %s for rollback", from)
			var keepf []string
			for _, p := range AwgPackages {
				if f := w.fetchBuild(fw, p, other, dir); f != "" {
					keepf = append(keepf, f)
				}
			}
			if len(keepf) == len(AwgPackages) {
				keep(w.e.DataDir, "amneziawg", from, keepf, other, fw.Postfix)
			}
		} else {
			w.logf("Warning: the installed build is no longer published, nothing to keep for rollback")
		}
	}
	w.phase("Refreshing package lists")
	w.e.Pkg.Refresh(w.log)
	w.phase("Installing the %s build", src.Label)
	ok2, err := w.e.Pkg.InstallFiles(paths, true, w.log)
	w.must(ok2, err, "Package installation failed")
	if !wantRU && w.e.Pkg.Version(AwgRU) != "" {
		w.e.Pkg.Remove([]string{AwgRU}, w.log)
	}
	return w.finishAwg(out, id, fw.Tag, was)
}
