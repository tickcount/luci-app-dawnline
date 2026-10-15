#!/bin/sh
# shellcheck shell=dash
#
# Dawnline uninstaller for OpenWrt.
#
#   sh -c "$(wget -qO- https://raw.githubusercontent.com/tickcount/luci-app-dawnline/main/uninstall.sh)"
#
# Backs up the configuration, runs Dawnline's own removal (the same as
# Settings → Remove Dawnline from this router: tunnels, firewall rules, portal,
# routing and the home-like link go away), removes the package and cleans what
# is left. AmneziaWG stays unless --remove-awg is given. `--help` lists the
# options.

UNINSTALLER_VERSION="1.0.0"
PKG_NAME="luci-app-dawnline"
# Removal order: LuCI pieces first, the kernel module last.
AWG_PKGS="luci-i18n-amneziawg-ru luci-proto-amneziawg amneziawg-tools kmod-amneziawg"

LOG_FILE="/tmp/dawnline-uninstall.log"
LOCK_DIR="/tmp/dawnline.install.lock.d"
DATA_DIR="/etc/dawnline"
BACKUP_DIR="$DATA_DIR/backups"

ASSUME_YES=0
PURGE=0
REMOVE_AWG=0
DRY_RUN=0
VERBOSE=0

LOG_READY=0
LOCK_HELD=0
TMP_DIR=""
PKG_MANAGER=""
PKG_IS_APK=0
STEP=0
STEPS=6
BACKUP_PATH=""
FAILED=0
_STREAM_PID=""
_STREAM_STOP=""

ESC="$(printf '\033')"
if [ -t 1 ] 2>/dev/null && [ "${TERM:-dumb}" != "dumb" ]; then
	C_RESET="${ESC}[0m"
	C_BOLD="${ESC}[1m"
	C_RED="${ESC}[31;1m"
	C_GREEN="${ESC}[32;1m"
	C_YELLOW="${ESC}[33;1m"
	C_CYAN="${ESC}[36;1m"
else
	C_RESET=""
	C_BOLD=""
	C_RED=""
	C_GREEN=""
	C_YELLOW=""
	C_CYAN=""
fi

START_TS="$(date +%s 2>/dev/null || echo 0)"

# ---------- output ----------

ts_elapsed() {
	_now="$(date +%s 2>/dev/null || echo "$START_TS")"
	_el=$((_now - START_TS))
	[ "$_el" -ge 0 ] 2>/dev/null || _el=0
	printf '+%02d:%02d' $((_el / 60)) $((_el % 60))
}

log_line() {
	[ "$LOG_READY" -eq 1 ] || return 0
	printf '[%s %s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S' 2>/dev/null)" "$(ts_elapsed)" "$1" >>"$LOG_FILE" 2>/dev/null || true
}

msg() {
	log_line "INFO  $1"
	printf '  [%s] %s%s%s\n' "$(ts_elapsed)" "$C_CYAN" "$1" "$C_RESET"
}

ok() {
	log_line "OK    $1"
	printf '  [%s] %s%s✓%s %s\n' "$(ts_elapsed)" "$C_GREEN" "$C_BOLD" "$C_RESET" "$1"
}

warn() {
	log_line "WARN  $1"
	printf '  [%s] %s%s⚠%s %s\n' "$(ts_elapsed)" "$C_YELLOW" "$C_BOLD" "$C_RESET" "$1" >&2
}

err() {
	log_line "ERROR $1"
	printf '  [%s] %s%s✗%s %s\n' "$(ts_elapsed)" "$C_RED" "$C_BOLD" "$C_RESET" "$1" >&2
}

debug() {
	log_line "DEBUG $1"
	[ "$VERBOSE" -eq 1 ] || return 0
	printf '  [%s] [debug] %s\n' "$(ts_elapsed)" "$1" >&2
}

dry() {
	msg "[dry-run] would $1"
}

step() {
	STEP=$((STEP + 1))
	log_line "STEP  [$STEP/$STEPS] $1"
	printf '  [%s] %s[%s/%s] %s%s\n' "$(ts_elapsed)" "$C_BOLD" "$STEP" "$STEPS" "$1" "$C_RESET"
}

fail() {
	err "$1"
	[ "$LOG_READY" -eq 1 ] && err "Uninstaller log: $LOG_FILE"
	exit 1
}

usage() {
	cat <<EOF
Dawnline Uninstaller v${UNINSTALLER_VERSION}

Usage: sh uninstall.sh [options]

  -y, --yes          Do not ask for confirmation
  -p, --purge        Also delete the configuration, keys, history and every
                     backup (/etc/config/dawnline, /etc/dawnline). No backup is made.
      --keep-awg     Keep AmneziaWG (the default: other tunnels may use it)
      --remove-awg   Also remove AmneziaWG, unless another interface still uses it
  -n, --dry-run      Show what would be removed; change nothing
  -v, --verbose      Print diagnostics
      --version      Print the uninstaller version
  -h, --help         Show this help

Without --purge a backup of the configuration is kept in $BACKUP_DIR:
after installing Dawnline again, restore it in Dawnline → Settings → Backups.

Log: $LOG_FILE
EOF
}

parse_args() {
	while [ "$#" -gt 0 ]; do
		case "$1" in
		-y | --yes) ASSUME_YES=1 ;;
		-p | --purge) PURGE=1 ;;
		--keep-awg) REMOVE_AWG=0 ;;
		--remove-awg) REMOVE_AWG=1 ;;
		-n | --dry-run) DRY_RUN=1 ;;
		-v | --verbose) VERBOSE=1 ;;
		--version)
			printf 'dawnline-uninstaller %s\n' "$UNINSTALLER_VERSION"
			exit 0
			;;
		-h | --help)
			usage
			exit 0
			;;
		*)
			err "Unknown option: $1 (see --help)"
			return 2
			;;
		esac
		shift
	done
	return 0
}

# ---------- process plumbing ----------

command_exists() { command -v "$1" >/dev/null 2>&1; }

acquire_lock() {
	if mkdir "$LOCK_DIR" 2>/dev/null; then
		echo "$$" >"$LOCK_DIR/pid"
		LOCK_HELD=1
		return 0
	fi
	_old="$(cat "$LOCK_DIR/pid" 2>/dev/null)"
	if [ -n "$_old" ] && kill -0 "$_old" 2>/dev/null; then
		err "Another Dawnline installer or uninstaller is running (pid $_old)"
		return 1
	fi
	warn "Removing a stale installer lock${_old:+ (pid $_old)}"
	rm -rf "$LOCK_DIR" 2>/dev/null
	mkdir "$LOCK_DIR" 2>/dev/null || {
		err "Cannot create the lock $LOCK_DIR"
		return 1
	}
	echo "$$" >"$LOCK_DIR/pid"
	LOCK_HELD=1
}

release_lock() {
	[ "$LOCK_HELD" -eq 1 ] || return 0
	[ "$(cat "$LOCK_DIR/pid" 2>/dev/null)" = "$$" ] && rm -rf "$LOCK_DIR" 2>/dev/null
	LOCK_HELD=0
}

_NL='
'

_stream_poll() {
	_ssize="$(wc -c <"$_sf" 2>/dev/null | tr -d " ")"
	case "$_ssize" in '' | *[!0-9]*) _ssize=0 ;; esac
	[ "$_ssize" -gt "$_spos" ] || return 0
	_sbuf="$_sbuf$(tail -c +$((_spos + 1)) "$_sf" 2>/dev/null)$_NL"
	_spos="$_ssize"
	case "$(tail -c 1 "$_sf" 2>/dev/null)" in
	'') ;;
	*) _sbuf="${_sbuf%"$_NL"}" ;;
	esac
	while :; do
		case "$_sbuf" in
		*"$_NL"*) ;;
		*) break ;;
		esac
		_sline="${_sbuf%%"$_NL"*}"
		_sbuf="${_sbuf#*"$_NL"}"
		[ -n "$_sline" ] && printf '  [%s] [%s] %s\n' "$(ts_elapsed)" "$_stag" "$_sline"
	done
	return 0
}

_stream_loop() {
	_sf="$1"
	_stag="$2"
	_sstop="$3"
	_sparent="$4"
	_spos=0
	_sbuf=""
	_sidle=0
	while :; do
		[ -e "$_sstop" ] && break
		kill -0 "$_sparent" 2>/dev/null || break
		_spre="$_spos"
		_stream_poll
		if [ "$_spos" -eq "$_spre" ]; then
			_sidle=$((_sidle + 1))
			[ $((_sidle % 10)) -eq 0 ] && printf '  [%s] [%s] … still running (%ss)\n' "$(ts_elapsed)" "$_stag" "$_sidle"
		else
			_sidle=0
		fi
		sleep 1
	done
	_stream_poll
	[ -n "$_sbuf" ] && printf '  [%s] [%s] %s\n' "$(ts_elapsed)" "$_stag" "$_sbuf"
	return 0
}

stream_stop() {
	[ -n "$_STREAM_PID" ] || return 0
	: >"$_STREAM_STOP" 2>/dev/null
	wait "$_STREAM_PID" 2>/dev/null
	_STREAM_PID=""
	rm -f "$_STREAM_STOP" 2>/dev/null
	return 0
}

# run_logged TAG COMMAND...: foreground, output streamed and kept in the log.
run_logged() {
	_tag="$1"
	shift
	_out="$TMP_DIR/cmd.$$.out"
	log_line "EXEC  [$_tag] $*"
	: >"$_out"
	_STREAM_STOP="$_out.stop"
	rm -f "$_STREAM_STOP"
	_stream_loop "$_out" "$_tag" "$_STREAM_STOP" "$$" &
	_STREAM_PID=$!
	"$@" >"$_out" 2>&1 </dev/null
	_rc=$?
	stream_stop
	if [ -s "$_out" ]; then
		while IFS= read -r _line || [ -n "$_line" ]; do
			log_line "  [$_tag] $_line"
		done <"$_out"
	fi
	log_line "EXIT  [$_tag] $_rc"
	cp "$_out" "$TMP_DIR/last.out" 2>/dev/null
	rm -f "$_out"
	return "$_rc"
}

# act DESCRIPTION TAG COMMAND...: run, or only say it in a dry run.
act() {
	_desc="$1"
	shift
	if [ "$DRY_RUN" -eq 1 ]; then
		dry "$_desc"
		return 0
	fi
	debug "$_desc"
	run_logged "$@"
}

# ---------- packages ----------

detect_package_manager() {
	if command_exists apk; then
		PKG_MANAGER="apk"
		PKG_IS_APK=1
	elif command_exists opkg; then
		PKG_MANAGER="opkg"
		PKG_IS_APK=0
	else
		err "Neither apk nor opkg is available"
		return 1
	fi
}

pkg_is_installed() {
	if [ "$PKG_IS_APK" -eq 1 ]; then
		apk info -e "$1" >/dev/null 2>&1
	else
		opkg status "$1" 2>/dev/null | grep -q '^Status: .* installed'
	fi
}

installed_dawnline_pkgs() {
	_l=""
	pkg_is_installed "$PKG_NAME" && _l="$PKG_NAME"
	if [ "$PKG_IS_APK" -eq 1 ]; then
		_i18n="$(apk info 2>/dev/null | grep '^luci-i18n-dawnline-')"
	else
		_i18n="$(opkg list-installed 'luci-i18n-dawnline-*' 2>/dev/null | awk '{ print $1 }')"
	fi
	# Translations first: they depend on the app.
	for _p in $_i18n; do _l="$_p $_l"; done
	printf '%s' "$_l"
}

pkg_remove() {
	_tag="$1"
	shift
	if [ "$PKG_IS_APK" -eq 1 ]; then
		act "apk del $*" "$_tag" apk del "$@"
	else
		_w=0
		while pidof opkg >/dev/null 2>&1 && [ "$_w" -lt 30 ]; do
			_w=$((_w + 1))
			sleep 1
		done
		act "opkg remove $*" "$_tag" opkg remove "$@"
	fi
}

# ---------- steps ----------

dawnline_present() {
	pkg_is_installed "$PKG_NAME" || [ -e /usr/bin/dawnline ] || [ -e /etc/init.d/dawnline ] ||
		[ -e /etc/config/dawnline ] || [ -d "$DATA_DIR" ]
}

confirm() {
	[ "$ASSUME_YES" -eq 0 ] && [ "$DRY_RUN" -eq 0 ] && [ -t 0 ] || return 0
	printf '  This removes %sDawnline%s from the router: everyone is disconnected, and its\n' "$C_BOLD" "$C_RESET"
	printf '  tunnels, firewall rules, portal and the %s package are removed.\n' "$PKG_NAME"
	if [ "$PURGE" -eq 1 ]; then
		printf '  %s--purge: the configuration, keys, history and every backup are deleted too.%s\n' "$C_RED" "$C_RESET"
		printf '  %sThis cannot be undone.%s\n' "$C_RED" "$C_RESET"
	else
		printf '  A backup of the configuration is kept in %s.\n' "$BACKUP_DIR"
	fi
	if [ "$REMOVE_AWG" -eq 1 ]; then
		printf '  AmneziaWG is removed too, unless another interface still uses it.\n'
	else
		printf '  AmneziaWG stays installed (other tunnels may use it; --remove-awg removes it).\n'
	fi
	printf '\n  Remove Dawnline? [y/N] '
	read -r _answer || _answer=""
	case "$_answer" in
	y | Y | yes | Yes | YES) ;;
	*)
		msg "Cancelled: nothing was changed"
		exit 0
		;;
	esac
}

# An update (by hand or automatic) may be in the middle of opkg/apk: let it
# finish rather than tear the package out from under it. The updater holds
# UPDATE_LOCK for a whole job; once this script has it, no automatic update
# can start until the removal is over.
UPDATE_JOB=/var/run/dawnline/update-job.json
UPDATE_LOCK=/var/run/dawnline/update.lock
update_running() {
	if command_exists flock && [ -e "$UPDATE_LOCK" ]; then
		exec 8>>"$UPDATE_LOCK"
		flock -n 8 && return 1
		return 0
	fi
	[ -f "$UPDATE_JOB" ] || return 1
	grep -q '"state": *"running"' "$UPDATE_JOB" 2>/dev/null || return 1
	_pid="$(sed -n 's/.*"pid": *\([0-9][0-9]*\).*/\1/p' "$UPDATE_JOB" | head -n 1)"
	[ -n "$_pid" ] && [ -d "/proc/$_pid" ]
}

wait_for_update() {
	update_running || return 0
	if [ "$DRY_RUN" -eq 1 ]; then
		warn "An update is running: the removal would wait for it to finish"
		return 0
	fi
	msg "An update is running: waiting for it to finish (up to 5 min)"
	_w=0
	while update_running; do
		[ "$_w" -ge 300 ] && fail "The update is still running after 5 min. Nothing was removed; try again when it finishes"
		sleep 5
		_w=$((_w + 5))
		[ $((_w % 30)) -eq 0 ] && msg "… still updating (${_w}s)"
	done
	ok "The update finished"
}

do_backup() {
	step "Backing up the configuration"
	if [ "$PURGE" -eq 1 ]; then
		warn "--purge: no backup is made"
		return 0
	fi
	if [ ! -f /etc/config/dawnline ]; then
		ok "No /etc/config/dawnline: nothing to back up"
		return 0
	fi
	if [ "$DRY_RUN" -eq 1 ]; then
		dry "save /etc/config/dawnline and Dawnline's data to $BACKUP_DIR"
		return 0
	fi
	_bn=""
	if [ -x /usr/bin/dawnline ]; then
		_bn="$(/usr/bin/dawnline backup --reason pre-remove 2>>"$LOG_FILE")"
		[ -n "$_bn" ] && [ -f "$BACKUP_DIR/$_bn" ] || _bn=""
		[ -n "$_bn" ] || warn "dawnline backup failed; saving the files directly"
	fi
	if [ -z "$_bn" ]; then
		# The same archive format Dawnline makes, so Settings → Backups can restore it.
		_bn="dawnline-$(date +%Y%m%d-%H%M%S)-pre-remove.tar.gz"
		set -- etc/config/dawnline
		for _f in usage.json events.json; do
			[ -f "$DATA_DIR/$_f" ] && set -- "$@" "${DATA_DIR#/}/$_f"
		done
		mkdir -p "$BACKUP_DIR" && chmod 700 "$DATA_DIR" "$BACKUP_DIR" 2>/dev/null
		tar -czf "$BACKUP_DIR/$_bn" -C / "$@" 2>>"$LOG_FILE" || {
			rm -f "$BACKUP_DIR/$_bn"
			fail "The backup failed and nothing was removed (--purge removes without a backup)"
		}
	fi
	chmod 600 "$BACKUP_DIR/$_bn" 2>/dev/null
	BACKUP_PATH="$BACKUP_DIR/$_bn"
	ok "Backup: $BACKUP_PATH"
}

do_teardown() {
	step "Running Dawnline's own removal"
	if ubus list luci.dawnline >/dev/null 2>&1; then
		# The same call as Settings → Remove Dawnline from this router.
		if act "call luci.dawnline uninstall (Settings → Remove Dawnline)" rpc \
			ubus -t 120 call luci.dawnline uninstall '{"confirm":"remove"}'; then
			[ "$DRY_RUN" -eq 1 ] && return 0
			if grep -q '"ok": *true' "$TMP_DIR/last.out" 2>/dev/null; then
				ok "Tunnels, firewall rules, portal and routing removed; service stopped"
				return 0
			fi
		fi
		warn "luci.dawnline uninstall failed: $(sed -n 's/.*"error": *"\(.*\)".*/\1/p' "$TMP_DIR/last.out" 2>/dev/null | head -n 1)"
	fi
	if [ -x /usr/bin/dawnline ]; then
		act "stop the Dawnline service" stop /etc/init.d/dawnline stop
		if act "run 'dawnline teardown'" teardown /usr/bin/dawnline teardown; then
			ok "dawnline teardown removed what Dawnline created"
		else
			warn "dawnline teardown failed: leftovers are cleaned in step 5"
		fi
		act "disable the Dawnline service" disable /etc/init.d/dawnline disable
		return 0
	fi
	if [ -x /etc/init.d/dawnline ]; then
		act "stop and disable the Dawnline service" stop sh -c '/etc/init.d/dawnline stop; /etc/init.d/dawnline disable'
	fi
	warn "/usr/bin/dawnline is missing: leftovers are cleaned in step 5"
}

do_remove_package() {
	step "Removing the package"
	_pkgs="$(installed_dawnline_pkgs)"
	if [ -z "$_pkgs" ]; then
		ok "$PKG_NAME is not installed"
		return 0
	fi
	# shellcheck disable=SC2086
	pkg_remove pkg $_pkgs
	if [ "$DRY_RUN" -eq 0 ] && pkg_is_installed "$PKG_NAME"; then
		err "$PKG_MANAGER could not remove $PKG_NAME (see $LOG_FILE)"
		FAILED=1
		return 0
	fi
	[ "$DRY_RUN" -eq 1 ] || ok "Removed: $_pkgs"
}

do_awg() {
	step "AmneziaWG"
	_have=""
	for _p in $AWG_PKGS; do
		pkg_is_installed "$_p" && _have="$_have $_p"
	done
	_have="${_have# }"
	if [ -z "$_have" ]; then
		ok "AmneziaWG is not installed"
		return 0
	fi
	if [ "$REMOVE_AWG" -eq 0 ]; then
		ok "AmneziaWG kept (other tunnels may use it; --remove-awg removes it)"
		return 0
	fi
	# AmneziaWG interfaces that are not Dawnline's (tagged _dawnline).
	_users=""
	for _i in $(uci -q show network 2>/dev/null | sed -n "s/^network\.\([^.]*\)\.proto='amneziawg'$/\1/p"); do
		[ -n "$(uci -q get "network.$_i._dawnline")" ] || _users="$_users $_i"
	done
	if [ -n "$_users" ]; then
		warn "AmneziaWG kept: still used by interface(s)$_users"
		return 0
	fi
	# shellcheck disable=SC2086
	pkg_remove awg $_have
	if [ "$DRY_RUN" -eq 0 ]; then
		if pkg_is_installed kmod-amneziawg || pkg_is_installed amneziawg-tools; then
			warn "AmneziaWG could not be removed completely (see $LOG_FILE)"
		else
			ok "AmneziaWG removed"
		fi
	fi
}

# Only objects Dawnline names as its own (see "What Dawnline changes" in the
# README); normally `dawnline teardown` has removed all of them already.
clean_network_leftovers() {
	_ifs="$(uci -q show network 2>/dev/null | sed -n "s/^network\.\([^.]*\)\._dawnline=.*/\1/p")"
	_fw="$(uci -q show firewall 2>/dev/null | sed -n 's/^firewall\.\(dawnline[A-Za-z0-9_]*\)=.*/\1/p')"
	_found=0
	if [ -n "$_ifs" ]; then
		_found=1
		for _i in $_ifs; do
			if [ "$DRY_RUN" -eq 1 ]; then
				dry "delete network interface $_i"
			else
				ifdown "$_i" >/dev/null 2>&1
				uci -q delete "network.$_i"
			fi
		done
		[ "$DRY_RUN" -eq 1 ] || {
			uci -q commit network
			ubus call network reload >/dev/null 2>&1
		}
		[ "$DRY_RUN" -eq 1 ] || ok "Removed leftover tunnel interfaces: $(echo "$_ifs" | tr '\n' ' ')"
	fi
	if [ -n "$_fw" ]; then
		_found=1
		if [ "$DRY_RUN" -eq 1 ]; then
			dry "delete firewall sections: $(echo "$_fw" | tr '\n' ' ')"
		else
			for _s in $_fw; do uci -q delete "firewall.$_s"; done
			uci -q commit firewall
			/etc/init.d/firewall reload >/dev/null 2>&1
			ok "Removed leftover firewall sections: $(echo "$_fw" | tr '\n' ' ')"
		fi
	fi
	if command_exists nft && nft list table inet dawnline >/dev/null 2>&1; then
		_found=1
		if [ "$DRY_RUN" -eq 1 ]; then
			dry "delete the nft table inet dawnline"
		else
			nft delete table inet dawnline 2>/dev/null
			ok "Removed the nft table inet dawnline"
		fi
	fi
	if [ -e /var/run/netns/dawnline ] || ip link show dlx0 >/dev/null 2>&1 || ip link show dll0 >/dev/null 2>&1; then
		_found=1
		if [ "$DRY_RUN" -eq 1 ]; then
			dry "delete the dawnline network namespace and its veth links"
		else
			ip link del dlx0 >/dev/null 2>&1
			ip link del dll0 >/dev/null 2>&1
			ip netns del dawnline >/dev/null 2>&1 || rm -f /var/run/netns/dawnline
			ok "Removed the dawnline network namespace (policy rules left behind go away on reboot)"
		fi
	fi
	clean_routing_leftovers "$_ifs" && _found=1
	[ "$_found" -eq 1 ] || ok "No tunnel, firewall, nft or routing leftovers"
}

# Dawnline's policy rules: priority 90 sends the portal's and the tunnels'
# answers by the main table; 5200-5299 are the "like a home device" loop for a
# tunnel interface (Dawnline's, or one already gone), with tables 2077-2176.
clean_routing_leftovers() {
	_ours=" $(echo "$1" | tr '\n' ' ') "
	_rules=""
	for _fam in -4 -6; do
		_r="$(ip "$_fam" rule show 2>/dev/null | awk -v fam="$_fam" -v ours="$_ours" '
			{ pr = $1; sub(/:$/, "", pr); pr += 0; line = $0; sub(/^[0-9]+:[ \t]*/, "", line) }
			pr == 90 && line ~ /ipproto (tcp|udp) sport [0-9]+ lookup main/ { print fam "|" pr "|" line; next }
			pr >= 5200 && pr < 5300 && fam == "-4" && match(line, /iif [^ ]+/) {
				dev = substr(line, RSTART + 4, RLENGTH - 4)
				if (line ~ /\[detached\]/ || index(ours, " " dev " ")) print fam "|" pr "|" line
			}')"
		[ -n "$_r" ] && _rules="$_rules$_r
"
	done
	_rules="$(printf '%s' "$_rules" | sed '/^$/d')"
	[ -n "$_rules" ] || return 1
	_tables="$(printf '%s\n' "$_rules" | awk '{ t = $NF + 0; if ($(NF - 1) == "lookup" && t >= 2077 && t < 2177) print t }' | sort -u)"
	if [ "$DRY_RUN" -eq 1 ]; then
		printf '%s\n' "$_rules" | while IFS='|' read -r _f _p _l; do dry "delete ip $_f rule $_p: $_l"; done
		for _t in $_tables; do dry "flush route table $_t"; done
		return 0
	fi
	printf '%s\n' "$_rules" | while IFS='|' read -r _f _p _l; do
		# "from all" and "[detached]" are how ip prints a rule, not how it takes one.
		_spec="$(echo "$_l" | sed -e 's/^from all //' -e 's/ \[detached\]//')"
		# shellcheck disable=SC2086  # the rule spec is words for ip
		ip "$_f" rule del priority "$_p" $_spec 2>/dev/null
	done
	for _t in $_tables; do ip -4 route flush table "$_t" 2>/dev/null; done
	ok "Removed $(printf '%s\n' "$_rules" | wc -l | tr -d ' ') leftover routing rule(s)"
	return 0
}

do_leftovers() {
	step "Cleaning up leftovers"
	clean_network_leftovers

	if grep -qs '/usr/libexec/dawnline/' /etc/crontabs/root; then
		if [ "$DRY_RUN" -eq 1 ]; then
			dry "remove Dawnline lines from /etc/crontabs/root"
		else
			sed -i '\#/usr/libexec/dawnline/#d' /etc/crontabs/root
			/etc/init.d/cron restart >/dev/null 2>&1
			ok "Removed the heartbeat cron job"
		fi
	fi

	set -- /var/run/dawnline /var/run/dawnline-dns.pid /var/etc/dawnline-dns.conf \
		/var/etc/dawnline-dns.resolv /var/etc/dawnline-ns.nft /tmp/hosts/dawnline /tmp/dawnline-update \
		/www/cgi-bin/dawnline-portal
	# The package's own files, only once the package manager has let go of them.
	if ! pkg_is_installed "$PKG_NAME"; then
		set -- "$@" /usr/bin/dawnline /usr/libexec/dawnline /usr/share/dawnline /usr/share/ucode/dawnline \
			/etc/init.d/dawnline /etc/hotplug.d/iface/95-dawnline /etc/uci-defaults/90_dawnline \
			/usr/share/rpcd/ucode/luci.dawnline /usr/share/rpcd/acl.d/luci-app-dawnline.json \
			/usr/share/luci/menu.d/luci-app-dawnline.json /www/luci-static/resources/dawnline \
			/www/luci-static/resources/view/dawnline
		for _r in /etc/rc.d/*dawnline; do [ -e "$_r" ] && set -- "$@" "$_r"; done
	fi
	if [ "$PURGE" -eq 1 ]; then
		set -- "$@" "$DATA_DIR" /etc/config/dawnline /etc/config/dawnline-opkg /etc/config/dawnline.apk-new
	fi
	_gone=""
	for _p in "$@"; do
		[ -e "$_p" ] || [ -L "$_p" ] || continue
		_gone="$_gone $_p"
		if [ "$DRY_RUN" -eq 1 ]; then
			dry "delete $_p"
		else
			rm -rf "$_p"
		fi
	done
	if [ -n "$_gone" ] && [ "$DRY_RUN" -eq 0 ]; then
		log_line "INFO  deleted:$_gone"
		case "$_gone" in *"/tmp/hosts/dawnline"*) killall -HUP dnsmasq 2>/dev/null ;; esac
		ok "Removed leftover files ($(echo "$_gone" | wc -w | tr -d ' '))"
	elif [ -z "$_gone" ]; then
		ok "No leftover files"
	fi
	if [ "$PURGE" -eq 1 ] && [ "$DRY_RUN" -eq 0 ]; then
		ok "Configuration, keys, history and backups deleted (--purge)"
	elif [ "$PURGE" -eq 0 ]; then
		_kept=""
		[ -f /etc/config/dawnline ] && _kept="/etc/config/dawnline"
		[ -d "$DATA_DIR" ] && _kept="${_kept:+$_kept and }$DATA_DIR (backups, history)"
		[ -z "$_kept" ] || ok "Kept: $_kept"
	fi

	if [ "$DRY_RUN" -eq 1 ]; then
		dry "clear the LuCI caches"
	else
		rm -f /tmp/luci-indexcache* /var/luci-indexcache* /tmp/luci-modulecache/* 2>/dev/null
		ok "LuCI caches cleared"
	fi
}

do_reload_luci() {
	step "Reloading LuCI"
	_done=""
	for _svc in rpcd uhttpd; do
		[ -x "/etc/init.d/$_svc" ] || continue
		act "restart $_svc" "$_svc" "/etc/init.d/$_svc" restart && _done="${_done:+$_done and }$_svc"
	done
	[ "$DRY_RUN" -eq 1 ] || [ -z "$_done" ] || ok "Restarted $_done (log in to LuCI again if asked)"
	return 0
}

cleanup() {
	trap '' HUP INT TERM
	stream_stop
	[ -n "$TMP_DIR" ] && rm -rf "$TMP_DIR" 2>/dev/null
	release_lock
}

on_hup() { exit 129; }
on_int() { exit 130; }
on_term() { exit 143; }
on_pipe() {
	trap '' PIPE
	exit 141
}

main() {
	trap cleanup EXIT
	trap on_hup HUP
	trap on_int INT
	trap on_term TERM
	trap on_pipe PIPE

	parse_args "$@" || exit 2
	[ "$(id -u 2>/dev/null || echo 1)" = 0 ] || fail "Run the uninstaller as root"
	acquire_lock || exit 1
	: >"$LOG_FILE" 2>/dev/null && chmod 600 "$LOG_FILE" 2>/dev/null && LOG_READY=1
	log_line "INFO  Dawnline Uninstaller $UNINSTALLER_VERSION: $0 $*"
	TMP_DIR="$(mktemp -d /tmp/dawnline-uninstaller.XXXXXX 2>/dev/null)" || TMP_DIR=""
	[ -n "$TMP_DIR" ] || {
		TMP_DIR="/tmp/dawnline-uninstaller.$$"
		mkdir -p "$TMP_DIR" || fail "Cannot create a temporary directory in /tmp"
	}
	detect_package_manager || fail "No supported package manager"

	printf '\n  %s%sDawnline Uninstaller%s v%s\n' "$C_CYAN" "$C_BOLD" "$C_RESET" "$UNINSTALLER_VERSION"
	printf '  Removes Dawnline and everything it set up; AmneziaWG stays unless asked\n\n'
	[ "$DRY_RUN" -eq 1 ] && msg "Dry run: nothing on the router is changed"

	if ! dawnline_present; then
		ok "Dawnline is not installed: nothing to do"
		return 0
	fi
	confirm
	wait_for_update
	# Once started, an SSH drop must not leave the removal half done.
	trap '' HUP

	do_backup
	do_teardown
	do_remove_package
	do_awg
	do_leftovers
	do_reload_luci

	_took=$(($(date +%s 2>/dev/null || echo "$START_TS") - START_TS))
	if [ "$DRY_RUN" -eq 1 ]; then
		ok "Dry run finished in ${_took}s: nothing was changed"
		msg "Log: $LOG_FILE"
		return 0
	fi
	if [ "$FAILED" -eq 1 ]; then
		err "Dawnline was not removed completely in ${_took}s"
	else
		ok "Dawnline removed in ${_took}s"
	fi
	[ -n "$BACKUP_PATH" ] && msg "Backup: $BACKUP_PATH (restore it in Dawnline → Settings → Backups after reinstalling)"
	msg "Log: $LOG_FILE"
	[ "$FAILED" -eq 0 ] || exit 1
}

main "$@"
