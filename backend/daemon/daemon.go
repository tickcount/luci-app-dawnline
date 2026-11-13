// Package daemon is the running backend: it joins the parts and keeps them
// going until it is told to stop. cmd/dawnlined gives it the router's paths;
// a test gives it a stand's.
package daemon

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"

	backend "github.com/tickcount/luci-app-dawnline/backend"
	"github.com/tickcount/luci-app-dawnline/backend/api"
	"github.com/tickcount/luci-app-dawnline/backend/apply"
	"github.com/tickcount/luci-app-dawnline/backend/awg"
	"github.com/tickcount/luci-app-dawnline/backend/bridge"
	minute "github.com/tickcount/luci-app-dawnline/backend/chores"
	"github.com/tickcount/luci-app-dawnline/backend/files"
	"github.com/tickcount/luci-app-dawnline/backend/geo"
	"github.com/tickcount/luci-app-dawnline/backend/github"
	"github.com/tickcount/luci-app-dawnline/backend/hub"
	"github.com/tickcount/luci-app-dawnline/backend/i18n"
	"github.com/tickcount/luci-app-dawnline/backend/journal"
	"github.com/tickcount/luci-app-dawnline/backend/methods"
	"github.com/tickcount/luci-app-dawnline/backend/migrate"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/netview"
	"github.com/tickcount/luci-app-dawnline/backend/portal"
	"github.com/tickcount/luci-app-dawnline/backend/resolve"
	"github.com/tickcount/luci-app-dawnline/backend/roster"
	"github.com/tickcount/luci-app-dawnline/backend/servicelog"
	"github.com/tickcount/luci-app-dawnline/backend/store"
	"github.com/tickcount/luci-app-dawnline/backend/ubus"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
	"github.com/tickcount/luci-app-dawnline/backend/usage"
	"github.com/tickcount/luci-app-dawnline/backend/view"
	"github.com/tickcount/luci-app-dawnline/backend/watch"
	"github.com/tickcount/luci-app-dawnline/backend/watchdog"
	"github.com/tickcount/luci-app-dawnline/backend/zone"
)

// Options is where the backend finds the router.
type Options struct {
	// Socket is ubusd's.
	Socket string
	// RunDir holds runtime state (tmpfs), DataDir kept state (flash), Config the settings file.
	RunDir, DataDir, Config string
	// Stream is how pages follow: "sse" or "poll" (api.Info).
	Stream string
	// Watch: the backend looks at the tunnels and keeps the router to the settings (always, on a router; a
	// test stand that only wants the bus and the stream leaves it off).
	Watch bool
	// Tunnels reads the tunnels the watcher looks at; nil: the router's own (awg.System). A test stand's are
	// in its hands.
	Tunnels *awg.Reader
	// Portal: the backend serves the personal portal itself (package portal); nil: its own web server does.
	Portal *Portal
	// Log gets the lines for the system log.
	Log func(format string, args ...any)
}

// Portal is what the portal's web server runs with (the init script works it out).
type Portal struct {
	// Port is the HTTPS port, HTTP the plain one beside it (0: none); Cert and Key the certificate's files.
	Port, HTTP int
	Cert, Key  string
	// Procs is how many of the ucode portal run at once.
	Procs int
}

// Run works until ctx ends, then waits for its parts.
func Run(ctx context.Context, o Options) {
	// The router's zone, before anything counts a day in it (OpenWrt keeps it where Go does not look).
	zone.Load(zone.File)
	h := hub.New()
	audience := api.NewAudience()
	var b *bridge.Bridge
	// The watcher, when this backend runs it: what the methods it answers itself read.
	var w *watch.Watcher
	var more []ubus.Method
	nets := &homes{}
	// the portal's own answers, where this backend keeps the router (set with the watcher)
	var native http.Handler
	// set when the watcher runs: the topics Go makes itself, told again as the router is at that moment
	// (after a change of the settings)
	var publish func()
	if o.Watch {
		tunnels := awg.System()
		if o.Tunnels != nil {
			tunnels = *o.Tunnels
		}
		w = &watch.Watcher{
			Config: o.Config, RunDir: o.RunDir, DataDir: o.DataDir,
			DHCP: "/etc/config/dhcp", Leases: "/tmp/dhcp.leases", Zone: zone.File,
			Tunnels: tunnels, Hub: h, Audience: audience, Log: o.Log,
		}
		names := &resolve.Resolver{}
		// The router is this backend's to keep: its own apply, sync, keeper, chores and watchdog. One file gives
		// all of it back to the ucode backend, for as long as that one is still shipped: /etc/dawnline/backend-off
		// (the init script then starts this process without its watcher, and the agent does the work).
		mine := func() bool {
			_, err := os.Stat(o.DataDir + "/backend-off")
			return err != nil
		}
		logs := &servicelog.Log{RunDir: o.RunDir, Level: func() string {
			if world := w.World(); world != nil {
				return world.M.Settings.LogLevel
			}
			return "info"
		}}
		started(o, logs)
		defer ended(o, logs)
		syncer := &apply.Router{RunDir: o.RunDir, HostsFile: "/tmp/hosts/dawnline", DHCP: "/etc/config/dhcp", Log: logs,
			Network: "/etc/config/network", Firewall: "/etc/config/firewall",
			Remember: func(address string) {
				(store.Store{Config: o.Config, RunDir: o.RunDir}).Transact(func(c *uci.Config, _ *model.Model) error {
					if c.Section("settings") == nil {
						c.Add("settings", "settings")
					}
					c.Set("settings", "lan_address", address)
					return nil
				})
			},
			Snapshot: func() *netview.Snapshot { return netview.Take(netview.System(nets.logical)) },
			Exec: func(name string, args ...string) (string, int) {
				out, err := exec.Command(name, args...).CombinedOutput()
				if err == nil {
					return string(out), 0
				}
				if ee, isExit := err.(*exec.ExitError); isExit {
					return string(out), ee.ExitCode()
				}
				return string(out), 127
			}}
		// The keeper: once a minute, unless the router is given back to the ucode backend (mine), the runtime
		// sync, the home-like path's upkeep and the watch on the router's networks. The ucode agent leaves
		// those steps alone while this process is alive (its beat).
		keeper := &apply.Keeper{R: syncer, Config: o.Config, Words: i18n.Use(i18n.Dir, ""),
			Load: func() (*model.Model, string, error) {
				c, m, err := (store.Store{Config: o.Config, RunDir: o.RunDir}).Read()
				if err != nil {
					return nil, "", err
				}
				saved := ""
				if s := c.Section("settings"); s != nil {
					saved, _ = s.Get("lan_address")
				}
				return m, saved, nil
			},
			Usage: func() *usage.Usage {
				if world := w.World(); world != nil {
					return world.Usage
				}
				return nil
			},
			Dump: func() (map[string]awg.Peer, map[string]string) {
				if world := w.World(); world != nil {
					return world.Peers, world.Reads
				}
				return nil, nil
			},
			Tools: func() bool {
				_, tool := os.Stat("/usr/bin/awg")
				_, proto := os.Stat("/lib/netifd/proto/amneziawg.sh")
				return tool == nil && proto == nil
			},
			Caps: func() awg.Caps { return awg.SystemCaps(o.DataDir) }}
		// The other things done once a minute (package chores), with the same marker: what happens to people on
		// its own goes to the activity log, and their pages are told.
		var chores struct {
			deps methods.Deps
			run  *minute.Chores
		}
		chores.run = &minute.Chores{RunDir: o.RunDir, DataDir: o.DataDir, Config: o.Config, Log: logs,
			PortalCert: func(s model.Settings) (string, bool) { return methods.PortalCert(s, o.DataDir) },
			WanAddress: func(srv *model.Server) string { return netview.Take(netview.System(nets.logical)).WanAddress(srv) },
			Backup:     func(kind string) (string, error) { return methods.BackupCreate(chores.deps, kind) },
			Reload: func() {
				cmd := exec.Command("sh", "-c", "/etc/init.d/dawnline reload >/dev/null 2>&1")
				cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
				cmd.Start()
			},
			Updating: func() bool { return methods.Updating(o.RunDir) },
			Update: func() {
				exec.Command("start-stop-daemon", "-S", "-b", "-x", "/usr/libexec/dawnline/updater", "--", "auto").Run()
			}}
		// The places for the map: lookups run by themselves, a few at a time; what they find goes onto the
		// connections logged before it was known, and those people's pages are told.
		poke := func(people []string) {
			if len(people) == 0 {
				return
			}
			var waiting []string
			files.ReadJSON(o.RunDir+"/presence.poke", &waiting)
			files.WriteJSON(o.RunDir+"/presence.poke", append(waiting, people...), 0o600)
		}
		places := &geo.Locator{Store: geo.Store{Run: o.RunDir, Data: o.DataDir}, Get: geo.HTTP,
			Usage: func() *usage.Usage {
				if world := w.World(); world != nil {
					return world.Usage
				}
				return nil
			},
			Found: func(where map[string]string, devices []string) {
				journal.Log{Run: o.RunDir, Data: o.DataDir}.SetPlaces(where, time.Now().Unix()-3600)
				world := w.World()
				if world == nil {
					return
				}
				var people []string
				for _, id := range devices {
					if d := world.M.Devices[id]; d != nil {
						people = append(people, d.Person)
					}
				}
				poke(people)
			}}
		chores.run.FlushPlaces = func() { places.Store.Flush() }
		go func() {
			// the addresses the watcher saw connect or move: located at once
			for {
				time.Sleep(time.Second)
				if !mine() {
					continue
				}
				var ips []string
				if !files.ReadJSON(o.RunDir+"/geo.poke", &ips) {
					continue
				}
				os.Remove(o.RunDir + "/geo.poke")
				if world := w.World(); world != nil && world.M.Settings.GeoEnabled {
					places.Ask(world.M.Settings.GeoProvider, ips, nil)
				}
			}
		}()
		others := func() {
			world := w.World()
			if world == nil {
				return
			}
			_, m, err := (store.Store{Config: o.Config, RunDir: o.RunDir}).Read()
			if err != nil {
				return
			}
			events := chores.run.Tick(m, world.Usage)
			wan := ""
			if st := chores.deps.Bus; st != nil {
				list, _ := st("network.interface.wan", "status", nil)["ipv4-address"].([]any)
				if len(list) > 0 {
					first, _ := list[0].(map[string]any)
					wan, _ = first["address"].(string)
				}
			}
			places.Minute(m.Settings.GeoEnabled, m.Settings.GeoProvider, wan)
			if len(events) == 0 {
				return
			}
			log := journal.Log{Run: o.RunDir, Data: o.DataDir}
			if err := log.Add(events, journal.PolicyOf(m.Settings.Retention), journal.NamesOf(m), time.Now().Unix()); err != nil {
				logs.Say("error", "chores", "the activity log was not written · "+err.Error())
			}
			// the watcher moves these people's revisions with its next look, so their pages follow
			var people []string
			for _, e := range events {
				if p, _ := e["person"].(string); p != "" {
					people = append(people, p)
				}
			}
			poke(people)
		}
		go func() {
			// the first look once the watcher has its own, then every minute
			for wait := 15 * time.Second; ; wait = time.Minute {
				time.Sleep(wait)
				if mine() {
					beatNow(o)
					keeper.Tick()
					others()
					// the watchdog: what keeps people connected, looked at and repaired
					func() {
						defer func() {
							if e := recover(); e != nil {
								logs.Say("error", "watchdog", fmt.Sprint(e))
							}
						}()
						m, _, err := keeper.Load()
						if err != nil {
							return
						}
						facts := methods.WatchdogFacts(chores.deps, m, syncer, func() {
							if world := w.World(); world != nil {
								syncer.Apply(keeper.Load, world.Usage, keeper.Words, keeper.Tools(), keeper.Caps())
							}
						})
						watchdog.Pass(o.RunDir+"/watchdog.json", watchdog.Probes(m, facts), m.Settings.Watchdog, methods.Updating(o.RunDir), time.Now().Unix(), logs)
					}()
				}
			}
		}()
		deps := methods.Deps{World: func() *view.World { return roster.Complete(w.World(), nets.of, o.DataDir) }, Events: func() []map[string]any { return w.Recent(0) }, Catalogs: i18n.Dir,
			Home: func(srv *model.Server, p *model.Person) []string { return nets.of(srv, p) }, HostIP: names.HostIP, RunDir: o.RunDir, DataDir: o.DataDir, Config: o.Config, Addresses: nets.addresses,
			Snapshot:   func() *netview.Snapshot { return netview.Take(netview.System(nets.logical)) },
			Handler:    nets.handler,
			Resolve:    names.Addresses,
			ResetUsage: w.ResetUsage,
			Teardown: func(m *model.Model) {
				syncer.Teardown(m)
				migrate.Router{Store: store.Store{Config: o.Config, RunDir: o.RunDir}, Uhttpd: "/etc/config/uhttpd", CGI: "/www/cgi-bin/dawnline-portal", Log: logs,
					ReloadUhttpd: func() { exec.Command("/etc/init.d/uhttpd", "reload").Run() }}.UhttpdOnly()
				// the agent's heartbeat check
				exec.Command("sh", "-c", "grep -qs /usr/libexec/dawnline/heartbeat /etc/crontabs/root && { sed -i '\\#/usr/libexec/dawnline/heartbeat#d' /etc/crontabs/root; /etc/init.d/cron restart >/dev/null 2>&1; }").Run()
			},
			// after the answer is out: this process is one of the service's own
			Stop: func() {
				cmd := exec.Command("sh", "-c", "sleep 1; /etc/init.d/dawnline stop >/dev/null 2>&1; /etc/init.d/dawnline disable >/dev/null 2>&1")
				cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
				cmd.Start()
			},
			ApplyPlan: func() any {
				c, m, err := (store.Store{Config: o.Config, RunDir: o.RunDir}).Read()
				if err != nil {
					return nil
				}
				saved := ""
				if s := c.Section("settings"); s != nil {
					saved, _ = s.Get("lan_address")
				}
				_, tool := os.Stat("/usr/bin/awg")
				_, proto := os.Stat("/lib/netifd/proto/amneziawg.sh")
				return syncer.ApplyPlan(m, saved, tool == nil && proto == nil, awg.SystemCaps(o.DataDir))
			},
			SyncPlan: func() any {
				world := w.World()
				_, m, err := (store.Store{Config: o.Config, RunDir: o.RunDir}).Read()
				if world == nil || err != nil {
					return nil
				}
				return syncer.Plan(m, world.Usage, time.Now().Unix())
			},
			Background: func(script string) {
				cmd := exec.Command("sh", "-c", "( "+script+" ) >/dev/null 2>&1 </dev/null")
				cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
				cmd.Start()
			},
			Ifup: func(name string) { exec.Command("ifup", name).Run() },
			Updater: func(lang string, args []string) {
				cmd := exec.Command("start-stop-daemon", append([]string{"-S", "-b", "-x", "/usr/libexec/dawnline/updater", "--"}, args...)...)
				if lang != "" {
					cmd.Env = append(os.Environ(), "DAWNLINE_LANG="+lang)
				}
				cmd.Run()
			},
			Restart: func(network bool) {
				script := "/etc/init.d/dawnline enabled || /etc/init.d/dawnline enable; sleep 1; "
				if network {
					script += "/etc/init.d/network restart; "
				}
				cmd := exec.Command("sh", "-c", script+"/etc/init.d/dawnline restart >/dev/null 2>&1")
				cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
				cmd.Start()
			},
			// the full apply
			Apply: func(lang string) map[string]any {
				// Go's own full apply (unless the router is given back to ucode): the one-time steps,
				// then network, firewall, the home-like path, the resolver, the reply table and the sync
				if mine() {
					if world := w.World(); world != nil {
						st := store.Store{Config: o.Config, RunDir: o.RunDir}
						migrate.Router{Store: st, NewCode: methods.NewCode, Uhttpd: "/etc/config/uhttpd", CGI: "/www/cgi-bin/dawnline-portal", Log: logs,
							ReloadUhttpd: func() { exec.Command("/etc/init.d/uhttpd", "reload").Run() }}.Run()
						_, tool := os.Stat("/usr/bin/awg")
						_, proto := os.Stat("/lib/netifd/proto/amneziawg.sh")
						full := syncer.Apply(func() (*model.Model, string, error) {
							c, m, err := st.Read()
							if err != nil {
								return nil, "", err
							}
							saved := ""
							if s := c.Section("settings"); s != nil {
								saved, _ = s.Get("lan_address")
							}
							return m, saved, nil
						}, world.Usage, i18n.Use(i18n.Dir, lang), tool == nil && proto == nil, awg.SystemCaps(o.DataDir))
						out := map[string]any{"network": full.Network, "firewall": full.Firewall, "like_home": full.LikeHome, "peers": full.Peers, "warning": nil}
						if full.Warning != "" {
							out["warning"] = full.Warning
						}
						return out
					}
				}
				// switched off while it runs (/etc/dawnline/backend-off without a restart): the ucode backend's
				// own service applies when it starts
				return map[string]any{"warning": "The change is saved. Dawnline's backend is switched off: restart the service to put it into effect (/etc/init.d/dawnline restart)."}
			},
			// after the answer is out: the reload may restart this very process (its portal's port is in its arguments)
			Reload: func() {
				cmd := exec.Command("sh", "-c", "sleep 1; /etc/init.d/dawnline reload >/dev/null 2>&1")
				cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
				cmd.Start()
			},
			AWG:   func() map[string]any { return roster.AwgState(nets.handler) },
			Store: &store.Store{Config: o.Config, RunDir: o.RunDir},
			Told: func() {
				if publish != nil {
					publish()
				}
			},
			// the runtime sync, and its warning for the admin
			Sync: func(lang string) any {
				// Go's own sync (unless the router is given back to ucode): the access sets, the devices
				// into the tunnels and the hostnames, with no call to ucode
				if mine() {
					if world := w.World(); world != nil {
						if _, m, err := (store.Store{Config: o.Config, RunDir: o.RunDir}).Read(); err == nil {
							res := syncer.Sync(m, world.Usage, time.Now().Unix(), false, i18n.Use(i18n.Dir, lang))
							if res.Warning == "" {
								return nil
							}
							return res.Warning
						}
					}
				}
				return "The change is saved. Dawnline's backend is switched off: restart the service to put it into effect (/etc/init.d/dawnline restart)."
			},
			Log: &servicelog.Log{RunDir: o.RunDir, Level: func() string {
				if world := w.World(); world != nil {
					return world.M.Settings.LogLevel
				}
				return "info"
			}},
			RouterWAN: nets.routerWAN,
			Bus: func(object, method string, args map[string]any) map[string]any {
				ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
				defer cancel()
				res, err := nets.bus.Call(ctx, object, method, args)
				if err != nil {
					return nil
				}
				return res
			},
			WANOf:  nets.wanOf,
			GitHub: &github.Client{RunDir: o.RunDir},
			Board: func() map[string]any {
				ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
				defer cancel()
				res, _ := nets.bus.Call(ctx, "system", "board", nil)
				return res
			}}
		more = methods.List(deps)
		chores.deps = deps
		native = methods.PortalHandler(deps, true)
	}
	object := api.Object(h, audience, api.Info{Version: backend.Version, Stream: o.Stream, Refresh: func(ctx context.Context) { b.Look(ctx) }, More: more})
	bus := ubus.NewBus(o.Socket, object)
	bus.Log = o.Log
	b = bridge.New(bridge.Bridge{
		Hub: h, Audience: audience, Log: o.Log,
		// what the topics are made of besides what the watcher tells of itself: the settings, the
		// configurations handed out, the servers kept down, the places found
		Watch: []string{o.Config, o.DataDir + "/issued.json", o.RunDir + "/netifd-blocked.json", o.RunDir + "/geo.json"},
	})
	run := []func(){
		func() { bus.Run(ctx) },
		func() { api.Broadcast(ctx, h, bus, object) },
		func() { b.Run(ctx) },
	}
	if o.Watch {
		run = append(run, func() { w.Run(ctx) })
		// The people as Go makes them, held against each status ucode answers (package roster).
		nets.bus = bus
		ro := &roster.Roster{World: w.World, Home: nets.of, DataDir: o.DataDir, RunDir: o.RunDir, Hub: h, Log: o.Log, Keyed: bridge.Split, Recent: w.Recent, Own: nets.own, Iface: nets.ifaceState, Homes: nets.serverHomes, Handler: nets.handler, WAN: nets.routerWAN}
		// The topics as the router is now: the watcher looks first, so what is told is never what it knew a
		// second ago. Without that look a page that asked in the backend's first second was told nothing
		// until Refresh (the watcher had no world yet), and settings changed on disk were told as they were
		// before (the bridge's second comes before the watcher's).
		tell := func() bool {
			w.Look()
			return ro.Publish()
		}
		publish = func() { tell() }
		// told again when the settings change, when somebody starts to look, and with the minute
		b.Tell = tell
		// the moment the watcher saw someone come, go or move, the pages have Go's own people
		w.Changed = func() { go ro.Publish() }
	}
	if p := o.Portal; p != nil {
		bell := &portal.Bell{}
		srv := &portal.Server{
			TLS: []string{fmt.Sprintf(":%d", p.Port)}, Cert: p.Cert, Key: p.Key,
			People: &portal.Settings{Path: o.Config}, Bell: bell, Log: o.Log,
			// the portal's answers (methods.Portal)
			Native: native,
		}
		if p.HTTP > 0 {
			srv.Plain = []string{fmt.Sprintf(":%d", p.HTTP)}
		}
		run = append(run, func() { srv.Run(ctx) }, func() { portal.Watch(ctx, bell, o.RunDir, o.DataDir, o.Config) })
	}
	var parts sync.WaitGroup
	for _, part := range run {
		parts.Add(1)
		go func() {
			defer parts.Done()
			part()
		}()
	}
	parts.Wait()
}

// homes answers which home networks a person reaches, from a look at the router's interfaces that is kept
// for a few seconds (every person of a status asks).
type homes struct {
	bus  *ubus.Bus
	mu   sync.Mutex
	snap *netview.Snapshot
	at   time.Time
}

func (h *homes) of(srv *model.Server, p *model.Person) []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.snap == nil || time.Since(h.at) > 5*time.Second {
		h.snap = netview.Take(netview.System(h.logical))
		h.at = time.Now()
	}
	return h.snap.PersonHome(srv, p)
}

// own is the router's own public-side addresses: each server's WAN address, and the wan interface's.
func (h *homes) own(m *model.Model) map[string]bool {
	h.mu.Lock()
	if h.snap == nil || time.Since(h.at) > 5*time.Second {
		h.snap = netview.Take(netview.System(h.logical))
		h.at = time.Now()
	}
	snap := h.snap
	h.mu.Unlock()
	out := map[string]bool{}
	for _, srv := range m.Servers {
		a := snap.WanAddress(srv)
		if a == "" {
			a = h.ifaceAddr(srv.WanZone)
		}
		if a != "" {
			out[a] = true
		}
	}
	if a := h.ifaceAddr("wan"); a != "" {
		out[a] = true
	}
	return out
}

// addresses is every IPv4 address of netifd's interfaces, in its order.
func (h *homes) addresses() []methods.Address {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	res, err := h.bus.Call(ctx, "network.interface", "dump", nil)
	if err != nil {
		return nil
	}
	var out []methods.Address
	list, _ := res["interface"].([]any)
	for _, i := range list {
		m, _ := i.(map[string]any)
		name, _ := m["interface"].(string)
		addrs, _ := m["ipv4-address"].([]any)
		for _, a := range addrs {
			am, _ := a.(map[string]any)
			out = append(out, methods.Address{Iface: name, CIDR: fmt.Sprintf("%v/%v", am["address"], am["mask"])})
		}
	}
	return out
}

// wanOf is the IPv4 address of a server's WAN (its interface's, else its zone's netifd interface's); of
// netifd's wan for no server.
func (h *homes) wanOf(srv *model.Server) string {
	if srv == nil {
		return h.ifaceAddr("wan")
	}
	if a := netview.Take(netview.System(h.logical)).WanAddress(srv); a != "" {
		return a
	}
	return h.ifaceAddr(srv.WanZone)
}

// handler tells whether netifd lists the amneziawg protocol.
func (h *homes) handler() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	res, err := h.bus.Call(ctx, "network", "get_proto_handlers", nil)
	_, has := res["amneziawg"]
	return err == nil && has
}

// routerWAN is the router's WAN address: the first server's with keys, else its zone's interface's.
func (h *homes) routerWAN(m *model.Model) string {
	h.mu.Lock()
	if h.snap == nil || time.Since(h.at) > 5*time.Second {
		h.snap = netview.Take(netview.System(h.logical))
		h.at = time.Now()
	}
	snap := h.snap
	h.mu.Unlock()
	for _, id := range m.ServerIDs() {
		srv := m.Servers[id]
		if srv.PrivateKey == "" {
			continue
		}
		if a := snap.WanAddress(srv); a != "" {
			return a
		}
		if a := h.ifaceAddr(srv.WanZone); a != "" {
			return a
		}
	}
	return h.ifaceAddr("wan")
}

// ifaceState is whether a netifd interface is up, and for how long.
func (h *homes) ifaceState(name string) (bool, int64) {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	res, err := h.bus.Call(ctx, "network.interface."+name, "status", nil)
	if err != nil {
		return false, 0
	}
	up, _ := res["up"].(bool)
	var uptime int64
	switch n := res["uptime"].(type) {
	case int64:
		uptime = n
	case int32:
		uptime = int64(n)
	case float64:
		uptime = int64(n)
	case int:
		uptime = int64(n)
	}
	return up, uptime
}

// serverHomes is a server's home interfaces with what each reaches.
func (h *homes) serverHomes(srv *model.Server) []view.HomeNet {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.snap == nil || time.Since(h.at) > 5*time.Second {
		h.snap = netview.Take(netview.System(h.logical))
		h.at = time.Now()
	}
	home, _ := h.snap.ServerHome(srv)
	out := []view.HomeNet{}
	for _, x := range home {
		out = append(out, view.HomeNet{Dev: x.Dev, Nets: x.Nets})
	}
	return out
}

// ifaceAddr is a netifd interface's first IPv4 address, or "".
func (h *homes) ifaceAddr(name string) string {
	if name == "" {
		return ""
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	res, err := h.bus.Call(ctx, "network.interface."+name, "status", nil)
	if err != nil {
		return ""
	}
	list, _ := res["ipv4-address"].([]any)
	if len(list) == 0 {
		return ""
	}
	first, _ := list[0].(map[string]any)
	a, _ := first["address"].(string)
	return a
}

// logical asks netifd which interface stands on which device.
func (h *homes) logical() map[string]netview.Logical {
	out := map[string]netview.Logical{}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	res, err := h.bus.Call(ctx, "network.interface", "dump", nil)
	if err != nil {
		return out
	}
	list, _ := res["interface"].([]any)
	for _, i := range list {
		m, _ := i.(map[string]any)
		dev, _ := m["l3_device"].(string)
		if dev == "" {
			dev, _ = m["device"].(string)
		}
		if _, seen := out[dev]; dev == "" || seen {
			continue
		}
		name, _ := m["interface"].(string)
		proto, _ := m["proto"].(string)
		out[dev] = netview.Logical{Name: name, Proto: proto}
	}
	return out
}
