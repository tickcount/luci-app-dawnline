package roster

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	backend "github.com/tickcount/luci-app-dawnline/backend"
	"github.com/tickcount/luci-app-dawnline/backend/awg"
	"github.com/tickcount/luci-app-dawnline/backend/disguise"
	"github.com/tickcount/luci-app-dawnline/backend/files"
	"github.com/tickcount/luci-app-dawnline/backend/ipnet"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/zone"
)

// The links of the path that makes tunnel devices look like home devices (dawnline.loop).
const transit, inner = "dlx0", "dll0"

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// LikeHome is the home-like path's last applied state, as dawnline.loop status() tells it. ok is false
// when it holds a reason only ucode can word yet (a refusal with its values).
func LikeHome(run string) (map[string]any, bool) {
	var s struct {
		Plan *struct {
			Dev     any `json:"dev"`
			Address any `json:"address"`
			DNS     any `json:"dns"`
			Gateway any `json:"gateway"`
			TxNS    any `json:"tx_ns"`
		} `json:"plan"`
		Off   any `json:"off"`
		Error any `json:"error"`
	}
	files.ReadJSON(run+"/loop.json", &s)
	if s.Plan != nil {
		master, _ := os.Readlink("/sys/class/net/" + inner + "/master")
		dev, _ := s.Plan.Dev.(string)
		return map[string]any{
			"active": exists("/sys/class/net/"+transit) && exists("/sys/class/net/"+inner),
			"dev":    s.Plan.Dev, "address": s.Plan.Address, "dns": s.Plan.DNS, "gateway": s.Plan.Gateway, "transit": s.Plan.TxNS,
			"bridged": master != "" && filepath.Base(master) == dev,
		}, true
	}
	if e, coded := s.Error.(map[string]any); coded {
		s.Error = likeHomeError(e)
	}
	off := s.Off != nil && s.Off != false && s.Off != float64(0) && s.Off != ""
	return map[string]any{"active": false, "off": off, "error": s.Error}, true
}

// likeHomeError says why the home-like path could not be set up (dawnline.loop error_text), in English as
// the stream's reader is given it.
func likeHomeError(e map[string]any) string {
	switch e["code"] {
	case "no_lan":
		return "No LAN detected."
	case "not_bridge":
		return fmt.Sprintf("%v is not a bridge, so Dawnline cannot join the LAN as a device.", e["dev"])
	case "no_ipv4":
		return fmt.Sprintf("%v has no IPv4 address.", e["dev"])
	case "no_address":
		return fmt.Sprintf("No free address on %v.", e["net"])
	case "no_transit":
		return "No free link-local range for the internal link."
	case "no_table":
		return "No free routing table."
	}
	return fmt.Sprintf("Setup failed: %v", e["detail"])
}

// blockedText says why a server is kept down (dawnline.awg blocked_text), or nil when it is not. ok is false
// for a reason kept in a shape Go does not know.
func blockedText(srv *model.Server) (text any, ok bool) {
	switch r := srv.Blocked.(type) {
	case nil:
		return nil, true
	case string:
		return srv.Name + " " + r + ".", true
	case map[string]any:
		switch r["code"] {
		case "ifname":
			return fmt.Sprintf("%s has an invalid interface name \"%v\".", srv.Name, r["ifname"]), true
		case "taken":
			return fmt.Sprintf("%s can't use the network interface %v: it exists and isn't Dawnline's.", srv.Name, r["ifname"]), true
		case "disguise":
			if in, _ := r["installed"].(string); in != "" {
				return fmt.Sprintf("%s is kept down: its disguise needs AmneziaWG %v (installed: %s).", srv.Name, r["need"], in), true
			}
			return fmt.Sprintf("%s is kept down: its disguise needs AmneziaWG %v (installed: none).", srv.Name, r["need"]), true
		case "disguise_invalid":
			// which values, from the server's own
			return strings.Trim(fmt.Sprintf("%s is kept down: its disguise has values AmneziaWG cannot take. %s", srv.Name, strings.Join(disguise.Unsafe(srv.Obf), " ")), " \t\r\n\v\f"), true
		}
		return srv.Name + " is kept down.", true
	}
	return nil, false
}

// AwgState is what of AmneziaWG is on the router (dawnline.awg state()); handler: netifd lists its protocol.
func AwgState(handler func() bool) map[string]any {
	tools := exists("/usr/bin/awg") && exists("/lib/netifd/proto/amneziawg.sh")
	loaded := exists("/sys/module/amneziawg")
	rel, _ := os.ReadFile("/proc/sys/kernel/osrelease")
	r := strings.TrimSpace(string(rel))
	kmod := loaded || (r != "" && exists("/lib/modules/"+r+"/amneziawg.ko"))
	has := tools && handler != nil && handler()
	missing := []any{}
	if !kmod {
		missing = append(missing, "kmod-amneziawg")
	}
	if !tools {
		missing = append(missing, "amneziawg-tools")
	}
	return map[string]any{"tools": tools, "kmod": kmod, "loaded": loaded, "handler": has, "missing": missing, "ok": len(missing) == 0 && loaded && has}
}

// publicWAN is the router's public IPv4, or nil when it has none or a private one.
func publicWAN(wan string) any {
	n, ok := ipnet.IP(wan)
	if !ok {
		return nil
	}
	for _, p := range []string{"100.64.0.0/10", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"} {
		if r, _ := ipnet.Any(p); r.Holds(n) {
			return nil
		}
	}
	return wan
}

// shown is what of the settings every page is shown.
func shown(set model.Settings) map[string]any {
	return map[string]any{
		"portal_enabled": set.PortalEnabled, "portal_port": set.PortalPort, "portal_host": set.PortalHost,
		"portal_public_port": set.PortalPort, "default_device_limit": set.DefaultDeviceLimit, "domain": set.Domain,
		"hostnames": set.Hostnames, "geo_enabled": set.GeoEnabled, "home_dns_fallback": set.HomeDNSFallback,
	}
}

// routerOf is the `router` and `clock` parts of a status that Go can tell, and whether that is all of them:
// a part it cannot tell yet is left out.
func (r *Roster) routerOf(m *model.Model, now int64) (map[string]any, bool) {
	host, _ := os.ReadFile("/proc/sys/kernel/hostname")
	_, off := time.Unix(now, 0).In(zone.Local()).Zone()
	out := map[string]any{
		"version": backend.Version, "hostname": strings.TrimSpace(string(host)), "tz": off / 60,
		"awg_state": AwgState(r.Handler), "settings": shown(m.Settings),
	}
	all := r.Handler != nil && r.WAN != nil
	if lh, ok := LikeHome(r.RunDir); ok {
		out["like_home"] = lh
	} else {
		all = false
	}
	out["awg"] = awg.SystemCaps(r.DataDir)
	if r.WAN != nil {
		out["wan"] = publicWAN(r.WAN(m))
	}
	return out, all
}
