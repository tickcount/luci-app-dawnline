package geo

import (
	"sync"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/usage"
)

// A lookup run: this many addresses at most, within this long.
const (
	perRun = 3
	budget = 12 * time.Second
)

// Locator finds the places of addresses for the map, a few at a time and never in the way of who asks: a
// lookup waits on the network for seconds. Addresses that just connected go first; the minute adds
// anything still shown that is missing or stale. One run at a time; what did not fit waits for the next.
type Locator struct {
	Store Store
	Get   Fetch
	// Usage is the counters now: they tell which addresses are still shown, and whose they are.
	Usage func() *usage.Usage
	// Found is told the places found ("City · ISP" by address) and the devices seen from those addresses.
	Found func(where map[string]string, devices []string)

	mu       sync.Mutex
	pending  []string
	running  bool
	lastHome int64
}

func (l *Locator) shown(u *usage.Usage) []string {
	var ips []string
	seen := map[string]bool{}
	if u == nil {
		return ips
	}
	for _, rec := range u.Devices {
		for ip := range rec.IPs {
			if !seen[ip] {
				seen[ip] = true
				ips = append(ips, ip)
			}
		}
	}
	return ips
}

// Ask has these addresses located now (provider: the settings' choice), and with them whatever of more is
// missing or stale. It returns at once; the run goes on by itself.
func (l *Locator) Ask(provider string, ips, more []string) {
	l.mu.Lock()
	for _, ip := range ips {
		known := false
		for _, q := range l.pending {
			known = known || q == ip
		}
		if !known {
			l.pending = append(l.pending, ip)
		}
	}
	if l.running {
		l.mu.Unlock()
		return
	}
	todo := Stale(l.Store.Load(), append(append([]string{}, l.pending...), more...), time.Now().Unix())
	want := todo
	if len(want) > perRun {
		want = want[:perRun]
	}
	// what just connected and did not fit waits for the next run
	var rest []string
	for _, ip := range todo[len(want):] {
		for _, q := range l.pending {
			if q == ip {
				rest = append(rest, ip)
			}
		}
	}
	l.pending = rest
	if len(want) == 0 {
		l.mu.Unlock()
		return
	}
	l.running = true
	l.mu.Unlock()
	go func() {
		found := LookupAll(l.Get, provider, want, perRun, budget)
		l.done(found)
		l.mu.Lock()
		l.running = false
		again := len(l.pending) > 0
		l.mu.Unlock()
		if again {
			l.Ask(provider, nil, nil)
		}
	}()
}

// done puts a run's results into the cache and tells who waits for them.
func (l *Locator) done(found map[string]Place) {
	u := l.Usage()
	c := l.Store.Load()
	if !Merge(c, found, l.shown(u), time.Now().Unix()) {
		return
	}
	l.Store.Save(c)
	where := map[string]string{}
	for ip, p := range found {
		if s := Label(p); s != "" {
			where[ip] = s
		}
	}
	if len(where) == 0 || l.Found == nil {
		return
	}
	var devices []string
	if u != nil {
		for id, rec := range u.Devices {
			for ip := range where {
				if _, has := rec.IPs[ip]; has {
					devices = append(devices, id)
					break
				}
			}
		}
	}
	l.Found(where, devices)
}

// Minute is the minute's part: addresses still shown that are missing or stale get a run, and the router's
// own place is looked at about hourly (wan: its public address as the router has it, "" when unknown).
func (l *Locator) Minute(enabled bool, provider, wan string) {
	if !enabled {
		l.mu.Lock()
		l.pending = nil
		l.mu.Unlock()
		return
	}
	l.Ask(provider, nil, l.shown(l.Usage()))
	now := time.Now().Unix()
	l.mu.Lock()
	due := now-l.lastHome > 3600
	if due {
		l.lastHome = now
	}
	l.mu.Unlock()
	if due {
		go func() {
			c := l.Store.Load()
			if ResolveHome(l.Get, provider, c, wan, time.Now().Unix()) {
				// the places found meanwhile are the file's: only the router's own is put in
				fresh := l.Store.Load()
				fresh.Home = c.Home
				l.Store.Save(fresh)
			}
		}()
	}
}
