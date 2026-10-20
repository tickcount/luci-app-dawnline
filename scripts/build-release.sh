#!/usr/bin/env bash
# Build the web bundles and pack luci-app-dawnline as a filesystem overlay
# tarball: dist/luci-app-dawnline-<version>.tar.gz (paths relative to /), with
# the translations as their packages lay them out (the catalogs compiled by
# web/i18n/lmo.ts, byte for byte po2lmo's, and the uci-defaults that adds the
# language to LuCI). scripts/deploy.sh installs it for development; releases
# are the .ipk/.apk packages (build-packages.sh).
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
for po in "$APP"/po/*/dawnline.po; do
	l="$(basename "$(dirname "$po")")"
	[ "$l" = templates ] && continue
	mkdir -p "$STAGE/usr/lib/lua/luci/i18n"
	node "$ROOT/web/i18n/lmo.ts" "$po" "$STAGE/usr/lib/lua/luci/i18n/dawnline.$l.lmo"
	# The name LuCI lists the language by (luci.mk's LUCI_LANG.<lang>).
	case "$l" in ru) name='Русский (Russian)' ;; *) name="$l" ;; esac
	printf "uci set luci.languages.%s='%s'; uci commit luci\n" "$l" "$name" > "$STAGE/etc/uci-defaults/luci-i18n-dawnline-$l"
done
chmod 755 "$STAGE/usr/bin/dawnline" "$STAGE/usr/libexec/dawnline/agent" "$STAGE/usr/libexec/dawnline/updater" "$STAGE/usr/libexec/dawnline/resolver" "$STAGE/usr/libexec/dawnline/postupdate" \
	"$STAGE/etc/init.d/dawnline" "$STAGE/etc/uci-defaults/90_dawnline" "$STAGE/etc/hotplug.d/iface/95-dawnline" \
	"$STAGE/usr/share/dawnline/portal/www/cgi-bin/portal" "$STAGE/usr/share/dawnline/portal/cgi.uc"
find "$STAGE" -name '.DS_Store' -delete

TAR="$OUT/luci-app-dawnline-$VERSION.tar.gz"
# Files only (no directory entries) and root ownership: extracting into /
# must never touch the mode or owner of /usr, /www or /etc.
( cd "$STAGE" && find usr www etc -type f | LC_ALL=C sort > "$STAGE/.files" )
COPYFILE_DISABLE=1 tar --format ustar --uid 0 --gid 0 --uname root --gname root \
	-czf "$TAR" -C "$STAGE" -T "$STAGE/.files"
( cd "$OUT" && shasum -a 256 "$(basename "$TAR")" > "$(basename "$TAR").sha256" )
echo "$TAR"
