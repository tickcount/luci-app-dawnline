package methods

import (
	"crypto/ecdh"
	crand "crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/tickcount/luci-app-dawnline/backend/awg"
	"github.com/tickcount/luci-app-dawnline/backend/files"
	"github.com/tickcount/luci-app-dawnline/backend/handout"
	"github.com/tickcount/luci-app-dawnline/backend/ipnet"
	"github.com/tickcount/luci-app-dawnline/backend/journal"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
)

// DeviceNameMax is the longest name a device takes, in characters.
const DeviceNameMax = 20

// Past ASCII, letters of any language are welcome in a device's name; these blocks are not: symbols,
// punctuation, arrows, maths, emoji and invisibles (both ends in).
var nameSymbols = [][2]rune{{0x80, 0xbf}, {0xd7, 0xd7}, {0xf7, 0xf7}, {0x2000, 0x2bff}, {0x3000, 0x303f}, {0xd800, 0xf8ff}, {0xfe00, 0xfe0f},
	{0xfe30, 0xfe4f}, {0xfeff, 0xfeff}, {0xfff0, 0xffff}, {0x1f000, 0x1fbff}, {0xe0000, 0xe007f}}

// ValidDeviceName tells a device's name (trimmed by the caller): 1 to DeviceNameMax characters, not blank,
// each an ASCII letter, digit, space or one of - _ . or, past ASCII, none of nameSymbols. Broken UTF-8 is refused.
func ValidDeviceName(s string) bool {
	if strings.Trim(s, blank) == "" || !utf8.ValidString(s) || utf8.RuneCountInString(s) > DeviceNameMax {
		return false
	}
	for _, r := range s {
		if r < 0x80 {
			if !(r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == ' ' || r == '.' || r == '_' || r == '-') {
				return false
			}
			continue
		}
		for _, b := range nameSymbols {
			if r >= b[0] && r <= b[1] {
				return false
			}
		}
	}
	return true
}

var linkNumber = regexp.MustCompile(`^[0-9]{1,4}$`)

// Actor is who changes a device (dawnline.devices opts): the admin, or the portal for one person. The
// portal is held to that person's own devices and their device limit, cannot touch a device the admin
// turned off, and may bring the device's public key from the browser. Defer: the page came through the
// device being set up again, so its new keys are loaded a moment after the answer is out.
type Actor struct {
	By, Person string
	PublicKey  string
	Defer      bool
}

var admin = Actor{By: "admin"}

// own is the device an actor may touch, or why not.
func (who Actor) own(m *model.Model, id string) (*model.Device, error) {
	dev := m.Devices[id]
	if dev == nil || (who.Person != "" && dev.Person != who.Person) {
		if who.Person != "" {
			return nil, errors.New("Device not found.")
		}
		return nil, errors.New("Unknown device.")
	}
	if who.By == "portal" && dev.Disabled {
		return nil, errors.New("The admin has turned this device off.")
	}
	return dev, nil
}

// deviceUpdate renames a device, turns it off or on, or changes how it connects (its own MTU and
// keep-alive, "" the server's again; LAN Bypass): dawnline.devices update(), as the admin.
func deviceUpdate(d Deps, a map[string]any) (map[string]any, error) {
	return DeviceUpdateAs(d, a, admin)
}

// DeviceUpdateAs is deviceUpdate for an actor: only the admin turns devices off or sets the MTU and
// keep-alive; the portal may rename and switch LAN Bypass.
func DeviceUpdateAs(d Deps, a map[string]any, who Actor) (map[string]any, error) {
	id := text(a["id"])
	name, renames := a["name"].(string)
	_, switches := a["disabled"].(bool)
	off := truthy(a["disabled"])
	if switches && who.By != "admin" {
		return nil, errors.New("Only the admin can turn devices off.")
	}
	if (a["mtu"] != nil || a["keepalive"] != nil) && who.By != "admin" {
		return nil, errors.New("Only the admin can change how a device connects.")
	}
	var was model.Device
	var linked, said_ []string
	fn := func(c *uci.Config, m *model.Model) error {
		dev, err := who.own(m, id)
		if err != nil {
			return err
		}
		was = *dev
		if renames && name != dev.Name {
			name = strings.Trim(name, blank)
			if !ValidDeviceName(name) {
				return said{"Enter a device name: up to %d letters, digits, spaces and - _ .", []any{DeviceNameMax}}
			}
			if p := m.People[dev.Person]; p != nil {
				for _, o := range p.Devices {
					if o != id && lower(m.Devices[o].Name) == lower(name) {
						return said{`"%s" already exists.`, []any{name}}
					}
				}
			}
			c.Set(id, "name", name)
		}
		if switches {
			if off {
				c.Set(id, "disabled", "1")
			} else {
				c.Delete(id, "disabled")
			}
		}
		// its link values: only those given change, each told with what it became
		put := func(k string, v, old *int, shown string) {
			if (v == nil) == (old == nil) && (v == nil || *v == *old) {
				return
			}
			if v == nil {
				c.Delete(id, k)
			} else {
				c.Set(id, k, strconv.Itoa(*v))
			}
			linked = append(linked, k)
			said_ = append(said_, k+"="+shown)
		}
		number := func(v any, lo, hi int, msg string) (*int, string, error) {
			s := trimmed(v)
			if s == "" {
				return nil, "auto", nil
			}
			n, _ := strconv.Atoi(s)
			if !linkNumber.MatchString(s) || n < lo || n > hi {
				return nil, "", errors.New(msg)
			}
			return &n, s, nil
		}
		if a["mtu"] != nil {
			v, shown, err := number(a["mtu"], 1280, 1500, "MTU must be 1280-1500.")
			if err != nil {
				return err
			}
			var old *int
			if dev.MTU != 0 {
				old = &dev.MTU
			}
			put("mtu", v, old, shown)
		}
		if a["keepalive"] != nil {
			v, shown, err := number(a["keepalive"], 0, 600, "Keep-alive must be 0-600 seconds.")
			if err != nil {
				return err
			}
			put("keepalive", v, dev.Keepalive, shown)
		}
		if on, given := a["lan_bypass"].(bool); given {
			one := 1
			var v, old *int
			shown := "off"
			if on {
				v, shown = &one, "on"
			}
			if dev.LanBypass {
				old = &one
			}
			put("lan_bypass", v, old, shown)
		}
		return nil
	}
	var warning any
	var err error
	// a change of the link values alone is in the device's configuration: nothing on the router changes
	if renames || switches {
		warning, err = change(d, text(a["lang"]), fn)
	} else {
		err = write(d, fn)
	}
	if err != nil {
		return nil, err
	}
	event := func(detail string) {
		logged(d, journal.Event{"type": "device_changed", "person": was.Person, "device": id, "detail": detail, "by": who.By})
	}
	if switches && off != was.Disabled {
		if off {
			event("turned off")
		} else {
			event("turned on")
		}
	} else if renames && a["name"] != was.Name {
		event("renamed from " + was.Name)
	}
	if len(linked) > 0 {
		event(strings.Join(said_, ", "))
	}
	if d.Told != nil {
		d.Told()
	}
	return map[string]any{"warning": warning}, nil
}

// rerouted has everything put into effect after a change of the settings that moves routes (the networks
// behind a router): the home-like path keeps its own rules for them, which only the full apply brings up
// to date. The warning is that apply's.
func rerouted(d Deps, lang string) (warning any) {
	if d.Apply != nil {
		warning = d.Apply(lang)["warning"]
	}
	if d.Told != nil {
		d.Told()
	}
	return warning
}

// ownNets is the router's own networks, which none behind a device may share addresses with (nil where
// the router cannot be looked at).
func ownNets(d Deps, m *model.Model) []string {
	if d.Snapshot == nil {
		return nil
	}
	if snap := d.Snapshot(); snap != nil {
		return snap.Own(m)
	}
	return nil
}

// behindNets reads the networks behind a device as a page gives them (a list; blanks around each and
// empty entries dropped), each told from its first address, or says what is wrong with the first that
// will not do: no private network of a site's size, too many, two that share addresses, or one that
// something else has already (a tunnel, the router itself, another device).
//
// asking: the list is only asked of the admin, who answers with everything in view; then what another
// router has is not held against it here. The portal is never told whose a network is unless it is the
// person's own.
func behindNets(m *model.Model, device string, given any, own []string, who Actor, asking bool) ([]string, error) {
	list, _ := given.([]any)
	var nets []ipnet.Net
	out := []string{}
	for _, v := range list {
		s := trimmed(v)
		if s == "" {
			continue
		}
		n, why := model.BehindNet(s)
		switch why {
		case "form":
			return nil, said{"Network %s is not written like 192.168.2.0/24.", []any{s}}
		case "wide":
			return nil, said{"Network %s is too wide: /%d at the most.", []any{s, model.BehindWidest}}
		case "public":
			return nil, said{"Network %s is not private (10.x, 172.16-31.x, 192.168.x).", []any{s}}
		}
		// the same one written twice is one
		twice := false
		for _, o := range nets {
			if o.Base == n.Base && o.Prefix == n.Prefix {
				twice = true
			} else if o.Overlaps(n) {
				return nil, said{"Networks %s and %s share addresses.", []any{o.String(), n.String()}}
			}
		}
		if twice {
			continue
		}
		if c := m.BehindClash(n, device, own); c != nil {
			switch {
			case c.Server != "":
				return nil, said{"Network %s is taken: %s is the tunnel network of %s. The two ends of a tunnel need different addresses.", []any{n.String(), c.Net, m.Servers[c.Server].Name}}
			case c.Device == "":
				return nil, said{"Network %s is taken: the router has %s itself. The two ends of a tunnel need different addresses.", []any{n.String(), c.Net}}
			}
			o := m.Devices[c.Device]
			switch {
			case who.Person != "" && o.Person == who.Person:
				return nil, said{"Network %s is taken: %s is behind your %s. Two sites need different addresses.", []any{n.String(), c.Net, o.Name}}
			case who.Person != "" && !asking:
				return nil, said{"Network %s is taken on this server. Ask the admin which addresses are free.", []any{n.String()}}
			case who.Person == "":
				owner := o.Person
				if p := m.People[o.Person]; p != nil {
					owner = p.Name
				}
				return nil, said{"Network %s is taken: %s is behind %s (%s). Two sites need different addresses.", []any{n.String(), c.Net, o.Name, owner}}
			}
		}
		nets = append(nets, n)
		out = append(out, n.String())
	}
	if len(out) > model.BehindMost {
		return nil, said{"A router has %d networks behind it at the most.", []any{model.BehindMost}}
	}
	return out, nil
}

func sameList(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// deviceNetworks sets the networks behind a router, all of them at once (none: it is a device like any
// other again). The tunnel then carries them both ways: a host there has its owner's access, and whoever
// reaches the router reaches it. A list that is the one there changes nothing and applies nothing.
func deviceNetworks(d Deps, a map[string]any) (map[string]any, error) {
	id := text(a["id"])
	var was model.Device
	var nets []string
	same := false
	err := write(d, func(c *uci.Config, m *model.Model) error {
		dev, err := admin.own(m, id)
		if err != nil {
			return err
		}
		was = *dev
		if nets, err = behindNets(m, id, a["networks"], ownNets(d, m), admin, false); err != nil {
			return err
		}
		if len(nets) > 0 && dev.Kind != "router" {
			return errors.New("Only a router has networks behind it.")
		}
		if same = sameList(nets, dev.Behind); same {
			return nil
		}
		setBehind(c, id, nets)
		// what its owner asked for and now has is asked no more
		if rest := without(dev.Ask, nets); len(rest) != len(dev.Ask) {
			setList(c, id, "ask_net", rest)
			if len(rest) == 0 && !dev.Waiting {
				c.Delete(id, "asked")
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if same {
		return map[string]any{"networks": nets, "warning": nil}, nil
	}
	warning := rerouted(d, text(a["lang"]))
	logged(d, journal.Event{"type": "device_changed", "person": was.Person, "device": id, "detail": "networks=" + behindSaid(nets), "by": admin.By})
	return map[string]any{"networks": nets, "warning": warning}, nil
}

// setList writes a list option, or removes it when the list is empty.
func setList(c *uci.Config, id, option string, list []string) {
	if len(list) == 0 {
		c.Delete(id, option)
		return
	}
	c.SetList(id, option, list)
}

// setBehind writes a device's networks: the list, or no option at all when there are none.
func setBehind(c *uci.Config, id string, nets []string) { setList(c, id, "behind_net", nets) }

// without is a list minus what another has, in its own order.
func without(list, drop []string) []string {
	out := []string{}
	for _, x := range list {
		gone := false
		for _, y := range drop {
			gone = gone || x == y
		}
		if !gone {
			out = append(out, x)
		}
	}
	return out
}

// behindSaid is a device's networks in a line of the activity log.
func behindSaid(nets []string) string {
	if len(nets) == 0 {
		return "none"
	}
	return strings.Join(nets, " ")
}

// deviceDelete removes a device. The event carries its name and kind: the log reads well once it is gone.
func deviceDelete(d Deps, id, lang string) (map[string]any, error) {
	return DeviceDeleteAs(d, id, lang, admin)
}

// DeviceDeleteAs is deviceDelete for an actor.
func DeviceDeleteAs(d Deps, id, lang string, who Actor) (map[string]any, error) {
	var was model.Device
	warning, err := change(d, lang, func(c *uci.Config, m *model.Model) error {
		dev, err := who.own(m, id)
		if err != nil {
			return err
		}
		was = *dev
		c.DeleteSection(id)
		return nil
	})
	if err != nil {
		return nil, err
	}
	logged(d, journal.Event{"type": "device_removed", "person": was.Person, "device": id, "detail": was.Name, "dname": was.Name, "dkind": was.Kind, "by": who.By})
	if d.Told != nil {
		d.Told()
	}
	return map[string]any{"warning": warning}, nil
}

// Keys is a device's new keys.
type Keys struct {
	Private, Public, Preshared string
}

// newKeys makes a device's keys as `awg genkey`, `awg pubkey` and `awg genpsk` do: a Curve25519 private
// key (32 random bytes, clamped), its public key, and 32 random bytes to share. A test puts its own in its place.
var newKeys = func() Keys {
	priv := make([]byte, 32)
	crand.Read(priv)
	priv[0] &= 248
	priv[31] = priv[31]&127 | 64
	psk := make([]byte, 32)
	crand.Read(psk)
	k := Keys{Private: base64.StdEncoding.EncodeToString(priv), Preshared: base64.StdEncoding.EncodeToString(psk)}
	if key, err := ecdh.X25519().NewPrivateKey(priv); err == nil {
		k.Public = base64.StdEncoding.EncodeToString(key.PublicKey().Bytes())
	}
	return k
}

var deviceKinds = []string{"computer", "phone", "tablet", "router", "other"}

// needAWG refuses, in the admin's words, while AmneziaWG is not on the router: no device's keys can be loaded.
func needAWG(d Deps) error {
	if d.AWG == nil {
		return nil
	}
	state := d.AWG()
	if state["tools"] == true && state["kmod"] == true {
		return nil
	}
	var miss []string
	list, _ := state["missing"].([]any)
	for _, x := range list {
		miss = append(miss, text(x))
	}
	if len(miss) > 0 {
		return said{"AmneziaWG is not installed (%s): install it in Dawnline → Components.", []any{strings.Join(miss, ", ")}}
	}
	return errors.New("AmneziaWG is not installed: install it in Dawnline → Components.")
}

// homeOf is the home networks a device's person reaches, for its configuration.
func homeOf(d Deps, m *model.Model, dev *model.Device) []string {
	p := m.People[dev.Person]
	if p == nil || d.Home == nil {
		return nil
	}
	srv := m.Servers[p.Server]
	if srv == nil {
		return nil
	}
	return d.Home(srv, p)
}

// markIssued remembers that a device was just given its current configuration, and when
// (dawnline.awg mark_issued): what it holds, as a fingerprint, in issued.json.
func markIssued(d Deps, m *model.Model, id string) {
	dev := m.Devices[id]
	if dev == nil || dev.Waiting {
		return
	}
	fp := handout.Fingerprint(m, dev, homeOf(d, m, dev))
	if fp == "" {
		return
	}
	defer files.Lock(d.RunDir, "issued")()
	path := d.DataDir + "/issued.json"
	var raw map[string]json.RawMessage
	files.ReadJSON(path, &raw)
	all := map[string]any{}
	for k, v := range raw {
		if m.Devices[k] == nil {
			continue
		}
		// an entry from before moments were kept is the fingerprint alone
		var old string
		if json.Unmarshal(v, &old) == nil {
			if old != "" {
				all[k] = map[string]any{"fp": old, "ts": 0}
			}
			continue
		}
		all[k] = v
	}
	all[id] = map[string]any{"fp": fp, "ts": clock()}
	os.MkdirAll(d.DataDir, 0o700)
	files.WriteJSON(path, all, 0o600)
}

// markReconnect remembers that a device is set up again: handshakes up to now are its old configuration's.
func markReconnect(d Deps, m *model.Model, id string, late int64) {
	defer files.Lock(d.RunDir, "reconnect")()
	path := d.DataDir + "/reconnect.json"
	all := map[string]any{}
	files.ReadJSON(path, &all)
	all[id] = clock() + late
	for k := range all {
		if m.Devices[k] == nil {
			delete(all, k)
		}
	}
	os.MkdirAll(d.DataDir, 0o700)
	files.WriteJSON(path, all, 0o600)
}

// configOf is a device's configuration as a method answers it.
func configOf(d Deps, m *model.Model, id string) map[string]any {
	dev := m.Devices[id]
	// a router that waits for the admin's answer has none yet
	if dev == nil || dev.Waiting {
		return nil
	}
	cfg := handout.ClientConfig(m, dev, homeOf(d, m, dev))
	if cfg == nil {
		return nil
	}
	raw, _ := json.Marshal(cfg)
	var out map[string]any
	json.Unmarshal(raw, &out)
	return out
}

// deviceCreate adds a device for a person with fresh keys: { id, config } (dawnline.devices add(), as the
// admin, who is not held to the person's device limit).
func deviceCreate(d Deps, a map[string]any) (map[string]any, error) {
	return DeviceCreateAs(d, a, admin)
}

// DeviceCreateAs is deviceCreate for an actor: the portal is held to the person's device limit, and may
// bring the device's public key (its private key then never leaves the browser).
func DeviceCreateAs(d Deps, a map[string]any, who Actor) (map[string]any, error) {
	if err := needAWG(d); err != nil {
		return nil, err
	}
	person, kind := text(a["person"]), text(a["kind"])
	name := trimmed(a["name"])
	bypass, _ := a["lan_bypass"].(bool)
	id := ""
	var nets []string
	// waits: a router asked of the admin; asks: its networks are asked too, not its own yet
	waits, asks := false, false
	err := write(d, func(c *uci.Config, m *model.Model) error {
		p := m.People[person]
		if p == nil {
			return errors.New("Unknown person.")
		}
		srv := m.Servers[p.Server]
		if srv == nil {
			return errors.New("The person has no server.")
		}
		if !ValidDeviceName(name) {
			return said{"Enter a device name: up to %d letters, digits, spaces and - _ .", []any{DeviceNameMax}}
		}
		if who.By == "portal" && len(p.Devices) >= p.DeviceLimit {
			return said{"Device limit reached (%d).", []any{p.DeviceLimit}}
		}
		known := false
		for _, k := range deviceKinds {
			known = known || k == kind
		}
		if !known {
			kind = "other"
		}
		for _, o := range p.Devices {
			if lower(m.Devices[o].Name) == lower(name) {
				return said{`"%s" already exists.`, []any{name}}
			}
		}
		// A router from someone's own page, by the server's rule: not taken there at all, asked of the admin
		// (it waits: no device of the tunnel, no configuration), or added at once. Its networks likewise:
		// asked with it, or its own from the start.
		if kind == "router" && who.By == "portal" {
			switch srv.PortalRouters {
			case "off":
				return errors.New("The admin adds routers on this server. Ask them for one.")
			case "ask":
				waits = true
			}
			asks = waits || srv.PortalNets == "ask"
		}
		if a["networks"] != nil {
			var err error
			if nets, err = behindNets(m, "", a["networks"], ownNets(d, m), who, asks); err != nil {
				return err
			}
			if len(nets) > 0 && kind != "router" {
				return errors.New("Only a router has networks behind it.")
			}
		}
		addr := allocAddress(m, srv, func(q *model.Person) string { return q.Server }, func(x *model.Device) string { return x.Address })
		if addr == "" {
			return errors.New("No free addresses left in the server subnet.")
		}
		k := newKeys()
		if who.PublicKey != "" {
			if !awg.ValidKey(who.PublicKey) {
				return errors.New("Invalid public key.")
			}
			k.Public, k.Private = who.PublicKey, ""
		}
		if !awg.ValidKey(k.Public) {
			return errors.New("Key generation failed (is amneziawg-tools installed?).")
		}
		for _, o := range m.Devices {
			if o.PublicKey == k.Public {
				return errors.New("This key is already in use.")
			}
		}
		// a server's own key is in every configuration: the kernel would silently ignore such a peer
		for _, s := range m.Servers {
			if s.PublicKey == k.Public {
				return errors.New("This key is already in use.")
			}
		}
		id = "d_" + randHex(4)
		c.Add("device", id)
		c.Set(id, "person", person)
		c.Set(id, "name", name)
		c.Set(id, "kind", kind)
		c.Set(id, "address", addr)
		c.Set(id, "public_key", k.Public)
		if k.Private != "" {
			c.Set(id, "private_key", k.Private)
		}
		c.Set(id, "preshared_key", k.Preshared)
		c.Set(id, "created", strconv.FormatInt(clock(), 10))
		c.Set(id, "created_by", who.By)
		if bypass {
			c.Set(id, "lan_bypass", "1")
		}
		if waits {
			c.Set(id, "waiting", "1")
		}
		if asks {
			setList(c, id, "ask_net", nets)
		} else {
			setBehind(c, id, nets)
		}
		if waits || (asks && len(nets) > 0) {
			c.Set(id, "asked", strconv.FormatInt(clock(), 10))
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	// With networks of its own the routes move: everything is applied. A router that waits changes
	// nothing on the router. Else the sync loads the device.
	var warning any
	switch {
	case len(nets) > 0 && !asks:
		warning = rerouted(d, text(a["lang"]))
	case waits:
		if d.Told != nil {
			d.Told()
		}
	default:
		if d.Sync != nil {
			warning = d.Sync(text(a["lang"]))
		}
		if d.Told != nil {
			d.Told()
		}
	}
	_, m, _ := d.Store.Read()
	logged(d, journal.Event{"type": "device_added", "person": person, "device": id, "detail": name, "by": who.By})
	var detail []string
	if waits {
		detail = append(detail, "asked=router")
	}
	if len(nets) > 0 && asks {
		detail = append(detail, "asked="+behindSaid(nets))
	} else if len(nets) > 0 {
		detail = append(detail, "networks="+behindSaid(nets))
	}
	if len(detail) > 0 {
		logged(d, journal.Event{"type": "device_changed", "person": person, "device": id, "detail": strings.Join(detail, ", "), "by": who.By})
	}
	if waits {
		return map[string]any{"id": id, "config": nil, "waiting": true, "warning": warning}, nil
	}
	markIssued(d, m, id)
	if d.Told != nil {
		d.Told()
	}
	return map[string]any{"id": id, "config": configOf(d, m, id), "warning": warning}, nil
}

// deviceRotate sets a device up from scratch (the admin's New keys): new keys, so the configuration it
// holds stops working with the sync, and it counts as not set up until it connects with the new one. Its
// kind and LAN Bypass change with the keys when given. It answers the new configuration.
func deviceRotate(d Deps, a map[string]any) (map[string]any, error) {
	return DeviceRotateAs(d, a, admin)
}

// DeviceRotateAs is deviceRotate for an actor. With who.Defer the new keys are loaded a moment after the
// answer: the device the page came through would lose its tunnel before the answer gets out.
func DeviceRotateAs(d Deps, a map[string]any, who Actor) (map[string]any, error) {
	id := text(a["id"])
	kind := text(a["kind"])
	bypass, bypassGiven := a["lan_bypass"].(bool)
	var changed []string
	person := ""
	// unrouted: the device was a router with networks behind it, which went with its kind
	unrouted := false
	put := func(fn func(c *uci.Config, m *model.Model) error) (any, error) {
		if err := write(d, fn); err != nil {
			return nil, err
		}
		if unrouted {
			return rerouted(d, text(a["lang"])), nil
		}
		var warning any
		if d.Sync != nil {
			warning = d.Sync(text(a["lang"]))
		}
		if d.Told != nil {
			d.Told()
		}
		return warning, nil
	}
	if who.Defer {
		put = func(fn func(c *uci.Config, m *model.Model) error) (any, error) {
			if err := write(d, fn); err != nil {
				return nil, err
			}
			if d.Background != nil {
				d.Background("sleep 3; /usr/bin/dawnline sync")
			}
			return nil, nil
		}
	}
	warning, err := put(func(c *uci.Config, m *model.Model) error {
		dev, err := who.own(m, id)
		if err != nil {
			return err
		}
		person = dev.Person
		if dev.Waiting {
			return errors.New("This router waits for an answer to its request: it has no configuration yet.")
		}
		if p := m.People[dev.Person]; who.By == "portal" && kind == "router" && dev.Kind != "router" && p != nil {
			if srv := m.Servers[p.Server]; srv == nil || srv.PortalRouters != "free" {
				return errors.New("Add the router as a new device: a device cannot be made one here.")
			}
		}
		if kind != "" {
			known := false
			for _, k := range deviceKinds {
				known = known || k == kind
			}
			if !known {
				return errors.New("Unknown device type.")
			}
			if kind != dev.Kind {
				c.Set(id, "kind", kind)
				changed = append(changed, "kind="+kind)
				// what is no router any more has nothing behind it, and asks for nothing
				if len(dev.Behind) > 0 {
					c.Delete(id, "behind_net")
					changed = append(changed, "networks=none")
					unrouted = true
				}
				for _, k := range []string{"ask_net", "asked", "declined", "declined_net"} {
					c.Delete(id, k)
				}
			}
		}
		if bypassGiven && bypass != dev.LanBypass {
			if bypass {
				c.Set(id, "lan_bypass", "1")
				changed = append(changed, "lan_bypass=on")
			} else {
				c.Delete(id, "lan_bypass")
				changed = append(changed, "lan_bypass=off")
			}
		}
		k := newKeys()
		if !awg.ValidKey(k.Public) || k.Private == "" {
			return errors.New("Key generation failed.")
		}
		c.Set(id, "private_key", k.Private)
		c.Set(id, "public_key", k.Public)
		if k.Preshared != "" {
			c.Set(id, "preshared_key", k.Preshared)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if len(changed) > 0 {
		logged(d, journal.Event{"type": "device_changed", "person": person, "device": id, "detail": strings.Join(changed, ", "), "by": who.By})
	}
	_, m, _ := d.Store.Read()
	logged(d, journal.Event{"type": "device_keys", "person": person, "device": id, "detail": m.Devices[id].Name, "by": who.By})
	markIssued(d, m, id)
	// a deferred sync lets the old keys live a few seconds more
	late := int64(0)
	if who.Defer {
		late = 5
	}
	markReconnect(d, m, id, late)
	if d.Told != nil {
		d.Told()
	}
	cfg := configOf(d, m, id)
	if cfg != nil && warning != nil && warning != "" {
		cfg["warning"] = warning
	}
	if cfg == nil {
		return map[string]any{"result": nil}, nil
	}
	return cfg, nil
}
