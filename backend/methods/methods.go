// Package methods is the admin's questions the Go backend answers itself: methods of the ubus object
// `dawnline` that were luci.dawnline's (dawnline.rpc.*), with the same arguments and the same answers, a
// failure as { error } in the page's language. hello names them, and a page asks them here instead.
//
//	events       { limit, person, device, since }  the newest of the activity log
//	person_usage { id, days }                      a person's days of traffic, and each of their devices'
//	person_links { id }                            the personal code and links (admins only: the access list)
//	device_config { id }                           a device's configuration, to show (admins only)
//	service_log                                    the watchdog's state and the newest of the service log
//	backup_list                                    the backups kept on the router
//	backup_read  { name }                          one of them, in base64 (admins only: it holds keys)
//	settings_get                                   the Settings page's data
//	server_ports { id }                            the ports and networks a server must avoid
//	interfaces   { id }                            a server's interfaces: what exists, what is detected, what it uses
//	updates_status                                 the Components tab's data
//	setup_defaults                                 what a new server starts from
//	health                                         Health's checks, the watchdog's state and the service log
//	home_hosts   { id }                            the devices at home, for the Home services picker
//	export                                         every section of the settings (admins only: it holds keys)
//	access_check { from, to }                      where a connection between two sides stops, in words (admins only)
//
// and the first that change something, none of them the settings or the tunnels (admins only):
//
//	logs_clear { person, device, category, older_days }  remove activity; nothing given clears it all
//	service_log_clear { older_days }               remove the service log's entries
//	usage_clear { scope, id }                      forget traffic history: all | person | device | limit
//	geo_clear                                      forget the places found for addresses
//	backup_delete { name }                         remove a backup
//
// and those that change the settings (package store), each put into effect by the ucode backend's sync
// until apply is ported:
//
//	service_set { id, name, address, ports }       add or change a home service
//	service_delete { id }                          remove one, and take it from everyone who had it
//	circle_set { id, server, name, color, members }  add or change a circle; members replaces who is in it
//	circle_delete { id }                           remove one, and take everyone out of it
//	person_pause { id, paused }                    pause a person, or let them on again
//	person_delete { id }                           remove a person and their devices
//	person_update { id, …fields }                  an immediate edit from a person's page
//	people_update { list }                         several people at once, all or nothing
//	person_create { name, slug, server, access, device_limit, expires, quota_gb, quota_period }
//	person_regen { id, remove }                    a new personal link, the old one's devices taken away when asked
//	device_update { id, name, disabled, mtu, keepalive, lan_bypass }  rename, turn off or on, how it connects
//	device_delete { id }                           remove a device
//	device_create { person, name, kind, lan_bypass, networks }  a new device with keys made here: its id and configuration
//	device_networks { id, networks }               the networks behind a router, all at once; applied in full
//	device_answer { id, answer, reason, router, networks }  what a router's owner asked for: accept, decline, reopen
//	device_rotate { id, kind, lan_bypass }         new keys: the device is set up again, its new configuration
//	settings_update { values }                     save settings, "" back to the default; the portal checked as it will be
//	server_update { id, values }                   a server's settings, applied at once (ucode's full apply for now)
//	server_interfaces { id, auto_wan, wan_device, auto_lan, lan_devices, lan_like, device_mesh, mesh }
//	server_delete { id }                           a server with its people, their devices and its circles; a backup first
//	server_obfuscation { id, preset }              a new disguise for a server: off, balanced or max
//	health_fix { id }                              run a fix a check named, and Health again
//	updates_run { what }                           start an update job (the updater works in the background)
//	apply                                          put everything into effect (ucode's full apply for now)
//	server_create { id, name, ifname, port, subnet, endpoint, mtu, preset, lan_zone, wan_zone, lan_like,
//	                portal_enabled, portal_port }  set a server up, with keys made here
//	backup_create                                  a backup now: its name
//	backup_restore { name }                        bring a kept backup back (checked first, a backup made before)
//	backup_upload { data }                         the same for a backup the admin sends, in base64
//	import { data }                                replace the settings with an export
//
//	portal_info                                    the addresses the portal could use and Health's checks of it
//	endpoint_probe { host, id, port }              where a public address points, as the admin types it
//	updates_releases { page }                      Dawnline's releases, five a page
//	updates_notes { component, tag, build }        a release's notes
//	updates_changes { from, to }                   what changed between the installed version and a release
package methods

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/access"
	"github.com/tickcount/luci-app-dawnline/backend/awg"
	"github.com/tickcount/luci-app-dawnline/backend/endpoint"
	"github.com/tickcount/luci-app-dawnline/backend/files"
	"github.com/tickcount/luci-app-dawnline/backend/github"
	"github.com/tickcount/luci-app-dawnline/backend/handout"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/netview"
	"github.com/tickcount/luci-app-dawnline/backend/roster"
	"github.com/tickcount/luci-app-dawnline/backend/servicelog"
	"github.com/tickcount/luci-app-dawnline/backend/state"
	"github.com/tickcount/luci-app-dawnline/backend/store"

	"github.com/tickcount/luci-app-dawnline/backend/i18n"
	"github.com/tickcount/luci-app-dawnline/backend/ubus"
	"github.com/tickcount/luci-app-dawnline/backend/usage"
	"github.com/tickcount/luci-app-dawnline/backend/view"
)

// Deps is what the methods read.
type Deps struct {
	// World is the settings, the counters and the tunnels as the watcher last saw them (nil before its first look).
	World func() *view.World
	// Events is the whole activity log, the oldest first, home names with the connections that have them.
	Events func() []map[string]any
	// Catalogs is where the translations are (i18n.Dir).
	Catalogs string
	// Home is the home networks a person reaches on their server; HostIP, where a name points ("" nowhere).
	Home   func(srv *model.Server, p *model.Person) []string
	HostIP func(host string) string
	// RunDir and DataDir are the state's (/var/run/dawnline, /etc/dawnline); Config the settings file.
	RunDir, DataDir, Config string
	// Addresses is every IPv4 address of netifd's interfaces.
	Addresses func() []Address
	// Snapshot is a fresh look at the router's interfaces.
	Snapshot func() *netview.Snapshot
	// Board is `ubus call system board`'s answer.
	Board func() map[string]any
	// Handler tells whether netifd lists the amneziawg protocol.
	Handler func() bool
	// GitHub asks GitHub (nil: the methods that need it are not offered).
	GitHub *github.Client
	// Resolve is a name's addresses; WANOf the WAN's IPv4 for a server (nil: the default WAN), "" when none.
	Resolve func(host string) []string
	WANOf   func(srv *model.Server) string
	// Bus asks another ubus object (nil answer: it did not answer); RouterWAN is the router's WAN address.
	Bus       func(object, method string, args map[string]any) map[string]any
	RouterWAN func(m *model.Model) string
	// Log writes the service log (nil: nothing is written).
	Log *servicelog.Log
	// ResetUsage forgets traffic history in the watcher's counters (false: it has not looked yet).
	ResetUsage func(scope, id string) bool
	// Store changes the settings; Sync puts them into effect and returns a warning for the admin (nil: none).
	Store *store.Store
	Sync  func(lang string) any
	// Told has the pages told of a change at once: the settings read anew and the topics put again.
	Told func()
	// AWG is what of AmneziaWG is on the router (nil: not asked).
	AWG func() map[string]any
	// Reload has the service take new portal settings (its own restart among them): after the answer is out.
	Reload func()
	// Apply has the ucode backend put everything into effect (its full apply) and returns what that came to.
	Apply func(lang string) map[string]any
	// Caps is what the installed AmneziaWG can do (nil: read on the router).
	Caps func() awg.Caps
	// Restart turns the service on and restarts it after a server is made (the network first when netifd
	// does not know AmneziaWG yet), in the background: this very process restarts with it.
	Restart func(network bool)
	// Background runs a shell script detached, after the answer is out; Ifup brings a netifd interface up;
	// Updater starts the updater with these arguments, speaking a language ("" English).
	Background func(script string)
	Ifup       func(name string)
	Updater    func(lang string, args []string)
	// SyncPlan is what Go's own sync would load, with nothing loaded (nil: not there).
	SyncPlan func() any
	// Teardown removes everything Dawnline made on the router, from the settings as they were (nil: not there);
	// Stop then stops the service and keeps it from starting, once the answer is out.
	Teardown func(m *model.Model)
	Stop     func()
	// ApplyPlan is what Go's own full apply would change, with nothing changed (nil: not there).
	ApplyPlan func() any
}

// num is a number as the bus hands it over.
func num(v any) float64 {
	switch n := v.(type) {
	case int:
		return float64(n)
	case int32:
		return float64(n)
	case int64:
		return float64(n)
	case uint32:
		return float64(n)
	case uint64:
		return float64(n)
	case float64:
		return n
	}
	return 0
}

func text(v any) string {
	s, _ := v.(string)
	return s
}

// days is how much history a caller may ask for: 1 to 400, 30 when not said.
func days(v any) int {
	n := num(v)
	if v == nil || n < 1 {
		return 30
	}
	if n > 400 {
		return 400
	}
	return int(n)
}

// a method's own work: its answer, or the failure to tell the page (said in English, translated by wrap)
type call func(w *view.World, args map[string]any) (map[string]any, error)

// unworded puts an error that has no sentence for a person into the system log: the page is told it went wrong.
func (d Deps) unworded(line string) {
	if d.Log != nil {
		d.Log.Say("error", "dawnline", line)
	}
}

// said is a failure whose sentence has values: translated first, filled after.
type said struct {
	msg  string
	args []any
}

func (s said) Error() string { return fmt.Sprintf(s.msg, s.args...) }

// List is the methods, to add to the object.
func List(d Deps) []ubus.Method {
	wrap := func(fn call) ubus.Handler {
		return func(_ context.Context, args map[string]any) (map[string]any, error) {
			t := i18n.Use(d.Catalogs, text(args["lang"]))
			w := d.World()
			if w == nil {
				return map[string]any{"error": t.T("The router is still starting. Try again in a moment.")}, nil
			}
			res, err := fn(w, args)
			if s, refused := err.(access.Said); refused {
				return map[string]any{"error": fmt.Sprintf(t.T(s.Msg), s.Args...)}, nil
			}
			if f, isGitHub := err.(github.Failure); isGitHub {
				return map[string]any{"error": fmt.Sprintf(t.T(f.Msg), f.Args...)}, nil
			}
			if s, filled := err.(said); filled {
				return map[string]any{"error": fmt.Sprintf(t.T(s.msg), s.args...)}, nil
			}
			if err != nil {
				return map[string]any{"error": wordsOf(t, err, d.unworded)}, nil
			}
			return res, nil
		}
	}
	// the same, for an answer that has words of its own in the page's language
	worded := func(fn func(w *view.World, t *i18n.Catalog) map[string]any) ubus.Handler {
		return func(_ context.Context, args map[string]any) (map[string]any, error) {
			t := i18n.Use(d.Catalogs, text(args["lang"]))
			w := d.World()
			if w == nil {
				return map[string]any{"error": t.T("The router is still starting. Try again in a moment.")}, nil
			}
			return fn(w, t), nil
		}
	}
	list := []ubus.Method{}
	if d.GitHub != nil {
		list = append(list,
			ubus.Method{Name: "updates_releases", Params: map[string]ubus.Kind{"page": ubus.Int, "lang": ubus.String},
				Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) { return releases(d.GitHub, a["page"]) })},
			ubus.Method{Name: "updates_notes", Params: map[string]ubus.Kind{"component": ubus.String, "tag": ubus.String, "build": ubus.String, "lang": ubus.String},
				Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) {
					return notes(d.GitHub, text(a["component"]), text(a["tag"]), text(a["build"]))
				})},
			ubus.Method{Name: "updates_changes", Params: map[string]ubus.Kind{"from": ubus.String, "to": ubus.String, "lang": ubus.String},
				Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) {
					return changes(d.GitHub, text(a["from"]), text(a["to"]))
				})},
		)
	}
	return append(list, []ubus.Method{
		{Name: "device_config", Params: map[string]ubus.Kind{"id": ubus.String, "lang": ubus.String},
			Handle: wrap(func(w *view.World, a map[string]any) (map[string]any, error) {
				return deviceConfig(w, d, text(a["id"]))
			})},
		{Name: "service_log", Params: map[string]ubus.Kind{"lang": ubus.String},
			Handle: worded(func(w *view.World, t *i18n.Catalog) map[string]any { return serviceLog(w, t, d.RunDir, d.DataDir) })},
		{Name: "settings_get", Params: map[string]ubus.Kind{"lang": ubus.String},
			Handle: worded(func(w *view.World, t *i18n.Catalog) map[string]any { return settingsGet(w, t, d) })},
		{Name: "server_ports", Params: map[string]ubus.Kind{"id": ubus.String, "lang": ubus.String},
			Handle: func(_ context.Context, a map[string]any) (map[string]any, error) {
				return worded(func(w *view.World, t *i18n.Catalog) map[string]any { return serverPorts(w, t, d, text(a["id"])) })(nil, a)
			}},
		{Name: "interfaces", Params: map[string]ubus.Kind{"id": ubus.String, "lang": ubus.String},
			Handle: wrap(func(w *view.World, a map[string]any) (map[string]any, error) { return interfaces(w, d, text(a["id"])) })},
		{Name: "updates_status", Params: map[string]ubus.Kind{"lang": ubus.String},
			Handle: worded(func(w *view.World, t *i18n.Catalog) map[string]any { return updatesStatus(w, t, d) })},
		{Name: "setup_defaults", Params: map[string]ubus.Kind{"lang": ubus.String},
			Handle: worded(func(w *view.World, t *i18n.Catalog) map[string]any { return setupDefaults(w, t, d) })},
		{Name: "endpoint_probe", Params: map[string]ubus.Kind{"host": ubus.String, "id": ubus.String, "port": ubus.Int, "lang": ubus.String},
			Handle: func(_ context.Context, a map[string]any) (map[string]any, error) {
				return worded(func(w *view.World, t *i18n.Catalog) map[string]any { return endpointProbe(w, t, d, a) })(nil, a)
			}},
		{Name: "home_hosts", Params: map[string]ubus.Kind{"id": ubus.String, "lang": ubus.String},
			Handle: wrap(func(w *view.World, a map[string]any) (map[string]any, error) {
				return homeHosts(w, d, text(a["id"]), "/tmp/dhcp.leases", "/etc/config/dhcp")
			})},
		{Name: "export", Params: map[string]ubus.Kind{"lang": ubus.String},
			Handle: wrap(func(*view.World, map[string]any) (map[string]any, error) { return export(d) })},
		{Name: "access_check", Params: map[string]ubus.Kind{"from": ubus.String, "to": ubus.String, "lang": ubus.String},
			Handle: func(_ context.Context, a map[string]any) (map[string]any, error) {
				return wrap(func(w *view.World, a map[string]any) (map[string]any, error) {
					return accessCheck(w, i18n.Use(d.Catalogs, text(a["lang"])), d, text(a["from"]), text(a["to"]))
				})(nil, a)
			}},
		{Name: "logs_clear", Params: map[string]ubus.Kind{"person": ubus.String, "device": ubus.String, "category": ubus.String, "older_days": ubus.String, "lang": ubus.String},
			Handle: wrap(func(w *view.World, a map[string]any) (map[string]any, error) {
				return logsClear(w, d, text(a["person"]), text(a["device"]), text(a["category"]), text(a["older_days"]))
			})},
		{Name: "service_log_clear", Params: map[string]ubus.Kind{"older_days": ubus.String, "lang": ubus.String},
			Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) {
				return serviceLogClear(d, text(a["older_days"])), nil
			})},
		{Name: "usage_clear", Params: map[string]ubus.Kind{"scope": ubus.String, "id": ubus.String, "lang": ubus.String},
			Handle: wrap(func(w *view.World, a map[string]any) (map[string]any, error) {
				return usageClear(w, d, text(a["scope"]), text(a["id"]))
			})},
		{Name: "geo_clear", Params: map[string]ubus.Kind{"lang": ubus.String},
			Handle: wrap(func(*view.World, map[string]any) (map[string]any, error) { return geoClear(d), nil })},
		{Name: "backup_delete", Params: map[string]ubus.Kind{"name": ubus.String, "lang": ubus.String},
			Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) {
				return backupDelete(d.DataDir+"/backups", text(a["name"]))
			})},
		{Name: "service_set", Params: map[string]ubus.Kind{"id": ubus.String, "name": ubus.String, "address": ubus.String, "ports": ubus.Array, "lang": ubus.String},
			Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) { return serviceSet(d, a) })},
		{Name: "service_delete", Params: map[string]ubus.Kind{"id": ubus.String, "lang": ubus.String},
			Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) {
				return serviceDelete(d, text(a["id"]), text(a["lang"]))
			})},
		{Name: "circle_set", Params: map[string]ubus.Kind{"id": ubus.String, "server": ubus.String, "name": ubus.String, "color": ubus.Int, "members": ubus.Array, "lang": ubus.String},
			Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) { return circleSet(d, a) })},
		{Name: "circle_delete", Params: map[string]ubus.Kind{"id": ubus.String, "lang": ubus.String},
			Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) {
				return circleDelete(d, text(a["id"]), text(a["lang"]))
			})},
		{Name: "person_pause", Params: map[string]ubus.Kind{"id": ubus.String, "paused": ubus.Bool, "lang": ubus.String},
			Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) {
				return personPause(d, text(a["id"]), truthy(a["paused"]), text(a["lang"]))
			})},
		{Name: "person_delete", Params: map[string]ubus.Kind{"id": ubus.String, "lang": ubus.String},
			Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) {
				return personDelete(d, text(a["id"]), text(a["lang"]))
			})},
		{Name: "person_update", Params: map[string]ubus.Kind{"id": ubus.String, "name": ubus.String, "access": ubus.String, "device_limit": ubus.String, "expires": ubus.String,
			"quota_gb": ubus.String, "quota_period": ubus.String, "bonus_gb": ubus.String, "note": ubus.String, "dns_mode": ubus.String, "paused": ubus.Bool,
			"services": ubus.Array, "circle": ubus.String, "home_nets": ubus.Array, "server": ubus.String, "lang": ubus.String},
			Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) { return personUpdate(d, a) })},
		{Name: "people_update", Params: map[string]ubus.Kind{"list": ubus.Array, "lang": ubus.String},
			Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) { return peopleUpdate(d, a) })},
		{Name: "person_create", Params: map[string]ubus.Kind{"name": ubus.String, "slug": ubus.String, "server": ubus.String, "access": ubus.String, "device_limit": ubus.String,
			"expires": ubus.String, "quota_gb": ubus.String, "quota_period": ubus.String, "lang": ubus.String},
			Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) { return personCreate(d, a) })},
		{Name: "person_regen", Params: map[string]ubus.Kind{"id": ubus.String, "remove": ubus.Array, "lang": ubus.String},
			Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) { return personRegen(d, a) })},
		{Name: "device_update", Params: map[string]ubus.Kind{"id": ubus.String, "name": ubus.String, "disabled": ubus.Bool, "mtu": ubus.String, "keepalive": ubus.String,
			"lan_bypass": ubus.Bool, "lang": ubus.String},
			Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) { return deviceUpdate(d, a) })},
		{Name: "device_delete", Params: map[string]ubus.Kind{"id": ubus.String, "lang": ubus.String},
			Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) {
				return deviceDelete(d, text(a["id"]), text(a["lang"]))
			})},
		{Name: "device_create", Params: map[string]ubus.Kind{"person": ubus.String, "name": ubus.String, "kind": ubus.String, "lan_bypass": ubus.Bool,
			"networks": ubus.Array, "lang": ubus.String},
			Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) { return deviceCreate(d, a) })},
		{Name: "device_networks", Waits: true, Params: map[string]ubus.Kind{"id": ubus.String, "networks": ubus.Array, "lang": ubus.String},
			Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) { return deviceNetworks(d, a) })},
		{Name: "device_answer", Waits: true, Params: map[string]ubus.Kind{"id": ubus.String, "answer": ubus.String, "reason": ubus.String, "router": ubus.Bool,
			"networks": ubus.Array, "lang": ubus.String},
			Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) { return deviceAnswer(d, a) })},
		{Name: "device_rotate", Params: map[string]ubus.Kind{"id": ubus.String, "kind": ubus.String, "lan_bypass": ubus.Bool, "lang": ubus.String},
			Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) { return deviceRotate(d, a) })},
		{Name: "settings_update", Params: map[string]ubus.Kind{"values": ubus.Table, "lang": ubus.String},
			Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) { return settingsUpdate(d, a) })},
		{Name: "server_update", Waits: true, Params: map[string]ubus.Kind{"id": ubus.String, "values": ubus.Table, "lang": ubus.String},
			Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) { return serverUpdate(d, a) })},
		{Name: "server_interfaces", Waits: true, Params: map[string]ubus.Kind{"id": ubus.String, "auto_wan": ubus.Bool, "wan_device": ubus.String, "auto_lan": ubus.Bool,
			"lan_devices": ubus.Array, "lan_like": ubus.Bool, "device_mesh": ubus.Bool, "mesh": ubus.String, "lang": ubus.String},
			Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) { return serverInterfaces(d, a) })},
		{Name: "server_delete", Waits: true, Params: map[string]ubus.Kind{"id": ubus.String, "lang": ubus.String},
			Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) {
				return serverDelete(d, text(a["id"]), text(a["lang"]))
			})},
		{Name: "backup_create", Params: map[string]ubus.Kind{"lang": ubus.String},
			Handle: wrap(func(*view.World, map[string]any) (map[string]any, error) {
				name, err := backupCreate(d, "")
				if err != nil {
					return nil, err
				}
				return map[string]any{"name": name}, nil
			})},
		{Name: "server_obfuscation", Waits: true, Params: map[string]ubus.Kind{"id": ubus.String, "preset": ubus.String, "lang": ubus.String},
			Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) {
				return serverObfuscation(d, text(a["id"]), asString(a["preset"]), text(a["lang"]))
			})},
		{Name: "server_create", Waits: true, Params: map[string]ubus.Kind{"id": ubus.String, "name": ubus.String, "ifname": ubus.String, "port": ubus.Int, "subnet": ubus.String,
			"endpoint": ubus.String, "mtu": ubus.Int, "preset": ubus.String, "lan_zone": ubus.String, "wan_zone": ubus.String, "lan_like": ubus.Bool,
			"portal_enabled": ubus.Bool, "portal_port": ubus.Int, "lang": ubus.String},
			Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) { return serverCreate(d, a) })},
		{Name: "health_fix", Waits: true, Params: map[string]ubus.Kind{"id": ubus.String, "lang": ubus.String},
			Handle: func(_ context.Context, a map[string]any) (map[string]any, error) {
				return wrap(func(w *view.World, a map[string]any) (map[string]any, error) {
					return healthFix(w, i18n.Use(d.Catalogs, text(a["lang"])), d, text(a["id"]), text(a["lang"]))
				})(nil, a)
			}},
		{Name: "updates_run", Params: map[string]ubus.Kind{"what": ubus.String, "lang": ubus.String},
			Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) {
				return updatesRun(d, text(a["what"]), text(a["lang"]))
			})},
		{Name: "apply", Waits: true, Params: map[string]ubus.Kind{"lang": ubus.String},
			Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) {
				out := map[string]any{}
				if d.Apply != nil {
					out = d.Apply(text(a["lang"]))
				}
				if d.Told != nil {
					d.Told()
				}
				return out, nil
			})},
		{Name: "uninstall", Waits: true, Params: map[string]ubus.Kind{"confirm": ubus.String, "lang": ubus.String},
			Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) {
				return uninstall(d, text(a["confirm"]))
			})},
		{Name: "backup_restore", Waits: true, Params: map[string]ubus.Kind{"name": ubus.String, "lang": ubus.String},
			Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) {
				return backupRestore(d, text(a["name"]), text(a["lang"]))
			})},
		{Name: "backup_upload", Waits: true, Params: map[string]ubus.Kind{"data": ubus.String, "lang": ubus.String},
			Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) {
				return backupUpload(d, text(a["data"]), text(a["lang"]))
			})},
		{Name: "import", Waits: true, Params: map[string]ubus.Kind{"data": ubus.Table, "lang": ubus.String},
			Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) {
				return importAll(d, a["data"], text(a["lang"]))
			})},
		// What Go's sync would load: for root on the router, to hold it to what runs there. No access list names it.
		{Name: "sync_plan", Handle: func(context.Context, map[string]any) (map[string]any, error) {
			if d.SyncPlan == nil {
				return map[string]any{}, nil
			}
			raw, _ := json.Marshal(d.SyncPlan())
			var out map[string]any
			json.Unmarshal(raw, &out)
			return out, nil
		}},
		// What Go's full apply would do: for root on the router, likewise.
		{Name: "apply_plan", Waits: true, Handle: func(context.Context, map[string]any) (map[string]any, error) {
			if d.ApplyPlan == nil {
				return map[string]any{}, nil
			}
			raw, _ := json.Marshal(d.ApplyPlan())
			var out map[string]any
			json.Unmarshal(raw, &out)
			return out, nil
		}},
		{Name: "portal_info", Params: map[string]ubus.Kind{"lang": ubus.String},
			Handle: worded(func(w *view.World, t *i18n.Catalog) map[string]any { return portalInfo(w, t, d) })},
		// Health: the checks, with the watchdog's state and the service log beside them.
		{Name: "health", Params: map[string]ubus.Kind{"lang": ubus.String},
			Handle: worded(func(w *view.World, t *i18n.Catalog) map[string]any {
				out := serviceLog(w, t, d.RunDir, d.DataDir)
				out["checks"] = healthChecks(w, t, d)
				return out
			})},
		{Name: "backup_read", Params: map[string]ubus.Kind{"name": ubus.String, "lang": ubus.String},
			Handle: wrap(func(_ *view.World, a map[string]any) (map[string]any, error) {
				return backupRead(d.DataDir+"/backups", text(a["name"]))
			})},
		{Name: "backup_list", Params: map[string]ubus.Kind{"lang": ubus.String},
			Handle: wrap(func(*view.World, map[string]any) (map[string]any, error) {
				return map[string]any{"backups": backups(d.DataDir + "/backups")}, nil
			})},
		{Name: "events", Params: map[string]ubus.Kind{"limit": ubus.Int, "person": ubus.String, "device": ubus.String, "since": ubus.Int, "lang": ubus.String},
			Handle: wrap(func(w *view.World, a map[string]any) (map[string]any, error) {
				return events(w, d.Events(), text(a["person"]), text(a["device"]), num(a["since"]), int(num(a["limit"]))), nil
			})},
		{Name: "person_usage", Params: map[string]ubus.Kind{"id": ubus.String, "days": ubus.Int, "lang": ubus.String},
			Handle: wrap(func(w *view.World, a map[string]any) (map[string]any, error) {
				return personUsage(w, text(a["id"]), days(a["days"]))
			})},
		{Name: "person_links", Params: map[string]ubus.Kind{"id": ubus.String, "lang": ubus.String},
			Handle: wrap(func(w *view.World, a map[string]any) (map[string]any, error) { return personLinks(w, text(a["id"])) })},
	}...)
}

// events is the newest `limit` entries of the log that pass every filter given, how many passed before the
// limit, and what the log keeps (dawnline.rpc.status events_list).
func events(w *view.World, log []map[string]any, person, device string, since float64, limit int) map[string]any {
	kept := []map[string]any{}
	for _, e := range log {
		// the tunnel down/up events of older versions are left out: the service log tells it better
		if t := text(e["type"]); t == "server_down" || t == "server_up" {
			continue
		}
		if (person != "" && text(e["person"]) != person) || (device != "" && text(e["device"]) != device) || (since != 0 && num(e["ts"]) <= since) {
			continue
		}
		kept = append(kept, e)
	}
	total := len(kept)
	if limit <= 0 {
		limit = 300
	}
	if len(kept) > limit {
		kept = kept[len(kept)-limit:]
	}
	return map[string]any{"events": kept, "total": total, "policy": policy(w)}
}

func personUsage(w *view.World, id string, days int) (map[string]any, error) {
	p := w.M.People[id]
	if p == nil {
		return nil, errors.New("Unknown person.")
	}
	devs := map[string]any{}
	for _, d := range p.Devices {
		devs[d] = view.Series([]*usage.Record{w.Usage.Devices[d]}, days, w.Now)
	}
	return map[string]any{"person": view.Series([]*usage.Record{w.Usage.People[id]}, days, w.Now), "devices": devs}, nil
}

func personLinks(w *view.World, id string) (map[string]any, error) {
	p := w.M.People[id]
	if p == nil {
		return nil, errors.New("Unknown person.")
	}
	hosts := view.PortalHosts(w.M)
	var link any
	links := []string{}
	for i, h := range hosts {
		l := view.PortalLink(w.M, p, h)
		if l == "" {
			continue
		}
		if i == 0 {
			link = l
		}
		links = append(links, l)
	}
	return map[string]any{"code": p.Code, "link": link, "links": links}, nil
}

// deviceConfig is a device's configuration, for the admin to show (QR code, file, text). Showing it marks
// nothing: a configuration counts as given out when it is made or fetched on the portal.
func deviceConfig(w *view.World, d Deps, id string) (map[string]any, error) {
	dev := w.M.Devices[id]
	if dev == nil {
		return nil, errors.New("Unknown device.")
	}
	if dev.Waiting {
		return nil, errors.New("This router waits for an answer to its request: it has no configuration yet.")
	}
	var home []string
	p := w.M.People[dev.Person]
	var srv *model.Server
	if p != nil {
		srv = w.M.Servers[p.Server]
	}
	if srv != nil && d.Home != nil {
		home = d.Home(srv, p)
	}
	cfg := handout.ClientConfig(w.M, dev, home)
	if cfg == nil {
		return map[string]any{"result": nil}, nil
	}
	raw, _ := json.Marshal(cfg)
	var out map[string]any
	json.Unmarshal(raw, &out)
	// V2RayTun on Android takes the server by its IP: only where it can connect at all, and AmneziaWG 3.1
	// (Maximum) is beyond it.
	if dev.Kind != "router" && dev.Kind != "computer" && srv.Preset != "max" && d.HostIP != nil {
		if am, ok := out["amnezia"].(map[string]any); ok {
			am["host_ip"] = nil
			if ip := d.HostIP(text(am["host"])); ip != "" {
				am["host_ip"] = ip
			}
		}
	}
	return out, nil
}

// ordered is a JSON object's keys in the order the file has them.
func ordered(raw json.RawMessage) []string {
	dec := json.NewDecoder(bytes.NewReader(raw))
	if t, err := dec.Token(); err != nil || t != json.Delim('{') {
		return nil
	}
	var keys []string
	for dec.More() {
		k, err := dec.Token()
		if err != nil {
			return keys
		}
		keys = append(keys, k.(string))
		var skip json.RawMessage
		if dec.Decode(&skip) != nil {
			return keys
		}
	}
	return keys
}

// serviceLog is the watchdog's state and the newest two hundred entries of the service log, newest first
// (dawnline.watchdog view): target and repair names in the page's language, the log as it was written.
func serviceLog(w *view.World, t *i18n.Catalog, run, data string) map[string]any {
	var st struct {
		Last    any              `json:"last"`
		Targets json.RawMessage  `json:"targets"`
		Repairs []map[string]any `json:"repairs"`
	}
	files.ReadJSON(run+"/watchdog.json", &st)
	var beat float64
	files.ReadJSON(run+"/agent.beat", &beat)
	names := map[string]string{"agent": t.T("Agent"), "nft": t.T("Access rules"), "fw": t.T("Firewall"), "portal": t.T("Portal"),
		"resolver": t.T("Resolver"), "rpc": t.T("LuCI link")}
	chip := func(id string, stored any) any {
		if n, ok := names[id]; ok {
			return n
		}
		if srv := w.M.Servers[strings.TrimPrefix(id, "cfg_")]; srv != nil && strings.HasPrefix(id, "cfg_") {
			return fmt.Sprintf(t.T("%s · interface settings"), srv.Name)
		}
		return stored
	}
	now := time.Now().Unix()
	targets := []any{map[string]any{"id": "agent", "name": names["agent"], "ok": beat > 0 && float64(now)-beat < 180, "tries": 0}}
	var byID map[string]map[string]any
	if json.Unmarshal(st.Targets, &byID) == nil {
		for _, id := range ordered(st.Targets) {
			x := byID[id]
			tries := x["tries"]
			if tries == nil {
				tries = 0
			}
			targets = append(targets, map[string]any{"id": id, "name": chip(id, x["name"]), "ok": truthy(x["ok"]), "tries": tries})
		}
	}
	repairs := []any{}
	for _, r := range st.Repairs {
		r["name"] = chip(text(r["id"]), r["name"])
		repairs = append(repairs, r)
	}
	var last, beatAt any = st.Last, nil
	if beat != 0 {
		beatAt = beat
	}
	raw, err := os.ReadFile(run + "/service.log")
	if err != nil {
		raw, _ = os.ReadFile(data + "/service.log")
	}
	lines := strings.Split(string(raw), "\n")
	log := []any{}
	for i := len(lines) - 1; i >= 0 && len(log) < 200; i-- {
		var e map[string]any
		if lines[i] != "" && json.Unmarshal([]byte(lines[i]), &e) == nil && e != nil && truthy(e["ts"]) {
			log = append(log, e)
		}
	}
	return map[string]any{
		"watchdog": map[string]any{"enabled": w.M.Settings.Watchdog, "last": last, "beat": beatAt, "now": now, "targets": targets, "repairs": repairs},
		"log":      log,
	}
}

// truthy is a JSON value as ucode's !! reads it.
func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case float64:
		return x != 0
	case string:
		return x != ""
	}
	return true
}

var backupName = regexp.MustCompile(`^dawnline-([0-9]{8}-[0-9]{6})(-([a-z0-9-]+))?\.tar\.gz$`)

// backups is the backups kept in dir, the newest first: why each was made is in its name.
func backups(dir string) []map[string]any {
	out := []map[string]any{}
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		m := backupName.FindStringSubmatch(e.Name())
		if m == nil {
			continue
		}
		reason := m[3]
		if reason == "" {
			reason = "manual"
		}
		var created, size int64
		if st, err := os.Stat(dir + "/" + e.Name()); err == nil {
			created, size = st.ModTime().Unix(), st.Size()
		}
		out = append(out, map[string]any{"name": e.Name(), "created": created, "size": size, "reason": reason})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i]["created"].(int64) > out[j]["created"].(int64) })
	return out
}

// orNull is a name, or null when there is none.
func orNull(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// interfaces is a server's interfaces for Settings: what exists, what is detected, what the server uses
// (dawnline.rpc.servers interfaces_get). A server not named is the first one.
func interfaces(w *view.World, d Deps, id string) (map[string]any, error) {
	srv := w.M.Servers[id]
	if ids := w.M.ServerIDs(); srv == nil && len(ids) > 0 {
		srv = w.M.Servers[ids[0]]
	}
	if srv == nil || d.Snapshot == nil {
		return nil, errors.New("No server yet.")
	}
	snap := d.Snapshot()
	wan, home, nets, zones := snap.ServerNet(srv)
	byDev := map[string]netview.HomeOf{}
	homes := []any{}
	for _, h := range home {
		byDev[h.Dev] = h
		homes = append(homes, map[string]any{"dev": h.Dev, "auto": h.Auto, "nets": h.Nets, "zone": orNull(h.Zone), "missing": h.Missing})
	}
	devs := []any{}
	for _, name := range snap.Names() {
		x := snap.Devices[name]
		h, isHome := byDev[name]
		devs = append(devs, map[string]any{
			"name": x.Name, "category": x.Category, "kind": x.Kind, "up": x.Up, "master": orNull(x.Master), "members": x.Members, "nets": x.Nets,
			"addrs": x.Addrs, "logical": orNull(x.Logical), "proto": orNull(x.Proto), "zone": orNull(x.Zone),
			"own": name == srv.Ifname, "home": isHome, "auto": isHome && h.Auto,
		})
	}
	// saved names that no longer exist still show, so they can be removed
	for _, h := range home {
		if h.Missing {
			devs = append(devs, map[string]any{"name": h.Dev, "category": "other", "kind": "other", "missing": true, "nets": []string{}, "addrs": []string{},
				"members": []string{}, "home": true, "auto": h.Auto})
		}
	}
	lanOnly := 0
	for _, p := range w.M.People {
		if p.Server == srv.ID && p.Access == "lan" {
			lanOnly++
		}
	}
	lans := srv.LanDevices
	if lans == nil {
		lans = []string{}
	}
	likeHome, _ := roster.LikeHome(d.RunDir)
	return map[string]any{
		"server": srv.ID, "ifname": srv.Ifname,
		"detected": map[string]any{"wan": orNull(snap.WAN), "lan": orNull(snap.LAN)},
		"saved":    map[string]any{"wan": srv.DetectedWan, "lan": srv.DetectedLan},
		"config": map[string]any{"auto_wan": srv.AutoWan, "wan_device": srv.WanDevice, "auto_lan": srv.AutoLan, "lan_devices": lans, "lan_like": srv.LanLike,
			"device_mesh": srv.DeviceMesh, "mesh": srv.Mesh},
		"like_home": likeHome, "needs": Needs()["home"],
		"effective": map[string]any{"wan": map[string]any{"dev": orNull(wan.Dev), "auto": wan.Auto, "zone": wan.Zone, "missing": wan.Missing},
			"home": homes, "nets": nets, "zones": zones},
		"zones": snap.Zones, "devices": devs, "lan_only": lanOnly,
	}, nil
}

// endpointProbe is where a public address points, as the admin types it: the facts Health uses, in words.
// `id` names the server whose WAN to compare with (a new one: the default WAN).
func endpointProbe(w *view.World, t *i18n.Catalog, d Deps, a map[string]any) map[string]any {
	host := strings.Trim(text(a["host"]), " \t\r\n\v\f")
	if host != "" && !endpoint.ValidHost(host) {
		return map[string]any{"error": t.T("Public address must be a hostname or IP address.")}
	}
	srv := w.M.Servers[strings.Trim(text(a["id"]), " \t\r\n\v\f")]
	f := endpoint.Of(host, endpointReads(d, srv, host))
	port := 4500
	if srv != nil {
		port = srv.Port
	} else if p := int(num(a["port"])); p != 0 {
		port = p
	}
	status, words := endpoint.Words(f, fmt.Sprintf("UDP %d", port), t)
	raw, _ := json.Marshal(f)
	var out map[string]any
	json.Unmarshal(raw, &out)
	out["status"], out["text"] = status, words
	return out
}

// endpointReads is what a public address's facts are made from, read on the router.
func endpointReads(d Deps, srv *model.Server, host string) endpoint.Reads {
	r := endpoint.Reads{}
	if host != "" && d.Resolve != nil {
		r.IPs = d.Resolve(host)
	}
	if d.WANOf != nil {
		r.WAN = d.WANOf(srv)
	}
	// the router's IPv6 only when the name has some to compare with
	for _, ip := range r.IPs {
		if strings.Contains(ip, ":") {
			r.Router6, r.Known6 = router6()
			break
		}
	}
	return r
}

// router6 is the router's public IPv6 addresses, and whether `ip` could tell.
func router6() ([]string, bool) {
	out, err := exec.Command("ip", "-6", "-j", "addr", "show", "scope", "global").Output()
	if err != nil {
		return nil, false
	}
	if len(bytes.TrimSpace(out)) == 0 {
		return []string{}, true
	}
	var links []struct {
		Info []struct {
			Family    string `json:"family"`
			Local     string `json:"local"`
			DADFailed bool   `json:"dadfailed"`
		} `json:"addr_info"`
	}
	if json.Unmarshal(out, &links) != nil {
		return nil, false
	}
	return endpoint.Own6(links), true
}

// accessCheck is "Check access" between two sides, each a device's id or an IPv4 address.
func accessCheck(w *view.World, t *i18n.Catalog, d Deps, from, to string) (map[string]any, error) {
	states := map[string]string{}
	for id, p := range w.M.People {
		states[id] = state.Of(w.M, p, w.Usage, w.Now)
	}
	ctx := access.Ctx{States: states, Peers: w.Peers, Snap: d.Snapshot(), T: t, Online: func(dev *model.Device, peer awg.Peer) bool {
		// the watcher's word; without one, a recent handshake
		if w.Online != nil {
			return w.Online[dev.ID]
		}
		return peer.Handshake > 0 && w.Now-peer.Handshake < 190
	}}
	ok, steps, err := access.Check(w.M, from, to, ctx)
	if err != nil {
		return nil, err
	}
	return map[string]any{"ok": ok, "steps": steps}, nil
}
