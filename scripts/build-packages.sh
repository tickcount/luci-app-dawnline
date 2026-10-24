#!/usr/bin/env bash
# Build the release packages with the OpenWrt SDK in Docker (as CI does):
#   scripts/build-packages.sh [ipk|apk|all]
# Output: dist/luci-app-dawnline-<version>.{ipk,apk}, a translation package per
# po/<lang> (dist/luci-i18n-dawnline-<lang>-<version>.{ipk,apk}) and dist/sha256sums.txt
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/package/luci-app-dawnline"
VERSION="$(sed -n 's/^PKG_VERSION:=//p' "$APP/Makefile")"
OUT="$ROOT/dist"
WHAT="${1:-all}"
IPK_SDK="${IPK_SDK:-itdoginfo/openwrt-sdk-ipk:24.10.6}"
APK_SDK="${APK_SDK:-itdoginfo/openwrt-sdk-apk:25.12.3}"

# One version everywhere: the Makefile, the ucode library and the web package.
grep -q "^export const VERSION = '$VERSION';" "$APP/root/usr/share/ucode/dawnline/util.uc" || { echo "util.uc VERSION != $VERSION" >&2; exit 1; }
grep -q "\"version\": \"$VERSION\"" "$ROOT/web/package.json" || { echo "web/package.json version != $VERSION" >&2; exit 1; }

# The web bundles are not committed: web/ builds them (npm run build).
for f in htdocs/luci-static/resources/dawnline/app.js root/usr/share/dawnline/portal/assets/portal.js root/usr/share/dawnline/portal/assets/portal.css; do
	[ -f "$APP/$f" ] || { echo "$APP/$f is missing: run 'npm run build' in web/" >&2; exit 1; }
done

mkdir -p "$OUT"
build() {
	local type="$1" sdk="$2" tag="dawnline-build:$1"
	docker build --platform linux/amd64 -f "$ROOT/build/Dockerfile" --build-arg "SDK_IMAGE=$sdk" -t "$tag" "$ROOT"
	local id
	id="$(docker create "$tag")"
	rm -rf "$OUT/.$type" && mkdir -p "$OUT/.$type"
	docker cp "$id:/builder/out/." "$OUT/.$type/"
	docker rm "$id" >/dev/null
	local f name
	for f in "$OUT/.$type"/*."$type"; do
		[ -f "$f" ] || continue
		# ipk names use underscores (luci-app-dawnline_0.1.0-r1_all.ipk), apk names
		# dashes: one stable name per package for both, its name and the version.
		name="$(basename "$f")"
		name="${name%%[_-][0-9]*}"
		mv "$f" "$OUT/$name-$VERSION.$type"
		echo "$OUT/$name-$VERSION.$type"
	done
	rm -rf "$OUT/.$type"
	for name in luci-app-dawnline $(i18n_packages); do
		[ -f "$OUT/$name-$VERSION.$type" ] || { echo "no $name .$type built" >&2; exit 1; }
	done
}

# The translation packages luci.mk makes: one per po/<lang>.
i18n_packages() {
	local d
	for d in "$APP"/po/*/; do
		d="$(basename "$d")"
		[ "$d" = templates ] || printf 'luci-i18n-dawnline-%s\n' "$d"
	done
}

case "$WHAT" in
ipk) build ipk "$IPK_SDK" ;;
apk) build apk "$APK_SDK" ;;
all) build ipk "$IPK_SDK"; build apk "$APK_SDK" ;;
*) echo "usage: $0 [ipk|apk|all]" >&2; exit 2 ;;
esac

(
	cd "$OUT"
	files=""
	for name in luci-app-dawnline $(i18n_packages); do
		for f in "$name-$VERSION".ipk "$name-$VERSION".apk; do [ -f "$f" ] && files="$files $f"; done
	done
	# shellcheck disable=SC2086
	if command -v sha256sum >/dev/null; then sha256sum $files; else shasum -a 256 $files; fi > sha256sums.txt
)
cat "$OUT/sha256sums.txt"
