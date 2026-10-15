#!/usr/bin/env bash
# Build the release packages with the OpenWrt SDK in Docker (as CI does):
#   scripts/build-packages.sh [ipk|apk|all]
# Output: dist/luci-app-dawnline-<version>.{ipk,apk} and dist/sha256sums.txt
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

mkdir -p "$OUT"
build() {
	local type="$1" sdk="$2" tag="dawnline-build:$1"
	docker build --platform linux/amd64 -f "$ROOT/build/Dockerfile" --build-arg "SDK_IMAGE=$sdk" -t "$tag" "$ROOT"
	local id
	id="$(docker create "$tag")"
	rm -rf "$OUT/.$type" && mkdir -p "$OUT/.$type"
	docker cp "$id:/builder/out/." "$OUT/.$type/"
	docker rm "$id" >/dev/null
	local f
	f="$(find "$OUT/.$type" -type f -name "*.$type" | head -n1)"
	[ -n "$f" ] || { echo "no .$type built" >&2; exit 1; }
	# ipk names use underscores (luci-app-dawnline_0.1.0-r1_all.ipk): one stable name for both.
	mv "$f" "$OUT/luci-app-dawnline-$VERSION.$type"
	rm -rf "$OUT/.$type"
	echo "$OUT/luci-app-dawnline-$VERSION.$type"
}

case "$WHAT" in
ipk) build ipk "$IPK_SDK" ;;
apk) build apk "$APK_SDK" ;;
all) build ipk "$IPK_SDK"; build apk "$APK_SDK" ;;
*) echo "usage: $0 [ipk|apk|all]" >&2; exit 2 ;;
esac

(
	cd "$OUT"
	set -- luci-app-dawnline-"$VERSION".ipk luci-app-dawnline-"$VERSION".apk
	files=""
	for f in "$@"; do [ -f "$f" ] && files="$files $f"; done
	# shellcheck disable=SC2086
	if command -v sha256sum >/dev/null; then sha256sum $files; else shasum -a 256 $files; fi > sha256sums.txt
)
cat "$OUT/sha256sums.txt"
