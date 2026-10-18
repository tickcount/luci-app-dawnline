#!/usr/bin/env bash
# Compile-check every ucode file on a router without installing anything:
# the tree is unpacked under /tmp/dlc and scripts/compile-ucode.sh runs there
# (the same check CI runs in an OpenWrt rootfs container, scripts/ucode-container.sh).
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
ssh "$HOST" 'rm -rf /tmp/dlc && mkdir -p /tmp/dlc && tar -xzf /tmp/dl-check.tgz -C /tmp/dlc && rm /tmp/dl-check.tgz'
# The script goes over stdin (`sh -s`), nothing of it stays on the router.
ssh "$HOST" 'sh -s /tmp/dlc; rc=$?; rm -rf /tmp/dlc; exit $rc' < "$(dirname "$0")/compile-ucode.sh"
