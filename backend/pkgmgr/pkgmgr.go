// Package pkgmgr is one interface over the router's package manager: opkg on OpenWrt 24.10, apk on 25.12
// (dawnline.pkg). Commands that change packages take a log(line) callback, which gets what they say.
package pkgmgr

import (
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
)

// Manager is the router's package manager.
type Manager struct {
	// Run runs a shell command: what it said (both streams) and its exit code.
	Run func(cmd string) (out string, code int)
	// Apk tells whether this router has apk (else opkg).
	Apk bool
	// T puts a sentence in the job's language (nil: as it is).
	T func(msg string) string
}

// Failure is a refusal with its words (already in the job's language).
type Failure struct{ Msg string }

func (f Failure) Error() string { return f.Msg }

// System is the router's own, by what is installed.
func System(run func(cmd string) (string, int)) *Manager {
	st, err := os.Stat("/usr/bin/apk")
	return &Manager{Run: run, Apk: err == nil && st.Mode()&0o111 != 0}
}

func (m *Manager) t(msg string) string {
	if m.T != nil {
		return m.T(msg)
	}
	return msg
}

// Q quotes a word for the shell.
func Q(s string) string { return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'" }

func qAll(list []string) string {
	q := make([]string, len(list))
	for i, s := range list {
		q[i] = Q(s)
	}
	return strings.Join(q, " ")
}

const blank = " \t\r\n\v\f"

func (m *Manager) logged(cmd string, log func(string)) (string, int) {
	out, code := m.Run(cmd)
	if log != nil {
		for _, line := range strings.Split(strings.Trim(out, blank), "\n") {
			if strings.Trim(line, blank) != "" {
				log("  " + line)
			}
		}
	}
	return out, code
}

// Ext is the package files' extension here.
func (m *Manager) Ext() string {
	if m.Apk {
		return "apk"
	}
	return "ipk"
}

// Version is the installed version of a package, or "".
func (m *Manager) Version(name string) string {
	esc := regexp.QuoteMeta(name)
	if m.Apk {
		out, _ := m.Run("apk list --installed " + Q(name))
		if f := regexp.MustCompile(`^` + esc + `-([^ ]+) `).FindStringSubmatch(out); f != nil {
			return f[1]
		}
		// a name another package provides (OpenWrt 25.12: «acme» is acme-acmesh's): that package's version
		out, _ = m.Run("apk list --installed --providers " + Q(name))
		if f := regexp.MustCompile(`(?m)^<` + esc + `> \S+?-(\d[^ ]*) `).FindStringSubmatch(out); f != nil {
			return f[1]
		}
		return ""
	}
	// libraries carry their ABI in the name (libustream-openssl20201210)
	re := regexp.MustCompile(`^` + esc + `([0-9]+)? - (.+)$`)
	out, _ := m.Run("opkg list-installed")
	found, exact := "", false
	for _, line := range strings.Split(out, "\n") {
		if f := re.FindStringSubmatch(strings.Trim(line, blank)); f != nil && (found == "" || (f[1] == "" && !exact)) {
			found, exact = strings.Trim(f[2], blank), f[1] == ""
		}
	}
	return found
}

var (
	ipkName    = regexp.MustCompile(`(^|\n)Package: *([^\n]+)`)
	ipkVersion = regexp.MustCompile(`(^|\n)Version: *([^\n]+)`)
	apkName    = regexp.MustCompile(`\n *name: *([^\n]+)`)
	apkVersion = regexp.MustCompile(`\n *version: *([^\n]+)`)
)

// ControlInfo is the package a control text names (name, version; each "" when it does not say). Pure: an
// ipk's control file, else `apk adbdump` of an apk, whose first name and version are the package's own.
func ControlInfo(text string, ipk bool) (name, version string) {
	pick := func(re *regexp.Regexp, i int) string {
		if f := re.FindStringSubmatch(text); f != nil {
			return f[i]
		}
		return ""
	}
	if ipk {
		return pick(ipkName, 2), pick(ipkVersion, 2)
	}
	return pick(apkName, 1), pick(apkVersion, 1)
}

// FileInfo is the package inside a file.
func (m *Manager) FileInfo(path string) (name, version string) {
	if strings.HasSuffix(path, ".ipk") {
		out, _ := m.Run("tar -xzOf " + Q(path) + " ./control.tar.gz | tar -xzO ./control")
		return ControlInfo(out, true)
	}
	out, _ := m.Run("apk adbdump " + Q(path))
	return ControlInfo(out, false)
}

// FileVersion is the version inside a package file, or "".
func (m *Manager) FileVersion(path string) string {
	_, v := m.FileInfo(path)
	return v
}

// Cmp compares two package versions the way the package manager does (so -r10 is newer than -r9 and ~rc
// before the release): -1, 0 or 1; ok is false when one is unknown.
func (m *Manager) Cmp(a, b string) (int, bool) {
	if a == "" || b == "" {
		return 0, false
	}
	if a == b {
		return 0, true
	}
	if m.Apk {
		out, _ := m.Run("apk version -t " + Q(a) + " " + Q(b))
		switch strings.Trim(out, blank) {
		case "<":
			return -1, true
		case ">":
			return 1, true
		case "=":
			return 0, true
		}
		return 0, false
	}
	if _, code := m.Run("opkg compare-versions " + Q(a) + " '<<' " + Q(b)); code == 0 {
		return -1, true
	}
	if _, code := m.Run("opkg compare-versions " + Q(a) + " '>>' " + Q(b)); code == 0 {
		return 1, true
	}
	return 0, true
}

// Refresh updates the package lists.
func (m *Manager) Refresh(log func(string)) bool {
	cmd := "opkg update"
	if m.Apk {
		cmd = "apk update"
	}
	_, code := m.logged(cmd, log)
	return code == 0
}

var dfFree = regexp.MustCompile(`\n\S+\s+[0-9]+\s+[0-9]+\s+([0-9]+)\s`)

// preflight: room for the files (or needKB from the feeds). The package manager unpacks before it removes,
// so a full flash leaves half an install behind. It fails with the numbers.
func (m *Manager) preflight(paths []string, needKB int64, log func(string)) error {
	out, _ := m.Run("df -Pk /overlay 2>/dev/null || df -Pk / 2>/dev/null")
	f := dfFree.FindStringSubmatch(out)
	if f == nil {
		return nil
	}
	free, _ := strconv.ParseInt(f[1], 10, 64)
	need := needKB
	if need == 0 {
		need = 512
	}
	for _, p := range paths {
		if st, err := os.Stat(p); err == nil {
			need += st.Size() * 3 / 1024
		}
	}
	if free < need {
		return Failure{fmt.Sprintf(m.t("Not enough free space on the router: %d MB free, about %d MB needed. Remove old backups or packages first"), free/1024, need/1024+1)}
	}
	if log != nil {
		log("  " + fmt.Sprintf(m.t("%d MB free on the overlay"), free/1024))
	}
	return nil
}

// Dawnline's own package: a file of it tells whether apk really reinstalled it.
const (
	self       = "luci-app-dawnline"
	selfMarker = "/usr/share/dawnline/version"
)

// Wanted is a package file and what it holds.
type Wanted struct {
	Name, Version, File string
}

// Mismatched is the packages an apk install did not leave at their file's version: apk takes a given file
// as it is (an older version too, a rollback) but leaves an installed version alone, whatever the file.
// Pure: have is the installed version of each name.
func Mismatched(want []Wanted, have map[string]string) []Wanted {
	var bad []Wanted
	for _, w := range want {
		if w.Name == "" || w.Version == "" || have[w.Name] != w.Version {
			bad = append(bad, w)
		}
	}
	return bad
}

// InstallFiles installs package files (from a release): true when every one is in. force also reinstalls
// the same version or goes back to an older one (opkg; apk takes a file as it is: Dawnline's own package
// is checked by a file of it, any other by its installed version).
func (m *Manager) InstallFiles(paths []string, force bool, log func(string)) (bool, error) {
	if err := m.preflight(paths, 0, log); err != nil {
		return false, err
	}
	args := qAll(paths)
	if !m.Apk {
		flags := ""
		if force {
			flags = "--force-reinstall --force-downgrade "
		}
		_, code := m.logged("opkg install "+flags+args, log)
		return code == 0, nil
	}
	var want []Wanted
	own := false
	for _, f := range paths {
		n, v := m.FileInfo(f)
		want = append(want, Wanted{n, v, f})
		own = own || n == self
	}
	// Dawnline's own reinstall that changed nothing is a failure, not a silent "done"
	var before int64
	if st, err := os.Stat(selfMarker); own && force && err == nil {
		before = st.ModTime().UnixNano()
	}
	if _, code := m.logged("apk add --allow-untrusted "+args, log); code != 0 {
		return false, nil
	}
	if own {
		if st, err := os.Stat(selfMarker); force && before != 0 && err == nil && st.ModTime().UnixNano() == before {
			if log != nil {
				log("  " + m.t("apk did not reinstall the version that is already installed"))
			}
			return false, Failure{m.t("apk doesn't reinstall an installed version. Install a different release, or run install.sh on the router")}
		}
		return true, nil
	}
	// any other package took when it is at its file's version (the same version again counts)
	have := map[string]string{}
	for _, w := range want {
		if w.Name != "" {
			have[w.Name] = m.Version(w.Name)
		}
	}
	bad := Mismatched(want, have)
	for _, w := range bad {
		name, version, got := w.Name, w.Version, have[w.Name]
		if name == "" {
			name = w.File
		}
		if version == "" {
			version = "?"
		}
		if got == "" {
			got = "-"
		}
		if log != nil {
			log("  " + fmt.Sprintf(m.t("apk did not install %s %s (installed: %s)"), name, version, got))
		}
	}
	return len(bad) == 0, nil
}

func (m *Manager) feeds(apk, opkg string, names []string, log func(string)) (bool, error) {
	if err := m.preflight(nil, 2048, log); err != nil {
		return false, err
	}
	cmd := opkg
	if m.Apk {
		cmd = apk
	}
	_, code := m.logged(cmd+" "+qAll(names), log)
	return code == 0, nil
}

// Add installs packages by name from the feeds; Upgrade updates them.
func (m *Manager) Add(names []string, log func(string)) (bool, error) {
	return m.feeds("apk add", "opkg install", names, log)
}

func (m *Manager) Upgrade(names []string, log func(string)) (bool, error) {
	return m.feeds("apk upgrade", "opkg upgrade", names, log)
}

// Remove takes packages away.
func (m *Manager) Remove(names []string, log func(string)) bool {
	cmd := "opkg remove"
	if m.Apk {
		cmd = "apk del"
	}
	_, code := m.logged(cmd+" "+qAll(names), log)
	return code == 0
}

var (
	// "name-version-rN < newer": the version is what follows the last dash before the release suffix (a
	// name may hold digits, a version no dash)
	apkNewer  = regexp.MustCompile(`^(\S+)-([^- ]+-r[0-9]+)\s+<\s+(\S+)`)
	opkgNewer = regexp.MustCompile(`^(\S+) - (\S+) - (\S+)`)
)

// ParseUpgradable reads the package manager's list of what the feeds have newer: the latest by name. Pure.
func ParseUpgradable(out string, apk bool) map[string]string {
	up := map[string]string{}
	re := opkgNewer
	if apk {
		re = apkNewer
	}
	for _, line := range strings.Split(out, "\n") {
		if f := re.FindStringSubmatch(line); f != nil {
			up[f[1]] = f[3]
		}
	}
	return up
}

// Upgradable is the installed packages with a newer version in the feeds.
func (m *Manager) Upgradable() map[string]string {
	cmd := "opkg list-upgradable"
	if m.Apk {
		cmd = `apk version -l "<"`
	}
	out, _ := m.Run(cmd)
	return ParseUpgradable(out, m.Apk)
}
