// Package updater is Dawnline's background update worker (usr/libexec/dawnline/updater and the modules it
// ran: dawnline.updates, upd_app, upd_awg, upd_pkgs, awg_builds), started detached by the backend and by
// the minute's chores:
//
//	updater check [app|amneziawg|packages]
//	updater install app | app@<tag> | app:reinstall | app:rollback
//	updater install amneziawg[:auto|slava|grey[:ru]] | amneziawg:rollback
//	updater install pkgs:<name,…>
//	updater auto                      (Settings → Updates: check, then install)
//
// One job at a time: the job holds the update lock until it exits. Progress: update-job.json; check
// results: update-check.json. The Components tab reads both.
package updater

import (
	"os"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/files"
)

// Repo is where Dawnline's own releases are.
const Repo = "tickcount/luci-app-dawnline"

// Targets is what a check looks at.
var Targets = []string{"app", "amneziawg", "packages"}

// lock takes the update lock without waiting: the open file (kept for the whole job; the kernel releases
// it when the process ends), or nil when another job holds it.
func lock(run string) *os.File {
	os.MkdirAll(run, 0o755)
	f, err := os.OpenFile(run+"/update.lock", os.O_WRONLY|os.O_APPEND|os.O_CREATE, 0o644)
	if err != nil {
		return nil
	}
	if syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB) != nil {
		f.Close()
		return nil
	}
	return f
}

// historyAdd puts an entry at the head of the history (Components → Activity): newest first, the last 30
// kept on flash.
func historyAdd(data string, now int64, e map[string]any) {
	var h []map[string]any
	files.ReadJSON(data+"/update-history.json", &h)
	e["ts"] = now
	h = append([]map[string]any{e}, h...)
	if len(h) > 30 {
		h = h[:30]
	}
	os.MkdirAll(data, 0o700)
	files.WriteJSON(data+"/update-history.json", h, 0o600)
}

var (
	versionShape = regexp.MustCompile(`^([0-9.]+)([-~]([0-9A-Za-z.]+))?`)
	preShape     = regexp.MustCompile(`^([^0-9]*)([0-9]*)`)
)

// VersionCmp compares Dawnline release versions (0.3.2, v0.4.0-rc1): -1, 0 or 1. Numbers compare as
// numbers; a pre-release (-rc1, -beta) comes before its release.
func VersionCmp(a, b string) int {
	type parsed struct {
		nums   []int
		pre    string
		hasPre bool
	}
	parse := func(v string) parsed {
		m := versionShape.FindStringSubmatch(strings.TrimPrefix(v, "v"))
		if m == nil {
			return parsed{[]int{0}, v, true}
		}
		var nums []int
		for _, x := range strings.Split(m[1], ".") {
			n, _ := strconv.Atoi(x)
			nums = append(nums, n)
		}
		return parsed{nums, m[3], m[2] != ""}
	}
	x, y := parse(a), parse(b)
	for i := 0; i < len(x.nums) || i < len(y.nums); i++ {
		p, r := 0, 0
		if i < len(x.nums) {
			p = x.nums[i]
		}
		if i < len(y.nums) {
			r = y.nums[i]
		}
		if p != r {
			if p < r {
				return -1
			}
			return 1
		}
	}
	switch {
	case x.hasPre == y.hasPre && x.pre == y.pre:
		return 0
	case !x.hasPre:
		return 1
	case !y.hasPre:
		return -1
	}
	// rc1 < rc2 < rc10: the number runs compare as numbers
	px, py := preShape.FindStringSubmatch(x.pre), preShape.FindStringSubmatch(y.pre)
	if px[1] != py[1] {
		if px[1] < py[1] {
			return -1
		}
		return 1
	}
	nx, _ := strconv.Atoi(px[2])
	ny, _ := strconv.Atoi(py[2])
	switch {
	case nx < ny:
		return -1
	case nx > ny:
		return 1
	}
	return 0
}

// Kept is the version a component had before its last update (Keep the previous version).
type Kept struct {
	Version  string   `json:"version"`
	Build    any      `json:"build"`
	Firmware any      `json:"firmware"`
	Files    []string `json:"files"`
	Saved    int64    `json:"saved"`
}

// kept is the kept version of a component, or nil (none, or its files are gone).
func kept(data, component string) *Kept {
	var k Kept
	if !files.ReadJSON(data+"/keep/"+component+"/meta.json", &k) || k.Version == "" || len(k.Files) == 0 {
		return nil
	}
	for _, f := range k.Files {
		if _, err := os.Stat(f); err != nil {
			return nil
		}
	}
	return &k
}

// keep replaces the kept version of a component with these files (copied in); all of them, or nothing.
func keep(data, component, version string, paths []string, build, firmware any) {
	dir := data + "/keep/" + component
	os.RemoveAll(dir)
	os.MkdirAll(dir, 0o700)
	os.Chmod(data+"/keep", 0o700)
	var saved []string
	for _, f := range paths {
		raw, err := os.ReadFile(f)
		to := dir + "/" + f[strings.LastIndex(f, "/")+1:]
		if err != nil || os.WriteFile(to, raw, 0o600) != nil {
			os.RemoveAll(dir)
			return
		}
		saved = append(saved, to)
	}
	files.WriteJSON(dir+"/meta.json", Kept{Version: version, Build: build, Firmware: firmware, Files: saved, Saved: time.Now().Unix()}, 0o600)
}

func forget(data, component string) { os.RemoveAll(data + "/keep/" + component) }
