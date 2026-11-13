// Package resolve finds where a name points, as dawnline.lookup does: public resolvers first (local DNS
// often rewrites the router's own name to its LAN address), then the router's own; every server is asked at
// once for A and AAAA with a short timeout, and the first in that order that answers wins. Answers are kept
// five minutes, failures one.
package resolve

import (
	"context"
	"net"
	"regexp"
	"sync"
	"time"
)

// Servers are asked in this order of preference.
var Servers = []string{"1.1.1.1", "8.8.8.8", "127.0.0.1"}

const (
	keep     = 5 * time.Minute
	keepFail = time.Minute
	timeout  = 2 * time.Second
)

var name = regexp.MustCompile(`^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$`)

type answer struct {
	at  time.Time
	ips []string
}

// A Resolver keeps what it found. Lookup is how one server is asked for one kind of address ("ip4", "ip6");
// nil asks the real one.
type Resolver struct {
	Lookup func(ctx context.Context, server, network, host string) []string
	Now    func() time.Time

	mu    sync.Mutex
	cache map[string]answer
}

func ask(ctx context.Context, server, network, host string) []string {
	r := &net.Resolver{PreferGo: true, Dial: func(ctx context.Context, n, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, n, net.JoinHostPort(server, "53"))
	}}
	ips, _ := r.LookupIP(ctx, network, host)
	out := make([]string, 0, len(ips))
	for _, ip := range ips {
		out = append(out, ip.String())
	}
	return out
}

// Addresses is a name's addresses, IPv4 before IPv6; an address is itself; nothing for what does not resolve.
func (r *Resolver) Addresses(host string) []string {
	if net.ParseIP(host) != nil {
		return []string{host}
	}
	if len(host) > 253 || !name.MatchString(host) {
		return nil
	}
	now := time.Now
	if r.Now != nil {
		now = r.Now
	}
	r.mu.Lock()
	c, has := r.cache[host]
	r.mu.Unlock()
	if has && ((len(c.ips) > 0 && now().Sub(c.at) < keep) || (len(c.ips) == 0 && now().Sub(c.at) < keepFail)) {
		return c.ips
	}
	lookup := r.Lookup
	if lookup == nil {
		lookup = ask
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	found := make([][2][]string, len(Servers))
	var wg sync.WaitGroup
	for i, server := range Servers {
		for j, network := range []string{"ip4", "ip6"} {
			wg.Add(1)
			go func() {
				defer wg.Done()
				found[i][j] = lookup(ctx, server, network, host)
			}()
		}
	}
	wg.Wait()
	var ips []string
	for _, f := range found {
		if ips = append(append(ips, f[0]...), f[1]...); len(ips) > 0 {
			break
		}
	}
	r.mu.Lock()
	if r.cache == nil {
		r.cache = map[string]answer{}
	}
	for h, c := range r.cache {
		if now().Sub(c.at) >= keep {
			delete(r.cache, h)
		}
	}
	r.cache[host] = answer{now(), ips}
	r.mu.Unlock()
	return ips
}

// HostIP is the address to give an app that takes no name for the server: IPv4 first, as a phone on mobile
// data may have no IPv6. "" when the name does not resolve.
func (r *Resolver) HostIP(host string) string {
	ips := r.Addresses(host)
	for _, ip := range ips {
		if net.ParseIP(ip).To4() != nil {
			return ip
		}
	}
	if len(ips) > 0 {
		return ips[0]
	}
	return ""
}
