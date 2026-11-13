#!/usr/bin/env bash
# Dev deploy: build the release tarball and install it on a router over SSH.
#   scripts/deploy.sh [root@host]
#   PORT=51005 scripts/deploy.sh root@host     when its SSH is not on port 22 (from outside the LAN)
# Backs up the configs Dawnline touches to /root/dawnline-predeploy-<ts>/ first.
set -euo pipefail

HOST="${1:-root@outline.lan}"
# ssh and scp name the port each in its own way
SSH=(ssh ${PORT:+-p "$PORT"})
SCP=(scp ${PORT:+-P "$PORT"})
# The Go backend is built for this router's processor.
BACKEND_ARCH="$("${SSH[@]}" "$HOST" uname -m)"
export BACKEND_ARCH
TAR="$("$(dirname "$0")/build-release.sh" | tail -n1)"

"${SCP[@]}" -q "$TAR" "$HOST:/tmp/luci-app-dawnline.tar.gz"
"${SSH[@]}" "$HOST" sh <<'REMOTE'
set -e
ts="$(date +%Y%m%d-%H%M%S)"
mkdir -p "/root/dawnline-predeploy-$ts"
for c in network firewall dhcp dawnline; do
	[ -f "/etc/config/$c" ] && cp "/etc/config/$c" "/root/dawnline-predeploy-$ts/$c"
done
# Keep only the five most recent pre-deploy backups.
ls -d /root/dawnline-predeploy-* 2>/dev/null | sort | head -n -5 | xargs -r rm -rf
# The backend that runs is the old file: taken out of procd, so the start below runs the new one.
ubus call service delete '{"name":"dawnline","instance":"backend"}' >/dev/null 2>&1 || true
tar -xozf /tmp/luci-app-dawnline.tar.gz -C /
rm -f /tmp/luci-app-dawnline.tar.gz
sh /etc/uci-defaults/90_dawnline && rm -f /etc/uci-defaults/90_dawnline
for f in /etc/uci-defaults/luci-i18n-dawnline-*; do
	if [ -f "$f" ]; then sh "$f" && rm -f "$f"; fi
done
# rpcd reads the access lists once: the backend's object is in the new one.
/etc/init.d/rpcd reload
# The service's instances as the new init script has them (what runs unchanged is left running).
/etc/init.d/dawnline start
# LuCI reads a language's catalogs once per web server: the new ones need a fresh one.
/etc/init.d/uhttpd restart
sleep 1
echo "backup: /root/dawnline-predeploy-$ts"
i=0
while ! ubus list dawnline >/dev/null 2>&1 && [ "$i" -lt 10 ]; do sleep 1; i=$((i + 1)); done
ubus list dawnline >/dev/null 2>&1 && echo "backend: $(ubus call dawnline hello | jsonfilter -e '@.version') · pages follow by $(ubus call dawnline hello | jsonfilter -e '@.stream')"
REMOTE
