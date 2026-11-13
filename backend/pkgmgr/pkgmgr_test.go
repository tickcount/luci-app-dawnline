package pkgmgr

import (
	"strings"
	"testing"
)

func TestVersionApk(t *testing.T) {
	m := &Manager{Apk: true, Run: func(cmd string) (string, int) {
		switch {
		case cmd == "apk list --installed 'ip-full'":
			return "ip-full-6.14.0-r1 aarch64_cortex-a53 {feeds/base} (GPL-2.0) [installed]\n", 0
		case strings.HasPrefix(cmd, "apk list --installed --providers 'acme'"):
			return "<acme> acme-acmesh-3.1.3-r3 noarch {feeds/packages/net/acme-acmesh} (GPL-3.0-only) [installed]\n", 0
		}
		return "", 0
	}}
	if v := m.Version("ip-full"); v != "6.14.0-r1" {
		t.Fatalf("a package by its own name: %q", v)
	}
	if v := m.Version("acme"); v != "3.1.3-r3" {
		t.Fatalf("a name another package provides: %q", v)
	}
	if v := m.Version("kmod-veth"); v != "" {
		t.Fatalf("not installed: %q", v)
	}
}
