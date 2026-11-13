package github

import (
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestPoints(t *testing.T) {
	for msg, want := range map[string][]string{
		"Dawnline 0.3.1\n\n- one thing\n- another,\n  wrapped onto a line\n\n* a third\ntrailing words": {"one thing", "another, wrapped onto a line", "a third"},
		"Fix the portal's port":             {"Fix the portal's port"},
		"Merge branch 'main' into x\n\n- a": {},
		"v0.4.0":                            {},
		"Dawnline 0.3":                      {},
		"":                                  {},
		"A title\n\nwords, no points":       {"A title"},
	} {
		if got := Points(msg); !reflect.DeepEqual(got, want) {
			t.Errorf("%q: %q", msg, got)
		}
	}
}

func TestReleasesAndTheCache(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	asked := 0
	answers := map[string]struct {
		status int
		body   string
	}{
		"https://api.github.com/repos/o/r/releases?per_page=5&page=1": {200, `[{"tag_name":"v2","name":null,"prerelease":true,"html_url":"u","body":"notes","published_at":"2027-01-01T00:00:00Z",
			"assets":[{"name":"a.apk","id":77,"digest":"sha256:` + strings.Repeat("ab", 32) + `"},{"name":"b.txt","id":78,"digest":"md5:x"}]},{"tag_name":"draft","draft":true},{"tag_name":"v1"}]`},
		"https://api.github.com/repos/o/r/releases/tags/v2":      {200, `{"tag_name":"v2","body":"` + strings.Repeat("x", 13000) + `"}`},
		"https://api.github.com/repos/o/r/releases/tags/v9":      {404, `{"message":"Not Found"}`},
		"https://api.github.com/repos/o/r/releases/tags/limited": {403, `{"message":"API rate limit exceeded"}`},
		"https://api.github.com/repos/o/r/releases/tags/broken":  {500, `{"message":"Server Error"}`},
		"https://api.github.com/repos/o/r/compare/v1...v2":       {200, `{"commits":[{"commit":{"message":"older"}},{"commit":{"message":"Dawnline 2\n\n- newer a\n- newer b"}}]}`},
		"https://api.github.com/repos/o/r/commits/v2":            {200, `{"commit":{"message":"Dawnline 2\n\n- its own"}}`},
	}
	c := &Client{RunDir: t.TempDir(), Now: func() time.Time { return now }, Get: func(url string) (int, []byte) {
		asked++
		a := answers[url]
		return a.status, []byte(a.body)
	}}
	rel, err := c.Releases("o/r", 1)
	if err != nil || len(rel) != 2 {
		t.Fatalf("releases: %v %v", rel, err)
	}
	first := rel[0].(map[string]any)
	if first["tag"] != "v2" || first["name"] != "v2" || first["prerelease"] != true || !reflect.DeepEqual(first["assets"], []any{"a.apk", "b.txt"}) ||
		!reflect.DeepEqual(first["digests"], map[string]any{"a.apk": strings.Repeat("ab", 32)}) || len(first["ids"].(map[string]any)) != 2 {
		t.Fatalf("a release: %v", first)
	}
	// kept ten minutes, then asked again; with no answer the second time, the old one stands
	c.Releases("o/r", 1)
	if asked != 1 {
		t.Fatal("asked again within ten minutes")
	}
	now = now.Add(11 * time.Minute)
	delete(answers, "https://api.github.com/repos/o/r/releases?per_page=5&page=1")
	if rel, _ := c.Releases("o/r", 1); asked != 2 || len(rel) != 2 {
		t.Fatalf("with GitHub out of reach: asked %d, %d releases", asked, len(rel))
	}
	if r, _ := c.Release("o/r", "v2"); len(r["body"].(string)) != 12000 {
		t.Fatal("the notes are not cut")
	}
	if r, err := c.Release("o/r", "v9"); r != nil || err != nil {
		t.Fatalf("no such release: %v %v", r, err)
	}
	if _, err := c.Release("o/r", "limited"); err == nil || err.Error() != "GitHub API rate limit reached: try again in an hour." {
		t.Fatalf("a rate limit: %v", err)
	}
	if _, err := c.Release("o/r", "broken"); err == nil || err.Error() != "GitHub: Server Error" {
		t.Fatalf("an API error: %v", err)
	}
	if ch, _ := c.Changes("o/r", "v1", "v2"); !reflect.DeepEqual(ch, []any{"newer a", "newer b", "older"}) {
		t.Fatalf("changes between tags: %v", ch)
	}
	if ch, _ := c.Changes("o/r", "", "v2"); !reflect.DeepEqual(ch, []any{"its own"}) {
		t.Fatalf("a release's own changes: %v", ch)
	}
}
