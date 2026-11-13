// Package github is GitHub for the Components tab, as dawnline.github: releases (with each file's sha256),
// one release by tag, and the changes between two tags, each kept ten minutes in the run directory under
// the name the ucode backend keeps its own (gh-<key>.json: whichever asked first, the other reads it, and
// the two share GitHub's hourly allowance).
//
// Trust: the API is only ever asked directly (TLS to api.github.com).
package github

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"

	"crypto/sha256"
	"encoding/hex"
	"github.com/tickcount/luci-app-dawnline/backend/files"
	"os"
)

// Failure is why GitHub could not be asked, as a sentence to translate (Msg) and what goes into it (Args).
type Failure struct {
	Msg  string
	Args []any
}

func (f Failure) Error() string { return fmt.Sprintf(f.Msg, f.Args...) }

// Client asks GitHub. Get fetches a URL (status 0: no answer); nil is the real one.
type Client struct {
	RunDir string
	Get    func(url string) (status int, body []byte)
	Now    func() time.Time
}

func get(url string) (int, []byte) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return 0, nil
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "Dawnline")
	res, err := (&http.Client{Timeout: 12 * time.Second}).Do(req)
	if err != nil {
		return 0, nil
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if err != nil {
		return 0, nil
	}
	return res.StatusCode, body
}

func (c *Client) now() int64 {
	if c.Now != nil {
		return c.Now().Unix()
	}
	return time.Now().Unix()
}

var rateLimit = regexp.MustCompile(`(?i)rate limit`)

// api is JSON from the API, or nil when GitHub did not answer or has no such thing; a Failure on a rate
// limit or another API error.
func (c *Client) api(url string) (any, error) {
	fetch := c.Get
	if fetch == nil {
		fetch = get
	}
	status, body := fetch(url)
	if status == 0 {
		return nil, nil
	}
	var j any
	if json.Unmarshal(body, &j) != nil {
		return nil, nil
	}
	msg := ""
	if m, ok := j.(map[string]any); ok {
		msg, _ = m["message"].(string)
	}
	if status == 403 || status == 429 || rateLimit.MatchString(msg) {
		return nil, Failure{Msg: "GitHub API rate limit reached: try again in an hour."}
	}
	if status == 404 {
		return nil, nil
	}
	if status >= 400 {
		if msg == "" {
			msg = fmt.Sprintf("HTTP %d", status)
		}
		return nil, Failure{Msg: "GitHub: %s", Args: []any{msg}}
	}
	return j, nil
}

var unsafe = regexp.MustCompile(`[^A-Za-z0-9_.-]`)

// cached answers from the file while it is fresh, else asks; what could not be asked anew is the old answer.
func (c *Client) cached(key string, ttl int64, fn func() (any, error)) (any, error) {
	path := c.RunDir + "/gh-" + unsafe.ReplaceAllString(key, "_") + ".json"
	var kept struct {
		At   float64 `json:"at"`
		Data any     `json:"data"`
	}
	has := files.ReadJSON(path, &kept)
	if has && float64(c.now())-kept.At < float64(ttl) {
		return kept.Data, nil
	}
	data, err := fn()
	if err != nil {
		return nil, err
	}
	if data != nil {
		files.WriteJSON(path, map[string]any{"at": c.now(), "data": data}, 0o644)
		return data, nil
	}
	return kept.Data, nil
}

var digest = regexp.MustCompile(`^sha256:[0-9a-f]{64}$`)

// slim is what is kept of a release.
func slim(x map[string]any) map[string]any {
	digests, ids := map[string]any{}, map[string]any{}
	names := []any{}
	list, _ := x["assets"].([]any)
	for _, a := range list {
		m, _ := a.(map[string]any)
		name, _ := m["name"].(string)
		names = append(names, m["name"])
		if d, _ := m["digest"].(string); digest.MatchString(d) {
			digests[name] = d[7:]
		}
		if id, ok := m["id"].(float64); ok && id > 0 && id == float64(int64(id)) {
			ids[name] = id
		}
	}
	or := func(v, dflt any) any {
		if v == nil {
			return dflt
		}
		return v
	}
	body, _ := x["body"].(string)
	if len(body) > 12000 {
		body = body[:12000]
	}
	pre, _ := x["prerelease"].(bool)
	return map[string]any{
		"tag": x["tag_name"], "name": or(x["name"], x["tag_name"]), "published": x["published_at"], "prerelease": pre, "url": x["html_url"],
		"body": body, "assets": names, "digests": digests, "ids": ids,
	}
}

// Releases is a repository's releases, newest first, five a page (drafts skipped).
func (c *Client) Releases(repo string, page int) ([]any, error) {
	data, err := c.cached(fmt.Sprintf("rel-%s-%d", repo, page), 600, func() (any, error) {
		j, err := c.api(fmt.Sprintf("https://api.github.com/repos/%s/releases?per_page=5&page=%d", repo, page))
		list, ok := j.([]any)
		if err != nil || !ok {
			return nil, err
		}
		out := []any{}
		for _, x := range list {
			if m, ok := x.(map[string]any); ok && m["draft"] != true {
				out = append(out, slim(m))
			}
		}
		return out, nil
	})
	list, _ := data.([]any)
	if list == nil {
		list = []any{}
	}
	return list, err
}

// Release is one release by tag (its notes, its files and their sha256), or nil.
func (c *Client) Release(repo, tag string) (map[string]any, error) {
	data, err := c.cached("tag-"+repo+"-"+tag, 600, func() (any, error) {
		j, err := c.api("https://api.github.com/repos/" + repo + "/releases/tags/" + tag)
		if m, ok := j.(map[string]any); ok && m["tag_name"] != nil && m["tag_name"] != "" {
			return slim(m), err
		}
		return nil, err
	})
	m, _ := data.(map[string]any)
	return m, err
}

var (
	point   = regexp.MustCompile(`^\s*[-*]\s+(.*)$`)
	wrapped = regexp.MustCompile(`^\s+\S`)
	version = regexp.MustCompile(`^(Dawnline )?v?[0-9]+\.[0-9]+(\.[0-9]+)?$`)
)

const space = " \t\r\n\v\f"

// Points is what changed in a commit message: a release commit lists its changes as "- " lines in the
// body, any other commit is its title. Wrapped points are joined back into one line.
func Points(msg string) []string {
	lines := strings.Split(msg, "\n")
	title := strings.Trim(lines[0], space)
	out := []string{}
	if strings.HasPrefix(title, "Merge ") {
		return out
	}
	cur, open := "", false
	for _, line := range lines[1:] {
		if m := point.FindStringSubmatch(line); m != nil {
			if open {
				out = append(out, cur)
			}
			cur, open = strings.Trim(m[1], space), true
		} else if open && wrapped.MatchString(line) {
			cur += " " + strings.Trim(line, space)
		} else if open {
			out = append(out, cur)
			open = false
		}
	}
	if open {
		out = append(out, cur)
	}
	if len(out) == 0 && title != "" && !version.MatchString(title) {
		out = append(out, title)
	}
	return out
}

func message(commit any) string {
	m, _ := commit.(map[string]any)
	c, _ := m["commit"].(map[string]any)
	s, _ := c["message"].(string)
	return s
}

// Changes is what changed from one tag to another, newest first, twenty points at most: commit by commit,
// or the release's own commit when there is no base to compare with.
func (c *Client) Changes(repo, base, head string) ([]any, error) {
	key := base
	if base == "" {
		key = "null"
	}
	data, err := c.cached("changes-"+repo+"-"+key+"-"+head, 600, func() (any, error) {
		cut := func(points []any) any {
			if len(points) > 20 {
				points = points[:20]
			}
			return points
		}
		if base != "" {
			j, err := c.api("https://api.github.com/repos/" + repo + "/compare/" + base + "..." + head)
			if err != nil {
				return nil, err
			}
			m, _ := j.(map[string]any)
			if commits, ok := m["commits"].([]any); ok {
				out := []any{}
				for i := len(commits) - 1; i >= 0; i-- {
					for _, p := range Points(message(commits[i])) {
						out = append(out, p)
					}
				}
				return cut(out), nil
			}
		}
		j, err := c.api("https://api.github.com/repos/" + repo + "/commits/" + head)
		if err != nil {
			return nil, err
		}
		if m, _ := j.(map[string]any); m["commit"] != nil {
			out := []any{}
			for _, p := range Points(message(j)) {
				out = append(out, p)
			}
			return cut(out), nil
		}
		return nil, nil
	})
	list, _ := data.([]any)
	if list == nil {
		list = []any{}
	}
	return list, err
}

// Mirrors are prefixes that fetch github.com files when GitHub itself is unreachable. A file may come
// through one only when its sha256 is known from the API, and is kept only if it matches.
var Mirrors = []string{"https://ghfast.top/", "https://gh-proxy.com/", "https://ghproxy.net/"}

// Latest is a repository's latest stable release, or nil when GitHub does not answer.
func (c *Client) Latest(repo string) map[string]any {
	data, _ := c.cached("latest-"+repo, 300, func() (any, error) {
		j, err := c.api("https://api.github.com/repos/" + repo + "/releases/latest")
		if m, ok := j.(map[string]any); ok && m["tag_name"] != nil && m["tag_name"] != "" {
			return slim(m), err
		}
		return nil, err
	})
	m, _ := data.(map[string]any)
	return m
}

// AssetSHA256 is the sha256 GitHub publishes for a release's file, or "".
func (c *Client) AssetSHA256(repo, tag, name string) string {
	r, _ := c.Release(repo, tag)
	digests, _ := r["digests"].(map[string]any)
	s, _ := digests[name].(string)
	return s
}

// Assets is the names of a release's files (nil: no such release, or GitHub does not answer).
func (c *Client) Assets(repo, tag string) []string {
	r, _ := c.Release(repo, tag)
	if r == nil {
		return nil
	}
	list, _ := r["assets"].([]any)
	out := []string{}
	for _, a := range list {
		if s, is := a.(string); is {
			out = append(out, s)
		}
	}
	return out
}

// Fetch downloads a URL into a file; false when it did not come whole.
type Fetch func(url, dest string) bool

// HTTPFetch is Fetch over the network: five minutes at most, redirects followed.
func HTTPFetch(url, dest string) bool {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return false
	}
	req.Header.Set("User-Agent", "Dawnline")
	res, err := (&http.Client{Timeout: 300 * time.Second}).Do(req)
	if err != nil {
		return false
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return false
	}
	f, err := os.OpenFile(dest, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return false
	}
	n, err := io.Copy(f, res.Body)
	if cerr := f.Close(); err != nil || cerr != nil || n == 0 {
		os.Remove(dest)
		return false
	}
	return true
}

// SHA256 is a file's sha256 in hex, or "".
func SHA256(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return ""
	}
	return hex.EncodeToString(h.Sum(nil))
}

var fromGitHub = regexp.MustCompile(`^https://(github\.com|raw\.githubusercontent\.com)/`)

// Download gets a file: GitHub itself first; a mirror only when the sha256 is known (from the API) and
// mirrors are allowed. A file that does not match the sha256 is thrown away and the next source is tried.
// It returns the URL that worked, or "". log is told of mirrors (words in t's language; nil: English).
func Download(fetch Fetch, url, dest, want string, mirrors bool, log func(string), t func(string) string) string {
	if t == nil {
		t = func(s string) string { return s }
	}
	say := func(format string, args ...any) {
		if log != nil {
			log(fmt.Sprintf(t(format), args...))
		}
	}
	want = strings.ToLower(want)
	type try struct {
		url    string
		mirror bool
	}
	tries := []try{{url, false}}
	if want != "" && mirrors && fromGitHub.MatchString(url) {
		for _, m := range Mirrors {
			tries = append(tries, try{m + url, true})
		}
	}
	for i, x := range tries {
		host := strings.SplitN(strings.TrimPrefix(x.url, "https://"), "/", 2)[0]
		if x.mirror {
			say("Trying mirror %s", host)
		}
		if fetch(x.url, dest) {
			if st, err := os.Stat(dest); err == nil && st.Size() > 0 {
				if want == "" || SHA256(dest) == want {
					return x.url
				}
				say("Warning: %s sent a file that does not match GitHub's sha256, discarded", host)
			}
		}
		os.Remove(dest)
		if i == 0 && len(tries) > 1 {
			say("GitHub did not answer, trying mirrors")
		}
	}
	return ""
}
