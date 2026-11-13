#!/usr/bin/env bash
# The Go backend's checks, in containers (needs docker):
#   scripts/backend-container.sh
# gofmt, go vet and the unit tests with the Go toolchain image, then the tests
# that need a real ubusd in the OpenWrt rootfs containers CI uses.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GO_IMAGE="${GO_IMAGE:-golang:1.27-alpine}"
ROOTFS="${ROOTFS:-openwrt/rootfs:x86-64-24.10.6 openwrt/rootfs:x86-64-25.12.3}"
OUT="$ROOT/dist/backend-test"

mkdir -p "$OUT"
# The whole repository is mounted: the e2e tests read the package's files.
docker run --rm -v "$ROOT":/repo:ro -v "$OUT":/out -w /repo/backend \
	-v dawnline-gocache:/root/.cache/go-build -v dawnline-gomod:/go/pkg/mod \
	-e CGO_ENABLED=0 "$GO_IMAGE" sh -ec '
	unformatted="$(gofmt -l .)"
	[ -z "$unformatted" ] || { echo "gofmt: $unformatted" >&2; exit 1; }
	go vet ./...
	go vet -tags ubusd ./...
	go test ./...
	go vet -tags e2e ./...
	GOARCH=amd64 go test -c -tags ubusd -o /out/ubus.test ./ubus
	GOARCH=amd64 go test -c -tags e2e -o /out/e2e.test ./daemon
'

for image in $ROOTFS; do
	echo "== ubusd tests on $image"
	docker run --rm --platform linux/amd64 -v "$OUT":/out:ro \
		-v "$ROOT/package/luci-app-dawnline/root/usr/share/rpcd/acl.d/luci-app-dawnline.json":/usr/share/rpcd/acl.d/luci-app-dawnline.json:ro \
		"$image" sh -ec '
		mkdir -p /var/run/ubus
		ubusd &
		# BusyBox sleep takes whole seconds there.
		i=0
		while [ ! -S /var/run/ubus/ubus.sock ] && [ "$i" -lt 10 ]; do sleep 1; i=$((i + 1)); done
		/out/ubus.test -test.run RealBus -test.v
		# The whole path of a page: rpcd with the ACL of the package, and /ubus of uhttpd.
		rpcd &
		uhttpd -f -p 127.0.0.1:8099 -h /www -u /ubus -t 60 -T 30 &
		i=0
		while ! ubus list session >/dev/null 2>&1 && [ "$i" -lt 10 ]; do sleep 1; i=$((i + 1)); done
		/out/e2e.test -test.run ThroughUhttpd -test.v
	'
done
