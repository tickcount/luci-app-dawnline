package portal

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"
)

const link = "kamiro-telosu-bavine"

type people struct{ redirect string }

func (p people) PersonByCode(c string) string {
	if c == link {
		return "anna"
	}
	return ""
}
func (p people) Redirect() string { return p.redirect }

// A portal to ask: the ucode portal is a shell script that says what it was asked and, for the state,
// prints the file the test keeps (no file: the link works no more).
func stand(t *testing.T, p people) (*httptest.Server, *Server, string) {
	dir := t.TempDir()
	script := dir + "/portal.sh"
	os.WriteFile(script, []byte(`#!/bin/sh
case "$REQUEST_URI" in
	*/api/state)
		if [ -f "`+dir+`/state.json" ]; then
			printf 'Status: 200 OK\r\nContent-Type: application/json\r\n\r\n'
			cat "`+dir+`/state.json"
		else
			printf 'Status: 404 Not Found\r\nContent-Type: text/plain\r\n\r\nNot found\n'
		fi ;;
	*/api/live)
		printf 'Status: 404 Not Found\r\nContent-Type: text/plain\r\nX-Judged: cgi\r\n\r\nNot found\n' ;;
	*)
		printf 'Status: 201 Created\r\nContent-Type: text/plain\r\nX-Frame-Options: DENY\r\n\r\n'
		printf '%s %s from %s https=%s lang=%s body=' "$REQUEST_METHOD" "$REQUEST_URI" "$REMOTE_ADDR" "$HTTPS" "$HTTP_ACCEPT_LANGUAGE"
		cat ;;
esac
`), 0o755)
	s := &Server{CGI: []string{"/bin/sh", script}, Procs: 2, People: p, Bell: &Bell{}}
	web := httptest.NewServer(s.Handler())
	t.Cleanup(web.Close)
	return web, s, dir
}

// The client the tests ask with (a test over TLS puts its server's own here).
var client = http.DefaultClient

func get(t *testing.T, url string) (*http.Response, string) {
	c := *client
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	res, err := c.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	return res, string(body)
}

func TestTheDoor(t *testing.T) {
	web, _, _ := stand(t, people{})
	for _, path := range []string{"/", "/wp-login.php", "/cgi-bin/luci", "/kamiro-telosu", "/KAMIRO-telosu-bavine"} {
		res, body := get(t, web.URL+path)
		if res.StatusCode != 404 || body != "Not found\n" || res.Header.Get("X-Frame-Options") != "DENY" ||
			res.Header.Get("Cache-Control") != "no-store" || res.Header.Get("Content-Type") != "text/plain" {
			t.Fatalf("%s: %d %q %v", path, res.StatusCode, body, res.Header)
		}
	}
	// a redirect from Settings takes what is no file; a file keeps its 404
	web, _, _ = stand(t, people{redirect: "https://example.org/"})
	if res, body := get(t, web.URL+"/"); res.StatusCode != 302 || res.Header.Get("Location") != "https://example.org/" || body != "Moved\n" {
		t.Fatalf("the redirect: %d %q", res.StatusCode, body)
	}
	for _, path := range []string{"/favicon.ico", "/luci-static/x", "/ubus"} {
		if res, _ := get(t, web.URL+path); res.StatusCode != 404 {
			t.Fatalf("%s followed the redirect: %d", path, res.StatusCode)
		}
	}
}

func TestALinkGoesToThePortal(t *testing.T) {
	web, _, _ := stand(t, people{})
	req, _ := http.NewRequest("POST", web.URL+"/"+link+"/api/devices?x=1", strings.NewReader(`{"name":"Phone"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept-Language", "ru")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	want := "POST /" + link + `/api/devices?x=1 from 127.0.0.1 https= lang=ru body={"name":"Phone"}`
	if res.StatusCode != 201 || string(body) != want {
		t.Fatalf("%d %q", res.StatusCode, body)
	}
	// a code that is nobody's is the portal's to judge, on the stream's path too
	if res, _ := get(t, web.URL+"/bavine-telosu-kamiro/api/live"); res.StatusCode != 404 || res.Header.Get("X-Judged") != "cgi" {
		t.Fatalf("a wrong code on the stream: %d %v", res.StatusCode, res.Header)
	}
}

// events reads a stream's events as they come.
func events(t *testing.T, ctx context.Context, url string) <-chan [2]string {
	req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != 200 || res.Header.Get("Content-Type") != "text/event-stream" || res.Header.Get("Cache-Control") != "no-store" {
		t.Fatalf("the stream: %d %v", res.StatusCode, res.Header)
	}
	out := make(chan [2]string, 8)
	go func() {
		defer res.Body.Close()
		defer close(out)
		name := ""
		sc := bufio.NewScanner(res.Body)
		for sc.Scan() {
			l := sc.Text()
			if strings.HasPrefix(l, "event: ") {
				name = l[7:]
			} else if strings.HasPrefix(l, "data: ") {
				out <- [2]string{name, l[6:]}
			}
		}
	}()
	return out
}

func next(t *testing.T, ch <-chan [2]string) (string, map[string]any) {
	select {
	case e, ok := <-ch:
		if !ok {
			t.Fatal("the stream ended")
		}
		var doc map[string]any
		json.Unmarshal([]byte(e[1]), &doc)
		return e[0], doc
	case <-time.After(5 * time.Second):
		t.Fatal("nothing came down the stream")
	}
	return "", nil
}

func TestTheStream(t *testing.T) {
	web, s, dir := stand(t, people{})
	write := func(doc string) { os.WriteFile(dir+"/state.json", []byte(doc), 0o644) }
	write(`{"person":{"name":"Anna","online":0,"devices":[{"id":"d1","online":false}]},"here":null,"now":1}`)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ch := events(t, ctx, web.URL+"/"+link+"/api/live")
	if name, doc := next(t, ch); name != "put" || doc["person"].(map[string]any)["name"] != "Anna" {
		t.Fatalf("the first event: %s %v", name, doc)
	}
	// her phone connects: only what changed comes
	write(`{"person":{"name":"Anna","online":1,"devices":[{"id":"d1","online":true}]},"here":"d1","now":2}`)
	s.Bell.Ring("anna", Changed)
	name, doc := next(t, ch)
	want := map[string]any{"person": map[string]any{"online": 1.0, "devices": []any{map[string]any{"id": "d1", "online": true}}}, "here": "d1", "now": 2.0}
	if name != "patch" || !reflect.DeepEqual(doc, want) {
		t.Fatalf("after a change: %s %v", name, doc)
	}
	// someone else's change is not hers; the counters alone are asked for at their own pace
	s.Bell.Ring("boris", Changed)
	s.Bell.Ring("", Counters)
	select {
	case e := <-ch:
		t.Fatalf("an event nobody caused: %v", e)
	case <-time.After(Settle + 300*time.Millisecond):
	}
	// the link is taken away: the page is told, and the stream ends
	os.Remove(dir + "/state.json")
	s.Bell.Ring("", Changed)
	if name, _ := next(t, ch); name != "gone" {
		t.Fatalf("after the link went: %s", name)
	}
	if _, open := <-ch; open {
		t.Fatal("the stream stays open after gone")
	}
	if s.total != 0 || len(s.open) != 0 {
		t.Fatalf("streams still counted: %d %v", s.total, s.open)
	}
}

func TestWatchRingsForWhoChanged(t *testing.T) {
	dir := t.TempDir()
	run, data := dir+"/run", dir+"/data"
	os.MkdirAll(run, 0o755)
	os.MkdirAll(data, 0o755)
	os.WriteFile(run+"/presence.json", []byte(`{"rev":4,"people":{"anna":4,"boris":2}}`), 0o600)
	b := &Bell{}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go Watch(ctx, b, run, data, dir+"/config")
	anna, boris := b.Listen("anna"), b.Listen("boris")
	heard := func(s *Sub) (What, bool) {
		select {
		case w := <-s.C:
			return w, true
		case <-time.After(2500 * time.Millisecond):
			return 0, false
		}
	}
	// the first look after someone began to listen is no news
	time.Sleep(1200 * time.Millisecond)
	os.WriteFile(run+"/presence.json", []byte(`{"rev":5,"people":{"anna":5,"boris":2}}`), 0o600)
	if w, ok := heard(anna); !ok || w != Changed {
		t.Fatal("anna's change was not rung")
	}
	select {
	case <-boris.C:
		t.Fatal("boris heard anna's change")
	default:
	}
	os.WriteFile(run+"/usage.json", []byte(`{}`), 0o600)
	if w, ok := heard(boris); !ok || w != Counters {
		t.Fatal("the counters were not rung for everyone")
	}
	os.WriteFile(dir+"/config", []byte("config settings 'settings'\n"), 0o600)
	if w, ok := heard(boris); !ok || w != Changed {
		t.Fatal("a change of the settings was not rung for everyone")
	}
}
