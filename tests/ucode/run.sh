#!/bin/sh
# Run the ucode unit tests against the real libuci: the fixture configs are
# copied into /etc/config (replacing what is there), the stand-in `awg` goes on
# PATH and tests/ucode/run.uc runs every *.test.uc. For a throw-away OpenWrt
# rootfs container (scripts/ucode-container.sh); on anything else it refuses
# unless DAWNLINE_TEST_FORCE=1, because it overwrites /etc/config/dawnline.
#   tests/ucode/run.sh [REPO] [test name filter]
set -eu
REPO="$(cd "${1:-$(dirname "$0")/../..}" && pwd)"
T="$REPO/tests/ucode"
if [ ! -e /.dockerenv ] && [ "${DAWNLINE_TEST_FORCE:-}" != 1 ]; then
	echo "run.sh replaces /etc/config/dawnline and /etc/config/uhttpd: run it in a container (scripts/ucode-container.sh)" >&2
	exit 2
fi
cp "$T"/fixtures/config/* /etc/config/
mkdir -p /tmp/dawnline-tests /var/run/dawnline
PATH="$T/fixtures/bin:$PATH" ucode -L "$REPO/package/luci-app-dawnline/root/usr/share/ucode/*.uc" "$T/run.uc" "${2:-}"
