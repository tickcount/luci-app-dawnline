#!/usr/bin/env bash
# Dev deploy: build the release tarball and install it on a router over SSH.
#   scripts/deploy.sh [root@host]
# Backs up the configs Dawnline touches to /root/dawnline-predeploy-<ts>/ first.
set -euo pipefail

HOST="${1:-root@outline.lan}"
TAR="$("$(dirname "$0")/build-release.sh" | tail -n1)"

scp -q "$TAR" "$HOST:/tmp/luci-app-dawnline.tar.gz"
ssh "$HOST" sh <<'REMOTE'
set -e
ts="$(date +%Y%m%d-%H%M%S)"
mkdir -p "/root/dawnline-predeploy-$ts"
for c in network firewall dhcp dawnline; do
	[ -f "/etc/config/$c" ] && cp "/etc/config/$c" "/root/dawnline-predeploy-$ts/$c"
done
# Keep only the five most recent pre-deploy backups.
ls -d /root/dawnline-predeploy-* 2>/dev/null | sort | head -n -5 | xargs -r rm -rf
tar -xozf /tmp/luci-app-dawnline.tar.gz -C /
rm -f /tmp/luci-app-dawnline.tar.gz
sh /etc/uci-defaults/90_dawnline && rm -f /etc/uci-defaults/90_dawnline
for f in /etc/uci-defaults/luci-i18n-dawnline-*; do
	if [ -f "$f" ]; then sh "$f" && rm -f "$f"; fi
done
# LuCI reads a language's catalogs once per web server: the new ones need a fresh one.
/etc/init.d/uhttpd restart
sleep 1
ubus list luci.dawnline >/dev/null && echo "luci.dawnline registered (backup: /root/dawnline-predeploy-$ts)"
REMOTE
