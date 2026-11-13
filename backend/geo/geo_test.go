package geo

import (
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/usage"
)

const now = 1790000000

func place() Place {
	return Place{"lat": 45.04, "lon": 38.98, "city": "Krasnodar", "country": "Russia", "cc": "RU", "asn": 12389.0, "org": "Rostelecom"}
}

func stamped(ts float64) Place { p := place(); p["ts"] = ts; return p }

// As tests/ucode/geo.test.uc holds the ucode module to.
func TestStaleAndMerge(t *testing.T) {
	c := &Cache{IPs: map[string]Place{"37.78.36.76": stamped(now - 86400), "212.233.85.1": stamped(now - 31*86400), "185.135.150.35": {"fail": float64(now - 3600)},
		"185.135.150.28": {"fail": float64(now - 2*86400)}, "83.239.111.148": {"lat": 1.0, "lon": 2.0, "city": "Old", "ts": float64(now)}}}
	for _, k := range []struct {
		ips  []string
		want string
	}{{[]string{"37.78.36.76"}, ""}, {[]string{"212.233.85.1"}, "212.233.85.1"}, {[]string{"185.135.150.35"}, ""}, {[]string{"185.135.150.28"}, "185.135.150.28"},
		{[]string{"83.239.111.148"}, "83.239.111.148"}, {[]string{"10.0.1.164", "100.64.1.1", "", "fe80::1"}, ""}, {[]string{"1.1.1.1", "8.8.8.8", "1.1.1.1"}, "1.1.1.1 8.8.8.8"}} {
		if got := strings.Join(Stale(c, k.ips, now), " "); got != k.want {
			t.Errorf("stale of %v: %q, not %q", k.ips, got, k.want)
		}
	}
	c = &Cache{IPs: map[string]Place{}}
	if !Merge(c, map[string]Place{"1.1.1.1": place(), "8.8.8.8": nil}, nil, now) {
		t.Error("results changed nothing")
	}
	if c.IPs["1.1.1.1"]["ts"] != float64(now) || c.IPs["1.1.1.1"]["city"] != "Krasnodar" || len(c.IPs["8.8.8.8"]) != 1 || c.IPs["8.8.8.8"]["fail"] != float64(now) {
		t.Errorf("after the merge: %v", c.IPs)
	}
	if Merge(c, nil, nil, now) || Merge(c, map[string]Place{"10.0.0.1": place()}, nil, now) || c.IPs["10.0.0.1"] != nil {
		t.Error("nothing, or a local address, changed the cache")
	}
	if Label(c.IPs["1.1.1.1"]) != "Krasnodar · Rostelecom" || Label(c.IPs["8.8.8.8"]) != "" || Label(nil) != "" || Label(Place{"city": "X"}) != "X" {
		t.Error("the labels")
	}
	// bounded: the oldest go, never what is still shown
	c = &Cache{IPs: map[string]Place{}}
	for i := 0; i < 500; i++ {
		c.IPs[fmt.Sprintf("1.0.%d.%d", i/250, i%250+1)] = stamped(float64(now - 1000 + i))
	}
	Merge(c, map[string]Place{"9.9.9.9": place(), "9.9.9.10": place()}, []string{"1.0.0.1"}, now)
	if len(c.IPs) != 500 || c.IPs["1.0.0.1"] == nil || c.IPs["1.0.0.2"] != nil || c.IPs["1.0.0.3"] != nil || c.IPs["1.0.0.4"] == nil || c.IPs["9.9.9.9"] == nil {
		t.Errorf("the bound: %d entries", len(c.IPs))
	}
	for _, ip := range []string{"8.8.8.8", "2a00:1450::1"} {
		if !IsPublic(ip) {
			t.Errorf("%s is not public", ip)
		}
	}
	for _, ip := range []string{"", "192.168.1.1", "172.20.0.1", "224.0.0.1", "fe80::1", "fd00::1", "::1", "nonsense"} {
		if IsPublic(ip) {
			t.Errorf("%s is public", ip)
		}
	}
}

func TestLookups(t *testing.T) {
	var asked []string
	get := func(url string) map[string]any {
		asked = append(asked, url)
		switch {
		case strings.HasPrefix(url, "https://ipwho.is/1.1.1.1?"):
			return map[string]any{"success": true, "ip": "1.1.1.1", "latitude": 45.04, "longitude": 38.98, "city": "Krasnodar", "country": "Russia", "country_code": "RU",
				"connection": map[string]any{"asn": 12389.0, "isp": "Rostelecom", "org": "Other"}}
		case url == "https://ipapi.co/8.8.8.8/json/":
			return map[string]any{"ip": "8.8.8.8", "latitude": 37.4, "longitude": -122.0, "city": "Mountain View", "country_name": "United States", "country_code": "US", "asn": "AS15169", "org": "GOOGLE"}
		case url == "https://ipapi.co/json/":
			return map[string]any{"ip": "203.0.113.7", "latitude": 55.7, "longitude": 37.6, "city": "Moscow", "country_name": "Russia", "country_code": "RU", "asn": "AS1", "org": "ISP"}
		case strings.HasPrefix(url, "https://ipwho.is/"):
			return map[string]any{"success": false}
		}
		return nil
	}
	found := LookupAll(get, "ipwho.is", []string{"1.1.1.1", "8.8.8.8", "4.4.4.4", "5.5.5.5"}, 3, time.Minute)
	if len(found) != 3 || found["1.1.1.1"]["org"] != "Rostelecom" || found["1.1.1.1"]["ip"] != nil || found["8.8.8.8"]["asn"] != 15169.0 || found["8.8.8.8"]["country"] != "United States" || found["4.4.4.4"] != nil {
		t.Errorf("the lookups: %v", found)
	}
	asked = nil
	Lookup(get, "ipapi.co", "1.1.1.1")
	if len(asked) != 2 || !strings.HasPrefix(asked[0], "https://ipapi.co/") {
		t.Errorf("the chosen provider is not asked first: %v", asked)
	}
	// the router's own place: behind NAT the service is asked who we are; kept six hours, or until the address moves
	c := &Cache{IPs: map[string]Place{}}
	if !ResolveHome(get, "ipwho.is", c, "192.168.1.2", now) || c.Home["city"] != "Moscow" || c.Home["wan"] != "192.168.1.2" {
		t.Errorf("home: %v", c.Home)
	}
	if ResolveHome(get, "ipwho.is", c, "192.168.1.2", now+3600) || !ResolveHome(get, "ipwho.is", c, "192.168.1.2", now+7*3600) {
		t.Error("home is asked too often, or never again")
	}
	c.Home["wan"] = "1.1.1.1"
	if ResolveHome(get, "ipwho.is", c, "1.1.1.1", now+7*3600+60) || !ResolveHome(get, "ipwho.is", c, "8.8.8.8", now+7*3600+120) || c.Home["city"] != "Mountain View" {
		t.Errorf("home after the address moved: %v", c.Home)
	}
}

func TestLocator(t *testing.T) {
	dir := t.TempDir()
	u := usage.Empty()
	u.Devices["d1"] = &usage.Record{IPs: map[string]float64{"1.1.1.1": 1, "10.0.0.9": 1}}
	u.Devices["d2"] = &usage.Record{IPs: map[string]float64{"2.2.2.2": 1, "3.3.3.3": 1, "4.4.4.4": 1}}
	var mu sync.Mutex
	asked := 0
	var where map[string]string
	var devices []string
	done := make(chan bool, 8)
	l := &Locator{Store: Store{Run: dir + "/run", Data: dir + "/data"}, Usage: func() *usage.Usage { return u },
		Get: func(url string) map[string]any {
			mu.Lock()
			asked++
			mu.Unlock()
			if strings.Contains(url, "1.1.1.1") {
				return map[string]any{"success": true, "latitude": 1.0, "longitude": 2.0, "city": "Krasnodar", "connection": map[string]any{"asn": 1.0, "isp": "ISP"}}
			}
			return nil
		},
		Found: func(w map[string]string, d []string) { where, devices = w, d; done <- true }}
	l.Ask("ipwho.is", []string{"1.1.1.1"}, nil)
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("nothing was found")
	}
	if where["1.1.1.1"] != "Krasnodar · ISP" || len(devices) != 1 || devices[0] != "d1" {
		t.Errorf("found %v for %v", where, devices)
	}
	if c := l.Store.Load(); c.IPs["1.1.1.1"]["city"] != "Krasnodar" {
		t.Errorf("the cache: %v", c.IPs)
	}
	// the minute: what is shown and unknown, three a run; what is known is not asked again
	mu.Lock()
	asked = 0
	mu.Unlock()
	l.Minute(true, "ipwho.is", "")
	time.Sleep(300 * time.Millisecond)
	c := l.Store.Load()
	if c.IPs["1.1.1.1"]["city"] != "Krasnodar" || c.IPs["2.2.2.2"]["fail"] == nil || c.IPs["3.3.3.3"]["fail"] == nil || c.IPs["4.4.4.4"]["fail"] == nil || c.IPs["10.0.0.9"] != nil {
		t.Errorf("after the minute: %v", c.IPs)
	}
	if !l.Store.Flush() || l.Store.Flush() {
		t.Error("the cache is not put on flash once")
	}
	l.Minute(false, "ipwho.is", "")
}
