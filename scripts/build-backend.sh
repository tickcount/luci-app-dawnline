#!/usr/bin/env bash
# Build the Go backend (backend/, the program dawnlined) for one router architecture:
#   scripts/build-backend.sh <arch>     arch: what `uname -m` says on the router (aarch64, armv7l, mips,
#                                        mipsel, x86_64), or a Go name (arm64, arm, mips, mipsle, amd64)
# Output: dist/backend/dawnlined-<goarch>, and its path as the last line. Needs docker (the Go toolchain
# image); nothing of Go is installed here. A static binary: it runs on any OpenWrt of that architecture.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GO_IMAGE="${GO_IMAGE:-golang:1.27-alpine}"
VERSION="$(cat "$ROOT/package/luci-app-dawnline/root/usr/share/dawnline/version")"

case "${1:-}" in
aarch64 | arm64) GOARCH=arm64 ;;
armv7l | armv7 | arm) GOARCH=arm ;;
mips) GOARCH=mips ;;
mipsel | mipsle) GOARCH=mipsle ;;
x86_64 | amd64) GOARCH=amd64 ;;
*) echo "usage: $0 <aarch64|armv7l|mips|mipsel|x86_64>" >&2; exit 2 ;;
esac

OUT="$ROOT/dist/backend"
mkdir -p "$OUT"
# Routers' MIPS and ARMv7 have no FPU to count on: soft float, and ARMv7's own instructions.
docker run --rm -v "$ROOT/backend":/src:ro -v "$OUT":/out -w /src \
	-v dawnline-gocache:/root/.cache/go-build -v dawnline-gomod:/go/pkg/mod \
	-e CGO_ENABLED=0 -e GOOS=linux -e "GOARCH=$GOARCH" -e GOMIPS=softfloat -e GOARM=7 "$GO_IMAGE" \
	go build -trimpath -ldflags "-s -w -X github.com/tickcount/luci-app-dawnline/backend.Version=$VERSION" \
	-o "/out/dawnlined-$GOARCH" ./cmd/dawnlined
echo "$OUT/dawnlined-$GOARCH"
