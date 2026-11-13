package bridge

import (
	"os"
	"testing"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/hub"
)

// The topics are told again when somebody starts to look, when the settings change and with the minute,
// and not otherwise; the backend's own topic says it is well.
func TestToldWhenDue(t *testing.T) {
	dir := t.TempDir()
	conf := dir + "/dawnline"
	os.WriteFile(conf, []byte("a"), 0o600)
	h := hub.New()
	told := 0
	b := New(Bridge{Hub: h, Log: func(string, ...any) {}, Watch: []string{conf}, Tell: func() bool { told++; return true }})
	b.wasAbsent = true
	b.status()
	b.status()
	if told != 1 {
		t.Fatalf("the first look: told %d times", told)
	}
	time.Sleep(10 * time.Millisecond)
	os.WriteFile(conf, []byte("bb"), 0o600)
	b.status()
	b.status()
	if told != 2 {
		t.Fatalf("after the settings changed: told %d times", told)
	}
	b.told = time.Now().Add(-2 * Refresh)
	b.status()
	if told != 3 {
		t.Fatalf("a minute later: told %d times", told)
	}
	if doc, ok := h.Sync("", 0, nil).Docs["backend"].(map[string]any); !ok || doc["ok"] != true {
		t.Errorf("the backend's own topic: %v", h.Sync("", 0, nil).Docs["backend"])
	}
	// a stand with nobody to make the topics tells nothing
	quiet := New(Bridge{Hub: hub.New(), Watch: []string{conf}})
	quiet.wasAbsent = true
	quiet.status()
}

// Topics that could not be made yet (the backend just started: the settings are not read) stay due: they
// are asked for again with the next second, not after Refresh, and until then the backend's own topic does
// not say that they are there.
func TestStaysDueUntilTold(t *testing.T) {
	h := hub.New()
	asked, ready := 0, false
	b := New(Bridge{Hub: h, Tell: func() bool { asked++; return ready }})
	b.wasAbsent = true
	b.status()
	b.status()
	if asked != 2 {
		t.Fatalf("not told yet: asked %d times", asked)
	}
	if doc, there := h.Sync("", 0, nil).Docs["backend"]; there {
		t.Fatalf("the backend's own topic before any was made: %v", doc)
	}
	ready = true
	b.status()
	b.status()
	if asked != 3 {
		t.Fatalf("once told: asked %d times", asked)
	}
	if _, there := h.Sync("", 0, nil).Docs["backend"]; !there {
		t.Fatal("told, and the backend's own topic is not there")
	}
	// the same when they are due by their age
	ready = false
	b.told = time.Now().Add(-2 * Refresh)
	b.status()
	b.status()
	if asked != 5 {
		t.Fatalf("due by age and not told: asked %d times", asked)
	}
}
