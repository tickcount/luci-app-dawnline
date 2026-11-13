package updater

import (
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/tickcount/luci-app-dawnline/backend/files"
)

// Where AmneziaWG comes from (dawnline.awg_builds): the awg-openwrt projects publish builds per OpenWrt
// release and target (the kernel module must match the firmware), and the record of what was installed on
// which kernel and boot (an update whose module could not be swapped starts with the next boot).

// Source is a project that publishes builds.
type Source struct{ Repo, Label string }

var (
	Sources = map[string]Source{"slava": {"Slava-Shchipunov/awg-openwrt", "Slava-Shchipunov"}, "grey": {"2Grey/awg-openwrt", "2Grey"}}
	// Order is the order they are tried in when no build is chosen.
	Order = []string{"slava", "grey"}
	// AwgPackages is a build's packages; AwgRU its Russian LuCI translation.
	AwgPackages = []string{"kmod-amneziawg", "amneziawg-tools", "luci-proto-amneziawg"}
)

const AwgRU = "luci-i18n-amneziawg-ru"

// Firmware is this firmware as the builds name it: { Tag: "v24.10.6", Postfix:
// "_v24.10.6_aarch64_cortex-a53_mediatek_filogic", Ext }.
type Firmware struct {
	Tag, Postfix, Ext string
	Snapshot          bool
}

var distribArch = regexp.MustCompile(`DISTRIB_ARCH='([^']*)'`)

// FirmwareOf makes it of what `ubus call system board` says of the release (version, target, arch; the
// arch from /etc/openwrt_release when the board does not say); ok is false when it cannot be told.
func FirmwareOf(version, target, arch, release, ext string) (Firmware, bool) {
	parts := strings.Split(target, "/")
	if arch == "" {
		if m := distribArch.FindStringSubmatch(release); m != nil {
			arch = m[1]
		}
	}
	if version == "" || len(parts) != 2 || arch == "" {
		return Firmware{}, false
	}
	return Firmware{Tag: "v" + version, Postfix: "_v" + version + "_" + arch + "_" + parts[0] + "_" + parts[1], Ext: ext,
		Snapshot: strings.Contains(version, "SNAPSHOT")}, true
}

// Asset is the file name of a package in a build.
func (fw Firmware) Asset(name string) string { return name + fw.Postfix + "." + fw.Ext }

// ForTag is the same firmware, another release of its series (v24.10.6 → v24.10.8).
func (fw Firmware) ForTag(tag string) Firmware {
	out := fw
	out.Tag, out.Postfix = tag, strings.Replace(fw.Postfix, fw.Tag, tag, 1)
	return out
}

var awgPart = regexp.MustCompile(`([0-9]+\.[0-9]+\.[0-9]{8})(-r?[0-9]+)?$`)

// Gen is the AmneziaWG generation of a package version ("" for none): 3.x packages carry 3.1; 1.0.x ones
// are 2.0 from July 2025 on, and the first generation before that. A kernel module's version carries the
// kernel release in front: the AmneziaWG part is at the end.
func Gen(version string) string {
	if version == "" {
		return ""
	}
	v := version
	if m := awgPart.FindStringSubmatch(version); m != nil {
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

// Record is awg.json: which build was installed on which kernel and boot.
type Record struct {
	OSRelease string         `json:"osrelease"`
	Source    any            `json:"source"`
	Tag       any            `json:"tag"`
	Packages  map[string]any `json:"packages"`
	Installed int64          `json:"installed"`
	Boot      any            `json:"boot"`
	PrevGen   any            `json:"prev_gen"`
	PrevCore  any            `json:"prev_core"`
	Reloaded  any            `json:"reloaded"`
}

func readTrim(path string) string {
	raw, _ := os.ReadFile(path)
	return strings.Trim(string(raw), " \t\r\n\v\f")
}

// bootID is this boot ("" when the kernel does not say); moduleCore the size in memory of the loaded
// kernel module (0: none is loaded). sysfs has no version for it, but builds differ in size.
func bootID() string { return readTrim("/proc/sys/kernel/random/boot_id") }

func moduleCore() int64 {
	n, _ := strconv.ParseInt(readTrim("/sys/module/amneziawg/coresize"), 10, 64)
	if n < 0 {
		return 0
	}
	return n
}

// Pending tells an installed update that waits for a reboot: the install could not swap the kernel module
// (the old one stayed loaded), this is still the boot it ran in, and the module loaded is still the one
// from before it. Pure.
func Pending(rec *Record, boot string, core int64) bool {
	if rec == nil || rec.Reloaded != false || boot == "" || rec.Boot != boot || core == 0 {
		return false
	}
	prev, _ := rec.PrevCore.(float64)
	return int64(prev) == core
}

// Module is the kernel module loaded now, taken before an install changes packages.
type Module struct {
	Core    int64
	Gen     string
	Pending bool
}

func record(data string) *Record {
	var r Record
	if !files.ReadJSON(data+"/awg.json", &r) {
		return nil
	}
	return &r
}

// moduleNow is what runs: the generation from before an install while it waits for a reboot, else the
// installed package's (version: the kmod-amneziawg package installed now).
func moduleNow(data, version string) Module {
	rec, boot, core := record(data), bootID(), moduleCore()
	m := Module{Core: core, Pending: Pending(rec, boot, core)}
	switch {
	case core == 0:
	case m.Pending:
		m.Gen, _ = rec.PrevGen.(string)
	default:
		m.Gen = Gen(version)
	}
	return m
}

// writeRecord remembers which build was installed on which kernel. After a firmware upgrade the module is
// gone (it was built for that kernel): Health can then say so and offer the build for the new one.
func writeRecord(data string, source, tag any, packages map[string]any, was Module, reloaded bool) {
	orNil := func(s string) any {
		if s == "" {
			return nil
		}
		return s
	}
	var core any
	if was.Core != 0 {
		core = was.Core
	}
	os.MkdirAll(data, 0o700)
	files.WriteJSON(data+"/awg.json", map[string]any{"osrelease": readTrim("/proc/sys/kernel/osrelease"), "source": source, "tag": tag, "packages": packages,
		"installed": time.Now().Unix(), "boot": orNil(bootID()), "prev_gen": orNil(was.Gen), "prev_core": core, "reloaded": reloaded}, 0o600)
}

// GoArch is the name the backend's binary carries in a release (dawnlined-<version>-<goarch>) for a
// router's architecture as OpenWrt names it (DISTRIB_ARCH: aarch64_cortex-a53, arm_cortex-a7_neon-vfpv4,
// mipsel_24kc, x86_64), or "" where none is built: such a router runs without the backend. ARM older than
// v7 has none (the binary is built for ARMv7's own instructions).
func GoArch(arch string) string {
	cpu := strings.SplitN(arch, "_", 2)
	sub := ""
	if len(cpu) > 1 {
		sub = cpu[1]
	}
	switch cpu[0] {
	case "aarch64":
		return "arm64"
	case "x86":
		if sub == "64" {
			return "amd64"
		}
	case "mips":
		return "mips"
	case "mipsel":
		return "mipsle"
	case "arm":
		// Cortex-A cores are ARMv7 or newer; arm926ej-s, arm1176jzf-s, xscale, fa526 and their like are not
		if strings.HasPrefix(sub, "cortex-a") {
			return "arm"
		}
	}
	return ""
}

// Adopt makes a record for a module Dawnline did not install (install.sh, by hand, or from before records
// were kept), so the next firmware upgrade is noticed: the kernel it is for, no source. Only when there is
// no record and the module is loaded or on disk for the running kernel. The backend calls it when it starts.
func Adopt(data string) {
	rel := readTrim("/proc/sys/kernel/osrelease")
	if _, err := os.Stat(data + "/awg.json"); err == nil {
		return
	}
	_, loaded := os.Stat("/sys/module/amneziawg")
	_, onDisk := os.Stat("/lib/modules/" + rel + "/amneziawg.ko")
	if loaded != nil && (rel == "" || onDisk != nil) {
		return
	}
	os.MkdirAll(data, 0o700)
	files.WriteJSON(data+"/awg.json", map[string]any{"osrelease": rel, "source": nil, "tag": nil, "packages": nil, "installed": time.Now().Unix(),
		"boot": bootID(), "prev_gen": nil, "prev_core": nil, "reloaded": nil}, 0o600)
}
