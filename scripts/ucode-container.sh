#!/usr/bin/env bash
# Run the ucode checks the way CI does: in an OpenWrt rootfs container with the
# release's own ucode and libuci — compile every file (compile-ucode.sh), then
# the unit tests (tests/ucode/run.sh). Needs docker; the repository is mounted
# read-only at /src, the container is thrown away.
#   scripts/ucode-container.sh [24.10|25.12|all] [test name filter]
#
# Images are the x86-64 rootfs of the OpenWrt releases the packages are built
# for (build/Dockerfile, scripts/build-packages.sh), pinned by digest so a
# retagged image cannot change what CI runs. To move to a new release change
# the tag and the digest together (docker buildx imagetools inspect <image>).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
image_for() {
	case "$1" in
		24.10) echo 'openwrt/rootfs:x86-64-24.10.6@sha256:fd76f3afb9c390ef2915618b6e3d7187698c03ecc6c23d3a13f12b62d9c6209e' ;;
		25.12) echo 'openwrt/rootfs:x86-64-25.12.3@sha256:af882e0583954fc2ceac6b081a9d214fc739cfea36a29b48795a5f15563aa3b5' ;;
		*) echo "unknown release $1 (24.10 or 25.12)" >&2; exit 2 ;;
	esac
}
releases="${1:-all}"
[ "$releases" = all ] && releases='24.10 25.12'
rc=0
for rel in $releases; do
	image="$(image_for "$rel")"
	echo "== OpenWrt $rel ($image)"
	# The checks run from this stdin script (`sh -s`): ucode-mod-uloop is not in
	# the 24.10 rootfs, so what is missing is installed from the release's feeds.
	docker run --rm -i --platform linux/amd64 -v "$REPO:/src:ro" -e "FILTER=${2:-}" "$image" sh -s <<-'INNER' || rc=1
		set -eu
		missing=''
		command -v ucode >/dev/null || missing='ucode'
		for m in fs uci ubus uloop; do
			[ -e "/usr/lib/ucode/$m.so" ] || missing="$missing ucode-mod-$m"
		done
		if [ -n "$missing" ]; then
			echo "installing:$missing"
			if command -v apk >/dev/null; then
				# shellcheck disable=SC2086
				apk add --quiet $missing
			else
				mkdir -p /var/lock
				# shellcheck disable=SC2086
				opkg update >/dev/null && opkg install $missing >/dev/null
			fi
		fi
		sh /src/scripts/compile-ucode.sh /src/package/luci-app-dawnline/root
		sh /src/tests/ucode/run.sh /src "$FILTER"
	INNER
done
exit $rc
