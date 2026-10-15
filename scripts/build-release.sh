#!/usr/bin/env bash
# Build the web bundles and pack luci-app-dawnline as a filesystem overlay
# tarball: dist/luci-app-dawnline-<version>.tar.gz (paths relative to /).
# This is the asset the in-app updater and install.sh install.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/package/luci-app-dawnline"
VERSION="$(sed -n "s/^export const VERSION = '\(.*\)';/\1/p" "$APP/root/usr/share/ucode/dawnline/util.uc")"
OUT="$ROOT/dist"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

grep -q "PKG_VERSION:=$VERSION\$" "$APP/Makefile" || { echo "Makefile PKG_VERSION != $VERSION" >&2; exit 1; }
grep -q "\"version\": \"$VERSION\"" "$ROOT/web/package.json" || { echo "web/package.json version != $VERSION" >&2; exit 1; }

[ "${SKIP_WEB:-0}" = 1 ] || (cd "$ROOT/web" && npm run --silent ci)

mkdir -p "$STAGE/www" "$OUT"
cp -R "$APP/root/." "$STAGE/"
cp -R "$APP/htdocs/." "$STAGE/www/"
chmod 755 "$STAGE/usr/bin/dawnline" "$STAGE/usr/libexec/dawnline/agent" "$STAGE/usr/libexec/dawnline/updater" "$STAGE/usr/libexec/dawnline/resolver" \
	"$STAGE/etc/init.d/dawnline" "$STAGE/etc/uci-defaults/90_dawnline" "$STAGE/etc/hotplug.d/iface/95-dawnline" \
	"$STAGE/usr/share/dawnline/portal/www/cgi-bin/portal"
find "$STAGE" -name '.DS_Store' -delete

TAR="$OUT/luci-app-dawnline-$VERSION.tar.gz"
# Files only (no directory entries) and root ownership: extracting into /
# must never touch the mode or owner of /usr, /www or /etc.
( cd "$STAGE" && find usr www etc -type f | LC_ALL=C sort > "$STAGE/.files" )
COPYFILE_DISABLE=1 tar --format ustar --uid 0 --gid 0 --uname root --gname root \
	-czf "$TAR" -C "$STAGE" -T "$STAGE/.files"
( cd "$OUT" && shasum -a 256 "$(basename "$TAR")" > "$(basename "$TAR").sha256" )
echo "$TAR"
