//go:build e2e

// The whole path a page takes, on a real OpenWrt userland: uhttpd's /ubus,
// rpcd's sessions and access lists (the package's own ACL file), ubusd and the
// backend with its own watcher and topics, over a stand's settings and tunnel.
// scripts/backend-container.sh starts the daemons and runs this.
package daemon

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/awg"
	"github.com/tickcount/luci-app-dawnline/backend/hub"
	"github.com/tickcount/luci-app-dawnline/backend/ubus"
)

const web = "http://127.0.0.1:8099/ubus"

// rpc is a JSON-RPC call through uhttpd, as LuCI's rpc.js makes it. It
// returns ubus's status and the answer.
func rpc(t *testing.T, sid, object, method string, args map[string]any) (int, map[string]any) {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": 1, "method": "call", "params": []any{sid, object, method, args}})
	res, err := http.Post(web, "application/json", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var out struct {
		Result []json.RawMessage
		Error  *struct {
			Code    int
			Message string
		}
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out.Error != nil {
		return out.Error.Code, nil
	}
	var code int
	json.Unmarshal(out.Result[0], &code)
	var data map[string]any
	if len(out.Result) > 1 {
		json.Unmarshal(out.Result[1], &data)
	}
	return code, data
}

func at(v any, path ...string) any {
	for _, k := range path {
		m, _ := v.(map[string]any)
		v = m[k]
	}
	return v
}

// The stand's settings: one server, one person, one device.
const (
	standServerKey = "yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk="
	standServerPub = "xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg="
	standDeviceKey = "HIgo9xNzJMWLKASShiTqIybxZ0U3wGLiUeJ1PKf8ykw="
)

func standSettings(person string) string {
	return `
config settings 'settings'
config server 's1'
	option name 'Home'
	option ifname 'dawn0'
	option subnet '10.77.0.0/24'
	option private_key '` + standServerKey + `'
	option public_key '` + standServerPub + `'
config person 'p1'
	option server 's1'
	option name '` + person + `'
config device 'd1'
	option person 'p1'
	option name 'Phone'
	option kind 'phone'
	option address '10.77.0.2'
	option public_key '` + standDeviceKey + `'
`
}

// tunnel is the stand's one tunnel: its device is there, with the handshake the test gave it.
type tunnel struct {
	mu        sync.Mutex
	handshake int64
}

func (tn *tunnel) reader() *awg.Reader {
	return &awg.Reader{
		// as `awg show <ifname> dump` prints: the interface's line, then a peer a line
		Show: func(string) (string, bool) {
			tn.mu.Lock()
			defer tn.mu.Unlock()
			return standServerKey + "\t" + standServerPub + "\t4500\toff\n" +
				fmt.Sprintf("%s\t(none)\t203.0.113.7:41821\t10.77.0.2/32\t%d\t0\t0\toff\n", standDeviceKey, tn.handshake), true
		},
		Index: func(string) (int, bool) { return 7, true },
	}
}

func (tn *tunnel) shake(at int64) {
	tn.mu.Lock()
	tn.handshake = at
	tn.mu.Unlock()
}

// follow asks with wait until the documents satisfy `done`, taking the events into them, and returns the
// number the page is at and the events of the last answer. The topics are the page's whole snapshot.
func follow(t *testing.T, sid, epoch string, seq float64, docs map[string]any, topics []any, what string, done func() bool) (float64, []any) {
	t.Helper()
	deadline := time.Now().Add(25 * time.Second)
	for {
		args := map[string]any{"epoch": epoch, "seq": seq, "timeout": 10}
		if topics != nil {
			args["topics"] = topics
		}
		code, got := rpc(t, sid, "dawnline", "wait", args)
		events, _ := got["events"].([]any)
		if code != 0 || got["docs"] != nil || (len(events) == 0 && time.Now().After(deadline)) {
			t.Fatalf("wait for %s: %d %v", what, code, got)
		}
		take(docs, events)
		seq = got["seq"].(float64)
		if done() {
			return seq, events
		}
	}
}

// take applies events to a page's documents, as a page does.
func take(docs map[string]any, events []any) {
	for _, e := range events {
		topic, _ := at(e, "topic").(string)
		switch at(e, "op") {
		case "put":
			docs[topic] = at(e, "data")
		case "patch":
			docs[topic] = hub.Merge(docs[topic], at(e, "data"))
		}
	}
}

func TestThroughUhttpd(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	dir := t.TempDir()
	config := filepath.Join(dir, "config")
	settings := func(person string) {
		if err := os.WriteFile(config, []byte(standSettings(person)), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	settings("Myata")
	// The stand is no router to keep: the minute's work (the access rules, the watchdog) stays away, the
	// watcher and the topics are the backend's own.
	if err := os.WriteFile(filepath.Join(dir, "backend-off"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	// A backend that was restarted: its earlier run left who was online, and nobody came or went since, so
	// the watcher's first look finds nothing to tell of by itself.
	run := filepath.Join(dir, "run")
	os.MkdirAll(run, 0o755)
	if err := os.WriteFile(filepath.Join(run, "presence.json"), []byte(`{"online":{"d1":false},"endpoint":{"d1":"203.0.113.7"},"rev":1,"people":{"p1":1}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	tn := &tunnel{}
	began := time.Now()
	// The backend is stopped, and has stopped, before the test ends: it writes into the stand's folders (its beat,
	// its presence) and logs through t, and a test that ended under it failed at removing a folder still written to.
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		Run(ctx, Options{Socket: ubus.Socket, RunDir: run, DataDir: dir, Config: config, Stream: "sse", Watch: true, Tunnels: tn.reader(), Log: t.Logf})
	}()
	defer func() {
		cancel()
		select {
		case <-stopped:
		case <-time.After(10 * time.Second):
			t.Error("the backend did not stop")
		}
	}()
	for exec.CommandContext(ctx, "ubus", "list", "dawnline").Run() != nil {
		if ctx.Err() != nil {
			t.Fatal("the object never appeared on the bus")
		}
		time.Sleep(20 * time.Millisecond)
	}

	// Without a session rpcd refuses; with one, the read ACL lets the page in.
	if code, _ := rpc(t, "00000000000000000000000000000000", "dawnline", "hello", nil); code == 0 {
		t.Fatal("answered without a session")
	}
	code, login := rpc(t, "00000000000000000000000000000000", "session", "login", map[string]any{"username": "root", "password": ""})
	if code != 0 {
		t.Fatalf("login: %d", code)
	}
	sid := login["ubus_rpc_session"].(string)

	code, hello := rpc(t, sid, "dawnline", "hello", map[string]any{})
	if code != 0 || hello["stream"] != "sse" || hello["epoch"] == "" {
		t.Fatalf("hello: %d %v", code, hello)
	}

	// A page that was open while the backend restarted asks at once, before the watcher's first look: its
	// first question starts the bridge, and the documents come with the bridge's next second. (They once
	// came only with the next Refresh, half a minute later: the bridge took topics nobody could make yet
	// for told.)
	asked := time.Now()
	code, snap := rpc(t, sid, "dawnline", "sync", map[string]any{})
	if code != 0 {
		t.Fatalf("sync: %d", code)
	}
	epoch, seq := snap["epoch"].(string), snap["seq"].(float64)
	docs, _ := snap["docs"].(map[string]any)
	if docs == nil {
		docs = map[string]any{}
	}
	whole := func() bool {
		return at(docs, "people", "items", "p1", "name") == "Myata" && at(docs, "servers", "items", "s1") != nil && at(docs, "backend", "ok") == true
	}
	if !whole() {
		seq, _ = follow(t, sid, epoch, seq, docs, nil, "the first documents", whole)
	}
	took := time.Since(asked)
	t.Logf("the page asked %v after the backend started and had its first documents %v later", asked.Sub(began).Round(time.Millisecond), took.Round(time.Millisecond))
	if took > 3*time.Second {
		t.Fatalf("the first documents took %v", took)
	}
	if at(docs, "people", "items", "p1", "devices", "items", "d1", "online") != false || at(docs, "servers", "order").([]any)[0] != "s1" {
		t.Fatalf("documents: %v", docs)
	}

	// An event stream, as a page opens it; on a web server that cannot hold one this part is skipped.
	stream, lines := openStream(t, ctx, sid)

	// A device comes online: the long poll returns with a patch that says so, and not the people whole.
	online := func() bool { return at(docs, "people", "items", "p1", "devices", "items", "d1", "online") == true }
	type result struct {
		seq    float64
		events []any
	}
	waited := make(chan result, 1)
	go func() {
		s, events := follow(t, sid, epoch, seq, docs, []any{"people"}, "the device to come online", online)
		waited <- result{s, events}
	}()
	time.Sleep(300 * time.Millisecond)
	changed := time.Now()
	tn.shake(time.Now().Unix())
	var r result
	select {
	case r = <-waited:
	case <-time.After(40 * time.Second):
		t.Fatal("the device never came online for the page")
	}
	var patch any
	for _, e := range r.events {
		if at(e, "op") == "patch" && at(e, "data", "items", "p1", "devices", "items", "d1", "online") == true {
			patch = e
		}
	}
	if patch == nil || at(patch, "data", "items", "p1", "name") != nil || at(patch, "data", "order") != nil {
		t.Fatalf("patch: %v", r.events)
	}
	t.Logf("a device that came online reached the page %v later, as %d bytes", time.Since(changed).Round(time.Millisecond), len(fmt.Sprint(at(patch, "data"))))

	if stream {
		// The same event came down the stream, with the same number.
		deadline := time.After(10 * time.Second)
		for found := false; !found; {
			select {
			case l := <-lines:
				var e map[string]any
				if strings.HasPrefix(l, "data: ") && json.Unmarshal([]byte(l[6:]), &e) == nil && e["seq"] == at(patch, "seq") {
					if e["topic"] != "people" || e["op"] != "patch" || e["epoch"] != epoch || !reflect.DeepEqual(e["data"], at(patch, "data")) {
						t.Fatalf("the stream's event differs: %v", e)
					}
					found = true
				}
			case <-deadline:
				t.Fatal("the event never came down the stream")
			}
		}
	}

	// The meter's points come as they are made, to a page that names it.
	if code, _ := rpc(t, sid, "dawnline", "watch", map[string]any{"topics": []any{"meter"}}); code != 0 {
		t.Fatalf("watch: %d", code)
	}
	code, got := rpc(t, sid, "dawnline", "wait", map[string]any{"epoch": epoch, "seq": r.seq, "topics": []any{"meter"}, "timeout": 10})
	events, _ := got["events"].([]any)
	appended := false
	for _, e := range events {
		appended = appended || at(e, "op") == "append"
	}
	if code != 0 || !appended {
		t.Fatalf("meter: %d %v", code, got)
	}

	// A page reads its own edit: once refresh answers, the stream holds what is on disk, with no waiting
	// for the watcher's second.
	settings("Mint")
	code, stands := rpc(t, sid, "dawnline", "refresh", map[string]any{})
	if code != 0 || stands["epoch"] != epoch {
		t.Fatalf("refresh: %d %v", code, stands)
	}
	code, got = rpc(t, sid, "dawnline", "sync", map[string]any{"epoch": epoch, "seq": r.seq, "topics": []any{"people"}})
	events, _ = got["events"].([]any)
	take(docs, events)
	if code != 0 || at(docs, "people", "items", "p1", "name") != "Mint" || got["seq"].(float64) < stands["seq"].(float64) {
		t.Fatalf("after refresh: %d %v (the stream stands at %v)", code, got, stands["seq"])
	}

	// Arguments are checked at the door.
	if code, _ := rpc(t, sid, "dawnline", "sync", map[string]any{"seq": -1}); code != int(ubus.StatusInvalidArgument) {
		t.Fatalf("a negative number was accepted: %d", code)
	}
	if code, _ := rpc(t, sid, "dawnline", "sync", map[string]any{"topics": "people"}); code != int(ubus.StatusInvalidArgument) {
		t.Fatalf("topics that are no list were accepted: %d", code)
	}
}

// openStream subscribes through uhttpd and returns the stream's lines.
func openStream(t *testing.T, ctx context.Context, sid string) (bool, <-chan string) {
	req, _ := http.NewRequestWithContext(ctx, "GET", web+"/subscribe/dawnline", nil)
	req.Header.Set("Authorization", "Bearer "+sid)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		t.Logf("no event stream from this web server (%s): %s", res.Status, ct)
		res.Body.Close()
		return false, nil
	}
	lines := make(chan string, 64)
	go func() {
		defer res.Body.Close()
		sc := bufio.NewScanner(res.Body)
		sc.Buffer(make([]byte, 0, 64<<10), 2<<20)
		for sc.Scan() {
			select {
			case lines <- sc.Text():
			default:
			}
		}
	}()
	return true, lines
}
