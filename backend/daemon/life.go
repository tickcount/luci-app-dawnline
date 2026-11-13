package daemon

import (
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	backend "github.com/tickcount/luci-app-dawnline/backend"
	"github.com/tickcount/luci-app-dawnline/backend/geo"
	"github.com/tickcount/luci-app-dawnline/backend/journal"
	"github.com/tickcount/luci-app-dawnline/backend/servicelog"
	"github.com/tickcount/luci-app-dawnline/backend/store"
	"github.com/tickcount/luci-app-dawnline/backend/updater"
)

// The beat is the time of the backend's last minute: the Health page calls it fine while it is fresh, and
// a beat left behind by a backend that is gone tells the next start that the last one did not end well.
const beatFile = "/agent.beat"

func readTrim(path string) string {
	raw, _ := os.ReadFile(path)
	return strings.Trim(string(raw), " \t\r\n\v\f")
}

// started says in the service log why this start: an update that was rolled back, a new version, a crash
// (the beat outlives a backend that died), a restart (the init script notes a stop), a boot, or a plain
// start. It also puts back the service log a reboot took from memory, and remembers the kernel an
// AmneziaWG module Dawnline did not install is for.
func started(o Options, logs *servicelog.Log) {
	os.MkdirAll(o.RunDir, 0o755)
	_, beat := os.Stat(o.RunDir + beatFile)
	crashed := beat == nil
	stopped, _ := strconv.ParseInt(readTrim(o.RunDir+"/agent.stopped"), 10, 64)
	os.Remove(o.RunDir + "/agent.stopped")
	was := readTrim(o.DataDir + "/version")
	v := backend.Version
	if was != v {
		os.MkdirAll(o.DataDir, 0o700)
		os.WriteFile(o.DataDir+"/version", []byte(v), 0o644)
	}
	// the service log lives in memory: after a reboot, what flash kept of it
	if _, err := os.Stat(o.RunDir + "/service.log"); err != nil {
		if raw, err := os.ReadFile(o.DataDir + "/service.log"); err == nil {
			os.WriteFile(o.RunDir+"/service.log", raw, 0o600)
		}
	}
	say := func(level, msg, detail string) {
		logs.Write("dawnline", level, msg, detail, "Dawnline", servicelog.Extra{})
	}
	rolled := readTrim(o.RunDir + "/update-rolled-back")
	os.Remove(o.RunDir + "/update-rolled-back")
	uptime := 0.0
	fmt.Sscan(readTrim("/proc/uptime"), &uptime)
	switch {
	// postupdate put this (kept) version back because the new one did not come up
	case rolled != "":
		say("error", fmt.Sprintf("update to %s failed its check - rolled back to %s", rolled, v),
			"The new version did not answer in LuCI or its agent did not start. Try again from Components, or install it with install.sh to see why.")
	case was != "" && was != v:
		say("up", fmt.Sprintf("updated · %s → %s", was, v), "")
	case crashed:
		// why, when syslog knows: procd, the kernel (out of memory, a fault)
		why, _ := exec.Command("sh", "-c", `logread -l 400 2>/dev/null | grep -iE "kernel:.*(out of memory|killed process|oom-kill|segfault)|procd:.*dawnline|dawnlined" | tail -n 6`).Output()
		say("repair", "stopped unexpectedly - started again", strings.Trim(string(why), " \t\r\n\v\f"))
	case stopped != 0 && time.Now().Unix()-stopped < 300:
		say("info", "restarted · version "+v, "")
	case uptime < 600:
		say("info", "started with the router · version "+v, "")
	default:
		say("info", "started · version "+v, "")
	}
	updater.Adopt(o.DataDir)
	beatNow(o)
}

func beatNow(o Options) {
	os.WriteFile(o.RunDir+beatFile, []byte(strconv.FormatInt(time.Now().Unix(), 10)), 0o644)
}

// ended is a clean stop: what lives in memory goes to flash (the activity log, the service log, the places
// found), and the beat goes, so the next start is not taken for a crash. The counters are the watcher's.
func ended(o Options, logs *servicelog.Log) {
	now := time.Now().Unix()
	if _, m, err := (store.Store{Config: o.Config, RunDir: o.RunDir}).Read(); err == nil {
		journal.Log{Run: o.RunDir, Data: o.DataDir}.Persist(journal.PolicyOf(m.Settings.Retention), now)
	}
	logs.Trim(o.DataDir, true)
	geo.Store{Run: o.RunDir, Data: o.DataDir}.Flush()
	os.Remove(o.RunDir + beatFile)
}
