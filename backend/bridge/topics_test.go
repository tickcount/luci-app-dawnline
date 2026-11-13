package bridge

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func doc(s string) map[string]any {
	var v map[string]any
	if err := json.Unmarshal([]byte(s), &v); err != nil {
		panic(err)
	}
	return v
}

// Lists of things with ids become keyed lists, at any depth; the rest stays.
func TestSplit(t *testing.T) {
	got := Split(doc(`{
		"version": "0.18.0", "now": 1700000000, "tz": "MSK-3", "hostname": "Outline",
		"servers": [{"id": "s1", "name": "Home", "series": [1, 2]}],
		"people": [
			{"id": "p1", "name": "Myata", "devices": [{"id": "d1", "online": true}, {"id": "d2", "online": false}]},
			{"id": "p2", "name": "Guest", "devices": []}
		],
		"circles": [], "services": [],
		"totals": {"rx": 1}, "series": [{"day": "2026-11-11", "rx": 1, "tx": 2}],
		"geo": {"enabled": true, "home": null, "points": [{"ip": "203.0.113.7"}]},
		"events": [{"ts": 1, "type": "connect"}]
	}`))
	want := doc(`{
		"router": {"version": "0.18.0", "hostname": "Outline"},
		"clock": {"now": 1700000000, "tz": "MSK-3"},
		"servers": {"order": ["s1"], "items": {"s1": {"id": "s1", "name": "Home", "series": [1, 2]}}},
		"people": {"order": ["p1", "p2"], "items": {
			"p1": {"id": "p1", "name": "Myata", "devices": {"order": ["d1", "d2"], "items": {"d1": {"id": "d1", "online": true}, "d2": {"id": "d2", "online": false}}}},
			"p2": {"id": "p2", "name": "Guest", "devices": []}
		}},
		"circles": {"order": [], "items": {}}, "services": {"order": [], "items": {}},
		"traffic": {"totals": {"rx": 1}, "series": {"order": ["2026-11-11"], "items": {"2026-11-11": {"day": "2026-11-11", "rx": 1, "tx": 2}}}},
		"places": {"enabled": true, "home": {"$null": true}, "points": [{"ip": "203.0.113.7"}]},
		"recent": [{"ts": 1, "type": "connect"}]
	}`)
	if !reflect.DeepEqual(got, map[string]any(want)) {
		g, _ := json.MarshalIndent(got, "", " ")
		t.Fatalf("got %s", g)
	}
}

// Two entries with one id, or one without: the list is left as it came.
func TestKeyedRefuses(t *testing.T) {
	for _, s := range []string{`{"l":[{"id":"a"},{"id":"a"}]}`, `{"l":[{"id":"a"},{"name":"b"}]}`, `{"l":[{"id":1}]}`, `{"l":[1,2]}`} {
		in := doc(s)
		if _, isList := rekey(in).(map[string]any)["l"].([]any); !isList {
			t.Fatalf("%s was keyed", s)
		}
	}
}

// The fixture the page's side reads too (web/tests/stream.test.ts joins testdata/topics.json back into
// testdata/status.json): what Split makes of a whole status answer. Run with UPDATE=1 to write it anew
// after Split changed, and look at the difference.
func TestSplitFixture(t *testing.T) {
	raw, err := os.ReadFile("testdata/status.json")
	if err != nil {
		t.Fatal(err)
	}
	var status map[string]any
	if err := json.Unmarshal(raw, &status); err != nil {
		t.Fatal(err)
	}
	got, err := json.MarshalIndent(Split(status), "", " ")
	if err != nil {
		t.Fatal(err)
	}
	if os.Getenv("UPDATE") != "" {
		if err := os.WriteFile("testdata/topics.json", append(got, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	want, err := os.ReadFile("testdata/topics.json")
	if err != nil {
		t.Fatal(err)
	}
	if string(got)+"\n" != string(want) {
		t.Fatal("Split no longer makes testdata/topics.json of testdata/status.json: UPDATE=1 writes it anew, and web/src/admin/state/join.ts must still join it back")
	}
}
