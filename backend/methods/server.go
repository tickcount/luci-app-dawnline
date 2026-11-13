package methods

import (
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"

	"github.com/tickcount/luci-app-dawnline/backend/awg"
	"github.com/tickcount/luci-app-dawnline/backend/disguise"
	"github.com/tickcount/luci-app-dawnline/backend/endpoint"
	"github.com/tickcount/luci-app-dawnline/backend/files"
	"github.com/tickcount/luci-app-dawnline/backend/i18n"
	"github.com/tickcount/luci-app-dawnline/backend/ipnet"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/servicelog"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
	"github.com/tickcount/luci-app-dawnline/backend/view"
)

var (
	meshWords    = map[string]string{"off": "devices kept apart", "all": "devices reach each other", "circles": "devices reach each other in circles"}
	keepaliveArg = regexp.MustCompile(`^[0-9]{1,3}$`)
	mtuArg       = regexp.MustCompile(`^[0-9]{1,4}$`)
)

// on tells a switch as a page sends it: true or "1".
func on(v any) bool { return v == true || v == "1" || num(v) == 1 }

// asString is a value as ucode writes it into a string, trimmed.
func asString(v any) string {
	switch x := v.(type) {
	case string:
		return strings.Trim(x, blank)
	case nil:
		return ""
	case bool:
		if x {
			return "true"
		}
		return "false"
	}
	return str(num(v))
}

// dnsList is a list of DNS servers as typed (a list, or "a, b"): each an IPv4 or IPv6 address.
func dnsList(v any) ([]string, error) {
	var parts []string
	if list, isList := v.([]any); isList {
		for _, x := range list {
			parts = append(parts, asString(x))
		}
	} else {
		parts = regexp.MustCompile(`[ ,]+`).Split(asString(v), -1)
	}
	out := []string{}
	for _, d := range parts {
		if d == "" {
			continue
		}
		if _, v4 := ipnet.IP(d); !v4 && (net.ParseIP(d) == nil || !strings.Contains(d, ":")) {
			return nil, said{"%s is not an IP address.", []any{d}}
		}
		out = append(out, d)
	}
	return out, nil
}

// privateNet tells a network that lies inside one of the private ranges.
func privateNet(n ipnet.Net) bool {
	for _, p := range []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"} {
		r, _ := ipnet.Any(p)
		if uint64(n.Base) >= uint64(r.Base) && uint64(n.Base)+n.Size() <= uint64(r.Base)+r.Size() {
			return true
		}
	}
	return false
}

// udpHeld is the UDP ports a server cannot take, read on the router.
func udpHeld(m *model.Model, srv *model.Server, t *i18n.Catalog) []map[string]any {
	udp, _ := os.ReadFile("/proc/net/udp")
	udp6, _ := os.ReadFile("/proc/net/udp6")
	return udpTaken(m, srv, t, parseFile("/etc/config/network"), parseFile("/etc/config/firewall"), udpBound(string(udp), string(udp6)), listening("udp"))
}

// serverUpdate saves a server's settings from the General and Network tabs and applies them at once
// (dawnline.rpc.servers server_update). It answers what the apply came to.
func serverUpdate(d Deps, a map[string]any) (map[string]any, error) {
	id := text(a["id"])
	v, _ := a["values"].(map[string]any)
	if v == nil {
		v = map[string]any{}
	}
	if v["device_mesh"] != nil && v["mesh"] == nil {
		v["mesh"] = "off"
		if on(v["device_mesh"]) {
			v["mesh"] = "all"
		}
	}
	t := i18n.Use(d.Catalogs, text(a["lang"]))
	var was model.Server
	var newDNS []string
	err := write(d, func(c *uci.Config, m *model.Model) error {
		srv := m.Servers[id]
		if srv == nil {
			return errors.New("Unknown server.")
		}
		was = *srv
		set := func(k, val string) {
			if val == "" {
				c.Delete(id, k)
			} else {
				c.Set(id, k, val)
			}
		}
		if v["name"] != nil {
			if !ValidName(asString(v["name"])) {
				return errors.New(`Server: Enter a name: up to 48 characters, without < > " or \.`)
			}
			set("name", asString(v["name"]))
		}
		// empty: the portal's address, as at creation
		if v["endpoint"] != nil {
			if e := asString(v["endpoint"]); e != "" && !endpoint.ValidHost(e) {
				return errors.New("Public address must be a hostname or IP address.")
			}
			set("endpoint", asString(v["endpoint"]))
		}
		if v["port"] != nil {
			if !ValidPort(asString(v["port"])) {
				return errors.New("UDP port must be 1-65535.")
			}
			n, _ := strconv.Atoi(asString(v["port"]))
			if n != srv.Port {
				for _, h := range udpHeld(m, srv, t) {
					if h["from"].(int) <= n && n <= h["to"].(int) {
						return said{"UDP %d is used by %s. Choose another port.", []any{n, h["who"]}}
					}
				}
			}
			set("port", strconv.Itoa(n))
		}
		if v["enabled"] != nil {
			if on(v["enabled"]) {
				set("enabled", "1")
			} else {
				set("enabled", "0")
			}
		}
		if v["mesh"] != nil {
			mesh := text(v["mesh"])
			if _, known := meshWords[mesh]; !known {
				return errors.New("Unknown choice for devices reaching each other.")
			}
			set("mesh", mesh)
			set("device_mesh", "")
		}
		// what people may do about routers on their own pages; "ask" is what an unset one means
		for k, choices := range map[string][]string{"portal_routers": model.PortalRouters, "portal_nets": model.PortalNets} {
			if v[k] == nil {
				continue
			}
			pick, known := text(v[k]), false
			for _, x := range choices {
				known = known || x == pick
			}
			if !known {
				return errors.New("Unknown choice for routers on people's pages.")
			}
			if pick == "ask" {
				pick = ""
			}
			set(k, pick)
		}
		if v["mtu"] != nil {
			s := asString(v["mtu"])
			if n, _ := strconv.Atoi(s); s != "" && (!mtuArg.MatchString(s) || n < 1280 || n > 1500) {
				return errors.New("MTU must be 1280-1500.")
			}
			set("mtu", s)
		}
		if v["keepalive"] != nil {
			s := asString(v["keepalive"])
			if n, _ := strconv.Atoi(s); s != "" && (!keepaliveArg.MatchString(s) || n > 600) {
				return errors.New("Keep-alive must be 0-600 seconds.")
			}
			set("keepalive", s)
		}
		if v["dns"] != nil {
			list, err := dnsList(v["dns"])
			if err != nil {
				return err
			}
			newDNS = list
			if len(list) > 0 {
				c.SetList(id, "dns", list)
			} else {
				c.Delete(id, "dns")
			}
		}
		// a new tunnel network: private, free, and every device renumbered into it
		if sub := asString(v["subnet"]); v["subnet"] != nil && sub != "" && sub != srv.Subnet {
			pc, ok := ipnet.Subnet(sub)
			if !ok {
				return errors.New("Subnet must look like 10.77.0.0/24.")
			}
			if !privateNet(pc) {
				return errors.New("Use a private range: 10.x.x.x, 172.16–31.x.x or 192.168.x.x.")
			}
			var addrs []Address
			if d.Addresses != nil {
				addrs = d.Addresses()
			}
			for _, n := range takenNetworks(m, addrs) {
				if n["cidr"] == srv.Subnet || n["name"] == srv.Name {
					continue
				}
				if o, ok := ipnet.Subnet(n["cidr"].(string)); ok && uint64(pc.Base) < uint64(o.Base)+o.Size() && uint64(o.Base) < uint64(pc.Base)+pc.Size() {
					return said{"Subnet overlaps %s.", []any{n["cidr"]}}
				}
			}
			// every device on the server gets an address in it, lowest first
			moved := map[string]string{}
			here := map[string]bool{}
			for _, pid := range m.PersonIDs() {
				if p := m.People[pid]; p.Server == id {
					for _, did := range p.Devices {
						here[did] = true
					}
				}
			}
			to := *srv
			to.Subnet = pc.String()
			for _, pid := range m.PersonIDs() {
				p := m.People[pid]
				if p.Server != id {
					continue
				}
				for _, did := range p.Devices {
					addr := allocAddress(m, &to, func(q *model.Person) string { return q.Server }, func(x *model.Device) string {
						if here[x.ID] {
							return moved[x.ID]
						}
						return x.Address
					})
					if addr == "" {
						return said{"%s has no room for every device on %s.", []any{pc.String(), srv.Name}}
					}
					moved[did] = addr
					c.Set(did, "address", addr)
				}
			}
			c.Set(id, "subnet", pc.String())
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	// for the log: what changed, in words; turning on or off is its own line
	var what []string
	for _, k := range []struct{ key, label string }{{"name", "name"}, {"endpoint", "public address"}, {"port", "AmneziaWG port"}, {"mtu", "MTU"},
		{"keepalive", "keep-alive"}, {"dns", "DNS"}, {"subnet", "tunnel network"}} {
		if v[k.key] == nil {
			continue
		}
		before, now := "", asString(v[k.key])
		switch k.key {
		case "name":
			before = was.Name
		case "endpoint":
			before = was.Endpoint
		case "port":
			before = strconv.Itoa(was.Port)
		case "mtu":
			if was.MTU != 0 {
				before = strconv.Itoa(was.MTU)
			}
		case "keepalive":
			before = strconv.Itoa(was.Keepalive)
		case "dns":
			before, now = strings.Join(was.DNS, " "), strings.Join(newDNS, " ")
		case "subnet":
			before = was.Subnet
		}
		if strings.Trim(before, blank) != strings.Trim(now, blank) {
			what = append(what, k.label)
		}
	}
	name := was.Name
	if v["name"] != nil {
		name = asString(v["name"])
	}
	var applied map[string]any
	if d.Apply != nil {
		applied = d.Apply(text(a["lang"]))
	}
	if d.Log != nil {
		line := func(msg, note string) {
			d.Log.Write("dawnline", "info", msg, "", name, servicelog.Extra{By: "admin", Kind: "server", Note: note, SID: id})
		}
		if v["enabled"] != nil && on(v["enabled"]) != was.Enabled {
			if on(v["enabled"]) {
				line("turned on", "")
			} else {
				line("turned off", "")
			}
		}
		if len(what) > 0 {
			line("changed", strings.Join(what, ", "))
		}
		if v["mesh"] != nil && text(v["mesh"]) != was.Mesh {
			line("changed", meshWords[text(v["mesh"])])
		}
		if v["portal_routers"] != nil && text(v["portal_routers"]) != was.PortalRouters {
			line("changed", "routers on people's pages: "+text(v["portal_routers"]))
		}
		if v["portal_nets"] != nil && text(v["portal_nets"]) != was.PortalNets {
			line("changed", "networks behind routers on people's pages: "+text(v["portal_nets"]))
		}
	}
	if d.Told != nil {
		d.Told()
	}
	if applied == nil {
		applied = map[string]any{}
	}
	return applied, nil
}

// serverDelete removes a server with its people, their devices and its circles; a backup is made first.
func serverDelete(d Deps, id, lang string) (map[string]any, error) {
	if d.Store == nil {
		return nil, errors.New("The router is still starting. Try again in a moment.")
	}
	if _, m, err := d.Store.Read(); err != nil || m.Servers[id] == nil {
		return nil, errors.New("Unknown server.")
	}
	if _, err := backupCreate(d, "pre-delete"); err != nil {
		return nil, err
	}
	name, gone := "", 0
	err := write(d, func(c *uci.Config, m *model.Model) error {
		srv := m.Servers[id]
		if srv == nil {
			return errors.New("Unknown server.")
		}
		for _, pid := range m.PersonIDs() {
			if p := m.People[pid]; p.Server == id {
				for _, dev := range p.Devices {
					c.DeleteSection(dev)
				}
				c.DeleteSection(pid)
				gone++
			}
		}
		for _, cid := range m.CircleIDs() {
			if m.Circles[cid].Server == id {
				c.DeleteSection(cid)
			}
		}
		c.DeleteSection(id)
		name = srv.Name
		return nil
	})
	if err != nil {
		return nil, err
	}
	var applied map[string]any
	if d.Apply != nil {
		applied = d.Apply(lang)
	}
	if d.Log != nil {
		note := ""
		if gone == 1 {
			note = "with 1 person"
		} else if gone > 1 {
			note = "with " + strconv.Itoa(gone) + " people"
		}
		d.Log.Write("awg", "info", "removed", "", name, servicelog.Extra{By: "admin", Kind: "server", Note: note, SID: id})
	}
	if d.Told != nil {
		d.Told()
	}
	if applied == nil {
		applied = map[string]any{}
	}
	return applied, nil
}

// off tells a switch a page turned off: false or "0".
func off(v any) bool { return v == false || v == "0" }

// serverInterfaces saves which interfaces a server uses (its WAN, its home networks), whether its traffic
// leaves like a home device's and who reaches whom, and applies it (dawnline.rpc.servers server_interfaces).
// It answers the interfaces as the page shows them, and whether the home networks changed.
func serverInterfaces(d Deps, a map[string]any) (map[string]any, error) {
	if d.Snapshot == nil {
		return nil, errors.New("The router is still starting. Try again in a moment.")
	}
	id := text(a["id"])
	snap := d.Snapshot()
	autoWan, autoLan := !off(a["auto_wan"]), !off(a["auto_lan"])
	wanDev := asString(a["wan_device"])
	var was, now model.Server
	mesh := ""
	err := write(d, func(c *uci.Config, m *model.Model) error {
		srv := m.Servers[id]
		if srv == nil {
			return errors.New("Unknown server.")
		}
		was = *srv
		if !autoWan {
			dev := snap.Devices[wanDev]
			if dev == nil {
				return errors.New("Choose the interface that leads to the internet.")
			}
			if dev.Zone == "" {
				return said{"%s is not in a firewall zone, so the server port cannot be opened on it.", []any{wanDev}}
			}
		}
		wan := wanDev
		if autoWan {
			wan = snap.WAN
		}
		var lans []string
		list, _ := a["lan_devices"].([]any)
		for _, x := range list {
			name := asString(x)
			saved := false
			for _, o := range srv.LanDevices {
				saved = saved || o == name
			}
			dev := snap.Devices[name]
			// unknown names are kept only if they were saved before (an interface down right now)
			if name == "" || name == srv.Ifname || (dev == nil && !saved) {
				continue
			}
			if dev != nil && dev.Master != "" {
				return said{"%s is part of %s; choose %s instead.", []any{name, dev.Master, dev.Master}}
			}
			if name == wan {
				return said{"%s is the WAN.", []any{name}}
			}
			dup := false
			for _, o := range lans {
				dup = dup || o == name
			}
			if !dup {
				lans = append(lans, name)
			}
		}
		if a["lan_like"] != nil {
			if off(a["lan_like"]) {
				c.Set(id, "lan_like", "0")
			} else {
				c.Set(id, "lan_like", "1")
			}
		}
		mesh = srv.Mesh
		if _, known := meshWords[text(a["mesh"])]; known {
			mesh = text(a["mesh"])
		} else if a["device_mesh"] != nil {
			mesh = "all"
			if off(a["device_mesh"]) {
				mesh = "off"
			}
		}
		c.Set(id, "mesh", mesh)
		c.Delete(id, "device_mesh")
		flag := func(k string, v bool) {
			if v {
				c.Set(id, k, "1")
			} else {
				c.Set(id, k, "0")
			}
		}
		flag("auto_wan", autoWan)
		flag("auto_lan", autoLan)
		if autoWan || wanDev == "" {
			c.Delete(id, "wan_device")
		} else {
			c.Set(id, "wan_device", wanDev)
		}
		if len(lans) > 0 {
			c.SetList(id, "lan_device", lans)
		} else {
			c.Delete(id, "lan_device")
		}
		// what was detected, as the fallback while an interface is down
		if snap.WAN != "" {
			c.Set(id, "detected_wan", snap.WAN)
		}
		if snap.LAN != "" {
			c.Set(id, "detected_lan", snap.LAN)
		}
		// the older zone options kept in step
		var blocked map[string]any
		files.ReadJSON(d.RunDir+"/netifd-blocked.json", &blocked)
		wanNet, _, _, zones := snap.ServerNet(model.Load(c, blocked).Servers[id])
		if wanNet.Zone != "" {
			c.Set(id, "wan_zone", wanNet.Zone)
		}
		if len(zones) > 0 {
			c.Set(id, "lan_zone", zones[0])
		}
		now = *model.Load(c, blocked).Servers[id]
		return nil
	})
	if err != nil {
		return nil, err
	}
	sig := func(x model.Server) (string, string) {
		wan, _, nets, _ := snap.ServerNet(&x)
		return strings.Join(nets, ","), strings.Join(nets, ",") + "|" + wan.Dev + "|" + strconv.FormatBool(x.LanLike)
	}
	before, sigWas := sig(was)
	_, sigNow := sig(now)
	var what []string
	if sigNow != sigWas {
		what = append(what, "home network and internet path")
	}
	if mesh != was.Mesh {
		what = append(what, meshWords[mesh])
	}
	if len(what) > 0 && d.Log != nil {
		d.Log.Write("awg", "info", "changed", "", was.Name, servicelog.Extra{By: "admin", Kind: "server", Note: strings.Join(what, ", "), SID: id})
	}
	if d.Apply != nil {
		d.Apply(text(a["lang"]))
	}
	if d.Told != nil {
		d.Told()
	}
	w := d.World()
	if w == nil || w.M == nil {
		_, m, _ := d.Store.Read()
		w = &view.World{M: m}
	}
	out, err := interfaces(w, d, id)
	if err != nil {
		return nil, err
	}
	eff, _ := out["effective"].(map[string]any)
	nets, _ := eff["nets"].([]string)
	out["nets_changed"] = before != strings.Join(nets, ",")
	return out, nil
}

// caps is what the installed AmneziaWG can do.
func caps(d Deps) awg.Caps {
	if d.Caps != nil {
		return d.Caps()
	}
	return awg.SystemCaps(d.DataDir)
}

// defaultMethod is the disguise a new server gets: the strongest this router can run.
func defaultMethod(d Deps) string {
	switch c := caps(d); {
	case c.V3:
		return "max"
	case c.V2:
		return "balanced"
	}
	return "off"
}

// checkMethod refuses a disguise the installed AmneziaWG cannot run, in the admin's words.
func checkMethod(d Deps, name string) error {
	if name != "off" && name != "balanced" && name != "max" {
		return errors.New("Unknown disguise method.")
	}
	c := caps(d)
	installed := true
	if d.AWG != nil {
		st := d.AWG()
		installed = st["tools"] == true && st["kmod"] == true
	}
	if name == "max" && !c.V3 {
		if installed {
			return errors.New("Maximum needs AmneziaWG 3.1 on the router (kmod-amneziawg, amneziawg-tools 3.1): install a 3.1 build in Dawnline → Components.")
		}
		return errors.New("AmneziaWG is not installed: install it in Dawnline → Components, then choose Maximum.")
	}
	if name == "balanced" && !c.V2 {
		if installed {
			return errors.New("Balanced needs AmneziaWG 2.0 or newer on the router: install a current build in Dawnline → Components.")
		}
		return errors.New("AmneziaWG is not installed: install it in Dawnline → Components, then choose Balanced.")
	}
	return nil
}

// serverObfuscation gives a server a new disguise of a method (the strongest the router runs when none is
// named): its old values go, the new ones are made here, and it is applied.
func serverObfuscation(d Deps, id, preset, lang string) (map[string]any, error) {
	if preset == "" {
		preset = defaultMethod(d)
	}
	if err := checkMethod(d, preset); err != nil {
		return nil, err
	}
	values := disguise.Preset(preset)
	// a cheap self-check: new values pass what a restore would be held to
	o := map[string]string{}
	for _, p := range values {
		o[p.Key] = p.Value
	}
	if errs := disguise.Errors(o); len(errs) > 0 {
		return nil, errors.New(strings.Join(errs, " "))
	}
	name := ""
	err := write(d, func(c *uci.Config, m *model.Model) error {
		srv := m.Servers[id]
		if srv == nil {
			return errors.New("Unknown server.")
		}
		name = srv.Name
		for _, k := range model.ObfKeys {
			c.Delete(id, k)
		}
		for _, p := range values {
			c.Set(id, p.Key, p.Value)
		}
		c.Set(id, "preset", preset)
		return nil
	})
	if err != nil {
		return nil, err
	}
	var applied map[string]any
	if d.Apply != nil {
		applied = d.Apply(lang)
	}
	if d.Log != nil {
		d.Log.Write("awg", "info", "changed", "", name, servicelog.Extra{By: "admin", Kind: "server", Note: "disguise: " + preset, SID: id})
	}
	if d.Told != nil {
		d.Told()
	}
	if applied == nil {
		applied = map[string]any{}
	}
	return applied, nil
}

// needLoaded: a server is made only where AmneziaWG is installed and its module loads. The golden's test
// turns it off, as the copy of ucode its golden ran on has that one check taken out.
var needLoaded = true

var serverID = regexp.MustCompile(`^[a-z][a-z0-9_]{0,23}$`)

// serverCreate sets a server up (the wizard's last step): its section with keys made here and the disguise
// of its method, the portal as asked, then ucode's full apply and the service turned on and restarted.
func serverCreate(d Deps, a map[string]any) (map[string]any, error) {
	if needLoaded {
		if err := needAWG(d); err != nil {
			return nil, err
		}
	}
	// an installed module that is not loaded yet is loaded: nothing loads it before the first tunnel comes up
	if needLoaded && d.AWG != nil && d.AWG()["loaded"] != true {
		exec.Command("modprobe", "amneziawg").Run()
		if d.AWG()["loaded"] != true {
			return nil, errors.New("AmneziaWG's kernel module doesn't load on this firmware: reinstall a build for this kernel in Components.")
		}
	}
	if d.Snapshot == nil {
		return nil, errors.New("The router is still starting. Try again in a moment.")
	}
	snap := d.Snapshot()
	var routerNets []string
	if d.Addresses != nil {
		for _, x := range d.Addresses() {
			routerNets = append(routerNets, x.CIDR)
		}
	}
	t := i18n.Use(d.Catalogs, text(a["lang"]))
	id, name, port := asString(a["id"]), "", 0
	if id == "" {
		id = "home"
	}
	err := write(d, func(c *uci.Config, m *model.Model) error {
		// a section's name: a dash would make uci drop it silently
		if !serverID.MatchString(id) {
			return errors.New("Server ID may use lowercase letters, digits and underscores.")
		}
		if idTaken(m, id) {
			return said{`"%s" is already taken.`, []any{id}}
		}
		network := parseFile("/etc/config/network")
		ifname := asString(a["ifname"])
		if ifname == "" {
			ifname = freeIfname(m, network)
		}
		free := (network == nil || network.Section(ifname) == nil) && ifname != "dlx0" && ifname != "dll0"
		for _, s := range m.Servers {
			free = free && s.Ifname != ifname
		}
		if !free {
			return said{"Network interface %s already exists.", []any{ifname}}
		}
		wanZone := asString(a["wan_zone"])
		if wanZone == "" {
			wanZone = "wan"
		}
		udp := udpHeld(m, &model.Server{WanZone: wanZone}, t)
		port = freePort(udp)
		if p := asString(a["port"]); a["port"] != nil && p != "" && p != "0" {
			if !ValidPort(p) {
				return errors.New("UDP port must be 1-65535.")
			}
			port, _ = strconv.Atoi(p)
		}
		for _, h := range udp {
			if h["from"].(int) <= port && port <= h["to"].(int) {
				return said{"UDP %d is used by %s. Choose another port.", []any{port, h["who"]}}
			}
		}
		mtu := asString(a["mtu"])
		if mtu == "0" {
			mtu = ""
		}
		if n, _ := strconv.Atoi(mtu); mtu != "" && (!mtuArg.MatchString(mtu) || n < 1280 || n > 1500) {
			return errors.New("MTU must be 1280-1500.")
		}
		preset := asString(a["preset"])
		if preset == "" {
			preset = defaultMethod(d)
		}
		if err := checkMethod(d, preset); err != nil {
			return err
		}
		values := disguise.Preset(preset)
		subnet := asString(a["subnet"])
		pc, isNet := ipnet.Subnet(subnet)
		if isNet {
			subnet = pc.String()
			// public addresses inside the tunnel would hide the real hosts behind them
			if !privateNet(pc) {
				return errors.New("Use a private range: 10.x.x.x, 172.16–31.x.x or 192.168.x.x.")
			}
		}
		endpointHost := asString(a["endpoint"])
		// the definition against the rest of the router, every fault at once
		var errs []string
		if !model.ValidIfname(ifname) {
			errs = append(errs, t.T("Interface name: 1-12 lowercase letters, digits or _."))
		}
		if port < 1 || port > 65535 {
			errs = append(errs, t.T("Port must be 1-65535."))
		}
		if !isNet {
			errs = append(errs, t.T("Subnet must look like 10.77.0.0/24."))
		} else {
			taken := append([]string{}, routerNets...)
			for _, sid := range m.ServerIDs() {
				taken = append(taken, m.Servers[sid].Subnet)
			}
			for _, o := range taken {
				if oc, ok := ipnet.Subnet(o); ok && uint64(pc.Base) < uint64(oc.Base)+oc.Size() && uint64(oc.Base) < uint64(pc.Base)+pc.Size() {
					errs = append(errs, fmt.Sprintf(t.T("Subnet overlaps %s."), o))
				}
			}
		}
		if endpointHost != "" && !endpoint.ValidHost(endpointHost) {
			errs = append(errs, t.T("Endpoint must be a hostname or IP address."))
		}
		o := map[string]string{}
		for _, p := range values {
			o[p.Key] = p.Value
		}
		errs = append(errs, disguise.Errors(o)...)
		if len(errs) > 0 {
			return said{"%s", []any{strings.Join(errs, " ")}}
		}
		name = asString(a["name"])
		if name == "" {
			name = "Home"
		}
		if !ValidName(name) {
			return errors.New(`Server: Enter a name: up to 48 characters, without < > " or \.`)
		}
		keys := newKeys()
		if !awg.ValidKey(keys.Public) || keys.Private == "" {
			return errors.New("Key generation failed (is amneziawg-tools installed?).")
		}
		c.Add("settings", "settings")
		c.Add("server", id)
		set := func(k, v string) { c.Set(id, k, v) }
		set("name", name)
		set("ifname", ifname)
		set("port", strconv.Itoa(port))
		set("subnet", subnet)
		set("endpoint", endpointHost)
		set("mtu", mtu)
		set("keepalive", "25")
		set("private_key", keys.Private)
		set("public_key", keys.Public)
		set("preset", preset)
		for _, p := range values {
			set(p.Key, p.Value)
		}
		zone := func(k string) {
			z := asString(a[k])
			if z == "" {
				z = strings.TrimSuffix(k, "_zone")
			}
			set(k, z)
		}
		zone("lan_zone")
		zone("wan_zone")
		set("auto_wan", "1")
		set("auto_lan", "1")
		set("detected_wan", snap.WAN)
		set("detected_lan", snap.LAN)
		// off unless asked for: the loop through the LAN costs speed
		if on(a["lan_like"]) {
			set("lan_like", "1")
		} else {
			set("lan_like", "0")
		}
		set("enabled", "1")
		if a["portal_enabled"] != nil {
			if on(a["portal_enabled"]) {
				c.Set("settings", "portal_enabled", "1")
			} else {
				c.Set("settings", "portal_enabled", "0")
			}
			if p := asString(a["portal_port"]); a["portal_port"] != nil && p != "" && p != "0" {
				if !ValidPort(p) {
					return errors.New("Portal port must be 1-65535.")
				}
				n, _ := strconv.Atoi(p)
				c.Set("settings", "portal_port", strconv.Itoa(n))
			}
		}
		if host, _ := c.Section("settings").Get("portal_host"); endpointHost != "" && host == "" && endpoint.ValidHost(endpointHost) {
			c.Set("settings", "portal_host", endpointHost)
		}
		// the portal as it will be, whatever this call changed
		var blocked map[string]any
		files.ReadJSON(d.RunDir+"/netifd-blocked.json", &blocked)
		return checkPortal(model.Load(c, blocked), m, listening("tcp"), parseFile("/etc/config/firewall"))
	})
	if err != nil {
		return nil, err
	}
	var applied map[string]any
	if d.Apply != nil {
		applied = d.Apply(text(a["lang"]))
	}
	if d.Log != nil {
		d.Log.Write("dawnline", "info", "created", "", name, servicelog.Extra{By: "admin", Kind: "server", Note: "UDP " + strconv.Itoa(port), SID: id})
	}
	// netifd reads its protocol handlers when it starts: AmneziaWG installed after that needs a network restart
	networkRestart := d.AWG != nil && d.AWG()["handler"] != true
	if d.Restart != nil {
		d.Restart(networkRestart)
	}
	if d.Told != nil {
		d.Told()
	}
	if applied == nil {
		applied = map[string]any{}
	}
	return map[string]any{"id": id, "applied": applied, "network_restart": networkRestart, "warning": applied["warning"]}, nil
}
