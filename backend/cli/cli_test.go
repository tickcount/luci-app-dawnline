package cli

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

func env(t *testing.T) (*Env, *bytes.Buffer, *bytes.Buffer, string) {
	dir := t.TempDir()
	text, _ := os.ReadFile("../access/testdata/access.uci")
	os.WriteFile(dir+"/dawnline", text, 0o600)
	out, errs := &bytes.Buffer{}, &bytes.Buffer{}
	e := &Env{RunDir: dir + "/run", DataDir: dir + "/data", Config: dir + "/dawnline", Out: out, Err: errs,
		Now: func() time.Time { return time.Unix(1_800_000_000, 0) },
		Run: func(name string, args ...string) (string, int) {
			if name == "awg" {
				return "4500\n", 0
			}
			return "", 1
		}}
	os.MkdirAll(e.RunDir, 0o755)
	return e, out, errs, dir
}

func entries(t *testing.T, e *Env) []map[string]any {
	raw, _ := os.ReadFile(e.RunDir + "/service.log")
	var out []map[string]any
	for _, l := range strings.Split(string(raw), "\n") {
		if l != "" {
			var m map[string]any
			json.Unmarshal([]byte(l), &m)
			out = append(out, m)
		}
	}
	return out
}

// The hotplug script's words: a start, a stop Dawnline did not make, one it did, and starts that keep failing.
func TestIfaceEvents(t *testing.T) {
	e, _, errs, _ := env(t)
	if e.Main([]string{"iface-event", "ifup", "dawn0"}) != 0 || e.Main([]string{"iface-event", "ifdown", "dawn0"}) != 0 {
		t.Fatal(errs.String())
	}
	// a stop Dawnline made itself is explained by the admin's own line: nothing here
	os.WriteFile(e.RunDir+"/iface-intent.json", []byte(`{"dawn1":{"reason":"settings","name":"Cabin","ts":1799999990},"dawn2":{"reason":"update","name":"Open","ts":1799999990}}`), 0o600)
	e.Main([]string{"iface-event", "ifdown", "dawn1"})
	e.Main([]string{"iface-event", "ifdown", "dawn2"})
	for i := 0; i < 3; i++ {
		e.Main([]string{"iface-event", "ifup-failed", "dawn0"})
	}
	log := entries(t, e)
	var got []string
	for _, l := range log {
		got = append(got, l["who"].(string)+" · "+l["level"].(string)+" · "+l["msg"].(string))
	}
	want := []string{"Home · up · started · accepting connections on port 4500", "Home · down · stopped unexpectedly", "Open · info · restarting for the AmneziaWG update", "Home · error · couldn't start"}
	if strings.Join(got, "\n") != strings.Join(want, "\n") {
		t.Errorf("the log:\n%s", strings.Join(got, "\n"))
	}
	if e.Main([]string{"iface-event", "ifup", "../etc"}) != 1 || !strings.Contains(errs.String(), "Bad interface.") {
		t.Errorf("a name that is no interface: %s", errs.String())
	}
	// the log as the admin reads it, newest first, by level
	e2, out, _, _ := env(t)
	e2.RunDir = e.RunDir
	if e2.Main([]string{"log", "--level", "down"}) != 0 || !strings.Contains(out.String(), "awg      down   Home stopped unexpectedly") || strings.Contains(out.String(), "accepting connections") {
		t.Errorf("the log's lines:\n%s", out.String())
	}
	out.Reset()
	e2.Main([]string{"log", "-n", "1", "--json"})
	var list []map[string]any
	if json.Unmarshal(out.Bytes(), &list) != nil || len(list) != 1 || list[0]["msg"] != "couldn't start" {
		t.Errorf("the newest entry: %s", out.String())
	}
	if e2.Main([]string{"log", "--since", "soon"}) != 1 {
		t.Error("a since that is no time was taken")
	}
}

func TestPeopleAndDevices(t *testing.T) {
	e, out, errs, _ := env(t)
	var asked []string
	e.Call = func(method string, args map[string]any) (map[string]any, error) {
		raw, _ := json.Marshal(args)
		asked = append(asked, method+" "+string(raw))
		switch method {
		case "sync":
			return map[string]any{"docs": map[string]any{"people": map[string]any{"order": []any{"zed", "amy"}, "items": map[string]any{
				"zed": map[string]any{"name": "Zed", "server": "home", "access": "both", "state": "active", "online": 1.0, "devices": map[string]any{"order": []any{"d_2", "d_1"}, "items": map[string]any{
					"d_2": map[string]any{"name": "Tablet", "kind": "tablet", "address": "10.77.0.3", "handshake": 1799990000.0},
					"d_1": map[string]any{"name": "Phone", "kind": "phone", "address": "10.77.0.2", "online": true}}}},
				"amy": map[string]any{"name": "Amy", "server": "home", "access": "lan", "state": "paused", "last_seen": 1799900000.0, "devices": map[string]any{"order": []any{}, "items": map[string]any{}}}}}}}, nil
		case "person_delete":
			return map[string]any{"ok": true, "warning": "Couldn't load devices into Home: busy."}, nil
		case "device_config":
			if args["id"] != "d_1" {
				return map[string]any{"error": "Unknown device."}, nil
			}
			return map[string]any{"conf": "[Interface]\n"}, nil
		case "person_links":
			return map[string]any{"url": "https://vpn.example.org:4500/aaaaaa-bbbbbb-cccccc"}, nil
		}
		return nil, errors.New("no backend")
	}
	e.Main([]string{"person", "ls"})
	want := "ID   NAME  SERVER  ACCESS  STATE   DEVICES       LAST SEEN\namy  Amy   home    lan     paused  0             1d ago\nzed  Zed   home    both    active  2 (1 online)  now\n"
	if out.String() != want {
		t.Errorf("person ls:\n%s", out.String())
	}
	out.Reset()
	e.Main([]string{"device", "ls", "zed"})
	want = "ID   PERSON  NAME    KIND    ADDRESS    STATE\nd_1  zed     Phone   phone   10.77.0.2  online\nd_2  zed     Tablet  tablet  10.77.0.3  seen 2h ago\n"
	if out.String() != want {
		t.Errorf("device ls:\n%s", out.String())
	}
	out.Reset()
	if e.Main([]string{"person", "rm", "zed"}) != 1 || !strings.Contains(errs.String(), "Zed has 2 devices: add --yes to remove them too.") {
		t.Errorf("a person with devices goes without a yes: %s", errs.String())
	}
	errs.Reset()
	if e.Main([]string{"person", "rm", "zed", "--yes"}) != 0 || out.String() != "Removed Zed and 2 devices.\n" || !strings.Contains(errs.String(), "Couldn't load devices into Home: busy.") {
		t.Errorf("person rm: %s / %s", out.String(), errs.String())
	}
	out.Reset()
	if e.Main([]string{"device", "conf", "d_1"}) != 0 || out.String() != "[Interface]\n" || e.Main([]string{"device", "conf", "nope"}) != 1 {
		t.Errorf("device conf: %q", out.String())
	}
	out.Reset()
	if e.Main([]string{"person", "link", "amy"}) != 0 || !strings.HasPrefix(out.String(), "https://vpn.example.org:4500/") || e.Main([]string{"person", "link", "who"}) != 1 {
		t.Errorf("person link: %q", out.String())
	}
	// what needs no backend: the plain-HTTP port (an IP is among the portal's addresses), the version, help
	out.Reset()
	if e.Main([]string{"portal-http-port"}) != 0 || out.String() != "4501\n" {
		t.Errorf("portal-http-port: %q", out.String())
	}
	if e.Main([]string{"backup", "--reason", "pre-update"}) != 0 || e.Main([]string{"dance", "now"}) != 2 || e.Main(nil) != 0 {
		t.Error("the exit codes")
	}
}
