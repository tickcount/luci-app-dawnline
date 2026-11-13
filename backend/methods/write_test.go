package methods

import (
	"encoding/json"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/tickcount/luci-app-dawnline/backend/awg"
	"github.com/tickcount/luci-app-dawnline/backend/netview"
	"github.com/tickcount/luci-app-dawnline/backend/store"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
	"github.com/tickcount/luci-app-dawnline/backend/view"
)

// A row of changes to access's household: after each, the settings file is the one the ucode backend's
// own method leaves, and a refusal has its words (testdata/write.uc, scripts/ucode-golden.sh).
func TestChangesAsUcode(t *testing.T) {
	raw, err := os.ReadFile("testdata/write.json")
	if err != nil {
		t.Fatal(err)
	}
	var golden struct {
		Steps []struct {
			Method string         `json:"method"`
			Args   map[string]any `json:"args"`
			Error  *string        `json:"error"`
			File   string         `json:"file"`
		} `json:"steps"`
	}
	if err := json.Unmarshal(raw, &golden); err != nil {
		t.Fatal(err)
	}
	if len(golden.Steps) < 287 {
		t.Fatal("the golden is too small")
	}
	dir := t.TempDir()
	text, _ := os.ReadFile("../access/testdata/access.uci")
	// as libuci keeps it: the golden's first commit rewrites the file whole
	c, _ := uci.Parse(string(text))
	os.WriteFile(dir+"/dawnline", []byte(c.Format()), 0o600)
	// the router the golden ran on: what its container said of itself (netview's golden, the same run)
	raw, err = os.ReadFile("../netview/testdata/trace.json")
	if err != nil {
		t.Fatal(err)
	}
	var router struct {
		Routes   json.RawMessage         `json:"routes"`
		Addrs    json.RawMessage         `json:"addrs"`
		Firewall string                  `json:"firewall"`
		Links    map[string]netview.Link `json:"links"`
	}
	if err := json.Unmarshal(raw, &router); err != nil {
		t.Fatal(err)
	}
	fw, _ := uci.Parse(router.Firewall)
	snapshot := func() *netview.Snapshot {
		return netview.Take(netview.Sources{Routes: func() []byte { return router.Routes }, Addrs: func() []byte { return router.Addrs },
			Links: func() map[string]netview.Link { return router.Links }, Zones: func() netview.Zones { return netview.ZonesOf(fw) }})
	}
	installed := true
	d := Deps{World: func() *view.World { return &view.World{} }, Store: &store.Store{Config: dir + "/dawnline", RunDir: dir}, Snapshot: snapshot,
		Config: dir + "/dawnline", RunDir: dir, DataDir: dir + "/data",
		// as in the golden's container: no AmneziaWG at all
		Caps: func() awg.Caps { return awg.Caps{} }, AWG: func() map[string]any {
			// the made-up device steps stand for a router that has it (they pass ucode's check by going around it)
			return map[string]any{"tools": installed, "kmod": installed, "loaded": installed, "handler": true, "missing": []any{"kmod-amneziawg", "amneziawg-tools"}}
		}}
	changed, refused := 0, 0
	before := c.Format()
	made := regexp.MustCompile(`config circle 'c_([0-9a-f]+)'`)
	codeOf := regexp.MustCompile(`option code '([a-z]{6}-[a-z]{6}-[a-z]{6})'`)
	momentOf := regexp.MustCompile(`option (?:code_set|created) '([0-9]+)'`)
	device := regexp.MustCompile(`config device 'd_([0-9a-f]+)'`)
	portOf := regexp.MustCompile(`option port '([0-9]+)'`)
	for i, step := range golden.Steps {
		// an id made at random is the one ucode's dice gave: the golden's file names it
		randHex = func(int) string {
			for _, m := range made.FindAllStringSubmatch(step.File, -1) {
				if !strings.Contains(before, "config circle 'c_"+m[1]+"'") {
					return m[1]
				}
			}
			return "none"
		}
		// a code and a moment likewise: the ones the golden's file has and the file before did not
		newCode = func() string {
			for _, m := range codeOf.FindAllStringSubmatch(step.File, -1) {
				if !strings.Contains(before, "'"+m[1]+"'") {
					return m[1]
				}
			}
			return "none"
		}
		clock = func() int64 {
			var latest int64
			for _, m := range momentOf.FindAllStringSubmatch(step.File, -1) {
				if n, _ := strconv.ParseInt(m[1], 10, 64); n > latest {
					latest = n
				}
			}
			return latest
		}
		// the keys the golden made up, and the device id its dice gave
		method := strings.TrimPrefix(step.Method, "x_")
		installed = step.Method != "server_obfuscation" && step.Method != "server_create"
		needLoaded = step.Method != "server_create"
		// a port drawn when the usual one is taken is ucode's dice too
		randPort = func() int {
			for _, m := range portOf.FindAllStringSubmatch(step.File, -1) {
				if !strings.Contains(before, "option port '"+m[1]+"'") {
					n, _ := strconv.Atoi(m[1])
					return n
				}
			}
			return 51830
		}
		if step.Method == "server_create" {
			// the keys the golden's stand-in tool gives
			newKeys = func() Keys {
				return Keys{Private: strings.Repeat("S", 42) + "A=", Public: strings.Repeat("T", 42) + "A="}
			}
		}
		if k, _ := step.Args["key"].(string); k != "" {
			key := func(c string) string { return strings.Repeat(c, 42)[:42*len(c)] + "A=" }
			newKeys = func() Keys { return Keys{Private: key(k + "x"), Public: key(k), Preshared: key(k + "y")} }
			randHex = func(int) string {
				for _, m := range device.FindAllStringSubmatch(step.File, -1) {
					if !strings.Contains(before, "config device 'd_"+m[1]+"'") {
						return m[1]
					}
				}
				return "none"
			}
		}
		res := ask(t, d, method, step.Args)
		got, _ := os.ReadFile(dir + "/dawnline")
		// ucode's full apply, which the server methods end with, notes a migration in the settings the first
		// time it runs; here nothing applies, so the note is put where that apply puts it
		const note = "\tlist migrated 'auto_mtu'\n"
		if strings.Contains(step.File, note) && !strings.Contains(string(got), note) {
			c, _ := uci.Parse(string(got))
			c.SetList("settings", "migrated", []string{"auto_mtu"})
			got = []byte(c.Format())
			os.WriteFile(dir+"/dawnline", got, 0o600)
		}
		if string(got) != step.File {
			t.Fatalf("step %d %s %v: the file differs\n%s\n--- ucode:\n%s", i, step.Method, step.Args, got, step.File)
		}
		if string(got) == before {
			// nothing was written: a refusal in the same words, or a change that changes nothing
			var want any
			if step.Error != nil {
				want = *step.Error
				refused++
			}
			if res["error"] != want {
				t.Errorf("step %d %s %v: refused with %v, ucode %v", i, step.Method, step.Args, res["error"], want)
			}
		} else {
			changed++
			if res["error"] != nil {
				t.Errorf("step %d %s %v: written, and yet %v", i, step.Method, step.Args, res["error"])
			}
		}
		before = string(got)
	}
	if changed < 115 || refused < 106 {
		t.Fatalf("the golden exercises too little: %d changes, %d refusals", changed, refused)
	}
}
