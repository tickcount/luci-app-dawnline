package apply

import (
	"fmt"
	"os"
	"syscall"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/awg"
	"github.com/tickcount/luci-app-dawnline/backend/files"
	"github.com/tickcount/luci-app-dawnline/backend/health"
	"github.com/tickcount/luci-app-dawnline/backend/i18n"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/servicelog"
	"github.com/tickcount/luci-app-dawnline/backend/state"
	"github.com/tickcount/luci-app-dawnline/backend/usage"
)

// The keeper is what holds the router to the settings between the admin's changes (the ucode agent's
// steps "Access rules", "Internet like a home device" and "Router"): once a minute it pushes devices and
// access sets when something moved, keeps the home-like path and the resolver in step, and applies
// everything again when the router's networks changed under it.

// resyncEvery is how long at most between two runtime syncs, whatever happened.
const resyncEvery = 600

// Keeper keeps one router. The zero value of what it remembers is "nothing seen yet".
type Keeper struct {
	R *Router
	// Load reads the settings anew, with the LAN address kept for the home-like path.
	Load func() (*model.Model, string, error)
	// Usage is the counters as the watcher has them; Dump what the tunnels hold right now.
	Usage func() *usage.Usage
	Dump  func() (peers map[string]awg.Peer, reads map[string]string)
	// Config is the settings' file: a change by anyone (a method, the CLI, a restore) is seen by its
	// inode and time.
	Config string
	Tools  func() bool
	Caps   func() awg.Caps
	// Words is the catalog the log's sentences are written in (English).
	Words *i18n.Catalog

	states   map[string]string
	lastSync int64
	peers    map[string]string
	conf     string
	seenConf bool
	baseNet  string
	pending  string
	failed   map[string]string
}

func (k *Keeper) step(who string, fn func()) {
	defer func() {
		if e := recover(); e != nil {
			msg := fmt.Sprint(e)
			if k.failed == nil {
				k.failed = map[string]string{}
			}
			// a new failure in the service log, a repeat in syslog alone
			if k.failed[who] != msg && k.R.Log != nil {
				k.R.Log.Write("dawnline", "error", "failed: "+msg, "", who, servicelog.Extra{})
			} else {
				k.R.say("error", "keeper", who+": "+msg)
			}
			k.failed[who] = msg
			return
		}
		delete(k.failed, who)
	}()
	fn()
}

func fileSig(path string) string {
	st, err := os.Stat(path)
	if err != nil {
		return ""
	}
	ino := uint64(0)
	if sys, is := st.Sys().(*syscall.Stat_t); is {
		ino = uint64(sys.Ino)
	}
	return fmt.Sprintf("%d/%d", st.ModTime().UnixNano(), ino)
}

func sameStates(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if w, has := b[k]; !has || w != v {
			return false
		}
	}
	return true
}

// runtime pushes devices and access sets when people's states changed, the settings' file was written,
// the access table is gone (a flushed ruleset: the firewall alone would let every device reach
// everything, so the sync unloads them until it is back), a running tunnel holds other devices than it
// should, or every ten minutes anyway.
func (k *Keeper) runtime(m *model.Model, u *usage.Usage, now int64) {
	states := map[string]string{}
	for _, id := range m.PersonIDs() {
		states[id] = state.Of(m, m.People[id], u, now)
	}
	// A running tunnel without all of its devices, or with ones it should not have: now, not up to ten
	// minutes later. Only where the last sync took: a server that refuses its devices has said so.
	if k.Dump != nil {
		peers, reads := k.Dump()
		for _, id := range m.ServerIDs() {
			srv := m.Servers[id]
			last := k.peers[id]
			if reads[srv.Ifname] != awg.Read || (last != "" && last != "ok" && last != "down") {
				continue
			}
			if d := health.PeerDiff(health.TunnelDevices(m, id, states), peers, srv.Ifname); d.Missing > 0 || d.Extra > 0 {
				k.lastSync = 0
			}
		}
	}
	conf := fileSig(k.Config)
	changed := k.states == nil || !sameStates(states, k.states) || (k.seenConf && conf != k.conf)
	if changed || now-k.lastSync > resyncEvery || (len(m.Servers) > 0 && !k.R.Present()) {
		k.peers = k.R.Sync(m, u, now, false, k.Words).Peers
		k.lastSync = now
	}
	k.conf, k.seenConf, k.states = conf, true, states
}

// KeepLoop keeps the home-like path and the resolver in step. Cheap when nothing changed; the access
// table is rebuilt when the netns address appears, moves or goes away (the guard allows DNS to it).
func (r *Router) KeepLoop(m *model.Model, saved string, u *usage.Usage, now int64, t *i18n.Catalog) Loop {
	unlock := files.Lock(r.RunDir, "apply")
	where := func() string {
		active, address, _, _ := r.likeHome()
		if !active {
			address = ""
		}
		return address + " " + r.ResolverTarget().Mode
	}
	before := where()
	lp := r.LoopEnsure(m, saved, false)
	r.SyncResolver(m)
	r.ReplyRoutes(m)
	if where() != before {
		r.sync(m, u, now, true, t)
	}
	unlock()
	if lp.Plan != nil && lp.Plan.Address != "" && lp.Plan.Address != saved && r.Remember != nil {
		r.Remember(lp.Plan.Address)
	}
	return lp
}

// network applies everything again when the router's networks changed under us. Only a change seen on two
// ticks in a row (a bridge recreated or an interface restarting passes), against what the last apply used.
func (k *Keeper) network(m *model.Model, u *usage.Usage) {
	sig := k.R.NetSignature(m)
	applied := k.baseNet
	if raw, err := os.ReadFile(k.R.RunDir + "/net.sig"); err == nil {
		applied = string(raw)
	}
	if applied == "" || sig == applied {
		if k.baseNet == "" {
			k.baseNet = sig
		}
		k.pending = ""
		return
	}
	if k.pending != sig {
		k.pending = sig
		return
	}
	k.pending = ""
	if k.R.Log != nil {
		k.R.Log.Write("dawnline", "info", "network changed - Dawnline set itself up again", "", "Router", servicelog.Extra{})
	}
	k.R.Apply(k.Load, u, k.Words, k.Tools(), k.Caps())
	k.baseNet = sig
	if raw, err := os.ReadFile(k.R.RunDir + "/net.sig"); err == nil {
		k.baseNet = string(raw)
	}
}

// Tick is one minute's keeping. Each step on its own: a failing one is logged and the others still run.
func (k *Keeper) Tick() {
	m, saved, err := k.Load()
	if err != nil {
		k.R.say("error", "keeper", "the settings could not be read · "+err.Error())
		return
	}
	u := k.Usage()
	if u == nil {
		return
	}
	now := time.Now().Unix()
	k.step("Access rules", func() { k.runtime(m, u, now) })
	k.step("Internet like a home device", func() { k.R.KeepLoop(m, saved, u, now, k.Words) })
	k.step("Router", func() { k.network(m, u) })
}
