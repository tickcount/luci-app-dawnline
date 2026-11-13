package methods

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/awg"
	"github.com/tickcount/luci-app-dawnline/backend/disguise"
	"github.com/tickcount/luci-app-dawnline/backend/ipnet"
	"github.com/tickcount/luci-app-dawnline/backend/model"
	"github.com/tickcount/luci-app-dawnline/backend/netview"
	"github.com/tickcount/luci-app-dawnline/backend/servicelog"
	"github.com/tickcount/luci-app-dawnline/backend/store"
	"github.com/tickcount/luci-app-dawnline/backend/ubus"
	"github.com/tickcount/luci-app-dawnline/backend/uci"
	"github.com/tickcount/luci-app-dawnline/backend/usage"
	"github.com/tickcount/luci-app-dawnline/backend/view"
	"github.com/tickcount/luci-app-dawnline/backend/zone"
)

func world() *view.World {
	m := &model.Model{
		People:  map[string]*model.Person{"anna": {ID: "anna", Name: "Anna", Server: "home", Code: "abcdef-ghijkl-mnopqr", Devices: []string{"phone"}}},
		Servers: map[string]*model.Server{"home": {ID: "home"}},
		Devices: map[string]*model.Device{"phone": {ID: "phone", Person: "anna"}},
	}
	m.Settings.PortalEnabled, m.Settings.PortalPort, m.Settings.PortalHost, m.Settings.PortalAlt = true, 4500, "vpn.example.org", []string{"203.0.113.7", "vpn.example.org"}
	return &view.World{M: m, Usage: usage.Empty(), Now: 1_800_000_000}
}

func ask(t *testing.T, d Deps, name string, args map[string]any) map[string]any {
	t.Helper()
	for _, m := range List(d) {
		if m.Name == name {
			res, err := m.Handle(context.Background(), args)
			if err != nil {
				t.Fatal(err)
			}
			return res
		}
	}
	t.Fatalf("no method %s", name)
	return nil
}

func TestEvents(t *testing.T) {
	log := []map[string]any{
		{"ts": 10.0, "type": "connect", "person": "anna", "device": "phone"},
		{"ts": 20.0, "type": "server_down"},
		{"ts": 30.0, "type": "disconnect", "person": "anna", "device": "phone"},
		{"ts": 40.0, "type": "connect", "person": "boris", "device": "tv"},
		{"ts": 50.0, "type": "roam", "person": "anna", "device": "laptop"},
	}
	d := Deps{World: world, Events: func() []map[string]any { return log }}
	ts := func(res map[string]any) (out []float64) {
		for _, e := range res["events"].([]map[string]any) {
			out = append(out, e["ts"].(float64))
		}
		return
	}
	for name, c := range map[string]struct {
		args  map[string]any
		want  []float64
		total int
	}{
		"all but the old tunnel events": {map[string]any{}, []float64{10, 30, 40, 50}, 4},
		"a person's":                    {map[string]any{"person": "anna"}, []float64{10, 30, 50}, 3},
		"a device's, the newest one":    {map[string]any{"device": "phone", "limit": int32(1)}, []float64{30}, 2},
		"after a moment":                {map[string]any{"since": int64(30)}, []float64{40, 50}, 2},
		"nothing passes":                {map[string]any{"person": "nobody"}, nil, 0},
	} {
		res := ask(t, d, "events", c.args)
		if got := ts(res); !reflect.DeepEqual(got, c.want) || res["total"] != c.total {
			t.Errorf("%s: %v of %v", name, got, res["total"])
		}
	}
	pol := ask(t, d, "events", nil)["policy"].(map[string]any)
	if pol["keep_days"] != 30 || pol["max"] != 2000 || pol["persist"] != "hourly" || pol["usage_days"] != 62 || pol["usage_months"] != 24 || len(pol["categories"].([]string)) != 3 {
		t.Fatalf("the policy: %v", pol)
	}
}

func TestPersonQuestions(t *testing.T) {
	d := Deps{World: world, Events: func() []map[string]any { return nil }}
	links := ask(t, d, "person_links", map[string]any{"id": "anna"})
	want := map[string]any{"code": "abcdef-ghijkl-mnopqr", "link": "https://vpn.example.org:4500/abcdef-ghijkl-mnopqr",
		"links": []string{"https://vpn.example.org:4500/abcdef-ghijkl-mnopqr", "http://203.0.113.7:4501/abcdef-ghijkl-mnopqr"}}
	if !reflect.DeepEqual(links, want) {
		t.Fatalf("links: %v", links)
	}
	u := ask(t, d, "person_usage", map[string]any{"id": "anna", "days": 7})
	if len(u["person"].([]view.Day)) != 7 || len(u["devices"].(map[string]any)["phone"].([]view.Day)) != 7 {
		t.Fatalf("usage: %v", u)
	}
	if u := ask(t, d, "person_usage", map[string]any{"id": "anna"}); len(u["person"].([]view.Day)) != 30 {
		t.Fatal("days not said are thirty")
	}
	for _, name := range []string{"person_links", "person_usage"} {
		if res := ask(t, d, name, map[string]any{"id": "nobody"}); res["error"] != "Unknown person." {
			t.Errorf("%s for nobody: %v", name, res)
		}
	}
	// before the watcher's first look there is nothing to answer from
	starting := Deps{World: func() *view.World { return nil }}
	if res := ask(t, starting, "events", nil); res["error"] == nil {
		t.Fatal("answered with no world")
	}
	var _ []ubus.Method = List(d)
}

func TestServiceLogAndBackups(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(dir+"/data/backups", 0o755)
	os.WriteFile(dir+"/watchdog.json", []byte(`{"last":1799999990,"targets":{"nft":{"ok":true,"name":"Access rules","tries":0},"cfg_home":{"ok":false,"name":"old","tries":2},"awg_home":{"ok":1,"name":"Home · AmneziaWG"}},"repairs":[{"id":"fw","name":"Firewall","ts":5}]}`), 0o600)
	os.WriteFile(dir+"/service.log", []byte("{\"ts\":1,\"msg\":\"a\"}\nnot json\n\n{\"msg\":\"no time\"}\n{\"ts\":3,\"msg\":\"c\"}\n"), 0o600)
	for i, name := range []string{"dawnline-20270101-000000.tar.gz", "dawnline-20270102-000000-pre-update.tar.gz", "notes.txt"} {
		os.WriteFile(dir+"/data/backups/"+name, []byte("x"), 0o600)
		at := time.Unix(1_800_000_000+int64(i)*60, 0)
		os.Chtimes(dir+"/data/backups/"+name, at, at)
	}
	w := world()
	w.M.Servers["home"].Name = "Home"
	d := Deps{World: func() *view.World { return w }, RunDir: dir, DataDir: dir + "/data"}
	res := ask(t, d, "service_log", nil)
	wd := res["watchdog"].(map[string]any)
	var got []string
	for _, x := range wd["targets"].([]any) {
		m := x.(map[string]any)
		got = append(got, fmt.Sprint(m["id"], "=", m["name"], "/", m["ok"], "/", m["tries"]))
	}
	want := []string{"agent=Agent/false/0", "nft=Access rules/true/0", "cfg_home=Home · interface settings/false/2", "awg_home=Home · AmneziaWG/true/0"}
	if !reflect.DeepEqual(got, want) || wd["beat"] != nil || wd["last"] != 1799999990.0 || len(wd["repairs"].([]any)) != 1 {
		t.Fatalf("the watchdog: %v %v", got, wd)
	}
	if log := res["log"].([]any); len(log) != 2 || log[0].(map[string]any)["msg"] != "c" {
		t.Fatalf("the log: %v", log)
	}
	b := ask(t, d, "backup_list", nil)["backups"].([]map[string]any)
	if len(b) != 2 || b[0]["reason"] != "pre-update" || b[1]["reason"] != "manual" || b[1]["size"] != int64(1) {
		t.Fatalf("backups: %v", b)
	}
}

func TestDeviceConfig(t *testing.T) {
	d := Deps{World: world, HostIP: func(string) string { return "203.0.113.7" }}
	if res := ask(t, d, "device_config", map[string]any{"id": "nothing"}); res["error"] != "Unknown device." {
		t.Fatalf("an unknown device: %v", res)
	}
	res := ask(t, d, "device_config", map[string]any{"id": "phone"})
	am, _ := res["amnezia"].(map[string]any)
	if res["conf"] == nil || am == nil || am["host_ip"] != "203.0.113.7" {
		t.Fatalf("a phone's configuration: %v", res)
	}
	w := world()
	w.M.Devices["phone"].Kind = "computer"
	res = ask(t, Deps{World: func() *view.World { return w }, HostIP: d.HostIP}, "device_config", map[string]any{"id": "phone"})
	if _, has := res["amnezia"].(map[string]any)["host_ip"]; has {
		t.Fatal("a computer was given the server's IP")
	}
}

func TestTakenPorts(t *testing.T) {
	netstat := `Active Internet connections (only servers)
Proto Recv-Q Send-Q Local Address           Foreign Address         State       PID/Program name
tcp        0      0 0.0.0.0:80              0.0.0.0:*               LISTEN      1899/uhttpd
tcp        0      0 0.0.0.0:4500            0.0.0.0:*               LISTEN      2001/dawnlined
tcp        0      0 192.168.1.1:8443        0.0.0.0:*               LISTEN      2100/nginx
tcp        0      0 :::8443                 :::*                    LISTEN      2100/nginx
tcp        0      0 :::9000                 :::*                    LISTEN      -
udp        0      0 0.0.0.0:53              0.0.0.0:*                           900/dnsmasq
`
	progs := programs(netstat, "tcp", func(pid string) string {
		if pid == "2001" {
			return "/usr/libexec/dawnline/dawnlined\x00-portal-port\x004500"
		}
		return "/usr/sbin/other"
	})
	if !reflect.DeepEqual(progs, []held{{80, "uhttpd"}, {8443, "nginx"}}) {
		t.Fatalf("programs: %v", progs)
	}
	fw, _ := uci.Parse(`
config redirect 'web'
	option name 'Web server'
	option src 'wan'
	option src_dport '8080-8090 9443'
	option proto 'tcp'
config redirect 'game'
	option src 'wan'
	option src_dport '27015'
	option proto 'udp'
config redirect 'both'
	option src 'wan'
	option src_dport '5000:5010'
config redirect 'off'
	option src 'wan'
	option src_dport '6000'
	option enabled '0'
config redirect 'dawnline_x'
	option src 'wan'
	option src_dport '7000'
config redirect 'lan'
	option src 'lan'
	option src_dport '7100'
`)
	w := world()
	got := tcpTaken(w.M, nil, progs, fw)
	var lines []string
	for _, x := range got {
		lines = append(lines, fmt.Sprint(x["from"], "-", x["to"], " ", x["who"]))
	}
	want := []string{"22-22 the router itself", "53-53 the router itself", "80-80 the router itself", "443-443 the router itself", "8443-8443 nginx on this router",
		"8080-8090 port forward “Web server”", "9443-9443 port forward “Web server”", "5000-5010 port forward “both”"}
	if !reflect.DeepEqual(lines, want) {
		t.Fatalf("taken:\n%v\n%v", lines, want)
	}

	// UDP: the other server, a tunnel of the router's own, what is bound, a forward
	conf, _ := uci.Parse("config settings 'settings'\nconfig server 'home'\n\toption name 'Home'\n\toption port '4500'\n\toption ifname 'dawn0'\n\toption subnet '10.77.0.0/24'\n" +
		"config server 'cabin'\n\toption name 'Cabin'\n\toption port '4600'\n\toption ifname 'dawn1'\n\toption subnet '10.78.0.9/24'\n")
	w.M = model.Load(conf, nil)
	network, _ := uci.Parse("config interface 'wg0'\n\toption listen_port '51820'\nconfig interface 'dawn0'\n\toption listen_port '4500'\nconfig interface 'lan'\n")
	proc := "   sl  local_address rem_address   st\n  12: 00000000:0035 00000000:0000 07 x\n  13: 00000000:1194 00000000:0000 07 x\n  14: 0A000001:D431 08080808:0035 01 x\n  15: 00000000:CA6C 00000000:0000 07 x\n  16: 00000000:0043 00000000:0000 07 x\n"
	udp := programs(netstat, "udp", func(string) string { return "" })
	lines = nil
	for _, x := range udpTaken(w.M, w.M.Servers["home"], nil, network, fw, udpBound(proc, proc), udp) {
		lines = append(lines, fmt.Sprint(x["from"], "-", x["to"], " ", x["who"]))
	}
	want = []string{"4600-4600 server “Cabin”", "51820-51820 interface wg0", "53-53 dnsmasq on this router", "67-67 another program on this router",
		"27015-27015 port forward “game”", "5000-5010 port forward “both”"}
	if !reflect.DeepEqual(lines, want) {
		t.Fatalf("taken UDP:\n%v\n%v", lines, want)
	}
	nets := takenNetworks(w.M, []Address{{"lan", "192.168.1.1/24"}, {"guest", "192.168.1.7/24"}, {"wan", "203.0.113.7/32"}})
	if fmt.Sprint(nets) != "[map[cidr:192.168.1.0/24 name:lan] map[cidr:10.77.0.0/24 name:Home] map[cidr:10.78.0.0/24 name:Cabin]]" {
		t.Fatalf("networks: %v", nets)
	}
}

func TestSettingsAndBackupRead(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(dir+"/data/backups", 0o755)
	os.WriteFile(dir+"/config", []byte("config settings 'settings'\n\toption portal_port '4500'\n\tlist portal_alt 'a.example'\n\tlist portal_alt 'b.example'\n"), 0o600)
	os.WriteFile(dir+"/events.json", []byte(`[{"ts":5,"type":"connect"},{"ts":9,"type":"person_added"}]`), 0o600)
	os.WriteFile(dir+"/geo.json", []byte(`{"ips":{"203.0.113.7":{},"198.51.100.4":{}}}`), 0o600)
	os.WriteFile(dir+"/data/backups/dawnline-20270101-000000.tar.gz", []byte("archive"), 0o600)
	w := world()
	w.M.Settings.PortalEnabled = false
	w.Usage.People["anna"] = &usage.Record{Days: map[string]usage.Pair{"2027-01-02": {1, 2}, "2026-12-30": {1, 2}}}
	d := Deps{World: func() *view.World { return w }, RunDir: dir, DataDir: dir + "/data", Config: dir + "/config"}
	res := ask(t, d, "settings_get", nil)
	set := res["settings"].(map[string]any)
	if set["portal_port"] != "4500" || !reflect.DeepEqual(set["portal_alt"], []string{"a.example", "b.example"}) || set["domain"] != "" || len(set) != len(Settings)+1 || res["cert"] != nil || res["geo_cached"] != 2 {
		t.Fatalf("settings: %v %v %v", set, res["cert"], res["geo_cached"])
	}
	logs := res["logs"].(map[string]any)
	if logs["events"] != 2 || logs["oldest"] != 5.0 || logs["usage_since"] != "2026-12-30" || logs["usage_days"] != 2 || logs["log_ram"] != int64(58) ||
		!reflect.DeepEqual(logs["by_category"], map[string]int{"connections": 1, "people": 1, "problems": 0}) {
		t.Fatalf("logs: %v", logs)
	}
	if got := ask(t, d, "backup_read", map[string]any{"name": "dawnline-20270101-000000.tar.gz"}); got["data"] != "YXJjaGl2ZQ==" {
		t.Fatalf("a backup: %v", got)
	}
	for name, want := range map[string]string{"../config": "Invalid backup name.", "dawnline-20270102-000000.tar.gz": "Backup not found."} {
		if got := ask(t, d, "backup_read", map[string]any{"name": name}); got["error"] != want {
			t.Errorf("%s: %v", name, got)
		}
	}
	if !covers("*.example.org", "vpn.example.org") || covers("*.example.org", "a.vpn.example.org") || covers("*.example.org", "example.org") || !covers("vpn.example.org", "vpn.example.org") {
		t.Fatal("which names a certificate covers")
	}
}

func TestUpdatesStatus(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(dir+"/data/keep/app", 0o755)
	os.MkdirAll(dir+"/i18n", 0o755)
	os.WriteFile(dir+"/i18n/dawnline.ru.lmo", nil, 0o644)
	os.WriteFile(dir+"/i18n/base.ru.lmo", nil, 0o644)
	os.WriteFile(dir+"/update-job.json", []byte(`{"id":"j1","state":"running","started":5}`), 0o600)
	os.WriteFile(dir+"/data/keep/app/pkg.apk", []byte("x"), 0o600)
	os.WriteFile(dir+"/data/keep/app/meta.json", []byte(`{"version":"0.17.0","files":["`+dir+`/data/keep/app/pkg.apk"],"saved":7}`), 0o600)
	hist := "["
	for i := 0; i < 15; i++ {
		hist += fmt.Sprintf(`{"ts":%d},`, i)
	}
	os.WriteFile(dir+"/data/update-history.json", []byte(hist[:len(hist)-1]+"]"), 0o600)
	d := Deps{World: world, RunDir: dir, DataDir: dir + "/data", Catalogs: dir + "/i18n"}
	res := ask(t, d, "updates_status", nil)
	job := res["job"].(map[string]any)
	// nobody holds the lock: the job that says it runs has stopped
	if job["state"] != "failed" || job["error"] != "The update stopped unexpectedly." || job["finished"] == nil {
		t.Fatalf("a job whose worker is gone: %v", job)
	}
	kept := res["kept"].(map[string]any)
	if kept["amneziawg"] != nil || kept["app"].(map[string]any)["version"] != "0.17.0" || len(res["history"].([]any)) != 12 ||
		!reflect.DeepEqual(res["translations"], []string{"ru"}) || res["check"] != nil || res["repo"] != Repo {
		t.Fatalf("status: %v", res)
	}
	os.Remove(dir + "/data/keep/app/pkg.apk")
	if res := ask(t, d, "updates_status", nil); res["kept"].(map[string]any)["app"] != nil {
		t.Fatal("a kept version whose file is gone is still offered")
	}
}

func TestWhatANewServerStartsFrom(t *testing.T) {
	held := func(ranges ...[2]int) (out []map[string]any) {
		for _, r := range ranges {
			out = append(out, map[string]any{"from": r[0], "to": r[1]})
		}
		return
	}
	if freePort(nil) != 4500 {
		t.Fatal("the usual port is free and not taken")
	}
	for i := 0; i < 50; i++ {
		if p := freePort(held([2]int{4500, 4500}, [2]int{40000, 45000})); p <= 45000 || p > 60000 {
			t.Fatalf("a port that is taken: %d", p)
		}
		n, ok := ipnet.Subnet(freeSubnet([]string{"10.0.0.0/9", "192.168.1.0/24", "not a network"}))
		if !ok || n.Prefix != 24 || ipnet.String(n.Base)[:3] != "10." || n.Base < 10<<24|128<<16 {
			t.Fatalf("a network inside one taken: %v", n)
		}
	}
	if n := freeSubnet([]string{"10.0.0.0/8"}); n[:4] != "172." {
		t.Fatalf("with all of 10/8 taken: %s", n)
	}
	if freePortalPort(4500, 0, held([2]int{4501, 4501}, [2]int{8443, 8443})) != 9443 || freePortalPort(4500, 0, nil) != 4500 || freePortalPort(4500, 7000, held([2]int{4500, 4500})) != 7000 {
		t.Fatal("the portal's port")
	}
	conf, _ := uci.Parse("config settings 'settings'\nconfig server 'home'\n\toption ifname 'dawn0'\nconfig person 'server2'\n\toption server 'home'\n")
	m := model.Load(conf, nil)
	network, _ := uci.Parse("config interface 'dawn1'\nconfig interface 'lan'\n")
	if freeServerID(m) != "server3" || freeIfname(m, network) != "dawn2" || idTaken(m, "nobody") || !idTaken(m, "api") || !idTaken(m, "main") {
		t.Fatalf("free names: %s %s", freeServerID(m), freeIfname(m, network))
	}
	for wan, want := range map[string]string{"": "none", "203.0.113.7": "public", "100.70.1.1": "cgnat", "192.168.1.2": "private", "10.1.1.1": "private"} {
		if got := wanKind(wan); got != want {
			t.Errorf("%q is %s", wan, got)
		}
	}
}

func TestHomeHostsAndExport(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(dir+"/leases", []byte("1800000000 aa:bb:cc:00:00:01 192.168.77.20 nas *\n1800000000 aa:bb:cc:00:00:02 192.168.77.5 * *\n1800000000 aa:bb:cc:00:00:03 10.9.9.9 elsewhere *\n"), 0o644)
	os.WriteFile(dir+"/dhcp", []byte("config host\n\toption name 'printer'\n\toption ip '192.168.77.9'\n\tlist mac 'aa:bb:cc:00:00:04'\n\tlist mac 'aa:bb:cc:00:00:05'\nconfig host\n\toption name 'again'\n\toption ip '192.168.77.20'\n"), 0o644)
	os.WriteFile(dir+"/config", []byte("config settings 'settings'\n\toption portal_port '4500'\n\tlist portal_alt 'a.example'\nconfig server 'home'\n\toption private_key 'secret'\n"), 0o600)
	conf, _ := uci.Parse("config settings 'settings'\nconfig server 'home'\n\toption ifname 'dawn0'\n\toption lan_device 'br-lan'\n\toption auto_lan '0'\n")
	w := &view.World{M: model.Load(conf, nil), Usage: usage.Empty()}
	var logged []string
	d := Deps{World: func() *view.World { return w }, Config: dir + "/config", RunDir: dir,
		Snapshot: func() *netview.Snapshot {
			return &netview.Snapshot{Devices: map[string]*netview.Device{"br-lan": {Name: "br-lan", Nets: []string{"192.168.77.0/24"}}}}
		},
		Bus: func(object, method string, _ map[string]any) map[string]any {
			if object != "umdns" {
				return nil
			}
			return map[string]any{
				"_ipp._tcp":     map[string]any{"Printer": map[string]any{"ipv4": []any{"192.168.77.9"}, "port": 631, "host": "printer.local"}},
				"_airplay._tcp": map[string]any{"TV": map[string]any{"ipv4": "192.168.77.30", "port": 7000, "host": "tv.local."}, "Far": map[string]any{"ipv4": "10.1.1.1"}, "None": map[string]any{}},
			}
		},
		Log: &servicelog.Log{RunDir: dir, Syslog: func(_, line string) { logged = append(logged, line) }},
	}
	res, err := homeHosts(w, d, "", dir+"/leases", dir+"/dhcp")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(res)
	want := `{"hosts":[{"address":"192.168.77.5","name":"","mac":"aa:bb:cc:00:00:02","services":[]},` +
		`{"address":"192.168.77.9","name":"printer","mac":"aa:bb:cc:00:00:04","services":[{"name":"Printer","port":631,"type":"_ipp._tcp"}]},` +
		`{"address":"192.168.77.20","name":"nas","mac":"aa:bb:cc:00:00:01","services":[]},` +
		`{"address":"192.168.77.30","name":"tv","mac":"","services":[{"name":"TV","port":7000,"type":"_airplay._tcp"}]}],"mdns":true}`
	if string(raw) != want {
		t.Fatalf("the devices at home:\n%s", raw)
	}
	out := ask(t, d, "export", nil)
	sections := out["sections"].([]map[string]any)
	if out["format"] != "dawnline" || len(sections) != 2 || sections[0]["portal_port"] != "4500" || !reflect.DeepEqual(sections[0]["portal_alt"], []string{"a.example"}) ||
		sections[1][".type"] != "server" || sections[1][".name"] != "home" || sections[1]["private_key"] != "secret" {
		t.Fatalf("an export: %v", out)
	}
	// taking the keys out of the router is written down
	if len(logged) != 1 || logged[0] != "[info] [dawnline] admin exported all settings · the file holds private keys" {
		t.Fatalf("the log: %v", logged)
	}
}

func TestClearingTheLogs(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(dir+"/data", 0o755)
	now := time.Now().Unix()
	os.WriteFile(dir+"/events.json", []byte(fmt.Sprintf(`[{"ts":%d,"type":"connect","person":"anna","device":"phone"},{"ts":%d,"type":"connect","person":"anna","device":"phone"},{"ts":%d,"type":"paused","person":"boris"}]`,
		now-40*86400, now-100, now-50)), 0o600)
	os.WriteFile(dir+"/service.log", []byte(fmt.Sprintf("{\"ts\":%d,\"msg\":\"old\"}\n{\"ts\":%d,\"msg\":\"new\"}\n", now-40*86400, now-10)), 0o600)
	var said []string
	d := Deps{World: world, RunDir: dir, DataDir: dir + "/data", Log: &servicelog.Log{RunDir: dir, Syslog: func(_, line string) { said = append(said, line) }}}
	for args, want := range map[string]string{
		`{"person":"nobody"}`: "Unknown person.", `{"category":"gossip"}`: "Unknown category.", `{"older_days":"0"}`: "Older than must be a number of days.", `{"older_days":"a week"}`: "Older than must be a number of days.",
	} {
		var a map[string]any
		json.Unmarshal([]byte(args), &a)
		if res := ask(t, d, "logs_clear", a); res["error"] != want {
			t.Errorf("%s: %v", args, res)
		}
	}
	if res := ask(t, d, "logs_clear", map[string]any{"person": "anna", "older_days": "7"}); res["removed"] != 1 || res["ok"] != true {
		t.Fatalf("an old event of a person's: %v", res)
	}
	if res := ask(t, d, "logs_clear", map[string]any{"device": "tv"}); res["removed"] != 0 {
		t.Fatalf("nothing to remove: %v", res)
	}
	if res := ask(t, d, "service_log_clear", map[string]any{"older_days": "7"}); res["removed"] != 1 {
		t.Fatalf("an old entry of the service log: %v", res)
	}
	want := []string{"[info] [dawnline] admin cleared the activity log · 1 event · Anna · older than 7 days", "[info] [dawnline] admin cleared the service log · 1 entry older than 7 days"}
	if !reflect.DeepEqual(said, want) {
		t.Fatalf("what was written down:\n%s", strings.Join(said, "\n"))
	}
	var left []map[string]any
	raw, _ := os.ReadFile(dir + "/events.json")
	json.Unmarshal(raw, &left)
	if len(left) != 2 {
		t.Fatalf("the activity left: %s", raw)
	}
	// the service log keeps its newer entry, and the two lines of what was cleared
	raw, _ = os.ReadFile(dir + "/service.log")
	if n := strings.Count(string(raw), "\n"); n != 3 || strings.Contains(string(raw), `"old"`) {
		t.Fatalf("the service log left:\n%s", raw)
	}
}

func TestForgetting(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(dir+"/data/backups", 0o755)
	os.WriteFile(dir+"/geo.json", []byte(`{"ips":{"203.0.113.7":{"city":"X"}},"home":{"lat":1}}`), 0o600)
	os.WriteFile(dir+"/data/backups/dawnline-20270101-000000.tar.gz", []byte("x"), 0o600)
	var said, reset []string
	d := Deps{World: world, RunDir: dir, DataDir: dir + "/data", Log: &servicelog.Log{RunDir: dir, Syslog: func(_, line string) { said = append(said, line) }},
		ResetUsage: func(scope, id string) bool { reset = append(reset, scope+" "+id); return true }}
	for args, want := range map[string]string{`{"scope":"some"}`: "Unknown scope.", `{"scope":"person","id":"nobody"}`: "Unknown person.", `{"scope":"limit","id":"nobody"}`: "Unknown person.",
		`{"scope":"device","id":"nothing"}`: "Unknown device."} {
		var a map[string]any
		json.Unmarshal([]byte(args), &a)
		if res := ask(t, d, "usage_clear", a); res["error"] != want {
			t.Errorf("%s: %v", args, res)
		}
	}
	for _, a := range []map[string]any{{"scope": "all"}, {"scope": "person", "id": "anna"}, {"scope": "limit", "id": "anna"}, {"scope": "device", "id": "phone"}} {
		if res := ask(t, d, "usage_clear", a); res["ok"] != true {
			t.Fatalf("%v: %v", a, res)
		}
	}
	if strings.Join(reset, "; ") != "all ; person anna; limit anna; device phone" {
		t.Fatalf("what was reset: %v", reset)
	}
	want := "[info] [dawnline] admin reset traffic history for everyone\n[info] [dawnline] admin reset traffic history for Anna\n" +
		"[info] [dawnline] admin reset the data limit's usage for Anna\n[info] [dawnline] admin reset traffic history for  (Anna)"
	if got := strings.Join(said, "\n"); got != want {
		t.Fatalf("what was written down:\n%s", got)
	}
	ask(t, d, "geo_clear", nil)
	for _, f := range []string{dir + "/geo.json", dir + "/data/geo.json"} {
		if raw, _ := os.ReadFile(f); strings.Join(strings.Fields(string(raw)), "") != `{"home":null,"ips":{}}` {
			t.Fatalf("%s after forgetting: %s", f, raw)
		}
	}
	for name, want := range map[string]string{"../x": "Invalid backup name.", "dawnline-20270102-000000.tar.gz": "Backup not found."} {
		if res := ask(t, d, "backup_delete", map[string]any{"name": name}); res["error"] != want {
			t.Errorf("%s: %v", name, res)
		}
	}
	if res := ask(t, d, "backup_delete", map[string]any{"name": "dawnline-20270101-000000.tar.gz"}); res["ok"] != true || exists(dir+"/data/backups/dawnline-20270101-000000.tar.gz") {
		t.Fatalf("a backup removed: %v", res)
	}
}

func TestBackupCreate(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(dir+"/data", 0o755)
	os.WriteFile(dir+"/config", []byte("config settings 'settings'\n"), 0o600)
	os.WriteFile(dir+"/usage.json", []byte(`{"live":true}`), 0o600)
	os.WriteFile(dir+"/data/events.json", []byte(`[]`), 0o600)
	d := Deps{Config: dir + "/config", RunDir: dir, DataDir: dir + "/data"}
	now := int64(1_800_000_000)
	clock = func() int64 { now += 60; return now }
	defer func() { clock = func() int64 { return time.Now().Unix() } }()
	read := func(name string) map[string]string {
		f, err := os.Open(dir + "/data/backups/" + name)
		if err != nil {
			t.Fatal(err)
		}
		defer f.Close()
		zr, err := gzip.NewReader(f)
		if err != nil {
			t.Fatal(err)
		}
		tr := tar.NewReader(zr)
		out := map[string]string{}
		for {
			h, err := tr.Next()
			if err != nil {
				break
			}
			raw, _ := io.ReadAll(tr)
			out[h.Name] = string(raw)
		}
		return out
	}
	// by hand: everything, the live counters put on flash first
	name, err := backupCreate(d, "")
	if err != nil || !backupFile.MatchString(name) || strings.Contains(name[len("dawnline-20270115-080100"):], "-") {
		t.Fatalf("a backup by hand: %q %v", name, err)
	}
	if got := read(name); len(got) != 3 || got["etc/config/dawnline"] != "config settings 'settings'\n" || got["etc/dawnline/usage.json"] != `{"live":true}` || got["etc/dawnline/events.json"] != "[]" {
		t.Fatalf("what it holds: %v", got)
	}
	// before a removal: the settings alone, and its kind in its name
	name, _ = backupCreate(d, "pre-delete")
	if got := read(name); len(got) != 1 || !strings.HasSuffix(name, "-pre-delete.tar.gz") {
		t.Fatalf("a backup before a removal: %s %v", name, got)
	}
	// of each kind only the newest stay: five before removals and the one just made
	for i := 0; i < 8; i++ {
		backupCreate(d, "pre-delete")
		at := time.Unix(now, 0)
		os.Chtimes(dir+"/data/backups/"+"dawnline-"+at.In(zone.Local()).Format("20060102-150405")+"-pre-delete.tar.gz", at, at)
	}
	kinds := map[string]int{}
	for _, b := range backups(dir + "/data/backups") {
		kinds[b["reason"].(string)]++
	}
	if kinds["pre-delete"] != 6 || kinds["manual"] != 1 {
		t.Fatalf("what stays: %v", kinds)
	}
	left, _ := os.ReadDir(dir + "/data/backups")
	for _, e := range left {
		if strings.HasPrefix(e.Name(), ".") {
			t.Fatalf("a half-written archive stays: %s", e.Name())
		}
	}
}

func TestANewDisguise(t *testing.T) {
	dir := t.TempDir()
	os.WriteFile(dir+"/dawnline", []byte("config settings 'settings'\nconfig server 'home'\n\toption name 'Home'\n\toption jc '3'\n\toption i5 '<r 9>'\n\toption header_protection_key 'old'\n\toption preset 'strong'\n"), 0o600)
	full := awg.Caps{V2: true, V3: true}
	var said []string
	d := Deps{World: world, Store: &store.Store{Config: dir + "/dawnline", RunDir: dir}, Caps: func() awg.Caps { return full },
		Log: &servicelog.Log{RunDir: dir, Syslog: func(_, line string) { said = append(said, line) }}}
	for _, name := range []string{"balanced", "max", "", "off"} {
		if res := ask(t, d, "server_obfuscation", map[string]any{"id": "home", "preset": name}); res["error"] != nil {
			t.Fatalf("%s: %v", name, res)
		}
		_, m, _ := d.Store.Read()
		srv := m.Servers["home"]
		want := name
		if want == "" {
			// none named: the strongest this router runs
			want = "max"
		}
		if srv.Preset != want || srv.Obf["i5"] != "" || srv.Obf["header_protection_key"] == "old" || len(disguise.Errors(srv.Obf)) != 0 || len(srv.Obf) != len(disguise.Preset(want)) {
			t.Fatalf("%s left %s with %v", name, srv.Preset, srv.Obf)
		}
	}
	if len(said) != 4 || said[1] != "[info] [awg] admin changed server Home · disguise: max" {
		t.Fatalf("what was written down: %v", said)
	}
	// an AmneziaWG that cannot run it: told what to install
	full = awg.Caps{V2: true}
	if res := ask(t, d, "server_obfuscation", map[string]any{"id": "home", "preset": "max"}); !strings.HasPrefix(text(res["error"]), "Maximum needs AmneziaWG 3.1") {
		t.Fatalf("3.1 on a 2.0 router: %v", res)
	}
	if res := ask(t, d, "server_obfuscation", map[string]any{"id": "home"}); res["error"] != nil {
		t.Fatalf("the strongest a 2.0 router runs: %v", res)
	}
	if _, m, _ := d.Store.Read(); m.Servers["home"].Preset != "balanced" {
		t.Fatalf("it is %s", m.Servers["home"].Preset)
	}
}

func TestFixesAndUpdates(t *testing.T) {
	dir := t.TempDir()
	conf, _ := uci.Parse("config settings 'settings'\nconfig server 'home'\n\toption ifname 'dawn0'\n\toption private_key 'k'\n\toption subnet '10.77.0.0/24'\nconfig server 'keyless'\n\toption ifname 'dawn1'\n")
	w := &view.World{M: model.Load(conf, nil), Usage: usage.Empty(), Now: 1_800_000_000}
	var did []string
	d := Deps{World: func() *view.World { return w }, RunDir: dir, DataDir: dir,
		Snapshot:   func() *netview.Snapshot { return &netview.Snapshot{Devices: map[string]*netview.Device{}} },
		Apply:      func(string) map[string]any { did = append(did, "apply"); return map[string]any{"applied": true} },
		Sync:       func(string) any { did = append(did, "sync"); return "a warning" },
		Background: func(s string) { did = append(did, "run "+s) },
		Ifup:       func(n string) { did = append(did, "ifup "+n) },
		Updater:    func(lang string, args []string) { did = append(did, "updater "+lang+" "+strings.Join(args, " ")) },
	}
	for id, want := range map[string]string{"apply": "apply", "sync": "sync", "restart": "run sleep 1; /etc/init.d/dawnline restart",
		"netrestart": "run sleep 1; /etc/init.d/network restart", "ifup:dawn0": "ifup dawn0"} {
		did = nil
		res := ask(t, d, "health_fix", map[string]any{"id": id})
		if res["error"] != nil || res["result"] == nil || res["checks"] == nil || res["watchdog"] == nil || len(did) != 1 || did[0] != want {
			t.Errorf("%s: did %v, answered error %v result %v", id, did, res["error"], res["result"])
		}
	}
	// never another interface of the router, nor a tunnel that has no keys
	for id, want := range map[string]string{"ifup:br-lan": "Unknown fix.", "ifup:lan": "lan is not one of Dawnline's tunnels.", "ifup:dawn1": "dawn1 is not one of Dawnline's tunnels.",
		"reboot": "Unknown fix.", "": "Unknown fix."} {
		did = nil
		if res := ask(t, d, "health_fix", map[string]any{"id": id}); res["error"] != want || len(did) != 0 {
			t.Errorf("%q: %v, did %v", id, res["error"], did)
		}
	}
	for what, want := range map[string]string{"": "updater  check", "check:app": "updater  check app", "app@v0.19.0": "updater  install app@v0.19.0",
		"amneziawg:slava:ru": "updater  install amneziawg:slava:ru", "pkgs:ip-full,kmod-veth": "updater  install pkgs:ip-full,kmod-veth"} {
		did = nil
		if res := ask(t, d, "updates_run", map[string]any{"what": what}); res["started"] != true || res["job"] != nil || len(did) != 1 || did[0] != want {
			t.Errorf("%q: %v, did %v", what, res, did)
		}
	}
	for what, want := range map[string]string{"everything": "Unknown update target.", "app; reboot": "Unknown update target.", "pkgs:busybox": "busybox is not a package Dawnline manages",
		"pkgs:ip-full,": "Unknown update target."} {
		did = nil
		if res := ask(t, d, "updates_run", map[string]any{"what": what}); res["error"] != want || len(did) != 0 {
			t.Errorf("%q: %v, did %v", what, res["error"], did)
		}
	}
	// the job the updater wrote is answered, never an older one
	os.WriteFile(dir+"/update-job.json", []byte(`{"id":"old","started":5,"state":"done"}`), 0o600)
	d.Updater = func(string, []string) {
		os.WriteFile(dir+"/update-job.json", []byte(fmt.Sprintf(`{"id":"new","started":%d,"state":"running"}`, time.Now().Unix()+1)), 0o600)
	}
	if res := ask(t, d, "updates_run", map[string]any{"what": "check"}); res["job"] == nil || res["job"].(map[string]any)["id"] != "new" {
		t.Fatalf("the new job: %v", res)
	}
	if res := ask(t, d, "apply", nil); res["applied"] != true {
		t.Fatalf("apply: %v", res)
	}
}

func TestRestoreAndImport(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(dir+"/data", 0o755)
	good := "\nconfig settings 'settings'\n\toption portal_port '4500'\n\nconfig server 'home'\n\toption name 'Home'\n\toption ifname 'dawn0'\n\toption port '4500'\n\toption subnet '10.77.0.0/24'\n\n"
	os.WriteFile(dir+"/config", []byte(good), 0o600)
	os.WriteFile(dir+"/usage.json", []byte(`{"devices":{},"people":{},"then":true}`), 0o600)
	os.WriteFile(dir+"/data/events.json", []byte(`[{"ts":1,"type":"connect"}]`), 0o600)
	var said []string
	applied := 0
	d := Deps{World: world, Config: dir + "/config", RunDir: dir, DataDir: dir + "/data", Store: &store.Store{Config: dir + "/config", RunDir: dir},
		Apply: func(string) map[string]any { applied++; return map[string]any{"ok": true} },
		Log:   &servicelog.Log{RunDir: dir, Syslog: func(_, line string) { said = append(said, line) }}}
	now := int64(1_800_000_000)
	clock = func() int64 { now += 60; return now }
	defer func() { clock = func() int64 { return time.Now().Unix() } }()
	kept, _ := backupCreate(d, "")
	// the settings change, the counters move on, then the backup is brought back
	os.WriteFile(dir+"/config", []byte(strings.Replace(good, "'Home'", "'Changed'", 1)), 0o600)
	os.WriteFile(dir+"/usage.json", []byte(`{"devices":{},"people":{},"later":true}`), 0o600)
	os.WriteFile(dir+"/data/usage.json", []byte(`{"devices":{},"people":{},"later":true}`), 0o600)
	if res := ask(t, d, "backup_restore", map[string]any{"name": kept}); res["ok"] != true || applied != 1 {
		t.Fatalf("a restore: %v, applied %d", res, applied)
	}
	if raw, _ := os.ReadFile(dir + "/config"); string(raw) != good {
		t.Fatalf("the settings after:\n%s", raw)
	}
	if raw, _ := os.ReadFile(dir + "/data/usage.json"); !strings.Contains(string(raw), "then") {
		t.Fatalf("the counters after: %s", raw)
	}
	// the watcher is told to load the counters anew, and what was there before the restore is kept
	if !exists(dir+"/usage.reload") || exists(dir+"/usage.json") {
		t.Fatal("the live counters were not handed back to flash")
	}
	kinds := map[string]int{}
	for _, b := range backups(dir + "/data/backups") {
		kinds[b["reason"].(string)]++
	}
	if kinds["pre-restore"] != 1 || kinds["manual"] != 1 || len(said) != 1 || !strings.Contains(said[0], "admin restored backup "+kept) {
		t.Fatalf("what stays %v, what was written down %v", kinds, said)
	}
	// what is no backup, or holds what a backup may not
	archive := func(entries ...[3]string) string {
		var buf bytes.Buffer
		zw := gzip.NewWriter(&buf)
		tw := tar.NewWriter(zw)
		for _, e := range entries {
			h := &tar.Header{Name: e[0], Mode: 0o600, Size: int64(len(e[1])), Typeflag: tar.TypeReg}
			if e[2] == "link" {
				h.Typeflag, h.Linkname, h.Size = tar.TypeSymlink, e[1], 0
			}
			tw.WriteHeader(h)
			if e[2] != "link" {
				tw.Write([]byte(e[1]))
			}
		}
		tw.Close()
		zw.Close()
		return base64.StdEncoding.EncodeToString(buf.Bytes())
	}
	broken := strings.Replace(good, "'10.77.0.0/24'", "'not a network'", 1)
	for name, c := range map[string][2]string{
		"nothing":            {"", "Upload is empty or too large."},
		"not an archive":     {base64.StdEncoding.EncodeToString([]byte("hello")), "Not a valid backup archive."},
		"another file":       {archive([3]string{"etc/config/dawnline", good, ""}, [3]string{"etc/passwd", "x", ""}), "Unexpected file in backup: etc/passwd"},
		"a link":             {archive([3]string{"etc/config/dawnline", "/etc/shadow", "link"}), "Unexpected entry in backup: etc/config/dawnline"},
		"no settings":        {archive([3]string{"etc/dawnline/usage.json", "{}", ""}), "Backup does not contain /etc/config/dawnline."},
		"unreadable":         {archive([3]string{"etc/config/dawnline", "config 'unclosed", ""}), "The configuration in this file cannot be read."},
		"settings that fail": {archive([3]string{"./etc/config/dawnline", broken, ""}), "This configuration can't be used: Server Home: Subnet must look like 10.77.0.0/24."},
	} {
		before := applied
		if res := ask(t, d, "backup_upload", map[string]any{"data": c[0]}); res["error"] != c[1] || applied != before {
			t.Errorf("%s: %v", name, res["error"])
		}
	}
	if raw, _ := os.ReadFile(dir + "/config"); string(raw) != good {
		t.Fatal("a refused upload touched the settings")
	}
	if res := ask(t, d, "backup_upload", map[string]any{"data": archive([3]string{"/etc/config/dawnline", strings.Replace(good, "'Home'", "'Sent'", 1), ""})}); res["ok"] != true {
		t.Fatalf("a good upload: %v", res)
	}
	// an export comes back as the settings it was taken from
	out := ask(t, d, "export", nil)
	raw, _ := json.Marshal(out)
	var sent map[string]any
	json.Unmarshal(raw, &sent)
	os.WriteFile(dir+"/config", []byte(good), 0o600)
	if res := ask(t, d, "import", map[string]any{"data": sent}); res["ok"] != true {
		t.Fatalf("an import: %v", res)
	}
	_, m, _ := d.Store.Read()
	if m.Servers["home"].Name != "Sent" || m.Servers["home"].Subnet != "10.77.0.0/24" || m.Settings.PortalPort != 4500 {
		t.Fatalf("the settings imported: %+v", m.Servers["home"])
	}
	for name, c := range map[string]struct {
		data any
		want string
	}{
		"not an export":  {map[string]any{"format": "other", "sections": []any{}}, "Not a Dawnline export."},
		"nothing":        {nil, "Not a Dawnline export."},
		"another kind":   {map[string]any{"format": "dawnline", "sections": []any{map[string]any{".type": "interface", ".name": "lan"}}}, "Invalid section lan."},
		"a bad name":     {map[string]any{"format": "dawnline", "sections": []any{map[string]any{".type": "person", ".name": "a b"}}}, "Invalid section a b."},
		"a bad option":   {map[string]any{"format": "dawnline", "sections": []any{map[string]any{".type": "person", ".name": "anna", "Name": "x"}}}, "Invalid option Name."},
		"a number":       {map[string]any{"format": "dawnline", "sections": []any{map[string]any{".type": "person", ".name": "anna", "limit": 5.0}}}, "Invalid option limit."},
		"what is broken": {map[string]any{"format": "dawnline", "sections": []any{map[string]any{".type": "settings", ".name": "settings"}, map[string]any{".type": "person", ".name": "anna", "server": "gone", "name": "Anna"}}}, "This configuration can't be used: Person Anna: server gone does not exist."},
	} {
		if res := ask(t, d, "import", map[string]any{"data": c.data}); res["error"] != c.want {
			t.Errorf("%s: %v", name, res["error"])
		}
	}
}

// A backup the ucode backend made with its own tar is read by Go's restore, file for file.
func TestUcodesBackupIsRead(t *testing.T) {
	raw, err := os.ReadFile("testdata/backup.json")
	if err != nil {
		t.Fatal(err)
	}
	var golden struct {
		Config   string `json:"config"`
		Archives []struct{ Name, Data string }
	}
	if err := json.Unmarshal(raw, &golden); err != nil {
		t.Fatal(err)
	}
	if len(golden.Archives) != 2 {
		t.Fatalf("%d archives", len(golden.Archives))
	}
	for i, a := range golden.Archives {
		data, _ := base64.StdEncoding.DecodeString(a.Data)
		parts, err := unpack(data)
		if err != nil || string(parts["etc/config/dawnline"]) != golden.Config || !backupFile.MatchString(a.Name) {
			t.Fatalf("%s: %v", a.Name, err)
		}
		// by hand: the counters and the log with it; before an update: the settings alone
		if want := []int{3, 1}[i]; len(parts) != want {
			t.Errorf("%s holds %d files, want %d", a.Name, len(parts), want)
		}
	}
	if !strings.Contains(string(mustUnpack(t, golden.Archives[0].Data)["etc/dawnline/usage.json"]), "by ucode") {
		t.Fatal("the counters in it are not the ones that were there")
	}
}

func mustUnpack(t *testing.T, b64 string) map[string][]byte {
	data, _ := base64.StdEncoding.DecodeString(b64)
	parts, err := unpack(data)
	if err != nil {
		t.Fatal(err)
	}
	return parts
}
