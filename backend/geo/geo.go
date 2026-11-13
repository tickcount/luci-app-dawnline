// Package geo is the city-level places for the admin's map (dawnline.geo). Client addresses are looked up
// once with a third-party service (ipwho.is, ipapi.co as the other) and kept: the live copy in the run
// directory (tmpfs), put on flash about hourly, like the traffic counters. The pages read the cache.
package geo

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/files"
	"github.com/tickcount/luci-app-dawnline/backend/ipnet"
)

const (
	ttl   = 30 * 86400
	retry = 86400
	// limit is the entries kept at least; addresses still shown are never pushed out.
	limit = 500
)

// Place is what is kept of an address, as the cache's file has it (lat, lon, city, country, cc, asn, org,
// ts; or fail alone: the moment a lookup found nothing).
type Place = map[string]any

// Cache is the file: the places by address, and the router's own.
type Cache struct {
	IPs  map[string]Place `json:"ips"`
	Home Place            `json:"home"`
}

// Store is where the cache lives.
type Store struct {
	Run, Data string
}

func (s Store) Load() *Cache {
	c := &Cache{}
	if !files.ReadJSON(s.Run+"/geo.json", c) {
		*c = Cache{}
		files.ReadJSON(s.Data+"/geo.json", c)
	}
	if c.IPs == nil {
		c.IPs = map[string]Place{}
	}
	return c
}

// Save writes the live copy; Flush puts it on flash.
func (s Store) Save(c *Cache) {
	os.MkdirAll(s.Run, 0o755)
	files.WriteJSON(s.Run+"/geo.json", c, 0o600)
}

// Flush copies the live cache to flash when it is newer; whether it did.
func (s Store) Flush() bool {
	live, err := os.Stat(s.Run + "/geo.json")
	if err != nil {
		return false
	}
	if kept, err := os.Stat(s.Data + "/geo.json"); err == nil && !live.ModTime().After(kept.ModTime()) {
		return false
	}
	var c Cache
	if !files.ReadJSON(s.Run+"/geo.json", &c) {
		return false
	}
	os.MkdirAll(s.Data, 0o700)
	return files.WriteJSON(s.Data+"/geo.json", c, 0o600) == nil
}

var private4 = []ipnet.Net{}

func init() {
	for _, n := range []string{"0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.168.0.0/16", "198.18.0.0/15", "224.0.0.0/3"} {
		if c, ok := ipnet.Any(n); ok {
			private4 = append(private4, c)
		}
	}
}

var (
	v6      = regexp.MustCompile(`^[0-9a-f:]+$`)
	localV6 = regexp.MustCompile(`^(fe[89ab]|f[cd]|::1$|::$)`)
)

// IsPublic tells an address a location service can say something about.
func IsPublic(ip string) bool {
	if ip == "" {
		return false
	}
	if n, ok := ipnet.IP(ip); ok {
		for _, c := range private4 {
			if c.Holds(n) {
				return false
			}
		}
		return true
	}
	l := strings.ToLower(ip)
	return v6.MatchString(l) && !localV6.MatchString(l)
}

func num(v any) (float64, bool) {
	switch x := v.(type) {
	case float64:
		return x, true
	case string:
		f, err := strconv.ParseFloat(x, 64)
		return f, err == nil
	}
	return 0, false
}

func str(v any) string {
	s, _ := v.(string)
	return s
}

// Stale is the public addresses of ips the cache does not know or knows from too long ago (a failed lookup
// is tried again after a day), once each and in order.
func Stale(c *Cache, ips []string, now int64) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, ip := range ips {
		if seen[ip] || !IsPublic(ip) {
			continue
		}
		seen[ip] = true
		if p := c.IPs[ip]; p != nil {
			if fail, failed := num(p["fail"]); failed && fail != 0 {
				if float64(now)-fail < retry {
					continue
				}
			} else if ts, _ := num(p["ts"]); p["asn"] != nil && float64(now)-ts < ttl {
				continue
			}
		}
		out = append(out, ip)
	}
	return out
}

// Fetch gets a URL's JSON (nil: not there, or not JSON).
type Fetch func(url string) map[string]any

// HTTP is Fetch over the network, five seconds at most.
func HTTP(url string) map[string]any {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil
	}
	res, err := (&http.Client{Timeout: 5 * time.Second}).Do(req)
	if err != nil {
		return nil
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	if err != nil || res.StatusCode != 200 {
		return nil
	}
	var out map[string]any
	if json.Unmarshal(body, &out) != nil {
		return nil
	}
	return out
}

func ipwho(get Fetch, ip string) Place {
	j := get("https://ipwho.is/" + ip + "?fields=success,ip,latitude,longitude,city,country,country_code,connection")
	if j == nil || j["success"] != true || j["latitude"] == nil {
		return nil
	}
	lat, _ := num(j["latitude"])
	lon, _ := num(j["longitude"])
	cn, _ := j["connection"].(map[string]any)
	asn, _ := num(cn["asn"])
	org := str(cn["isp"])
	if org == "" {
		org = str(cn["org"])
	}
	return Place{"lat": lat, "lon": lon, "city": str(j["city"]), "country": str(j["country"]), "cc": str(j["country_code"]), "ip": j["ip"], "asn": asn, "org": org}
}

var asPrefix = regexp.MustCompile(`(?i)^AS`)

func ipapi(get Fetch, ip string) Place {
	url := "https://ipapi.co/json/"
	if ip != "" {
		url = "https://ipapi.co/" + ip + "/json/"
	}
	j := get(url)
	if j == nil || (j["error"] != nil && j["error"] != false) || j["latitude"] == nil {
		return nil
	}
	lat, _ := num(j["latitude"])
	lon, _ := num(j["longitude"])
	asn, _ := strconv.ParseFloat(asPrefix.ReplaceAllString(fmt.Sprint(j["asn"]), ""), 64)
	return Place{"lat": lat, "lon": lon, "city": str(j["city"]), "country": str(j["country_name"]), "cc": str(j["country_code"]), "ip": j["ip"], "asn": asn, "org": str(j["org"])}
}

// Lookup is one lookup with the chosen provider and the other as fallback (ip "": whoever asks).
func Lookup(get Fetch, provider, ip string) Place {
	order := []func(Fetch, string) Place{ipwho, ipapi}
	if provider == "ipapi.co" {
		order = []func(Fetch, string) Place{ipapi, ipwho}
	}
	for _, fn := range order {
		if p := fn(get, ip); p != nil {
			return p
		}
	}
	return nil
}

// LookupAll looks up at most max of ips, within budget seconds (each lookup may wait on the network): a
// place, or nil where the services had nothing, for the ones tried. Network only, no cache.
func LookupAll(get Fetch, provider string, ips []string, max int, budget time.Duration) map[string]Place {
	started := time.Now()
	out := map[string]Place{}
	for _, ip := range ips {
		if len(out) >= max || time.Since(started) >= budget {
			break
		}
		p := Lookup(get, provider, ip)
		if p != nil {
			delete(p, "ip")
		}
		out[ip] = p
	}
	return out
}

func when(p Place) float64 {
	if ts, ok := num(p["ts"]); ok {
		return ts
	}
	fail, _ := num(p["fail"])
	return fail
}

// Merge puts LookupAll's results into the cache; true when it changed. shown is what is still on the map:
// the cache is kept bounded by dropping other entries only, oldest first, so a lookup is never repeated
// for an address that is still on the map.
func Merge(c *Cache, found map[string]Place, shown []string, now int64) bool {
	changed := false
	for ip, p := range found {
		if !IsPublic(ip) {
			continue
		}
		if p != nil {
			kept := Place{}
			for k, v := range p {
				kept[k] = v
			}
			kept["ts"] = float64(now)
			c.IPs[ip] = kept
		} else {
			c.IPs[ip] = Place{"fail": float64(now)}
		}
		changed = true
	}
	if over := len(c.IPs) - limit; over > 0 {
		keep := map[string]bool{}
		for _, ip := range shown {
			keep[ip] = true
		}
		var other []string
		for ip := range c.IPs {
			if !keep[ip] {
				other = append(other, ip)
			}
		}
		sort.Slice(other, func(i, j int) bool {
			a, b := when(c.IPs[other[i]]), when(c.IPs[other[j]])
			if a != b {
				return a < b
			}
			return other[i] < other[j]
		})
		for i := 0; i < over && i < len(other); i++ {
			delete(c.IPs, other[i])
			changed = true
		}
	}
	return changed
}

// ResolveHome locates the router itself (the arcs' origin), at most every six hours; true when the cache changed.
func ResolveHome(get Fetch, provider string, c *Cache, wan string, now int64) bool {
	h := c.Home
	if h != nil && h["asn"] != nil {
		if ts, _ := num(h["ts"]); float64(now)-ts < 6*3600 && (wan == "" || !IsPublic(wan) || h["wan"] == wan) {
			return false
		}
	}
	// behind NAT, the service is asked for our public address instead
	ask := ""
	if IsPublic(wan) {
		ask = wan
	}
	next := Place{}
	if p := Lookup(get, provider, ask); p != nil {
		next = p
		next["wan"] = wan
		if wan == "" {
			next["wan"] = nil
		}
	} else {
		for k, v := range h {
			next[k] = v
		}
	}
	next["ts"] = float64(now)
	c.Home = next
	return true
}

// Label is "City · ISP" for the activity log; "" for no place (none known, or a failed lookup).
func Label(p Place) string {
	if p == nil {
		return ""
	}
	if fail, failed := num(p["fail"]); failed && fail != 0 {
		return ""
	}
	var parts []string
	for _, x := range []string{str(p["city"]), str(p["org"])} {
		if x != "" {
			parts = append(parts, x)
		}
	}
	return strings.Join(parts, " · ")
}
