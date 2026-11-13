package methods

import (
	"os"
	"strings"
	"testing"

	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/store"
	"github.com/tickcount/luci-app-dawnline/backend/view"
)

// Removing Dawnline: only on the word, a backup first, the settings left with their own section alone,
// the router cleaned from the settings as they were, the service stopped last.
func TestUninstall(t *testing.T) {
	dir := t.TempDir()
	text, _ := os.ReadFile("../access/testdata/access.uci")
	os.WriteFile(dir+"/dawnline", text, 0o600)
	var order []string
	var servers int
	d := Deps{World: func() *view.World { return &view.World{} }, Store: &store.Store{Config: dir + "/dawnline", RunDir: dir}, Config: dir + "/dawnline", RunDir: dir, DataDir: dir + "/data",
		Teardown: func(m *model.Model) {
			servers = len(m.Servers)
			now, _ := os.ReadFile(dir + "/dawnline")
			if strings.Contains(string(now), "config server") {
				t.Error("the router is cleaned while the settings still hold servers")
			}
			order = append(order, "teardown")
		},
		Stop: func() { order = append(order, "stop") }}
	if res := ask(t, d, "uninstall", map[string]any{"confirm": "yes"}); res["error"] != `Type "remove" to confirm.` || len(order) != 0 {
		t.Fatalf("removed without the word: %v", res)
	}
	if now, _ := os.ReadFile(dir + "/dawnline"); string(now) != string(text) {
		t.Fatal("the settings changed without the word")
	}
	res := ask(t, d, "uninstall", map[string]any{"confirm": "remove"})
	if res["ok"] != true || strings.Join(order, " ") != "teardown stop" || servers != 3 {
		t.Fatalf("not removed as it should be: %v, %v, %d servers", res, order, servers)
	}
	now, _ := os.ReadFile(dir + "/dawnline")
	if strings.Count(string(now), "\nconfig ") != 1 || !strings.Contains(string(now), "config settings 'settings'") || !strings.Contains(string(now), "option portal_enabled '0'") {
		t.Errorf("the settings after:\n%s", now)
	}
	backups, _ := os.ReadDir(dir + "/data/backups")
	found := false
	for _, b := range backups {
		found = found || strings.Contains(b.Name(), "pre-remove")
	}
	if !found {
		t.Errorf("no backup before the removal: %v", backups)
	}
}
