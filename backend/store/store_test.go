package store

import (
	"errors"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
)

const file = "\nconfig settings 'settings'\n\toption portal_port '4500'\n\nconfig server 'home'\n\toption name 'Home'\n\n"

func TestTransact(t *testing.T) {
	dir := t.TempDir()
	s := Store{Config: dir + "/dawnline", RunDir: dir + "/run"}
	os.WriteFile(s.Config, []byte(file), 0o644)
	// a change that fails leaves the file as it was
	refused := errors.New("Unknown person.")
	if err := s.Transact(func(c *uci.Config, m *model.Model) error {
		c.Set("home", "name", "Changed")
		return refused
	}); err != refused {
		t.Fatalf("the refusal: %v", err)
	}
	if raw, _ := os.ReadFile(s.Config); string(raw) != file {
		t.Fatalf("a refused change was written:\n%s", raw)
	}
	// one that passes is written whole, against the model as it was, private to root
	if err := s.Transact(func(c *uci.Config, m *model.Model) error {
		if m.Servers["home"].Name != "Home" || m.Settings.PortalPort != 4500 {
			t.Errorf("the model inside: %+v", m.Servers["home"])
		}
		c.Set("home", "name", "Cabin")
		c.Add("person", "anna")
		c.Set("anna", "server", "home")
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(s.Config)
	want := "\nconfig settings 'settings'\n\toption portal_port '4500'\n\nconfig server 'home'\n\toption name 'Cabin'\n\nconfig person 'anna'\n\toption server 'home'\n\n"
	if st, _ := os.Stat(s.Config); string(raw) != want || st.Mode().Perm() != 0o600 {
		t.Fatalf("written (%v):\n%s", st.Mode().Perm(), raw)
	}
	left, _ := os.ReadDir(dir)
	for _, e := range left {
		if strings.HasPrefix(e.Name(), ".") {
			t.Fatalf("a temporary file stays: %s", e.Name())
		}
	}
	// writers wait for each other: none works on another's stale settings
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			s.Transact(func(c *uci.Config, m *model.Model) error {
				n, _ := c.Section("settings").Get("count")
				c.Set("settings", "count", n+"x")
				return nil
			})
		}()
	}
	wg.Wait()
	c, _, _ := s.Read()
	if n, _ := c.Section("settings").Get("count"); len(n) != 20 {
		t.Fatalf("twenty writers left %q", n)
	}
	// a directory that cannot be written: told as ucode tells it, the file untouched
	gone := Store{Config: dir + "/nowhere/dawnline", RunDir: dir + "/run"}
	err := gone.Transact(func(*uci.Config, *model.Model) error { return nil })
	if _, unsaved := err.(Unsaved); !unsaved || !strings.HasPrefix(err.Error(), "Couldn't save /etc/config/dawnline: ") {
		t.Fatalf("a write that fails: %v", err)
	}
}
