// Package watchdog checks, once a minute, what keeps people connected and repairs what it can, waiting
// longer after each repair that did not help (dawnline.watchdog). What it finds goes to the service log
// (English, as logged); its state to watchdog.json for the Health page.
package watchdog

import (
	"fmt"
	"os"
	"strings"

	"github.com/tickcount/luci-app-dawnline/backend/files"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/servicelog"
)

// wait is the seconds before the next repair, by the number of repairs so far.
var wait = []int64{0, 120, 600, 1800, 3600}

// settled is the good minutes in a row before a repaired target's count of repairs is forgotten: one good
// minute between two failures is still flapping.
const settled = 10

// Repair is how a target is put right: what is said of it ("restarting it"), how many times at most
// (0: no limit), and the doing (n: which try this is).
type Repair struct {
	What string
	Max  int
	Run  func(n int)
}

// Probe is one thing looked at. ID is the Health check's id; Name the chip (stored in English); Who the
// log's subject. The log reads "<who> <problem> - <what>".
type Probe struct {
	ID, Src, Name, Who string
	OK                 bool
	Problem, Back      string
	Detail             func() string
	Repair             *Repair
}

// Target is what is kept of a target between passes.
type Target struct {
	Bad      int    `json:"bad"`
	Tries    int    `json:"tries"`
	Next     int64  `json:"next"`
	Name     string `json:"name"`
	OK       bool   `json:"ok"`
	Reported bool   `json:"reported"`
	Stuck    bool   `json:"stuck"`
	Good     int    `json:"good"`
	Last     int64  `json:"last,omitempty"`
}

// Fixed is a repair that was made.
type Fixed struct {
	TS   int64  `json:"ts"`
	ID   string `json:"id"`
	Name string `json:"name"`
}

// State is watchdog.json.
type State struct {
	Last    int64              `json:"last"`
	Targets map[string]*Target `json:"targets"`
	Repairs []Fixed            `json:"repairs"`
}

// Pass is one pass over the probes. With fix off it only reports. busy: an update is replacing packages
// or restarting tunnels; what looks broken meanwhile is being worked on, and repairs would only get in
// its way.
func Pass(path string, probes []Probe, fix, busy bool, now int64, log *servicelog.Log) {
	say := func(src, level, msg string, detail func() string, who string) {
		if log == nil {
			return
		}
		d := ""
		if detail != nil {
			d = detail()
		}
		log.Write(src, level, msg, d, who, servicelog.Extra{})
	}
	var st State
	files.ReadJSON(path, &st)
	if st.Targets == nil {
		st.Targets = map[string]*Target{}
	}
	repairs := []Fixed{}
	for _, r := range st.Repairs {
		if now-r.TS < 86400 {
			repairs = append(repairs, r)
		}
	}
	seen := map[string]bool{}
	for _, p := range probes {
		seen[p.ID] = true
		x := st.Targets[p.ID]
		if x == nil {
			x = &Target{}
			st.Targets[p.ID] = x
		}
		x.Name, x.OK = p.Name, p.OK
		if p.OK {
			if x.Reported {
				msg := p.Back
				switch {
				case x.Stuck:
					msg = p.Back + " · restored"
				case x.Tries > 1:
					msg = fmt.Sprintf("%s (after %d repairs)", p.Back, x.Tries)
				case x.Tries == 1:
					msg = fmt.Sprintf("%s (after %d repair)", p.Back, x.Tries)
				}
				say(p.Src, "up", msg, nil, p.Who)
			}
			x.Bad, x.Next, x.Reported, x.Stuck = 0, 0, false, false
			// The repairs so far are forgotten only once it has stayed up a while.
			if x.Good++; x.Good >= settled {
				x.Tries, x.Good = 0, 0
			}
			continue
		}
		x.Good = 0
		// one bad minute can be a restart in progress
		if x.Bad++; x.Bad < 2 {
			continue
		}
		if busy {
			continue
		}
		max := 0
		if p.Repair != nil {
			max = p.Repair.Max
		}
		if max > 0 && x.Tries >= max && !x.Reported {
			say(p.Src, "error", fmt.Sprintf("%s - not repaired again (%d repairs didn't help)", p.Problem, max), p.Detail, p.Who)
			x.Reported = true
			continue
		}
		if !fix || p.Repair == nil || (max > 0 && x.Tries >= max) {
			if !x.Reported {
				say(p.Src, "error", p.Problem, p.Detail, p.Who)
			}
			x.Reported = true
			continue
		}
		// Three repairs did not help: said once, and from then on it keeps trying quietly until it works
		// again (that is logged).
		if x.Tries >= 3 && !x.Stuck && now-x.Last >= 50 {
			x.Stuck = true
			say(p.Src, "error", fmt.Sprintf("%s - %d repairs didn't help", p.Problem, x.Tries), p.Detail, p.Who)
		}
		if now < x.Next {
			continue
		}
		x.Tries++
		x.Last = now
		w := x.Tries
		if w > len(wait)-1 {
			w = len(wait) - 1
		}
		x.Next = now + wait[w]
		x.Reported = true
		if !x.Stuck {
			say(p.Src, "repair", p.Problem+" - "+p.Repair.What, p.Detail, p.Who)
		}
		func() {
			defer func() {
				if e := recover(); e != nil && !x.Stuck {
					say(p.Src, "error", fmt.Sprintf("couldn't be repaired: %v", e), nil, p.Who)
				}
			}()
			p.Repair.Run(x.Tries)
		}()
		if !x.Stuck {
			repairs = append(repairs, Fixed{TS: now, ID: p.ID, Name: p.Name})
		}
	}
	for id := range st.Targets {
		if !seen[id] {
			delete(st.Targets, id)
		}
	}
	st.Last, st.Repairs = now, repairs
	if i := strings.LastIndex(path, "/"); i > 0 {
		os.MkdirAll(path[:i], 0o755)
	}
	files.WriteJSON(path, st, 0o644)
}

// Iface is netifd's word on an interface.
type Iface struct {
	Exists, Up bool
}

// Facts is what the probes are made from: the router as it is now, and what repairs it.
type Facts struct {
	// AmneziaWG: its tool and protocol script, its module (installed, loaded), netifd's handler for it,
	// the packages that are missing.
	Tools, Kmod, Loaded, Handler bool
	Missing                      []string
	// Owner is whose an interface of the network configuration is: has false when there is none, id ""
	// when it is not Dawnline's.
	Owner func(ifname string) (id string, has bool)
	Iface func(ifname string) Iface
	// IfaceErrors is why a tunnel is down, from netifd and the last related syslog lines.
	IfaceErrors  func(ifname string) string
	UDPListening func(port int) bool
	// Drift is what of each running server's interface differs from what Dawnline writes, by option name.
	Drift map[string][]string
	// NftPresent: the access table is loaded. Firewall: "" fine, "off", "changed" or "not loaded".
	NftPresent bool
	Firewall   string
	// The portal: whether it can run at all here (HTTPS is there, nobody else holds its port), and listens.
	PortalCan, PortalListening bool
	// The Home-only resolver: its configuration is there, and it runs.
	ResolverConf, ResolverRunning bool
	// Said is the last lines of syslog about something ("uhttpd", "rpcd"), for a problem's detail.
	Said func(what string) string
	// Reapply is the full apply; Run a command; StartServices starts the service's missing instances.
	Reapply       func()
	Run           func(name string, args ...string)
	StartServices func()
	// BlockedNote and BlockedFix word why a server is kept down.
	BlockedNote, BlockedFix func(why map[string]any) string
}

// Probes is what to look at for these settings on this router.
func Probes(m *model.Model, f Facts) []Probe {
	var out []Probe
	var on []*model.Server
	keyed := false
	for _, id := range m.ServerIDs() {
		srv := m.Servers[id]
		keyed = keyed || srv.PrivateKey != ""
		if srv.Enabled && srv.PrivateKey != "" {
			on = append(on, srv)
		}
	}
	// The tunnels check themselves: AmneziaWG first (without it no tunnel can run), then each server's interface.
	awgOK := false
	tunnels := func() {
		if len(on) == 0 {
			return
		}
		base := Probe{ID: "awg", Src: "awg", Name: "AmneziaWG", Who: "AmneziaWG", Back: "is ready again"}
		if !f.Tools || !f.Kmod {
			p := base
			p.Problem = "isn't installed: no tunnel can run - install it in Dawnline → Components"
			if f.Tools {
				p.Problem = "kernel module isn't installed: no tunnel can run - install it in Dawnline → Components"
			}
			p.Detail = func() string { return "Missing: " + strings.Join(f.Missing, ", ") + "." }
			out = append(out, p)
			return
		}
		p := base
		p.OK = f.Loaded && f.Handler
		awgOK = p.OK
		if !f.Loaded {
			p.Problem = "kernel module isn't loaded"
			p.Detail = func() string { return f.Said("modprobe") }
			p.Repair = &Repair{What: "loading it", Run: func(int) { f.Run("modprobe", "amneziawg") }}
		} else {
			p.Problem = "isn't known to the network service - restart the network or reboot"
			p.Detail = func() string {
				return "netifd reads its protocol handlers when it starts; it was running before AmneziaWG was installed."
			}
		}
		out = append(out, p)
		// without the protocol handler ifup cannot work: the tunnels are not probed (or restarted) one by one
		if f.Loaded && !f.Handler {
			return
		}
		for _, srv := range on {
			srv := srv
			t := Probe{ID: "up_" + srv.ID, Src: "awg", Name: srv.Name + " · AmneziaWG", Who: srv.Name}
			// A tunnel Dawnline may not set up is reported, never restarted: an interface of the same name
			// that isn't Dawnline's may be your LAN.
			why, _ := srv.Blocked.(map[string]any)
			if why == nil {
				if !model.ValidIfname(srv.Ifname) {
					why = map[string]any{"code": "ifname", "ifname": srv.Ifname}
				} else if owner, has := f.Owner(srv.Ifname); has && owner != srv.ID {
					why = map[string]any{"code": "taken", "ifname": srv.Ifname}
				}
			}
			if why != nil {
				t.Problem, t.Back = f.BlockedNote(why), "AmneziaWG is running again"
				t.Detail = func() string { return f.BlockedFix(why) }
				out = append(out, t)
				continue
			}
			s := f.Iface(srv.Ifname)
			t.OK = s.Up && f.UDPListening(srv.Port)
			switch {
			case !s.Exists:
				t.Problem = "AmneziaWG is missing from the router"
			case !s.Up:
				t.Problem = "AmneziaWG isn't running"
			default:
				t.Problem = fmt.Sprintf("AmneziaWG isn't accepting connections on port %d", srv.Port)
			}
			t.Back = fmt.Sprintf("AmneziaWG is running again · accepting connections on port %d", srv.Port)
			t.Detail = func() string { return f.IfaceErrors(srv.Ifname) }
			if s.Exists {
				t.Repair = &Repair{What: "restarting it", Run: func(int) { f.Run("ifup", srv.Ifname) }}
			} else {
				t.Repair = &Repair{What: "setting it up again", Run: func(int) { f.Reapply() }}
			}
			out = append(out, t)
		}
	}
	tunnels()
	// A tunnel's interface edited outside Dawnline keeps that until the next apply: set up again with
	// Dawnline's settings. Only while AmneziaWG itself works (its target comes first, and is fixed first).
	if awgOK {
		for _, id := range m.ServerIDs() {
			diff, has := f.Drift[id]
			if !has {
				continue
			}
			srv := m.Servers[id]
			out = append(out, Probe{ID: "cfg_" + id, Src: "awg", Name: srv.Name + " · interface settings", Who: srv.Name, OK: len(diff) == 0,
				Problem: fmt.Sprintf("interface %s was changed outside Dawnline", srv.Ifname),
				Back:    fmt.Sprintf("interface %s has Dawnline's settings again", srv.Ifname),
				// option names only: their values hold the server's private key
				Detail: func() string { return "Changed: " + strings.Join(diff, ", ") + "." },
				Repair: &Repair{What: "setting it up again", Run: func(int) { f.Reapply() }}})
		}
	}
	if len(m.Servers) > 0 {
		out = append(out, Probe{ID: "nft", Src: "dawnline", Name: "Access rules", Who: "Access rules", OK: f.NftPresent,
			Problem: "are missing", Back: "are loaded again", Repair: &Repair{What: "loading them again", Run: func(int) { f.Reapply() }}})
	}
	if keyed {
		p := Probe{ID: "fw", Src: "dawnline", Name: "Firewall", Who: "Firewall", OK: f.Firewall == "", Back: "rules for Dawnline are in place again"}
		switch f.Firewall {
		case "off":
			// fw4 stopped on purpose is the admin's call: report it, do not start it
			p.Problem = "isn't running on this router (fw4): tunnels and the portal are closed"
		case "changed":
			p.Problem = "rules for Dawnline were changed or removed"
		default:
			p.Problem = "rules for Dawnline aren't loaded"
		}
		if f.Firewall != "off" {
			p.Repair = &Repair{What: "restoring them", Run: func(int) { f.Reapply(); f.Run("fw4", "-q", "reload") }}
		}
		out = append(out, p)
	}
	if s := m.Settings; s.PortalEnabled && f.PortalCan {
		out = append(out, Probe{ID: "portal", Src: "portal", Name: "Portal", Who: "Personal portal", OK: f.PortalListening,
			Problem: fmt.Sprintf("isn't answering on port %d", s.PortalPort), Back: "answers again",
			Detail: func() string { return f.Said("portal") }, Repair: &Repair{What: "restarting it", Run: func(int) { f.StartServices() }}})
	}
	// only while a server is on: with all of them off the resolver idles on loopback
	if f.ResolverConf && len(on) > 0 {
		out = append(out, Probe{ID: "resolver", Src: "dawnline", Name: "Resolver", Who: "DNS for Home-only devices", OK: f.ResolverRunning,
			Problem: "isn't running", Back: "runs again", Repair: &Repair{What: "restarting it", Run: func(int) { f.StartServices() }}})
	}
	return out
}
