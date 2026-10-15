#!/bin/sh
# shellcheck shell=dash
#
# Dawnline installer for OpenWrt 24.10+ (opkg) and 25.12+ (apk).
#
#   sh -c "$(wget -qO- https://raw.githubusercontent.com/tickcount/luci-app-dawnline/main/install.sh)"
#   sh install.sh [version]            a given release instead of the latest
#
# Environment:
#   DAWNLINE_REPO=owner/name           GitHub repository with the releases
#   DAWNLINE_AWG=auto|slava|grey|skip  where AmneziaWG comes from if it is missing
#                                      (auto: Slava-Shchipunov, then 2Grey)
#
# Installs AmneziaWG built for this firmware when it is missing, then the
# Dawnline package with its dependencies from the OpenWrt feeds. Settings and
# keys survive reinstalls and upgrades.

set -eu

REPO="${DAWNLINE_REPO:-tickcount/luci-app-dawnline}"
AWG_SOURCE="${DAWNLINE_AWG:-auto}"
VERSION="${1:-}"
TMP="/tmp/dawnline-install"
REQUIRED_KB=2048

PKG_IS_APK=0
command -v apk >/dev/null 2>&1 && PKG_IS_APK=1
EXT=ipk
[ "$PKG_IS_APK" -eq 1 ] && EXT=apk

msg() { printf '\033[32;1m%s\033[0m\n' "$*"; }
note() { printf '%s\n' "$*"; }
die() {
	printf '\033[31;1m%s\033[0m\n' "$*" >&2
	exit 1
}

cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT INT TERM

fetch() {
	# fetch URL FILE: a few attempts, a non-empty file or failure
	attempt=1
	while [ "$attempt" -le 3 ]; do
		if wget -q -T 30 -O "$2" "$1" 2>/dev/null && [ -s "$2" ]; then
			return 0
		fi
		rm -f "$2"
		attempt=$((attempt + 1))
		sleep 2
	done
	return 1
}

pkg_update() {
	if [ "$PKG_IS_APK" -eq 1 ]; then apk update >/dev/null; else opkg update >/dev/null; fi
}

pkg_installed() {
	if [ "$PKG_IS_APK" -eq 1 ]; then
		apk info -e "$1" >/dev/null 2>&1
	else
		opkg list-installed "$1" 2>/dev/null | grep -q "^$1 "
	fi
}

pkg_install_files() {
	if [ "$PKG_IS_APK" -eq 1 ]; then
		# Packages from GitHub releases are not signed with the feed key.
		apk add --allow-untrusted "$@"
	else
		opkg install "$@"
	fi
}

check_system() {
	[ "$(id -u)" = 0 ] || die "Run this as root."
	[ -f /etc/openwrt_release ] || die "This is not OpenWrt."
	# shellcheck disable=SC1091
	. /etc/openwrt_release
	RELEASE="${DISTRIB_RELEASE:-}"
	ARCH="${DISTRIB_ARCH:-}"
	TARGET="${DISTRIB_TARGET:-}"
	msg "OpenWrt $RELEASE · $TARGET · $ARCH"

	major="${RELEASE%%.*}"
	case "$major" in
	'' | *[!0-9]*) note "Snapshot or unknown release: continuing." ;;
	*) [ "$major" -ge 24 ] || die "Dawnline needs OpenWrt 24.10 or newer." ;;
	esac

	free_kb="$(df -k /overlay 2>/dev/null | awk 'NR==2 {print $4}')"
	if [ -n "$free_kb" ] && [ "$free_kb" -lt "$REQUIRED_KB" ]; then
		die "Not enough flash: $((free_kb / 1024)) MB free, $((REQUIRED_KB / 1024)) MB needed."
	fi

	nslookup github.com >/dev/null 2>&1 || die "DNS does not work: github.com does not resolve."
}

# AmneziaWG packages are built per firmware version and target by the
# awg-openwrt projects: <name>_v<release>_<arch>_<target>_<subtarget>.<ext>
install_awg() {
	if pkg_installed kmod-amneziawg && pkg_installed amneziawg-tools; then
		note "AmneziaWG is already installed."
		return 0
	fi
	[ "$AWG_SOURCE" = skip ] && die "AmneziaWG is missing and DAWNLINE_AWG=skip."

	case "$AWG_SOURCE" in
	slava) sources="Slava-Shchipunov/awg-openwrt" ;;
	grey) sources="2Grey/awg-openwrt" ;;
	*) sources="Slava-Shchipunov/awg-openwrt 2Grey/awg-openwrt" ;;
	esac

	postfix="_v${RELEASE}_${ARCH}_$(echo "$TARGET" | tr '/' '_').$EXT"
	for src in $sources; do
		msg "Downloading AmneziaWG for OpenWrt $RELEASE from $src"
		ok=1
		files=""
		for name in kmod-amneziawg amneziawg-tools luci-proto-amneziawg; do
			file="$TMP/${name}${postfix}"
			if fetch "https://github.com/$src/releases/download/v$RELEASE/${name}${postfix}" "$file"; then
				files="$files $file"
			else
				ok=0
				break
			fi
		done
		if [ "$ok" -eq 1 ]; then
			msg "Installing AmneziaWG"
			# shellcheck disable=SC2086
			pkg_install_files $files || die "AmneziaWG installation failed."
			return 0
		fi
		note "No build for OpenWrt $RELEASE ($TARGET) in $src."
	done
	die "No AmneziaWG build for OpenWrt $RELEASE ($TARGET). Install kmod-amneziawg, amneziawg-tools and luci-proto-amneziawg by hand, then run this again."
}

install_dawnline() {
	if [ -z "$VERSION" ]; then
		fetch "https://api.github.com/repos/$REPO/releases/latest" "$TMP/release.json" ||
			die "Cannot reach GitHub (or its rate limit is hit: try again in a few minutes)."
		VERSION="$(jsonfilter -i "$TMP/release.json" -e '@.tag_name' | sed 's/^v//')"
	fi
	VERSION="${VERSION#v}"
	[ -n "$VERSION" ] || die "Cannot determine the latest Dawnline release."

	asset="luci-app-dawnline-$VERSION.$EXT"
	base="https://github.com/$REPO/releases/download/v$VERSION"
	msg "Downloading Dawnline $VERSION"
	fetch "$base/$asset" "$TMP/$asset" || die "Download failed: $asset"
	fetch "$base/sha256sums.txt" "$TMP/sha256sums.txt" || die "Download failed: sha256sums.txt"

	want="$(awk -v f="$asset" '$2 == f || $2 == "*" f {print $1}' "$TMP/sha256sums.txt")"
	got="$(sha256sum "$TMP/$asset" | awk '{print $1}')"
	[ -n "$want" ] && [ "$want" = "$got" ] || die "Checksum mismatch for $asset."

	if [ -x /usr/bin/dawnline ]; then
		msg "Dawnline is installed: upgrading (a backup is made first)"
		/usr/bin/dawnline backup --reason pre-update >/dev/null 2>&1 || true
	fi
	msg "Installing Dawnline $VERSION"
	pkg_install_files "$TMP/$asset" || die "Dawnline installation failed."
}

main() {
	rm -rf "$TMP"
	mkdir -p "$TMP"
	check_system
	msg "Updating package lists"
	pkg_update || die "Package lists could not be updated."
	install_awg
	install_dawnline

	lan="$(uci -q get network.lan.ipaddr 2>/dev/null | cut -d/ -f1)"
	msg "Done."
	note "Open LuCI → Network → Dawnline${lan:+ (http://$lan/cgi-bin/luci/admin/network/dawnline/server)} and run the setup wizard."
}

main "$@"
