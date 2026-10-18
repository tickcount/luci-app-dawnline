#!/bin/sh
# Compile-check every ucode file of a Dawnline tree without installing it:
# modules are imported by name (dawnline/x.uc is dawnline.x, dawnline/rpc/x.uc
# dawnline.rpc.x) and entry points compiled with `ucode -c`. Needs ucode with
# its fs, uci, ubus and uloop modules, which is any OpenWrt box or an
# openwrt/rootfs container (scripts/ucode-container.sh); check-ucode.sh pipes
# this script to a router.
#   scripts/compile-ucode.sh [ROOT]   ROOT holds usr/ and etc/ (default: .)
#
# ucode resolves names at compile time and imports are static, so this catches
# a syntax error, a missing module and a named import that nothing exports.
set -eu
ROOT="$(cd "${1:-.}" && pwd)"
cd "$ROOT"
LIB="$ROOT/usr/share/ucode/*.uc"
rc=0
for f in usr/share/ucode/dawnline/*.uc usr/share/ucode/dawnline/rpc/*.uc; do
	[ -f "$f" ] || continue
	n=$(echo "${f#usr/share/ucode/}" | sed 's/\.uc$//; s#/#.#g')
	out=$(ucode -L "$LIB" -e "import * as x from '$n';" 2>&1) || { echo "FAIL $f"; echo "$out" | head -8; rc=1; }
done
# Entry points (ucode scripts outside the module tree); the shell ones live in
# the ShellCheck list of .github/workflows/ci.yml instead.
for f in usr/share/rpcd/ucode/luci.dawnline usr/libexec/dawnline/agent usr/libexec/dawnline/updater usr/bin/dawnline \
		usr/share/dawnline/portal/cgi.uc; do
	[ -f "$f" ] || { echo "FAIL $f: missing"; rc=1; continue; }
	out=$(ucode -L "$LIB" -c -o /dev/null "$f" 2>&1) || { echo "FAIL $f"; echo "$out" | head -8; rc=1; }
done
[ $rc = 0 ] && echo "all ucode files compile"
exit $rc
