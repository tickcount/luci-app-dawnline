package methods

import (
	crand "crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"math/rand/v2"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/ipnet"
	"github.com/tickcount/luci-app-dawnline/backend/journal"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/store"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
)

const blank = " \t\r\n\v\f"

// trimmed is an argument as a trimmed string ("" for none).
func trimmed(v any) string {
	switch x := v.(type) {
	case string:
		return strings.Trim(x, blank)
	case nil:
		return ""
	}
	return strings.Trim(fmt.Sprint(v), blank)
}

// ValidName tells a name people see: 1 to 48 characters (not bytes), none of < > " \ or a control character.
func ValidName(s string) bool {
	n := 0
	for _, r := range s {
		if r == '<' || r == '>' || r == '"' || r == '\\' || r < 0x20 || r == 0x7f {
			return false
		}
		n++
	}
	return n <= 48 && strings.Trim(s, blank) != ""
}

var portDigits = regexp.MustCompile(`^[0-9]{1,5}$`)

// ValidPort tells a TCP or UDP port as typed: 1 to 65535.
func ValidPort(s string) bool {
	s = strings.Trim(s, blank)
	n, _ := strconv.Atoi(s)
	return portDigits.MatchString(s) && n >= 1 && n <= 65535
}

// taken tells an id anything in the settings has, or that is reserved.
func taken(m *model.Model, id string) bool {
	for _, r := range ReservedIDs {
		if r == id {
			return true
		}
	}
	return m.Servers[id] != nil || m.People[id] != nil || m.Devices[id] != nil || m.Services[id] != nil || m.Circles[id] != nil
}

// newID is an id from make() that no section has yet.
func newID(m *model.Model, make func() string) (string, error) {
	for i := 0; i < 20; i++ {
		if id := make(); !taken(m, id) {
			return id, nil
		}
	}
	return "", errors.New("Could not find a free id, try again.")
}

// write runs a change of the settings: written, and not yet put into effect.
func write(d Deps, fn func(c *uci.Config, m *model.Model) error) error {
	if d.Store == nil {
		return errors.New("The router is still starting. Try again in a moment.")
	}
	if err := d.Store.Transact(fn); err != nil {
		if u, unsaved := err.(store.Unsaved); unsaved {
			return said{"Couldn't save /etc/config/dawnline: %s. Is the flash full?", []any{u.Why}}
		}
		return err
	}
	return nil
}

// change runs a change of the settings and has the ucode backend put it into effect; the warning is that
// sync's, for the admin.
func change(d Deps, lang string, fn func(c *uci.Config, m *model.Model) error) (warning any, err error) {
	if err := write(d, fn); err != nil {
		return nil, err
	}
	if d.Sync != nil {
		warning = d.Sync(lang)
	}
	if d.Told != nil {
		d.Told()
	}
	return warning, nil
}

var serviceID = regexp.MustCompile(`^[A-Za-z0-9_]{1,32}$`)

// serviceSet adds a home service or changes one (dawnline.rpc.home service_set).
func serviceSet(d Deps, a map[string]any) (map[string]any, error) {
	name := trimmed(a["name"])
	if !ValidName(name) {
		return nil, errors.New(`Service: Enter a name: up to 48 characters, without < > " or \.`)
	}
	address := trimmed(a["address"])
	if _, ok := ipnet.IP(address); !ok {
		return nil, errors.New("Address must be an IPv4 address.")
	}
	var ports []string
	if list, isList := a["ports"].([]any); isList {
		for _, p := range list {
			ports = append(ports, trimmed(p))
		}
	} else {
		ports = regexp.MustCompile(`[ ,]+`).Split(trimmed(a["ports"]), -1)
	}
	kept := ports[:0]
	for _, p := range ports {
		if p == "" {
			continue
		}
		if !ValidPort(p) {
			return nil, said{"Invalid port %s.", []any{p}}
		}
		kept = append(kept, p)
	}
	id := trimmed(a["id"])
	warning, err := change(d, text(a["lang"]), func(c *uci.Config, m *model.Model) error {
		switch {
		case id == "":
			var err error
			if id, err = newID(m, func() string { return fmt.Sprintf("svc_%d", 100000+rand.IntN(900000)) }); err != nil {
				return err
			}
		case !serviceID.MatchString(id):
			return errors.New("Invalid service id.")
		// never turn a person, device, server, circle or the settings into a service
		case m.Services[id] == nil && taken(m, id):
			return errors.New("That id is taken.")
		}
		c.Add("service", id)
		c.Set(id, "name", name)
		c.Set(id, "address", address)
		if len(kept) > 0 {
			c.SetList(id, "port", kept)
		} else {
			c.Delete(id, "port")
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{"id": id, "warning": warning}, nil
}

// serviceDelete removes a home service and takes it from everyone who had it.
func serviceDelete(d Deps, id, lang string) (map[string]any, error) {
	warning, err := change(d, lang, func(c *uci.Config, m *model.Model) error {
		if m.Services[id] == nil {
			return errors.New("Unknown service.")
		}
		c.DeleteSection(id)
		for _, pid := range m.PersonIDs() {
			p := m.People[pid]
			var rest []string
			had := false
			for _, s := range p.Services {
				if s == id {
					had = true
				} else {
					rest = append(rest, s)
				}
			}
			if !had {
				continue
			}
			if len(rest) > 0 {
				c.SetList(pid, "service", rest)
			} else {
				c.Delete(pid, "service")
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{"ok": true, "warning": warning}, nil
}

// randHex is n random bytes as hex: an id's tail. A test puts its own in its place.
var randHex = func(n int) string {
	b := make([]byte, n)
	crand.Read(b)
	return hex.EncodeToString(b)
}

// lower is s with its ASCII letters in lower case, as ucode's lc() leaves it.
func lower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + 32
		}
	}
	return string(b)
}

const circleColors = 8

// circles is the circles as the settings hold them now, for a page to show after its change.
func circles(d Deps) []any {
	out := []any{}
	if _, m, err := d.Store.Read(); err == nil {
		for _, id := range m.CircleIDs() {
			out = append(out, m.Circles[id])
		}
	}
	return out
}

// circleSet creates a circle or edits one; `members` (person ids), when given, replaces who is in it
// (dawnline.rpc.home circle_set).
func circleSet(d Deps, a map[string]any) (map[string]any, error) {
	name := trimmed(a["name"])
	if !ValidName(name) || len([]rune(name)) > 32 {
		return nil, errors.New(`Enter a circle name: up to 32 characters, without < > " or \.`)
	}
	id := text(a["id"])
	edit, serverName := false, ""
	warning, err := change(d, text(a["lang"]), func(c *uci.Config, m *model.Model) error {
		ci := m.Circles[id]
		if id != "" && ci == nil {
			return errors.New("Unknown circle.")
		}
		server := text(a["server"])
		if ci != nil {
			server = ci.Server
		}
		if m.Servers[server] == nil {
			return errors.New("Unknown server.")
		}
		for _, oid := range m.CircleIDs() {
			if o := m.Circles[oid]; oid != id && o.Server == server && lower(o.Name) == lower(name) {
				return said{"%s already exists.", []any{name}}
			}
		}
		if ci == nil {
			var err error
			if id, err = newID(m, func() string { return "c_" + randHex(4) }); err != nil {
				return err
			}
		}
		color := ((int(num(a["color"])) % circleColors) + circleColors) % circleColors
		c.Add("circle", id)
		c.Set(id, "server", server)
		c.Set(id, "name", name)
		c.Set(id, "color", strconv.Itoa(color))
		if list, given := a["members"].([]any); given {
			want := map[string]bool{}
			for _, pid := range list {
				if p := m.People[text(pid)]; p != nil && p.Server == server {
					want[text(pid)] = true
				}
			}
			for _, pid := range m.PersonIDs() {
				if want[pid] {
					c.Set(pid, "circle", id)
				} else if m.People[pid].Circle == id {
					c.Delete(pid, "circle")
				}
			}
		}
		edit, serverName = ci != nil, m.Servers[server].Name
		return nil
	})
	if err != nil {
		return nil, err
	}
	if d.Log != nil {
		msg := "added"
		if edit {
			msg = "changed"
		}
		d.Log.Admin("awg", msg, "circle", name, serverName)
	}
	return map[string]any{"id": id, "circles": circles(d), "warning": warning}, nil
}

// circleDelete removes a circle and takes everyone out of it.
func circleDelete(d Deps, id, lang string) (map[string]any, error) {
	name, serverName := "", ""
	warning, err := change(d, lang, func(c *uci.Config, m *model.Model) error {
		ci := m.Circles[id]
		if ci == nil {
			return errors.New("Unknown circle.")
		}
		c.DeleteSection(id)
		for _, pid := range m.PersonIDs() {
			if m.People[pid].Circle == id {
				c.Delete(pid, "circle")
			}
		}
		name = ci.Name
		if srv := m.Servers[ci.Server]; srv != nil {
			serverName = srv.Name
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if d.Log != nil {
		d.Log.Admin("awg", "removed", "circle", name, serverName)
	}
	return map[string]any{"circles": circles(d), "warning": warning}, nil
}

// logged puts events in the activity log and, those about the system, in syslog (dawnline.live add_events):
// each with the names it carries, as the settings have them now.
func logged(d Deps, events ...journal.Event) {
	if d.Store == nil {
		return
	}
	_, m, err := d.Store.Read()
	if err != nil {
		return
	}
	names := journal.NamesOf(m)
	for _, e := range events {
		journal.Named(e, names)
		if lvl := journal.Level(e); lvl != "" && d.Log != nil {
			kind, _ := e["type"].(string)
			d.Log.Say(lvl, journal.CategoryOf(kind), journal.Line(e))
		}
	}
	journal.Log{Run: d.RunDir, Data: d.DataDir}.Add(events, journal.PolicyOf(m.Settings.Retention), names, time.Now().Unix())
}

// personPause pauses a person, or lets them on again.
func personPause(d Deps, id string, paused bool, lang string) (map[string]any, error) {
	warning, err := change(d, lang, func(c *uci.Config, m *model.Model) error {
		if m.People[id] == nil {
			return errors.New("Unknown person.")
		}
		if paused {
			c.Set(id, "paused", "1")
		} else {
			c.Delete(id, "paused")
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	kind := "resumed"
	if paused {
		kind = "paused"
	}
	logged(d, journal.Event{"type": kind, "person": id, "by": "admin"})
	if d.Told != nil {
		d.Told()
	}
	return map[string]any{"warning": warning}, nil
}

// personDelete removes a person and their devices. The event carries their name: the log still reads well
// once they are gone.
func personDelete(d Deps, id, lang string) (map[string]any, error) {
	name := ""
	warning, err := change(d, lang, func(c *uci.Config, m *model.Model) error {
		p := m.People[id]
		if p == nil {
			return errors.New("Unknown person.")
		}
		for _, dev := range p.Devices {
			c.DeleteSection(dev)
		}
		c.DeleteSection(id)
		name = p.Name
		return nil
	})
	if err != nil {
		return nil, err
	}
	logged(d, journal.Event{"type": "person_removed", "person": id, "detail": name, "pname": name, "by": "admin"})
	if d.Told != nil {
		d.Told()
	}
	return map[string]any{"warning": warning}, nil
}
