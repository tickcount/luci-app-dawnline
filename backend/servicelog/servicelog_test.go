package servicelog

import (
	"os"
	"strings"
	"testing"
	"time"
)

func TestWrite(t *testing.T) {
	dir := t.TempDir()
	var said []string
	level := "info"
	l := Log{RunDir: dir, Level: func() string { return level }, Syslog: func(p, line string) { said = append(said, p+" "+line) },
		Now: func() time.Time { return time.Unix(1_800_000_000, 0) }}
	l.Admin("dawnline", "exported", "", "all settings", "the file holds private keys")
	l.Write("awg", "error", "did not start", "  line one\n\tline two  ", "Home", Extra{})
	l.Write("agent", "repair", "restarted", "why", "", Extra{})
	l.Say("debug", "apply", "a step")
	level = "error"
	l.Write("portal", "info", "started", "", "Personal portal", Extra{})
	raw, _ := os.ReadFile(dir + "/service.log")
	want := `{"by":"admin","level":"info","msg":"exported","note":"the file holds private keys","src":"dawnline","ts":1800000000,"who":"all settings"}
{"detail":"line one\n\tline two","level":"error","msg":"did not start","src":"awg","ts":1800000000,"who":"Home"}
{"detail":"why","level":"repair","msg":"restarted","src":"agent","ts":1800000000}
{"level":"info","msg":"started","src":"portal","ts":1800000000,"who":"Personal portal"}
`
	if string(raw) != want {
		t.Fatalf("the service log:\n%s", raw)
	}
	// syslog: the admin's own words, a problem with what went wrong on one line; nothing below the admin's level
	wantSaid := "daemon.info [info] [dawnline] admin exported all settings · the file holds private keys\n" +
		"daemon.err [error] [awg] Home did not start · line one | line two\ndaemon.warning [warn] [agent] restarted · why"
	if got := strings.Join(said, "\n"); got != wantSaid {
		t.Fatalf("syslog:\n%s", got)
	}
	if Line("odd", "", " a\n b\tc ") != "[info] [dawnline] a b c" {
		t.Fatal("a line's words")
	}
}
