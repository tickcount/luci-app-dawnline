package updater

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/github"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/pkgmgr"
	"github.com/tickcount/luci-app-dawnline/backend/servicelog"
)

// The cases tests/ucode holds the ucode modules to (updates, awg_builds, pkg).
func TestPureParts(t *testing.T) {
	for _, c := range []struct {
		a, b string
		want int
	}{{"0.5.1", "0.5.1", 0}, {"v0.5.1", "0.5.1", 0}, {"0.5.1", "0.5.2", -1}, {"0.10.0", "0.9.9", 1}, {"0.6", "0.6.0", 0}, {"0.6.0-rc1", "0.6.0", -1},
		{"0.6.0-rc2", "0.6.0-rc10", -1}, {"0.6.0-beta", "0.6.0-rc1", -1}, {"garbage", "0.1", -1}} {
		if got := VersionCmp(c.a, c.b); got != c.want {
			t.Errorf("%s against %s: %d, not %d", c.a, c.b, got, c.want)
		}
	}
	for v, want := range map[string]string{"": "", "3.1.20260812-r1": "3.1", "3.1.0-r1": "3.1", "1.0.20250722-r1": "2.0", "1.0.20250901": "2.0", "1.0.20250610-r1": "1.0",
		"1.0.20241112-r2": "1.0", "6.12.94.3.1.20260906-r1": "3.1", "6.12.94.3.1.20260906": "3.1", "6.6.73.1.0.20250722-r1": "2.0", "6.6.73.1.0.20250612-r1": "1.0",
		"5.15.150.1.0.20240711-r3": "1.0", "3.1.20260812": "3.1"} {
		if got := Gen(v); got != want {
			t.Errorf("the generation of %q: %q, not %q", v, got, want)
		}
	}
	waiting := func() *Record { return &Record{Reloaded: false, Boot: "boot-1", PrevGen: "2.0", PrevCore: 98304.0} }
	swapped, unknown, noBoot := waiting(), waiting(), waiting()
	swapped.Reloaded, unknown.Reloaded, noBoot.Boot = true, nil, nil
	for _, c := range []struct {
		what string
		rec  *Record
		boot string
		core int64
		want bool
	}{{"the old module still loaded, same boot", waiting(), "boot-1", 98304, true}, {"rebooted", waiting(), "boot-2", 98304, false},
		{"no module loaded", waiting(), "boot-1", 0, false}, {"another module loaded", waiting(), "boot-1", 110592, false},
		{"the install swapped it", swapped, "boot-1", 98304, false}, {"a module Dawnline did not install", unknown, "boot-1", 98304, false},
		{"a record from before boots were kept", &Record{OSRelease: "6.12.94", Source: "slava"}, "boot-1", 98304, false},
		{"the kernel gave no boot id", noBoot, "", 98304, false}, {"no record", nil, "boot-1", 98304, false}} {
		if got := Pending(c.rec, c.boot, c.core); got != c.want {
			t.Errorf("pending, %s: %v", c.what, got)
		}
	}
	if n, v := pkgmgr.ControlInfo("Package: amneziawg-tools\nVersion: 1.0.20250722-r1\nDepends: libc\n", true); n != "amneziawg-tools" || v != "1.0.20250722-r1" {
		t.Errorf("an ipk's control file: %q %q", n, v)
	}
	dump := "#%SCHEMA: 00504B47\ninfo:\n  name: kmod-amneziawg\n  version: 6.12.94.3.1.20260906-r1\n  depends: # 2 items\n    - kernel=6.12.94\npaths: # 2 items\n  - name: lib/modules\n"
	if n, v := pkgmgr.ControlInfo(dump, false); n != "kmod-amneziawg" || v != "6.12.94.3.1.20260906-r1" {
		t.Errorf("an apk's dump: %q %q", n, v)
	}
	if n, v := pkgmgr.ControlInfo("", false); n != "" || v != "" {
		t.Error("something read from nothing")
	}
	want := []pkgmgr.Wanted{{Name: "a", Version: "2"}, {Name: "b", Version: "1"}}
	if len(pkgmgr.Mismatched(want, map[string]string{"a": "2", "b": "1"})) != 0 || len(pkgmgr.Mismatched(want, map[string]string{"a": "1", "b": "1"})) != 1 ||
		len(pkgmgr.Mismatched([]pkgmgr.Wanted{{File: "x.apk"}}, nil)) != 1 {
		t.Error("which packages did not take")
	}
	up := pkgmgr.ParseUpgradable("libopenssl3-3.5.1-r1 < 3.5.2-r1\nip-full-6.11.0-r1 < 6.12.0-r1\nnoise\n", true)
	if up["libopenssl3"] != "3.5.2-r1" || up["ip-full"] != "6.12.0-r1" || len(up) != 2 {
		t.Errorf("apk's list: %v", up)
	}
	if up := pkgmgr.ParseUpgradable("acme - 4.0.0-r1 - 4.0.1-r1\n", false); up["acme"] != "4.0.1-r1" {
		t.Errorf("opkg's list: %v", up)
	}
	fam := WithFamily([]string{"openssl-util", "ip-full", "kmod-veth"}, map[string]string{"libopenssl3": "1", "libustream-openssl20201210": "1", "ip-tiny": "1", "acme": "1"})
	if strings.Join(fam, " ") != "ip-tiny libopenssl3 libustream-openssl20201210" {
		t.Errorf("the families: %v", fam)
	}
	for in, want := range map[string][2]string{"app": {"app", ""}, "app@v1.2": {"app", "@v1.2"}, "app:reinstall": {"app", "reinstall"}, "amneziawg:slava:ru": {"amneziawg", "slava:ru"},
		"pkgs:a,b": {"pkgs", "a,b"}, "app:lang:ru": {"app", "lang:ru"}} {
		if n, a := splitTarget(in); n != want[0] || a != want[1] {
			t.Errorf("the target %q: %q %q", in, n, a)
		}
	}
	if fw, ok := FirmwareOf("24.10.6", "mediatek/filogic", "aarch64_cortex-a53", "", "ipk"); !ok || fw.Asset("kmod-amneziawg") != "kmod-amneziawg_v24.10.6_aarch64_cortex-a53_mediatek_filogic.ipk" ||
		fw.ForTag("v24.10.8").Postfix != "_v24.10.8_aarch64_cortex-a53_mediatek_filogic" {
		t.Errorf("the firmware: %+v", fw)
	}
	if fw, ok := FirmwareOf("25.12.3", "x86/64", "", "DISTRIB_ARCH='x86_64'\n", "apk"); !ok || fw.Postfix != "_v25.12.3_x86_64_x86_64" {
		t.Errorf("the arch from the release file: %+v", fw)
	}
	if fw, _ := FirmwareOf("SNAPSHOT", "x86/64", "x86_64", "", "apk"); !fw.Snapshot {
		t.Error("a snapshot is not told")
	}
	for arch, want := range map[string]string{"aarch64_cortex-a53": "arm64", "aarch64_generic": "arm64", "x86_64": "amd64", "mips_24kc": "mips", "mipsel_24kc": "mipsle",
		"mipsel_74kc": "mipsle", "arm_cortex-a7_neon-vfpv4": "arm", "arm_cortex-a9": "arm", "arm_arm926ej-s": "", "arm_xscale": "", "i386_pentium4": "", "riscv64_riscv64": "", "": ""} {
		if got := GoArch(arch); got != want {
			t.Errorf("the binary for %q: %q, not %q", arch, got, want)
		}
	}
	if _, ok := FirmwareOf("", "x86/64", "x86_64", "", "apk"); ok {
		t.Error("a firmware made of nothing")
	}
}

// router is a made-up router: a package manager that keeps versions, GitHub with one newer release.
type router struct {
	t         *testing.T
	dir       string
	installed map[string]string
	ran       []string
	sums      map[string]string
	releases  map[string]map[string]string // tag -> asset -> body
	env       *Env
	said      []string
}

func newRouter(t *testing.T) *router {
	r := &router{t: t, dir: t.TempDir(), installed: map[string]string{"luci-app-dawnline": "0.18.0", "ip-full": "6.11.0-r1"}, releases: map[string]map[string]string{}}
	r.release("v0.18.0", "0.18.0")
	r.release("v0.19.0", "0.19.0")
	clock := time.Unix(1_800_000_000, 0)
	gh := &github.Client{RunDir: r.dir + "/run", Now: func() time.Time { return clock }, Get: func(url string) (int, []byte) {
		rel := func(tag string) map[string]any {
			var assets []any
			for name, body := range r.releases[tag] {
				sum := sha256.Sum256([]byte(body))
				a := map[string]any{"name": name, "id": 1.0}
				if !strings.Contains(name, "nosum") {
					a["digest"] = "sha256:" + hex.EncodeToString(sum[:])
				}
				assets = append(assets, a)
			}
			return map[string]any{"tag_name": tag, "html_url": "https://github.com/" + Repo + "/releases/tag/" + tag, "published_at": "2026-11-01T00:00:00Z", "assets": assets}
		}
		var out any
		switch {
		case strings.HasSuffix(url, "/releases/latest"):
			out = rel("v0.19.0")
		case strings.Contains(url, "/releases/tags/"):
			tag := url[strings.LastIndex(url, "/")+1:]
			if r.releases[tag] == nil {
				return 404, []byte(`{"message":"Not Found"}`)
			}
			out = rel(tag)
		default:
			return 404, []byte(`{"message":"Not Found"}`)
		}
		raw, _ := json.Marshal(out)
		return 200, raw
	}}
	pkg := &pkgmgr.Manager{Apk: true, Run: func(cmd string) (string, int) {
		switch {
		case strings.HasPrefix(cmd, "apk list --installed "):
			name := strings.Trim(strings.TrimPrefix(cmd, "apk list --installed "), "'")
			if v := r.installed[name]; v != "" {
				return name + "-" + v + " x86_64 {feed} [installed]\n", 0
			}
			return "", 0
		case strings.HasPrefix(cmd, "apk adbdump "):
			raw, _ := os.ReadFile(strings.Trim(strings.TrimPrefix(cmd, "apk adbdump "), "'"))
			return string(raw), 0
		case strings.HasPrefix(cmd, "df "):
			return "Filesystem 1024-blocks Used Available Capacity Mounted on\noverlay 100000 1000 99000 1% /overlay\n", 0
		case strings.HasPrefix(cmd, "apk add --allow-untrusted "):
			r.ran = append(r.ran, "apk add files")
			for _, f := range strings.Fields(strings.TrimPrefix(cmd, "apk add --allow-untrusted ")) {
				raw, _ := os.ReadFile(strings.Trim(f, "'"))
				if n, v := pkgmgr.ControlInfo(string(raw), false); n != "" {
					r.installed[n] = v
				}
			}
			return "OK: 10 MiB in 100 packages\n", 0
		case cmd == `apk version -l "<"`:
			return "ip-full-6.11.0-r1 < 6.12.0-r1\nip-tiny-6.11.0-r1 < 6.12.0-r1\n", 0
		}
		r.ran = append(r.ran, cmd)
		return "", 0
	}}
	r.env = &Env{RunDir: r.dir + "/run", DataDir: r.dir + "/data", Version: "0.18.0", Pkg: pkg, GH: gh, Pid: 4242, Now: func() time.Time { return clock }, Sleep: func(time.Duration) {},
		Policy: model.Updates{Check: true, Interval: "1d", Auto: true, Mode: "immediate", Time: "04:00", Targets: []string{"app", "packages"}, Mirrors: true},
		Fetch: func(url, dest string) bool {
			parts := strings.Split(url, "/releases/download/")
			if len(parts) != 2 || strings.HasPrefix(url, "https://gh") {
				return false
			}
			ta := strings.SplitN(parts[1], "/", 2)
			body, has := r.releases[ta[0]][ta[1]]
			if !has {
				return false
			}
			return os.WriteFile(dest, []byte(body), 0o600) == nil
		},
		Run: func(cmd string) (string, int) { r.ran = append(r.ran, cmd); return "", 0 },
		Log: &servicelog.Log{RunDir: r.dir + "/run", Level: func() string { return "info" }, Syslog: func(_, line string) { r.said = append(r.said, line) }}}
	return r
}

func (r *router) release(tag, ver string) {
	r.releases[tag] = map[string]string{"luci-app-dawnline-" + ver + ".apk": "info:\n  name: luci-app-dawnline\n  version: " + ver + "\n"}
}

func (r *router) job() Job {
	var j Job
	raw, _ := os.ReadFile(r.dir + "/run/update-job.json")
	json.Unmarshal(raw, &j)
	return j
}

func (r *router) run(args ...string) int {
	var out, errs bytes.Buffer
	return Main(r.env, args, &out, &errs)
}

func TestUsage(t *testing.T) {
	r := newRouter(t)
	var out, errs bytes.Buffer
	if Main(r.env, nil, &out, &errs) != 2 || Main(r.env, []string{"dance"}, &out, &errs) != 2 || Main(r.env, []string{"install"}, &out, &errs) != 2 || !strings.HasPrefix(errs.String(), "Usage:") {
		t.Error("a command it does not know")
	}
	if Main(r.env, []string{"help"}, &out, &errs) != 0 || !strings.HasPrefix(out.String(), "Usage:") {
		t.Error("asked for help")
	}
	if _, err := os.Stat(r.dir + "/run"); err == nil {
		t.Error("something was written for no command")
	}
}

func TestCheckAndInstall(t *testing.T) {
	r := newRouter(t)
	r.run("check", "app")
	var c struct {
		Components map[string]map[string]any `json:"components"`
	}
	raw, _ := os.ReadFile(r.dir + "/run/update-check.json")
	json.Unmarshal(raw, &c)
	if a := c.Components["app"]; a["update"] != true || a["latest"] != "0.19.0" || a["status"] != "outdated" || a["installed"] != "0.18.0" {
		t.Fatalf("the check: %s", raw)
	}
	if j := r.job(); j.State != "done" || j.Phase != "Finished" || j.Finished == nil {
		t.Fatalf("the check's job: %+v", j)
	}
	r.run("check", "packages")
	raw, _ = os.ReadFile(r.dir + "/run/update-check.json")
	json.Unmarshal(raw, &c)
	if p := c.Components["packages"]; p["updates"] != 2.0 || p["status"] != "outdated" || c.Components["app"]["latest"] != "0.19.0" {
		t.Fatalf("the packages' check (the app's must stay): %s", raw)
	}
	// the install: verified, the old version kept, a backup first, the package in, postupdate last
	r.env.Policy.Keep = true
	r.ran = nil
	r.run("install", "app")
	j := r.job()
	if j.State != "done" || j.From != "0.18.0" || j.To != "0.19.0" || r.installed["luci-app-dawnline"] != "0.19.0" {
		t.Fatalf("the install: %+v\n%s", j, strings.Join(j.Log, "\n"))
	}
	did := strings.Join(r.ran, "; ")
	if !strings.Contains(did, "dawnline backup --reason pre-update") || !strings.HasSuffix(did, "postupdate '0.19.0' </dev/null >/dev/null 2>&1 &") ||
		strings.Index(did, "backup") > strings.Index(did, "apk add files") {
		t.Errorf("what ran: %s", did)
	}
	if k := kept(r.dir+"/data", "app"); k == nil || k.Version != "0.18.0" || len(k.Files) != 1 {
		t.Errorf("the version kept for a rollback: %+v", k)
	}
	if !strings.Contains(strings.Join(j.Log, "\n"), "sha256 matches the release") {
		t.Errorf("nothing says the file was verified:\n%s", strings.Join(j.Log, "\n"))
	}
	raw, _ = os.ReadFile(r.dir + "/data/update-history.json")
	if !strings.Contains(string(raw), `"kind":"install"`) || !strings.Contains(string(raw), `"to":"0.19.0"`) {
		t.Errorf("the history: %s", raw)
	}
	raw, _ = os.ReadFile(r.dir + "/run/update-check.json")
	json.Unmarshal(raw, &c)
	if a := c.Components["app"]; a["update"] != false || a["installed"] != "0.19.0" {
		t.Errorf("the check after the install still offers it: %s", raw)
	}
	if _, err := os.Stat("/tmp/dawnline-update.4242"); err == nil {
		t.Error("the work directory stays")
	}
	// and back
	r.env.Version = "0.19.0"
	r.ran = nil
	r.run("install", "app:rollback")
	if j := r.job(); j.State != "done" || r.installed["luci-app-dawnline"] != "0.18.0" || kept(r.dir+"/data", "app") != nil {
		t.Errorf("the rollback: %+v", j)
	}
}

func TestInstallRefusals(t *testing.T) {
	r := newRouter(t)
	// a release that publishes no checksum is not installed
	r.releases["v0.20.0"] = map[string]string{"luci-app-dawnline-0.20.0.apk.nosum": "x"}
	r.releases["v0.20.0"]["luci-app-dawnline-0.20.0.apk"] = "info:\n  name: luci-app-dawnline\n  version: 0.20.0\n"
	delete(r.releases["v0.20.0"], "luci-app-dawnline-0.20.0.apk.nosum")
	r.run("install", "app@v9.9.9")
	j := r.job()
	if j.State != "failed" || !strings.Contains(j.Error.(string), "publishes no checksum") || r.installed["luci-app-dawnline"] != "0.18.0" {
		t.Errorf("a release that is not there: %+v", j)
	}
	found := false
	for _, l := range r.said {
		found = found || strings.Contains(l, "Dawnline update failed")
	}
	raw, _ := os.ReadFile(r.dir + "/data/update-history.json")
	if !found || !strings.Contains(string(raw), `"state":"failed"`) {
		t.Errorf("a failed update is not told: %v / %s", r.said, raw)
	}
	r.run("install", "pkgs:busybox")
	if j := r.job(); j.State != "failed" || j.Error != "busybox is not a package Dawnline manages" {
		t.Errorf("a package that is not ours: %+v", j)
	}
	r.run("install", "nonsense")
	if j := r.job(); j.State != "failed" || j.Error != "Unknown component nonsense" {
		t.Errorf("a component there is none of: %+v", j)
	}
	// one job at a time: a second one leaves without a trace
	held := lock(r.dir + "/run")
	before, _ := os.ReadFile(r.dir + "/run/update-job.json")
	if r.run("check", "app") != 0 {
		t.Error("a busy updater is an error")
	}
	if after, _ := os.ReadFile(r.dir + "/run/update-job.json"); string(after) != string(before) {
		t.Error("a second job wrote over the first")
	}
	held.Close()
}

func TestAuto(t *testing.T) {
	r := newRouter(t)
	// nothing due: no check, no job
	os.MkdirAll(r.dir+"/data", 0o700)
	os.WriteFile(r.dir+"/data/update-auto.json", []byte(`{"check":1799999000}`), 0o600)
	r.run("auto")
	if _, err := os.Stat(r.dir + "/run/update-check.json"); err == nil {
		t.Fatal("checked before its time")
	}
	// due, and updates right away: packages first, Dawnline last
	os.WriteFile(r.dir+"/data/update-auto.json", []byte(`{"check":1799000000}`), 0o600)
	r.ran = nil
	r.run("auto")
	j := r.job()
	if j.State != "done" || !j.Auto || j.Component != "pkgs:ip-full app" || r.installed["luci-app-dawnline"] != "0.19.0" {
		t.Fatalf("the automatic run: %+v\n%s", j, strings.Join(j.Log, "\n"))
	}
	did := strings.Join(r.ran, "; ")
	if !strings.Contains(did, "apk upgrade 'ip-full' 'ip-tiny'") || strings.Index(did, "apk upgrade") > strings.Index(did, "apk add files") {
		t.Errorf("the order: %s", did)
	}
	// an automatic run always keeps the version it replaces
	if k := kept(r.dir+"/data", "app"); k == nil || k.Version != "0.18.0" {
		t.Errorf("nothing kept by an automatic run: %+v", k)
	}
	said := strings.Join(r.said, "\n")
	if !strings.Contains(said, "updates available · Dawnline 0.19.0, 2 system packages") || !strings.Contains(said, "updated automatically · ip-full, ip-tiny") {
		t.Errorf("the service log: %s", said)
	}
	// checks only: found, told once, nothing installed
	r2 := newRouter(t)
	r2.env.Policy.Auto = false
	r2.run("auto")
	r2.run("auto")
	if r2.installed["luci-app-dawnline"] != "0.18.0" || strings.Count(strings.Join(r2.said, "\n"), "updates available") != 1 {
		t.Errorf("a check-only policy: %v", r2.said)
	}
	if _, err := os.Stat(r2.dir + "/run/update-job.json"); err == nil {
		t.Error("an automatic check shows up as a job")
	}
}
