package awg

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"

	"github.com/tickcount/luci-app-dawnline/backend/files"
)

// What the installed AmneziaWG can do, as dawnline.awg caps() works it out: the netifd protocol script and
// the awg tool say what the tools know, the kernel module's package version what the kernel runs, and a
// feature counts only when both have it. Held to ucode on testdata/caps.uc (scripts/ucode-golden.sh).

// Caps: V2 is S3/S4, I1-I5 and header ranges (AWG 2.0), V3 header protection, trailers, padding and timing
// (AWG 3.1); Tools and Kmod are their generations ("1.0", "2.0", "3.1"; nil unknown); Pending, an installed
// module waits for a reboot.
type Caps struct {
	V2       bool `json:"v2"`
	V3       bool `json:"v3"`
	Tools    any  `json:"tools"`
	Kmod     any  `json:"kmod"`
	Mismatch bool `json:"mismatch"`
	Pending  bool `json:"pending"`
}

// Record is what an install of AmneziaWG left in awg.json, as far as the running module is concerned.
type Record struct {
	Reloaded *bool   `json:"reloaded"`
	Boot     *string `json:"boot"`
	PrevCore *int64  `json:"prev_core"`
	PrevGen  *string `json:"prev_gen"`
}

var tail = regexp.MustCompile(`([0-9]+\.[0-9]+\.[0-9]{8})(-r?[0-9]+)?$`)

// Gen is the AmneziaWG generation of a package version: 3.x packages carry 3.1; 1.0.x ones are 2.0 from
// July 2025 on and the first generation before. A kernel module's version has the kernel release in front.
func Gen(version string) string {
	v := version
	if m := tail.FindStringSubmatch(version); m != nil {
		v = m[1]
	}
	switch {
	case strings.HasPrefix(v, "3."):
		return "3.1"
	case strings.HasPrefix(v, "1.0.2024"):
		return "1.0"
	case len(v) >= 10 && strings.HasPrefix(v, "1.0.20250") && v[9] >= '1' && v[9] <= '6':
		return "1.0"
	}
	return "2.0"
}

// Pending tells an installed update that waits for a reboot: the old module stayed loaded, this is still
// the boot it ran in, and the module loaded is still that one. boot "" and core 0 stand for "not known".
func Pending(rec *Record, boot string, core int64) bool {
	return rec != nil && rec.Reloaded != nil && !*rec.Reloaded && rec.Boot != nil && boot != "" && *rec.Boot == boot &&
		core != 0 && rec.PrevCore != nil && *rec.PrevCore == core
}

// RunningGen is the generation of the kernel module that runs: the one from before the install while it
// waits for a reboot, else the installed package's (version nil: no package). nil when not known.
func RunningGen(rec *Record, boot string, core int64, version *string) any {
	if Pending(rec, boot, core) {
		if rec.PrevGen == nil {
			return nil
		}
		return *rec.PrevGen
	}
	if version == nil {
		return nil
	}
	return Gen(*version)
}

// Found is what of AmneziaWG the router has, for CapsOf.
type Found struct {
	// Script is the netifd protocol script; Tool, whether the awg tool is there; Tool3, whether it knows the 3.1 keys.
	Script      string
	Tool, Tool3 bool
	Record      *Record
	Boot        string
	Core        int64
	// Version is the kmod-amneziawg package's, nil when it is not a package.
	Version *string
}

// CapsOf works the capabilities out of what was found.
func CapsOf(f Found) Caps {
	t2 := strings.Contains(f.Script, "awg_s3") && strings.Contains(f.Script, "awg_i1")
	t3 := t2 && strings.Contains(f.Script, "awg_header_protection_key") && f.Tool3
	var tools any
	if f.Tool {
		tools = "1.0"
		if t3 {
			tools = "3.1"
		} else if t2 {
			tools = "2.0"
		}
	}
	kmod := RunningGen(f.Record, f.Boot, f.Core, f.Version)
	return Caps{
		V2: t2 && (kmod == nil || kmod != "1.0"), V3: t3 && (kmod == nil || kmod == "3.1"),
		Tools: tools, Kmod: kmod, Mismatch: tools != nil && kmod != nil && tools != kmod,
		Pending: Pending(f.Record, f.Boot, f.Core),
	}
}

const (
	toolPath  = "/usr/bin/awg"
	protoPath = "/lib/netifd/proto/amneziawg.sh"
)

// Version is the installed version of a package (apk on OpenWrt 25.12, opkg before), or nil.
func Version(name string) *string {
	if st, err := os.Stat("/usr/bin/apk"); err == nil && st.Mode()&0o111 != 0 {
		out, _ := exec.Command("apk", "list", "--installed", name).CombinedOutput()
		if m := regexp.MustCompile(`^` + regexp.QuoteMeta(name) + `-([^ ]+) `).FindSubmatch(out); m != nil {
			v := string(m[1])
			return &v
		}
		return nil
	}
	out, _ := exec.Command("opkg", "list-installed").CombinedOutput()
	re := regexp.MustCompile(`^` + regexp.QuoteMeta(name) + `([0-9]+)? - (.+)$`)
	var found []string
	for _, line := range strings.Split(string(out), "\n") {
		if m := re.FindStringSubmatch(strings.TrimSpace(line)); m != nil && (found == nil || m[1] == "") {
			found = m
		}
	}
	if found == nil {
		return nil
	}
	v := strings.TrimSpace(found[2])
	return &v
}

var kept struct {
	sync.Mutex
	key  string
	caps Caps
	ok   bool
}

// SystemCaps is this router's capabilities. Worked out again only when the module's file, the tool, the
// protocol script, the install's record (awg.json in dataDir) or the loaded module changed.
func SystemCaps(dataDir string) Caps {
	mtime := func(path string) int64 {
		st, err := os.Stat(path)
		if err != nil {
			return 0
		}
		return st.ModTime().Unix()
	}
	read := func(path string) string {
		raw, _ := os.ReadFile(path)
		return strings.TrimSpace(string(raw))
	}
	var core int64
	fmt.Sscan(read("/sys/module/amneziawg/coresize"), &core)
	if core < 0 {
		core = 0
	}
	record := dataDir + "/awg.json"
	key := fmt.Sprintf("%d/%d/%d/%d/%d", mtime("/lib/modules/"+read("/proc/sys/kernel/osrelease")+"/amneziawg.ko"), mtime(toolPath), mtime(protoPath), mtime(record), core)
	kept.Lock()
	defer kept.Unlock()
	if kept.ok && kept.key == key {
		return kept.caps
	}
	f := Found{Boot: read("/proc/sys/kernel/random/boot_id"), Core: core, Version: Version("kmod-amneziawg")}
	script, _ := os.ReadFile(protoPath)
	f.Script = string(script)
	if tool, err := os.ReadFile(toolPath); err == nil {
		f.Tool, f.Tool3 = true, bytes.Contains(tool, []byte("HeaderProtectionKey"))
	}
	var rec Record
	if files.ReadJSON(record, &rec) {
		f.Record = &rec
	}
	kept.key, kept.caps, kept.ok = key, CapsOf(f), true
	return kept.caps
}
