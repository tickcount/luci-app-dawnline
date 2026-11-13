package methods

import (
	crand "crypto/rand"
	"errors"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/handout"
	"github.com/tickcount/luci-app-dawnline/backend/i18n"
	"github.com/tickcount/luci-app-dawnline/backend/ipnet"
	"github.com/tickcount/luci-app-dawnline/backend/journal"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
	"github.com/tickcount/luci-app-dawnline/backend/usage"
	"github.com/tickcount/luci-app-dawnline/backend/view"
	"github.com/tickcount/luci-app-dawnline/backend/zone"
)

// personFields are what person_update takes as strings ("" clears an optional one), in the order they are
// applied and told; a name and a move are one person at a time.
var personFields = []string{"name", "access", "device_limit", "expires", "quota_gb", "quota_period", "bonus_gb", "note", "dns_mode", "server"}

// fields is a person's changes from a call's arguments: the known ones that are given, and their names in
// the order ucode keeps them (the fields, then paused, services, circle, home_nets).
func fieldsOf(a map[string]any) (f map[string]any, order []string) {
	f = map[string]any{}
	take := func(k string) {
		f[k] = a[k]
		order = append(order, k)
	}
	for _, k := range personFields {
		if a[k] != nil {
			take(k)
		}
	}
	if a["paused"] != nil {
		take("paused")
	}
	if _, list := a["services"].([]any); list {
		take("services")
	}
	if a["circle"] != nil {
		take("circle")
	}
	if _, list := a["home_nets"].([]any); list {
		take("home_nets")
	}
	return f, order
}

// number reads a value as ucode's unary plus does: a whole number (decimal or 0x…), or one with a
// fraction or an exponent, blanks around it allowed. ok is false for anything else, and for none.
func number(v any) (float64, bool) {
	switch x := v.(type) {
	case string:
		s := strings.Trim(x, blank)
		if s == "" {
			return 0, false
		}
		if n, err := strconv.ParseInt(s, 0, 64); err == nil && !strings.HasPrefix(strings.TrimLeft(s, "+-"), "0b") && !strings.HasPrefix(strings.TrimLeft(s, "+-"), "0o") {
			return float64(n), true
		}
		if strings.ContainsAny(s, "nNiIxXpP_") {
			return 0, false
		}
		n, err := strconv.ParseFloat(s, 64)
		return n, err == nil
	case nil:
		return 0, false
	}
	return num(v), true
}

// str is a value as ucode writes it into a string: a whole number plainly, another as C's %g does.
func str(n float64) string {
	if n == math.Trunc(n) && math.Abs(n) < 1e15 {
		return strconv.FormatInt(int64(n), 10)
	}
	return strconv.FormatFloat(n, 'g', -1, 64)
}

// validDate tells YYYY-MM-DD, and a day that exists (2026-02-30 does not).
func validDate(s string) bool {
	t, err := time.ParseInLocation("2006-01-02", s, zone.Local())
	return err == nil && len(s) == 10 && t.Format("2006-01-02") == s
}

const ifaceChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.@-"

// allocAddress is the first free address in a server's tunnel network (the router has the first), or "".
func allocAddress(m *model.Model, srv *model.Server, serverOf func(*model.Person) string, addressOf func(*model.Device) string) string {
	t, ok := ipnet.Subnet(srv.Subnet)
	if !ok {
		return ""
	}
	used := map[uint32]bool{t.First(): true}
	for _, id := range m.DeviceIDs() {
		d := m.Devices[id]
		if p := m.People[d.Person]; p != nil && serverOf(p) == srv.ID {
			if n, ok := ipnet.IP(addressOf(d)); ok {
				used[n] = true
			}
		}
	}
	last := uint32(uint64(t.Base) + t.Size() - 2)
	for n := t.First() + 1; n <= last; n++ {
		if !used[n] {
			return ipnet.String(n)
		}
	}
	return ""
}

// updatePerson changes a person in the settings: only the fields given, "" clearing an optional one
// (dawnline.core update_person). A value that is refused leaves everything as it was (the caller's
// transaction writes nothing). t words the one refusal that counts devices.
func updatePerson(c *uci.Config, m *model.Model, id string, f map[string]any, records *usage.Usage, t *i18n.Catalog) error {
	p := m.People[id]
	if p == nil {
		return errors.New("Unknown person.")
	}
	set := func(k, v string) {
		if v == "" {
			c.Delete(id, k)
		} else {
			c.Set(id, k, v)
		}
	}
	given := func(k string) (string, bool) {
		v, has := f[k]
		if !has || v == nil {
			return "", false
		}
		if s, isString := v.(string); isString {
			return s, true
		}
		return str(num(v)), true
	}
	if v, ok := given("name"); ok {
		if !ValidName(v) {
			return errors.New(`Enter a name: up to 48 characters, without < > " or \.`)
		}
		set("name", strings.Trim(v, blank))
	}
	if v, ok := given("access"); ok {
		if v != "lan" && v != "internet" && v != "both" {
			return errors.New("Access must be lan, internet or both.")
		}
		set("access", v)
	}
	if _, ok := given("device_limit"); ok {
		x, _ := number(f["device_limit"])
		n := int(x)
		if n < 1 || n > 32 {
			return errors.New("Device limit must be between 1 and 32.")
		}
		if have := len(p.Devices); n < have {
			return said{t.N(int64(have), "%s already has %d device. Remove one first to lower the limit to %d.",
				"%s already has %d devices. Remove one first to lower the limit to %d."), []any{p.Name, have, n}}
		}
		set("device_limit", strconv.Itoa(n))
	}
	if v, ok := given("expires"); ok {
		if v != "" && !validDate(v) {
			return errors.New("End date must be YYYY-MM-DD.")
		}
		set("expires", v)
	}
	if v, ok := given("dns_mode"); ok {
		if v != "device" && v != "home" {
			return errors.New("Unknown DNS choice.")
		}
		if v == "device" {
			v = ""
		}
		set("dns_mode", v)
	}
	if v, ok := given("quota_gb"); ok {
		q, isNumber := number(f["quota_gb"])
		if !isNumber {
			q = -1
		}
		if v != "" && (q < 0 || q > 100000) {
			return errors.New("Data limit must be a positive number of GB.")
		}
		if q > 0 {
			set("quota_gb", str(q))
		} else {
			set("quota_gb", "")
		}
	}
	if v, ok := given("quota_period"); ok {
		if v != "total" {
			v = ""
		}
		set("quota_period", v)
	}
	if _, ok := given("bonus_gb"); ok {
		b, isNumber := number(f["bonus_gb"])
		if !isNumber || b < 0 || b > 100000 {
			return errors.New("Extra data must be a positive number of GB.")
		}
		if b > 0 {
			set("bonus_gb", str(b))
			// it lasts until their limit month ends (none running: a month from now)
			now := time.Now().Unix()
			from := now
			if records != nil {
				if lm := usage.LimitMonth(records.People[id], now); lm != nil {
					from = int64(lm.Start)
				}
			}
			set("bonus_until", strconv.FormatInt(usage.MonthAfter(from), 10))
		} else {
			set("bonus_gb", "")
			set("bonus_until", "")
		}
		set("bonus_month", "")
	}
	if v, ok := given("note"); ok {
		note := []rune(strings.Trim(v, blank))
		if len(note) > 500 {
			note = note[:500]
		}
		set("note", string(note))
	}
	if list, ok := f["services"].([]any); ok {
		var ids []string
		for _, s := range list {
			sid := text(s)
			if m.Services[sid] == nil {
				return said{"Unknown service %s.", []any{sid}}
			}
			ids = append(ids, sid)
		}
		if len(ids) > 0 {
			c.SetList(id, "service", ids)
		} else {
			c.Delete(id, "service")
		}
	}
	if v, ok := given("circle"); ok {
		if ci := m.Circles[v]; v != "" && (ci == nil || ci.Server != p.Server) {
			return errors.New("Unknown circle.")
		}
		set("circle", v)
	}
	// another server: every device gets an address in its tunnel (so each needs its configuration again);
	// circles and home networks are the old server's and go
	if v, ok := given("server"); ok && v != "" && v != p.Server {
		srv := m.Servers[v]
		if srv == nil {
			return errors.New("Unknown server.")
		}
		set("server", v)
		moved := map[string]string{}
		serverOf := func(q *model.Person) string {
			if q.ID == id {
				return v
			}
			return q.Server
		}
		addressOf := func(d *model.Device) string {
			if a, has := moved[d.ID]; has {
				return a
			}
			return d.Address
		}
		for _, did := range p.Devices {
			addr := allocAddress(m, srv, serverOf, addressOf)
			if addr == "" {
				return said{"No free address left on %s.", []any{srv.Name}}
			}
			moved[did] = addr
			c.Set(did, "address", addr)
		}
		c.Delete(id, "circle")
		c.Delete(id, "home_net")
	}
	if list, ok := f["home_nets"].([]any); ok {
		var nets []string
		seen := map[string]bool{}
		for _, x := range list {
			n := trimmed(x)
			if n == "" || len(n) > 32 || strings.Trim(n, ifaceChars) != "" || seen[n] {
				continue
			}
			seen[n] = true
			nets = append(nets, n)
		}
		if len(nets) > 0 {
			c.SetList(id, "home_net", nets)
		} else {
			c.Delete(id, "home_net")
		}
	}
	if v, has := f["paused"]; has && v != nil {
		if truthy(v) {
			set("paused", "1")
		} else {
			set("paused", "")
		}
	}
	return nil
}

// records is the watcher's counters, or nil before it has looked.
func records(d Deps) *usage.Usage {
	if w := d.World(); w != nil {
		return w.Usage
	}
	return nil
}

// merged puts an event in the activity log, folded into the last one of the same kind and person when that
// is no older than two minutes, and in syslog (dawnline.live add_event_merged).
func merged(d Deps, e journal.Event) {
	_, m, err := d.Store.Read()
	if err != nil {
		return
	}
	names := journal.NamesOf(m)
	if lvl := journal.Level(e); lvl != "" && d.Log != nil {
		line := journal.Event{}
		for k, v := range e {
			line[k] = v
		}
		kind, _ := e["type"].(string)
		d.Log.Say(lvl, journal.CategoryOf(kind), journal.Line(journal.Named(line, names)))
	}
	journal.Log{Run: d.RunDir, Data: d.DataDir}.AddMerged(e, 120, journal.PolicyOf(m.Settings.Retention), names, time.Now().Unix())
}

// personUpdate is an immediate edit from a person's page; it returns the person as the page shows them.
func personUpdate(d Deps, a map[string]any) (map[string]any, error) {
	id := text(a["id"])
	f, order := fieldsOf(a)
	t := i18n.Use(d.Catalogs, text(a["lang"]))
	var was any
	var before *model.Model
	warning, err := change(d, text(a["lang"]), func(c *uci.Config, m *model.Model) error {
		before = m
		if p := m.People[id]; p != nil {
			was = p.Access
		}
		return updatePerson(c, m, id, f, records(d), t)
	})
	if err != nil {
		return nil, err
	}
	// "moved to Test" says more than "server"
	var changes []string
	for _, k := range order {
		switch {
		case k == "note":
		case k == "server" && before.Servers[text(f["server"])] != nil:
			changes = append(changes, "moved to "+before.Servers[text(f["server"])].Name)
		default:
			changes = append(changes, k)
		}
	}
	if len(changes) > 0 {
		merged(d, journal.Event{"type": "person_changed", "person": id, "detail": strings.Join(changes, ", "), "by": "admin"})
	}
	if d.Told != nil {
		d.Told()
	}
	var person any
	if w := d.World(); w != nil && w.M != nil && w.M.People[id] != nil {
		person = w.PersonOf(w.M.People[id], true)
	}
	return map[string]any{"person": person, "was": was, "warning": warning}, nil
}

// bulkMax is how many people one people_update changes at most.
const bulkMax = 500

// peopleUpdate changes several people at once (People's picks: extend, pause, resume, and their undo):
// `list` is [{ id, patch }] with person_update's fields. All or nothing: one transaction, one apply.
func peopleUpdate(d Deps, a map[string]any) (map[string]any, error) {
	list, _ := a["list"].([]any)
	if len(list) == 0 {
		return nil, errors.New("Nothing to change.")
	}
	if len(list) > bulkMax {
		return nil, said{"At most %d people at once.", []any{bulkMax}}
	}
	type one struct {
		id    string
		f     map[string]any
		order []string
	}
	var todo []one
	seen := map[string]bool{}
	for _, x := range list {
		o, _ := x.(map[string]any)
		id, isString := o["id"].(string)
		if !isString || id == "" || len(id) > 64 {
			return nil, errors.New("Each change needs the id of a person.")
		}
		if seen[id] {
			return nil, said{"%s is in the list twice.", []any{id}}
		}
		seen[id] = true
		patch, _ := o["patch"].(map[string]any)
		if len(patch) == 0 {
			return nil, said{"Nothing to change for %s.", []any{id}}
		}
		for k, v := range patch {
			if k == "paused" {
				if _, isBool := v.(bool); !isBool {
					return nil, errors.New("Paused must be true or false.")
				}
				continue
			}
			known := false
			for _, pf := range personFields {
				known = known || pf == k
			}
			if !known || k == "name" || k == "server" {
				return nil, said{"%s cannot be changed for several people at once.", []any{k}}
			}
			switch v.(type) {
			case string, int, int32, int64, float64:
			default:
				return nil, said{"%s must be a value, not a list.", []any{k}}
			}
		}
		f, order := fieldsOf(patch)
		todo = append(todo, one{id, f, order})
	}
	t := i18n.Use(d.Catalogs, text(a["lang"]))
	was := map[string]bool{}
	warning, err := change(d, text(a["lang"]), func(c *uci.Config, m *model.Model) error {
		for _, x := range todo {
			if p := m.People[x.id]; p != nil {
				was[x.id] = p.Paused
			}
			if err := updatePerson(c, m, x.id, x.f, records(d), t); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	for _, x := range todo {
		if v, has := x.f["paused"]; has && truthy(v) != was[x.id] {
			kind := "resumed"
			if truthy(v) {
				kind = "paused"
			}
			logged(d, journal.Event{"type": kind, "person": x.id, "by": "admin"})
		}
		var changes []string
		for _, k := range x.order {
			if k != "note" && k != "paused" {
				changes = append(changes, k)
			}
		}
		if len(changes) > 0 {
			merged(d, journal.Event{"type": "person_changed", "person": x.id, "detail": strings.Join(changes, ", "), "by": "admin"})
		}
	}
	if d.Told != nil {
		d.Told()
	}
	return map[string]any{"changed": len(todo), "warning": warning}, nil
}

var _ = view.Person{}

// clock is the moment a change is made at. A test puts its own in its place.
var clock = func() int64 { return time.Now().Unix() }

// NewCode draws a personal code (for the steps that replace older ones).
func NewCode() string { return newCode() }

// newCode is a personal code: three pronounceable words of three syllables each (kamiro-telosu-bavine),
// easy to read out or type; the code is the whole link path. A test puts its own in its place.
var newCode = func() string {
	const consonants, vowels = "bdfgklmnprstvz", "aeiou"
	pick := func(alphabet string) byte {
		n := len(alphabet)
		lim := 256 - 256%n
		for {
			var b [1]byte
			crand.Read(b[:])
			if int(b[0]) < lim {
				return alphabet[int(b[0])%n]
			}
		}
	}
	for {
		words := make([]string, 3)
		for w := range words {
			var s []byte
			for i := 0; i < 3; i++ {
				s = append(s, pick(consonants), pick(vowels))
			}
			words[w] = string(s)
		}
		code := strings.Join(words, "-")
		bad := false
		for _, x := range []string{"suka", "pido", "muda", "zalup", "dura", "gavn"} {
			bad = bad || strings.Contains(code, x)
		}
		if !bad {
			return code
		}
	}
}

var (
	notLowerAlnum = regexp.MustCompile(`[^a-z0-9]+`)
	personID      = regexp.MustCompile(`^[a-z0-9_]{1,32}$`)
)

// slugify turns a display name into an id to start from ("Мама Таня" → "mama-tanya"), "user" for nothing.
func slugify(s string) string {
	out := notLowerAlnum.ReplaceAllString(lower(handout.Translit(strings.Trim(s, blank))), "-")
	out = strings.Trim(out, "-")
	if len(out) > 32 {
		out = out[:32]
	}
	if out == "" {
		return "user"
	}
	return out
}

// link is a person's main link, or nil when the portal would not answer it.
func link(m *model.Model, id string) any {
	p := m.People[id]
	hosts := view.PortalHosts(m)
	if p == nil || len(hosts) == 0 {
		return nil
	}
	return orNull(view.PortalLink(m, p, hosts[0]))
}

// personCreate adds a person (dawnline.core create_person): an id from their name, a personal code.
func personCreate(d Deps, a map[string]any) (map[string]any, error) {
	name := trimmed(a["name"])
	id := ""
	err := write(d, func(c *uci.Config, m *model.Model) error {
		if !ValidName(name) {
			return errors.New(`Enter a name: up to 48 characters, without < > " or \.`)
		}
		// the id is a section's name: letters, digits and underscores only; repeated names get _2, _3, …
		base := trimmed(a["slug"])
		if base == "" {
			base = slugify(name)
		}
		base = strings.ReplaceAll(base, "-", "_")
		if !personID.MatchString(base) {
			return errors.New("The id may use lowercase letters, digits and underscores.")
		}
		id = base
		for n := 2; taken(m, id); n++ {
			if n > 99 {
				return said{`"%s" is already taken.`, []any{base}}
			}
			id = base[:min(len(base), 28)] + "_" + strconv.Itoa(n)
		}
		server := trimmed(a["server"])
		if ids := m.ServerIDs(); server == "" && len(ids) > 0 {
			server = ids[0]
		}
		if m.Servers[server] == nil {
			return errors.New("Set up a server first.")
		}
		access := "internet"
		if a["access"] != nil {
			access = text(a["access"])
		}
		if access != "lan" && access != "internet" && access != "both" {
			return errors.New("Access must be lan, internet or both.")
		}
		limit := m.Settings.DefaultDeviceLimit
		if v := trimmed(a["device_limit"]); v != "" {
			if x, ok := number(v); ok {
				limit = int(x)
			}
		}
		if limit < 1 || limit > 32 {
			return errors.New("Device limit must be between 1 and 32.")
		}
		expires := trimmed(a["expires"])
		if expires != "" && !validDate(expires) {
			return errors.New("End date must be YYYY-MM-DD.")
		}
		quota, _ := number(trimmed(a["quota_gb"]))
		if quota < 0 || quota > 100000 {
			return errors.New("Monthly data must be a positive number of GB.")
		}
		now := strconv.FormatInt(clock(), 10)
		c.Add("person", id)
		c.Set(id, "server", server)
		c.Set(id, "name", name)
		c.Set(id, "access", access)
		c.Set(id, "device_limit", strconv.Itoa(limit))
		c.Set(id, "code", newCode())
		c.Set(id, "code_set", now)
		c.Set(id, "created", now)
		if expires != "" {
			c.Set(id, "expires", expires)
		}
		if quota > 0 {
			c.Set(id, "quota_gb", str(quota))
			period := "month"
			if text(a["quota_period"]) == "total" {
				period = "total"
			}
			c.Set(id, "quota_period", period)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	logged(d, journal.Event{"type": "person_added", "person": id, "detail": name, "by": "admin"})
	if d.Told != nil {
		d.Told()
	}
	_, m, _ := d.Store.Read()
	return map[string]any{"id": id, "link": link(m, id)}, nil
}

// personRegen gives a person a new personal link: the old one stops working at once. What it already
// handed out stays unless asked: `remove` lists the person's devices to take away with it.
func personRegen(d Deps, a map[string]any) (map[string]any, error) {
	id := text(a["id"])
	var gone []*model.Device
	err := write(d, func(c *uci.Config, m *model.Model) error {
		if m.People[id] == nil {
			return errors.New("Unknown person.")
		}
		c.Set(id, "code", newCode())
		c.Set(id, "code_set", strconv.FormatInt(clock(), 10))
		list, _ := a["remove"].([]any)
		for _, x := range list {
			if dev := m.Devices[text(x)]; dev != nil && dev.Person == id {
				already := false
				for _, g := range gone {
					already = already || g.ID == dev.ID
				}
				if !already {
					gone = append(gone, dev)
					c.DeleteSection(dev.ID)
				}
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	logged(d, journal.Event{"type": "link_changed", "person": id, "by": "admin"})
	var warning any
	if len(gone) > 0 {
		for _, dev := range gone {
			logged(d, journal.Event{"type": "device_removed", "person": id, "device": dev.ID, "detail": dev.Name, "dname": dev.Name, "dkind": dev.Kind, "by": "admin"})
		}
		if d.Sync != nil {
			warning = d.Sync(text(a["lang"]))
		}
	}
	if d.Told != nil {
		d.Told()
	}
	_, m, _ := d.Store.Read()
	return map[string]any{"link": link(m, id), "removed": len(gone), "warning": warning}, nil
}
