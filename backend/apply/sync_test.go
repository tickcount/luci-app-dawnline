package apply

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/netview"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
	"github.com/tickcount/luci-app-dawnline/backend/usage"
)

// stand is a router whose nft and awg keep what they are given, as the golden's stand-ins do.
type stand struct {
	dir              string
	present, nftFail bool
	refuse, down     map[string]bool
	scripts          []string
	confs            map[string]string
}

func (s *stand) exec(name string, args ...string) (string, int) {
	switch {
	case name == "nft" && args[0] == "-f":
		raw, _ := os.ReadFile(args[1])
		s.scripts = append(s.scripts, string(raw))
		if s.nftFail {
			return args[1] + ":1:1-5: Error: a made-up failure\n", 1
		}
		if strings.HasPrefix(string(raw), "flush set") {
			if !s.present {
				return args[1] + ":1:1-9: Error: No such file or directory\n", 1
			}
		} else {
			s.present = true
		}
		return "", 0
	case name == "nft" && args[0] == "list":
		if s.present {
			return "", 0
		}
		return "", 1
	case name == "awg" && args[0] == "show":
		if s.down[args[1]] {
			return "", 1
		}
		return "", 0
	case name == "awg" && args[0] == "syncconf":
		raw, _ := os.ReadFile(args[2])
		s.confs[args[1]] = string(raw)
		if s.refuse[args[1]] {
			return "Line unrecognized: a made-up refusal\n", 1
		}
		return "", 0
	}
	return "", 0
}

// A row of syncs of access's household, each as ucode's sync does it on the golden's router: the scripts
// loaded, each tunnel's peers, the hostnames, the states and what is answered (testdata/trace.uc).
func TestSyncAsUcode(t *testing.T) {
	raw, err := os.ReadFile("testdata/trace.json")
	if err != nil {
		t.Fatal(err)
	}
	var trace struct {
		Steps []struct {
			What      string            `json:"what"`
			Peers     map[string]string `json:"peers"`
			Table     *string           `json:"table"`
			Warning   *string           `json:"warning"`
			States    map[string]string `json:"states"`
			Scripts   []string          `json:"scripts"`
			Confs     map[string]string `json:"confs"`
			Hosts     *string           `json:"hosts"`
			HostsMode *bool             `json:"hosts_mode"`
			NftErr    *string           `json:"nft_err"`
			Present   bool              `json:"present"`
		} `json:"steps"`
	}
	if err := json.Unmarshal(raw, &trace); err != nil {
		t.Fatal(err)
	}
	if len(trace.Steps) != 9 {
		t.Fatalf("%d steps", len(trace.Steps))
	}
	text, _ := os.ReadFile("../access/testdata/access.uci")
	c, err := uci.Parse(string(text))
	if err != nil {
		t.Fatal(err)
	}
	raw, _ = os.ReadFile("../netview/testdata/trace.json")
	var router struct {
		Routes   json.RawMessage         `json:"routes"`
		Addrs    json.RawMessage         `json:"addrs"`
		Firewall string                  `json:"firewall"`
		Links    map[string]netview.Link `json:"links"`
	}
	json.Unmarshal(raw, &router)
	fw, _ := uci.Parse(router.Firewall)
	snap := netview.Take(netview.Sources{Routes: func() []byte { return router.Routes }, Addrs: func() []byte { return router.Addrs },
		Links: func() map[string]netview.Link { return router.Links }, Zones: func() netview.Zones { return netview.ZonesOf(fw) }})
	dir := t.TempDir()
	s := &stand{dir: dir, refuse: map[string]bool{}, down: map[string]bool{}}
	r := &Router{RunDir: dir, HostsFile: dir + "/hosts/dawnline", DHCP: dir + "/no-dhcp", Exec: s.exec, Snapshot: func() *netview.Snapshot { return snap }}
	str := func(p *string) string {
		if p == nil {
			return ""
		}
		return *p
	}
	for i, want := range trace.Steps {
		// what the golden does before each step
		switch i {
		case 2:
			c.Set("anna", "paused", "1")
		case 3:
			c.Delete("anna", "paused")
			s.nftFail = true
		case 4:
			s.present = false
		case 6:
			s.nftFail = false
			s.refuse["dawn0"] = true
		case 7:
			s.refuse["dawn0"] = false
			s.down["dawn1"] = true
		case 8:
			s.down["dawn1"] = false
		}
		s.scripts, s.confs = nil, map[string]string{}
		res := r.Sync(model.Load(c, nil), usage.Empty(), 1_800_000_000, false, nil)
		fail := func(what string, got, exp any) {
			t.Errorf("step %d (%s): %s\n go:    %v\n ucode: %v", i, want.What, what, got, exp)
		}
		if !reflect.DeepEqual(res.Peers, want.Peers) {
			fail("each server's devices", res.Peers, want.Peers)
		}
		if res.Table != str(want.Table) || res.Warning != str(want.Warning) {
			fail("the table and the warning", res.Table+" | "+res.Warning, str(want.Table)+" | "+str(want.Warning))
		}
		if !reflect.DeepEqual(res.States, want.States) {
			fail("the states", res.States, want.States)
		}
		if !reflect.DeepEqual(s.scripts, want.Scripts) {
			for n := range want.Scripts {
				if n >= len(s.scripts) || s.scripts[n] != want.Scripts[n] {
					fail("script "+string(rune('1'+n))+" of "+string(rune('0'+len(want.Scripts))), len(s.scripts), "differs")
					break
				}
			}
			if len(s.scripts) != len(want.Scripts) {
				fail("how many scripts were loaded", len(s.scripts), len(want.Scripts))
			}
		}
		if !reflect.DeepEqual(s.confs, want.Confs) {
			fail("the tunnels' peers", s.confs, want.Confs)
		}
		hosts, herr := os.ReadFile(r.HostsFile)
		if string(hosts) != str(want.Hosts) || (herr == nil) != (want.Hosts != nil) {
			fail("the hostnames", string(hosts), str(want.Hosts))
		}
		if st, err := os.Stat(r.HostsFile); err == nil && want.HostsMode != nil && (st.Mode().Perm()&0o004 != 0) != *want.HostsMode {
			fail("who may read the hostnames", st.Mode().Perm(), *want.HostsMode)
		}
		nftErr, eerr := os.ReadFile(dir + "/nft.err")
		if string(nftErr) != str(want.NftErr) || (eerr == nil) != (want.NftErr != nil) {
			fail("the table's error kept", string(nftErr), str(want.NftErr))
		}
		if s.present != want.Present {
			fail("whether a table is there", s.present, want.Present)
		}
		var kept map[string]string
		raw, _ := os.ReadFile(dir + "/states.json")
		json.Unmarshal(raw, &kept)
		if !reflect.DeepEqual(kept, want.States) {
			fail("the states kept", kept, want.States)
		}
	}
	// nobody's key stays on disk between syncs, nor a script
	left, _ := os.ReadDir(dir)
	for _, e := range left {
		if strings.HasSuffix(e.Name(), ".conf") || strings.HasSuffix(e.Name(), ".rules") {
			t.Errorf("%s stays in the state directory", e.Name())
		}
	}
}
