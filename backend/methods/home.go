package methods

import (
	"errors"
	"os"
	"sort"
	"strings"
	"time"

	backend "github.com/tickcount/luci-app-dawnline/backend"
	"github.com/tickcount/luci-app-dawnline/backend/ipnet"
	"github.com/tickcount/luci-app-dawnline/backend/view"
)

// homeHosts is the devices at home for the Home services picker: DHCP leases and static hosts in a
// server's home networks, with the services they announce (Bonjour, when umdns runs). A server not named
// is the first one. Each device's services are in the order of their type, then their name.
func homeHosts(w *view.World, d Deps, id, leases, dhcp string) (map[string]any, error) {
	srv := w.M.Servers[id]
	if ids := w.M.ServerIDs(); srv == nil && len(ids) > 0 {
		srv = w.M.Servers[ids[0]]
	}
	if srv == nil || d.Snapshot == nil {
		return nil, errors.New("No server yet.")
	}
	_, _, cidrs, _ := d.Snapshot().ServerNet(srv)
	var nets []ipnet.Net
	for _, c := range cidrs {
		if n, ok := ipnet.Any(c); ok && strings.Contains(c, "/") {
			nets = append(nets, n)
		}
	}
	inside := func(ip string) bool {
		n, ok := ipnet.IP(ip)
		if !ok {
			return false
		}
		for _, r := range nets {
			if r.Holds(n) {
				return true
			}
		}
		return false
	}
	type host struct {
		Address  string           `json:"address"`
		Name     string           `json:"name"`
		MAC      string           `json:"mac"`
		Services []map[string]any `json:"services"`
	}
	hosts := map[string]*host{}
	raw, _ := os.ReadFile(leases)
	for _, line := range strings.Split(string(raw), "\n") {
		if f := strings.Split(line, " "); len(f) >= 4 && inside(f[2]) {
			name := f[3]
			if name == "*" {
				name = ""
			}
			hosts[f[2]] = &host{Address: f[2], Name: name, MAC: f[1], Services: []map[string]any{}}
		}
	}
	if c := parseFile(dhcp); c != nil {
		for _, h := range c.OfType("host") {
			ip, _ := h.Get("ip")
			if ip == "" || !inside(ip) || hosts[ip] != nil {
				continue
			}
			name, _ := h.Get("name")
			mac := h.Values["mac"]
			if mac.IsList && len(mac.List) > 0 {
				mac.Str = mac.List[0]
			}
			hosts[ip] = &host{Address: ip, Name: name, MAC: mac.Str, Services: []map[string]any{}}
		}
	}
	// what is announced on the home networks, from OpenWrt's mDNS daemon while it answers
	var browse map[string]any
	if d.Bus != nil {
		browse = d.Bus("umdns", "browse", map[string]any{"address": true, "array": true})
	}
	types := make([]string, 0, len(browse))
	for t := range browse {
		types = append(types, t)
	}
	sort.Strings(types)
	for _, t := range types {
		insts, _ := browse[t].(map[string]any)
		names := make([]string, 0, len(insts))
		for n := range insts {
			names = append(names, n)
		}
		sort.Strings(names)
		for _, name := range names {
			i, _ := insts[name].(map[string]any)
			addr := text(i["ipv4"])
			if list, ok := i["ipv4"].([]any); ok && len(list) > 0 {
				addr = text(list[0])
			}
			if addr == "" {
				continue
			}
			port := i["port"]
			if port == nil {
				port = 0
			}
			svc := map[string]any{"type": t, "name": name, "port": port}
			if h := hosts[addr]; h != nil {
				h.Services = append(h.Services, svc)
			} else if inside(addr) {
				hn := strings.TrimSuffix(strings.TrimSuffix(text(i["host"]), "."), ".local")
				hosts[addr] = &host{Address: addr, Name: hn, Services: []map[string]any{svc}}
			}
		}
	}
	list := make([]*host, 0, len(hosts))
	for _, h := range hosts {
		list = append(list, h)
	}
	sort.Slice(list, func(i, j int) bool {
		a, _ := ipnet.IP(list[i].Address)
		b, _ := ipnet.IP(list[j].Address)
		return a < b
	})
	return map[string]any{"hosts": list, "mdns": browse != nil}, nil
}

// export is every section of the settings as written, for the admin to keep (it holds private keys).
func export(d Deps) (map[string]any, error) {
	sections := []map[string]any{}
	if c := parseFile(d.Config); c != nil {
		for _, s := range c.Sections {
			o := map[string]any{".type": s.Type, ".name": s.Name}
			for k, v := range s.Values {
				if v.IsList {
					o[k] = v.List
				} else {
					o[k] = v.Str
				}
			}
			sections = append(sections, o)
		}
	}
	if d.Log != nil {
		d.Log.Admin("dawnline", "exported", "", "all settings", "the file holds private keys")
	}
	return map[string]any{"format": "dawnline", "version": backend.Version, "exported": time.Now().Unix(), "sections": sections}, nil
}
