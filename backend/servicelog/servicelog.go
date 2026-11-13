// Package servicelog writes the service log and syslog as dawnline.util slog() and syslog() do: an entry a
// line of JSON in run/service.log (what the admin's Service log shows), and the same in words in syslog as
// "dawnline: [info] [awg] Home started", at the matching priority, when the admin's level takes it.
package servicelog

import (
	"encoding/json"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

var (
	rank = map[string]int{"error": 0, "warn": 1, "info": 2, "debug": 3}
	prio = map[string]string{"error": "err", "warn": "warning", "info": "info", "debug": "debug"}
	// a line break or a tab with the blanks around it: one space in a syslog line
	lineBreak = regexp.MustCompile(`[ \t\r\n]*[\t\r\n][ \t\r\n]*`)
	breaks    = regexp.MustCompile(`[\r\n\t]+`)
)

const space = " \t\r\n\v\f"

// Extra is the admin's own fields of an entry: { By: "admin", Kind: "server", Note: "port 50115" } reads
// "You <msg> <kind> <who> · <note>"; SID is the server's id.
type Extra struct {
	By, Kind, Note, SID string
}

// Entry is one service log entry as slog() writes it: the subject first, the admin's own fields, the detail capped.
func Entry(src, level, msg, detail, who string, x Extra, ts int64) map[string]any {
	e := map[string]any{"ts": ts, "src": src, "level": level, "msg": msg}
	if who != "" {
		e["who"] = who
	}
	for k, v := range map[string]string{"by": x.By, "kind": x.Kind, "note": x.Note, "sid": x.SID} {
		if v != "" {
			e[k] = v
		}
	}
	if d := strings.Trim(detail, space); d != "" {
		if len(d) > 2000 {
			d = d[:2000]
		}
		e["detail"] = d
	}
	return e
}

// Line is one syslog line's words: "[level] [src] line", on one line, at most 1000 characters.
func Line(level, src, line string) string {
	if _, known := rank[level]; !known {
		level = "info"
	}
	if src == "" {
		src = "dawnline"
	}
	out := "[" + level + "] [" + src + "] " + lineBreak.ReplaceAllString(strings.Trim(line, space), " ")
	if len(out) > 1000 {
		out = out[:1000]
	}
	return out
}

// Words is an entry as its syslog line tells it, and the level it goes out at.
func Words(src, level, msg, detail, who string, x Extra) (lvl, line string) {
	line = msg
	if x.By == "admin" {
		parts := []string{"admin", msg}
		for _, p := range []string{x.Kind, who} {
			if p != "" {
				parts = append(parts, p)
			}
		}
		if x.Note != "" {
			parts = append(parts, "· "+x.Note)
		}
		line = strings.Join(parts, " ")
	} else if who != "" {
		line = who + " " + msg
	}
	lvl = map[string]string{"error": "error", "repair": "warn", "down": "warn"}[level]
	if lvl == "" {
		lvl = "info"
	}
	// problems carry what went wrong
	if d := strings.Trim(detail, space); d != "" && lvl != "info" {
		if len(d) > 2000 {
			d = d[:2000]
		}
		d = breaks.ReplaceAllString(d, " | ")
		if len(d) > 400 {
			d = d[:400]
		}
		line += " · " + d
	}
	return lvl, line
}

// Log writes to a router's logs. Level is the admin's syslog level (error | warn | info | debug).
type Log struct {
	RunDir string
	Level  func() string
	// Syslog hands a line to syslog (nil: `logger`).
	Syslog func(priority, line string)
	Now    func() time.Time
}

// Write puts an entry in the service log and in syslog.
func (l Log) Write(src, level, msg, detail, who string, x Extra) {
	now := time.Now
	if l.Now != nil {
		now = l.Now
	}
	raw, _ := json.Marshal(Entry(src, level, msg, detail, who, x, now().Unix()))
	os.MkdirAll(l.RunDir, 0o755)
	if f, err := os.OpenFile(l.RunDir+"/service.log", os.O_WRONLY|os.O_APPEND|os.O_CREATE, 0o600); err == nil {
		f.Write(append(raw, '\n'))
		f.Close()
	}
	lvl, line := Words(src, level, msg, detail, who, x)
	l.Say(lvl, src, line)
}

// Say puts a line in syslog at a level, when the admin's level takes it.
func (l Log) Say(level, src, line string) {
	at := "info"
	if l.Level != nil {
		at = l.Level()
	}
	r, known := rank[level]
	if !known {
		r = 2
	}
	if r > rank[at] {
		return
	}
	p := prio[level]
	if p == "" {
		p = "info"
	}
	if l.Syslog != nil {
		l.Syslog("daemon."+p, Line(level, src, line))
		return
	}
	exec.Command("logger", "-t", "dawnline", "-p", "daemon."+p, Line(level, src, line)).Run()
}

// Admin records a change the admin made in LuCI.
func (l Log) Admin(src, msg, kind, who, note string) {
	l.Write(src, "info", msg, "", who, Extra{By: "admin", Kind: kind, Note: note})
}

// Clear removes entries from the service log, all of them or those older than `days` days, in the live
// copy and the one on flash (dataDir) when there is one; it returns how many went (dawnline.util slog_clear).
func (l Log) Clear(dataDir string, days int64) int {
	now := time.Now
	if l.Now != nil {
		now = l.Now
	}
	raw, err := os.ReadFile(l.RunDir + "/service.log")
	if err != nil {
		raw, _ = os.ReadFile(dataDir + "/service.log")
	}
	var keep []string
	removed := 0
	for _, line := range strings.Split(string(raw), "\n") {
		if line == "" {
			continue
		}
		var e struct {
			TS *float64 `json:"ts"`
		}
		json.Unmarshal([]byte(line), &e)
		if days > 0 && e.TS != nil && *e.TS >= float64(now().Unix()-days*86400) {
			keep = append(keep, line)
		} else {
			removed++
		}
	}
	data := ""
	if len(keep) > 0 {
		data = strings.Join(keep, "\n") + "\n"
	}
	os.MkdirAll(l.RunDir, 0o755)
	os.WriteFile(l.RunDir+"/service.log", []byte(data), 0o600)
	if _, err := os.Stat(dataDir + "/service.log"); err == nil {
		os.WriteFile(dataDir+"/service.log", []byte(data), 0o600)
	}
	return removed
}

// keep is how many entries the service log holds.
const keep = 300

// Trim keeps the last entries only, and copies them to flash (dataDir) when asked and something was
// written since the last copy.
func (l Log) Trim(dataDir string, save bool) {
	path := l.RunDir + "/service.log"
	raw, err := os.ReadFile(path)
	if err != nil {
		return
	}
	var lines []string
	for _, s := range strings.Split(string(raw), "\n") {
		if s != "" {
			lines = append(lines, s)
		}
	}
	if len(lines) > keep+50 {
		lines = lines[len(lines)-keep:]
		os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o600)
	}
	if !save || len(lines) == 0 {
		return
	}
	live, err := os.Stat(path)
	if err != nil {
		return
	}
	if kept, err := os.Stat(dataDir + "/service.log"); err == nil && !live.ModTime().After(kept.ModTime()) {
		return
	}
	os.MkdirAll(dataDir, 0o700)
	os.WriteFile(dataDir+"/service.log", []byte(strings.Join(lines, "\n")+"\n"), 0o600)
}
