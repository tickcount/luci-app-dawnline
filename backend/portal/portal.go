// Package portal is the personal portal's web server: what a person's link opens. It takes the place of
// the second uhttpd the portal ran under, and adds what that could not give: a stream of the person's own
// page (GET /<code>/api/live), so the page follows the router instead of being asked for again.
//
// Until its API is ported (docs/backend.md, stage 5) the answers are still the ucode portal's: a request
// shaped like a personal link is handed to it as CGI, exactly as uhttpd did. What is new here:
//
//	the door     a path that is no personal link gets the portal's bare answer (a 404, or the redirect from
//	             Settings) from this process: a scanner or a flood on the root starts nothing
//	the stream   the person's state as one document: first whole (`put`), then only what changed (`patch`,
//	             a JSON Merge Patch), the moment something of theirs changes on the router; `gone` when the
//	             link stops working. The state is the ucode portal's own answer to /api/state, asked for
//	             the stream's own visitor (the device the page is open on is theirs), and only on a change
//	the listener TLS with the portal's certificate, read again when its file changes (a renewal needs no
//	             restart); plain HTTP beside it only where the init script says an address needs it
//
// A code is never logged. A wrong code on the stream is the CGI's to judge and to count, like any other
// path under it.
package portal

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/cgi"
	"os"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/hub"
)

const (
	// Queue is how many requests may wait for a CGI process before the next one is refused.
	Queue = 64
	// Streams is how many pages may follow at once, and how many of one person's.
	Streams       = 64
	PersonStreams = 8
	// PingEvery keeps a stream from being taken for dead by what stands between (a proxy, a phone).
	PingEvery = 15 * time.Second
	// Settle is how long a stream waits after a change before it asks: an event moves the revision twice.
	Settle = 300 * time.Millisecond
	// CountersEvery is how often a stream asks again when only the traffic counters moved.
	CountersEvery = 55 * time.Second
)

// A personal link's first part: three words of six letters (dawnline.core WORD_CODE).
var code = regexp.MustCompile(`^[a-z]{6}-[a-z]{6}-[a-z]{6}$`)

// What every answer of the portal carries (dawnline.portal SECURITY_HEADERS).
var security = [][2]string{
	{"X-Content-Type-Options", "nosniff"},
	{"Referrer-Policy", "no-referrer"},
	{"X-Frame-Options", "DENY"},
	{"Cache-Control", "no-store"},
}

// People tells what the server needs of the settings, as they are now.
type People interface {
	// PersonByCode is the id of the person a code is the link of, or "".
	PersonByCode(code string) string
	// Redirect is where a path that is no link is sent ("": nowhere, it gets the 404).
	Redirect() string
}

// Server is the portal's web server.
type Server struct {
	// TLS and Plain are the addresses to listen on (":4500"); Cert and Key the certificate's files.
	TLS, Plain []string
	Cert, Key  string
	// CGI is the command that answers a personal link (ucode with the portal's script); Procs how many
	// of it run at once (each loads the whole model).
	CGI   []string
	Procs int
	// Native answers a personal link itself (the portal's API in Go); nil: the CGI does.
	Native http.Handler
	// People reads the settings; Bell rings when something changed for a person.
	People People
	Bell   *Bell
	Log    func(format string, args ...any)

	sem     chan struct{}
	waiting chan struct{}
	mu      sync.Mutex
	open    map[string]int
	total   int
}

// Handler is the server's answer to a request, ready to be served (Run does; a test stands it up itself).
func (s *Server) Handler() http.Handler {
	if s.Procs < 1 {
		s.Procs = 2
	}
	if s.Log == nil {
		s.Log = func(string, ...any) {}
	}
	s.sem = make(chan struct{}, s.Procs)
	s.waiting = make(chan struct{}, Queue)
	s.open = map[string]int{}
	return http.HandlerFunc(s.serve)
}

// Run serves until ctx ends. A port still held (the portal's old web server on its way out) is tried
// again for half a minute.
func (s *Server) Run(ctx context.Context) {
	h := &http.Server{
		Handler:           s.Handler(),
		ReadHeaderTimeout: 20 * time.Second,
		IdleTimeout:       30 * time.Second,
		MaxHeaderBytes:    16 << 10,
		BaseContext:       func(net.Listener) context.Context { return ctx },
		ErrorLog:          nil,
	}
	cert := &keeper{cert: s.Cert, key: s.Key}
	h.TLSConfig = &tls.Config{MinVersion: tls.VersionTLS12, GetCertificate: cert.get}
	var wg sync.WaitGroup
	listen := func(addr string, secure bool) {
		defer wg.Done()
		var l net.Listener
		var err error
		for try := 0; ; try++ {
			if l, err = net.Listen("tcp", addr); err == nil {
				break
			}
			if try == 30 || ctx.Err() != nil {
				s.Log("portal: %s is not ours to listen on: %v", addr, err)
				return
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(time.Second):
			}
		}
		if secure {
			err = h.ServeTLS(l, "", "")
		} else {
			err = h.Serve(l)
		}
		if err != nil && err != http.ErrServerClosed {
			s.Log("portal: %s stopped: %v", addr, err)
		}
	}
	for _, a := range s.TLS {
		wg.Add(1)
		go listen(a, true)
	}
	for _, a := range s.Plain {
		wg.Add(1)
		go listen(a, false)
	}
	<-ctx.Done()
	// streams end with ctx (BaseContext); what is being answered gets a moment
	end, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	h.Shutdown(end)
	cancel()
	wg.Wait()
}

// keeper holds the certificate and reads it again when its files changed.
type keeper struct {
	cert, key string
	mu        sync.Mutex
	sig       string
	have      *tls.Certificate
}

func (k *keeper) get(*tls.ClientHelloInfo) (*tls.Certificate, error) {
	sig := ""
	for _, p := range []string{k.cert, k.key} {
		if st, err := os.Stat(p); err == nil {
			sig += fmt.Sprintf("%d/%d;", st.ModTime().UnixNano(), st.Size())
		}
	}
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.have != nil && sig == k.sig {
		return k.have, nil
	}
	c, err := tls.LoadX509KeyPair(k.cert, k.key)
	if err != nil {
		// a renewal half written: the one we have serves until the new one reads
		if k.have != nil {
			return k.have, nil
		}
		return nil, err
	}
	k.have, k.sig = &c, sig
	return k.have, nil
}

func (s *Server) serve(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	first, rest, _ := strings.Cut(strings.TrimPrefix(path, "/"), "/")
	if !strings.HasPrefix(path, "/") || !code.MatchString(first) {
		s.bare(w, r)
		return
	}
	if rest == "api/live" && r.Method == http.MethodGet {
		if person := s.People.PersonByCode(first); person != "" {
			s.live(w, r, first, person)
			return
		}
		// a code that is nobody's: the portal's own answer, and its count of wrong guesses
	}
	s.cgi(w, r)
}

// bare is the answer for anything that is no personal link: the 404, or the redirect from Settings.
// Byte for byte the ucode portal's not_found() (and the shell door's that stood before it); files always
// get the 404, so a missing asset never turns into someone's website.
func (s *Server) bare(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	file := strings.Contains(path[strings.LastIndex(path, "/")+1:], ".")
	for _, p := range []string{"/luci-static", "/cgi-bin", "/ubus"} {
		file = file || path == p || strings.HasPrefix(path, p+"/")
	}
	head := w.Header()
	for _, kv := range security {
		head.Set(kv[0], kv[1])
	}
	head.Set("Content-Type", "text/plain")
	if hsts(r) {
		head.Set("Strict-Transport-Security", "max-age=31536000")
	}
	if to := s.People.Redirect(); to != "" && !file {
		head.Set("Location", to)
		w.WriteHeader(http.StatusFound)
		w.Write([]byte("Moved\n"))
		return
	}
	w.WriteHeader(http.StatusNotFound)
	w.Write([]byte("Not found\n"))
}

// hsts: the visitor is on HTTPS at the standard port (HSTS pins the whole name).
func hsts(r *http.Request) bool {
	if r.TLS == nil {
		return false
	}
	_, port, err := net.SplitHostPort(r.Host)
	return err != nil || port == "443"
}

// cgi answers a request under a personal link: this backend's own answer where it has one, else the ucode
// portal's, a few at a time.
func (s *Server) cgi(w http.ResponseWriter, r *http.Request) {
	if s.Native != nil {
		s.Native.ServeHTTP(w, r)
		return
	}
	select {
	case s.waiting <- struct{}{}:
		defer func() { <-s.waiting }()
	default:
		http.Error(w, "Busy\n", http.StatusServiceUnavailable)
		return
	}
	select {
	case s.sem <- struct{}{}:
		defer func() { <-s.sem }()
	case <-r.Context().Done():
		return
	}
	h := cgi.Handler{
		Path: s.CGI[0], Args: s.CGI[1:], Dir: "/",
		// DAWNLINE_LIVE: the page it serves is told that a stream waits for it at /api/live
		Env: []string{"PATH=/usr/sbin:/usr/bin:/sbin:/bin", "DAWNLINE_LIVE=1"},
	}
	h.ServeHTTP(w, r)
}

// recorder takes a CGI answer in memory (the state a stream asks for).
type recorder struct {
	head   http.Header
	status int
	body   bytes.Buffer
}

func (c *recorder) Header() http.Header { return c.head }
func (c *recorder) WriteHeader(n int) {
	if c.status == 0 {
		c.status = n
	}
}
func (c *recorder) Write(b []byte) (int, error) {
	c.WriteHeader(http.StatusOK)
	return c.body.Write(b)
}

// state asks the ucode portal for the page's state as this visitor would: their address tells which of
// the person's devices the page is open on. ok is false when the link works no more.
func (s *Server) state(r *http.Request, link string) (doc any, ok bool, err error) {
	ask := r.Clone(r.Context())
	ask.Method, ask.Body, ask.ContentLength = http.MethodGet, http.NoBody, 0
	u := *r.URL
	u.Path, u.RawPath, u.RawQuery = "/"+link+"/api/state", "", ""
	ask.URL = &u
	ask.RequestURI = u.Path
	ask.Header = r.Header.Clone()
	// the answer is read here, as it is
	ask.Header.Del("Accept-Encoding")
	rec := &recorder{head: http.Header{}}
	s.cgi(rec, ask)
	switch {
	case rec.status == http.StatusNotFound || rec.status == http.StatusUnauthorized:
		return nil, false, nil
	case rec.status != http.StatusOK:
		return nil, true, fmt.Errorf("the portal answered %d", rec.status)
	}
	if err := json.Unmarshal(rec.body.Bytes(), &doc); err != nil {
		return nil, true, err
	}
	return doc, true, nil
}

// live is a page's stream.
func (s *Server) live(w http.ResponseWriter, r *http.Request, link, person string) {
	flusher, can := w.(http.Flusher)
	if !can || !s.enter(person) {
		http.Error(w, "Busy\n", http.StatusServiceUnavailable)
		return
	}
	defer s.leave(person)
	sub := s.Bell.Listen(person)
	defer s.Bell.Forget(sub)

	doc, ok, err := s.state(r, link)
	if !ok {
		// the link stopped working between the door and here: the portal's own answer
		s.cgi(w, r)
		return
	}
	if err != nil {
		http.Error(w, "Error\n", http.StatusBadGateway)
		return
	}
	head := w.Header()
	for _, kv := range security {
		head.Set(kv[0], kv[1])
	}
	head.Set("Content-Type", "text/event-stream")
	// nothing between may hold the events back
	head.Set("X-Accel-Buffering", "no")
	if hsts(r) {
		head.Set("Strict-Transport-Security", "max-age=31536000")
	}
	w.WriteHeader(http.StatusOK)
	send := func(event string, data any) bool {
		raw, err := json.Marshal(data)
		if err != nil {
			return false
		}
		if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, raw); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}
	if !send("put", doc) {
		return
	}
	ping := time.NewTicker(PingEvery)
	defer ping.Stop()
	asked := time.Now()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ping.C:
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()
			continue
		case what := <-sub.C:
			// the counters alone move every minute for everyone: asked for at their own pace
			if what == Counters && time.Since(asked) < CountersEvery {
				continue
			}
		}
		// an event moves the revision more than once: asked once it has settled
		select {
		case <-r.Context().Done():
			return
		case <-time.After(Settle):
		}
		sub.drain()
		next, ok, err := s.state(r, link)
		asked = time.Now()
		if !ok {
			send("gone", struct{}{})
			return
		}
		if err != nil {
			// asked again at the next change; what the page shows stays
			continue
		}
		if patch, changed := hub.Diff(doc, next); changed {
			if !send("patch", patch) {
				return
			}
		}
		doc = next
	}
}

func (s *Server) enter(person string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.total >= Streams || s.open[person] >= PersonStreams {
		return false
	}
	s.total++
	s.open[person]++
	return true
}

func (s *Server) leave(person string) {
	s.mu.Lock()
	s.total--
	if s.open[person]--; s.open[person] <= 0 {
		delete(s.open, person)
	}
	s.mu.Unlock()
}
