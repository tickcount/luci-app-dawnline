#!/usr/bin/env bash
# Compile-check every ucode file on a router without installing anything:
# the tree is unpacked under /tmp/dlc and modules are resolved from there.
#   scripts/check-ucode.sh [root@host]
set -euo pipefail
HOST="${1:-root@outline.lan}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)/package/luci-app-dawnline/root"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# ucode resolves names at compile time: calling a function declared further
# down a file fails at runtime ("access to undeclared variable"). Catch it here.
python3 "$(dirname "$0")/lint-ucode.py" "$ROOT"
( cd "$ROOT" && COPYFILE_DISABLE=1 tar -czf "$TMP/t.tgz" usr etc )
scp -q "$TMP/t.tgz" "$HOST:/tmp/dl-check.tgz"
ssh "$HOST" sh <<'REMOTE'
rm -rf /tmp/dlc && mkdir -p /tmp/dlc && tar -xzf /tmp/dl-check.tgz -C /tmp/dlc && rm /tmp/dl-check.tgz
cd /tmp/dlc
rc=0
# Modules by their import name: dawnline/x.uc is dawnline.x, dawnline/rpc/x.uc dawnline.rpc.x.
for f in usr/share/ucode/dawnline/*.uc usr/share/ucode/dawnline/rpc/*.uc; do
	[ -f "$f" ] || continue
	n=$(echo "${f#usr/share/ucode/}" | sed 's/\.uc$//; s#/#.#g')
	out=$(ucode -L '/tmp/dlc/usr/share/ucode/*.uc' -e "import * as x from '$n';" 2>&1) || { echo "FAIL $f"; echo "$out" | head -8; rc=1; }
done
for f in usr/share/rpcd/ucode/luci.dawnline usr/libexec/dawnline/agent usr/libexec/dawnline/updater usr/bin/dawnline usr/share/dawnline/portal/www/cgi-bin/portal; do
	[ -f "$f" ] || continue
	out=$(ucode -L '/tmp/dlc/usr/share/ucode/*.uc' -c -o /dev/null "$f" 2>&1) || { echo "FAIL $f"; echo "$out" | head -8; rc=1; }
done
rm -rf /tmp/dlc
[ $rc = 0 ] && echo "all ucode files compile"
exit $rc
REMOTE
