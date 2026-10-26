#!/bin/sh
# shellcheck shell=dash
#
# Dawnline installer for OpenWrt 24.10+ (opkg) and 25.12+ (apk).
#
#   sh -c "$(wget -qO- https://raw.githubusercontent.com/tickcount/luci-app-dawnline/main/install.sh)"
#
#   wget -O /tmp/dawnline-install.sh https://raw.githubusercontent.com/tickcount/luci-app-dawnline/main/install.sh
#   sh /tmp/dawnline-install.sh [options] [version]
#
# Installs AmneziaWG built for this firmware when it is missing, then the
# Dawnline package with its dependencies from the OpenWrt feeds, and the admin's
# translation when LuCI speaks that language (--lang). Settings and
# keys survive reinstalls and upgrades. A recovery snapshot of the configs it
# may touch is taken first and restored if anything fails. `--help` lists the
# options.

INSTALLER_VERSION="1.0.0"
REPO="${DAWNLINE_REPO:-tickcount/luci-app-dawnline}"
PKG_NAME="luci-app-dawnline"
AWG_PKGS="kmod-amneziawg amneziawg-tools luci-proto-amneziawg"
# The admin's translations a release has: luci-i18n-dawnline-<lang>.
I18N_LANGS="ru"

CONNECT_TIMEOUT=15
METADATA_TIMEOUT=60
DOWNLOAD_TIMEOUT=300
APK_LOCK_WAIT=120
UBUS_WAIT=15
REQUIRED_OVERLAY_KB=2048
TMP_HEADROOM_KB=4096

LOG_FILE="/tmp/dawnline-install.log"
LOCK_DIR="/tmp/dawnline.install.lock.d"
DATA_DIR="/etc/dawnline"
SNAPSHOT_ROOT="$DATA_DIR/installer-backups"
# Everything Dawnline (or its postinst) may change: restored on failure.
SNAPSHOT_CONFIGS="dawnline network firewall dhcp uhttpd"
MIRRORS="https://ghfast.top/ https://gh-proxy.com/"
UPDATE_JOB="/var/run/dawnline/update-job.json"
UPDATE_LOCK="/var/run/dawnline/update.lock"

ASSUME_YES=0
DRY_RUN=0
VERBOSE=0
QUIET=0
TAG=""
AWG_SOURCE="${DAWNLINE_AWG:-auto}"
I18N_CHOICE="${DAWNLINE_LANG:-auto}"

LOG_READY=0
TMP_DIR=""
LOCK_HELD=0
FETCHER=""
PKG_MANAGER=""
PKG_IS_APK=0
EXT="ipk"
OWRT_RELEASE=""
OWRT_ARCH=""
OWRT_TARGET=""

VERSION=""
ASSET=""
ASSET_BASE=""
DOWNLOAD_BYTES=0
ASSET_FILE=""

WAS_INSTALLED=0
WAS_VERSION=""
WAS_ENABLED=0
WAS_RUNNING=0
MODE="install"

I18N_LANG=""
I18N_PKG=""
I18N_ASSET=""
I18N_FILE=""

AWG_ACTION="keep"
AWG_CANDIDATES=""
AWG_REPO=""
AWG_FILES=""

SNAPSHOT_DIR=""
TX_ACTIVE=0
TX_COMMITTED=0
_STREAM_PID=""
_STREAM_STOP=""
NO_STREAM=0

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
	[ "$QUIET" -eq 1 ] || printf '  [%s] %s%s%s\n' "$(ts_elapsed)" "$C_CYAN" "$1" "$C_RESET"
}

ok() {
	log_line "OK    $1"
	[ "$QUIET" -eq 1 ] || printf '  [%s] %s%s✓%s %s\n' "$(ts_elapsed)" "$C_GREEN" "$C_BOLD" "$C_RESET" "$1"
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

fail() {
	err "$1"
	[ "$LOG_READY" -eq 1 ] && err "Installer log: $LOG_FILE"
	exit 1
}

prompt() {
	printf '  [%s] %s' "$(ts_elapsed)" "$1"
}

banner() {
	[ "$QUIET" -eq 1 ] && return 0
	printf '\n  %s%sDawnline Installer%s v%s\n' "$C_CYAN" "$C_BOLD" "$C_RESET" "$INSTALLER_VERSION"
	printf '  AmneziaWG access server for OpenWrt: install, upgrade, repair\n\n'
}

usage() {
	cat <<EOF
Dawnline Installer v${INSTALLER_VERSION}

Usage: sh install.sh [options] [version]

  -y, --yes             No questions: latest release (or --tag), recommended choices
  -n, --dry-run         Check the system, resolve and verify the release; change nothing
  -v, --verbose         Print diagnostics
  -q, --quiet           Only warnings and errors
      --tag X.Y.Z       Install this release instead of the latest (same as [version])
      --awg SOURCE      Where AmneziaWG comes from when it is missing:
                          auto   Slava-Shchipunov, then 2Grey (default)
                          slava  Slava-Shchipunov/awg-openwrt
                          grey   2Grey/awg-openwrt
                          skip   do not install it (add it later in Dawnline → Components)
      --no-awg          Same as --awg skip
      --lang LANG       The admin's translation (luci-i18n-dawnline-LANG):
                          auto   when LuCI is set to that language or has its
                                 LuCI translation installed (default)
                          ru     Russian
                          none   add none (an installed one is kept up to date)
      --version         Print the installer version
  -h, --help            Show this help

Environment:
  DAWNLINE_REPO=owner/name       GitHub repository with the releases ($REPO)
  DAWNLINE_AWG=SOURCE            Same as --awg (the option wins)
  DAWNLINE_LANG=LANG             Same as --lang (the option wins)
  DAWNLINE_SNAPSHOT_KEEP=N       Recovery snapshots to keep (default 3)

Log: $LOG_FILE
EOF
}

# ---------- arguments ----------

set_tag() {
	_t="${1#v}"
	case "$_t" in
	'' | *[!0-9.]* | *.*.*.* | .* | *. | *..*)
		err "Invalid version: $1 (expected X.Y.Z)"
		return 1
		;;
	*.*.*) TAG="$_t" ;;
	*)
		err "Invalid version: $1 (expected X.Y.Z)"
		return 1
		;;
	esac
}

set_awg() {
	case "$1" in
	auto | slava | grey | skip) AWG_SOURCE="$1" ;;
	*)
		err "Unknown AmneziaWG source: $1 (auto, slava, grey or skip)"
		return 1
		;;
	esac
}

set_lang() {
	for _l in auto none $I18N_LANGS; do
		[ "$1" = "$_l" ] && {
			I18N_CHOICE="$1"
			return 0
		}
	done
	err "Unknown language: $1 (auto, none or one of: $I18N_LANGS)"
	return 1
}

parse_args() {
	while [ "$#" -gt 0 ]; do
		case "$1" in
		-y | --yes) ASSUME_YES=1 ;;
		-n | --dry-run) DRY_RUN=1 ;;
		-v | --verbose) VERBOSE=1 ;;
		-q | --quiet) QUIET=1 ;;
		--tag)
			[ "$#" -gt 1 ] || {
				err "--tag needs a version (X.Y.Z)"
				return 2
			}
			shift
			set_tag "$1" || return 2
			;;
		--tag=*) set_tag "${1#*=}" || return 2 ;;
		--awg)
			[ "$#" -gt 1 ] || {
				err "--awg needs a source (auto, slava, grey or skip)"
				return 2
			}
			shift
			set_awg "$1" || return 2
			;;
		--awg=*) set_awg "${1#*=}" || return 2 ;;
		--no-awg) AWG_SOURCE="skip" ;;
		--lang)
			[ "$#" -gt 1 ] || {
				err "--lang needs a language (auto, none or one of: $I18N_LANGS)"
				return 2
			}
			shift
			set_lang "$1" || return 2
			;;
		--lang=*) set_lang "${1#*=}" || return 2 ;;
		--version)
			printf 'dawnline-installer %s\n' "$INSTALLER_VERSION"
			exit 0
			;;
		-h | --help)
			usage
			exit 0
			;;
		[0-9]* | v[0-9]*)
			# The positional form of earlier installers: sh install.sh 0.3.2
			[ -z "$TAG" ] || {
				err "Two versions given: $TAG and $1"
				return 2
			}
			set_tag "$1" || return 2
			;;
		*)
			err "Unknown option: $1 (see --help)"
			return 2
			;;
		esac
		shift
	done
	if [ "$VERBOSE" -eq 1 ] && [ "$QUIET" -eq 1 ]; then
		err "--verbose and --quiet cannot be used together"
		return 2
	fi
	set_awg "$AWG_SOURCE" || return 2
	set_lang "$I18N_CHOICE" || return 2
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

init_tmp_dir() {
	TMP_DIR="$(mktemp -d /tmp/dawnline-installer.XXXXXX 2>/dev/null)"
	if [ -z "$TMP_DIR" ]; then
		TMP_DIR="/tmp/dawnline-installer.$$"
		mkdir -p "$TMP_DIR" || return 1
	fi
	chmod 700 "$TMP_DIR" 2>/dev/null
	return 0
}

# Command output streamed to the console as it arrives ("[tag] line"), with a
# heartbeat while a command is silent; the log gets the whole output after.
_NL='
'

_stream_poll() {
	_ssize="$(wc -c <"$_sf" 2>/dev/null | tr -d " ")"
	case "$_ssize" in '' | *[!0-9]*) _ssize=0 ;; esac
	[ "$_ssize" -gt "$_spos" ] || return 0
	_sbuf="$_sbuf$(tail -c +$((_spos + 1)) "$_sf" 2>/dev/null)$_NL"
	# tail through $(…) drops the trailing newline: put it back, then hold
	# back a last line that is still being written.
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

stream_start() {
	[ "$QUIET" -eq 1 ] || [ "$NO_STREAM" -eq 1 ] && return 0
	_STREAM_STOP="$1.stop"
	rm -f "$_STREAM_STOP"
	_stream_loop "$1" "$2" "$_STREAM_STOP" "$$" &
	_STREAM_PID=$!
}

stream_stop() {
	[ -n "$_STREAM_PID" ] || return 0
	: >"$_STREAM_STOP" 2>/dev/null
	wait "$_STREAM_PID" 2>/dev/null
	_STREAM_PID=""
	rm -f "$_STREAM_STOP" 2>/dev/null
	return 0
}

# run_logged TAG COMMAND...: runs in the foreground (Ctrl-C reaches it),
# streams its output and keeps a full copy in the log.
run_logged() {
	_tag="$1"
	shift
	_out="$TMP_DIR/cmd.$$.out"
	log_line "EXEC  [$_tag] $*"
	: >"$_out"
	stream_start "$_out" "$_tag"
	"$@" >"$_out" 2>&1 </dev/null
	_rc=$?
	stream_stop
	if [ -s "$_out" ]; then
		while IFS= read -r _line || [ -n "$_line" ]; do
			log_line "  [$_tag] $_line"
		done <"$_out"
	fi
	log_line "EXIT  [$_tag] $_rc"
	if [ "$_rc" -ne 0 ] && [ "$QUIET" -eq 1 ] && [ -s "$_out" ]; then
		tail -n 20 "$_out" | sed "s/^/  [$_tag] /" >&2
	fi
	rm -f "$_out"
	return "$_rc"
}

# ---------- environment ----------

detect_fetcher() {
	for _f in curl wget uclient-fetch; do
		if command_exists "$_f"; then
			FETCHER="$_f"
			debug "Downloads with $FETCHER"
			return 0
		fi
	done
	err "curl, wget or uclient-fetch is required"
	return 1
}

detect_package_manager() {
	if command_exists apk; then
		PKG_MANAGER="apk"
		PKG_IS_APK=1
		EXT="apk"
	elif command_exists opkg; then
		PKG_MANAGER="opkg"
		PKG_IS_APK=0
		EXT="ipk"
	else
		err "Neither apk nor opkg is available"
		return 1
	fi
	debug "Package manager: $PKG_MANAGER (.$EXT)"
}

check_tools() {
	_missing=""
	for _t in jsonfilter sha256sum tar ubus uci; do
		command_exists "$_t" || _missing="$_missing $_t"
	done
	[ -z "$_missing" ] && return 0
	err "Missing tools:$_missing"
	return 1
}

# ---------- downloads ----------

# fetch_once URL FILE [SECONDS] [ACCEPT]
fetch_once() {
	_fu="$1"
	_fd="$2"
	_ft="${3:-$DOWNLOAD_TIMEOUT}"
	_fa="${4:-}"
	rm -f "$_fd"
	case "$FETCHER" in
	curl)
		run_logged download curl -fsSL --connect-timeout "$CONNECT_TIMEOUT" --max-time "$_ft" \
			--speed-limit 1024 --speed-time 30 ${_fa:+-H "Accept: $_fa"} -o "$_fd" "$_fu"
		;;
	*) run_logged download "$FETCHER" -q -T "$CONNECT_TIMEOUT" ${_fa:+--header="Accept: $_fa"} -O "$_fd" "$_fu" ;;
	esac
	_frc=$?
	[ "$_frc" -eq 0 ] && [ -s "$_fd" ] && return 0
	rm -f "$_fd"
	return 1
}

host_of() {
	printf '%s' "$1" | sed 's#^[a-z]*://\([^/]*\).*#\1#'
}

# Release metadata from the GitHub API (log only, no console noise for a
# 404). Only ever asked directly: the checksums it carries are what makes a
# file from a mirror trustworthy.
fetch_meta() {
	debug "GET $1"
	NO_STREAM=1
	fetch_once "$1" "$2" "$METADATA_TIMEOUT" || {
		sleep 2
		fetch_once "$1" "$2" "$METADATA_TIMEOUT"
	}
	_frc=$?
	NO_STREAM=0
	return "$_frc"
}

# The sha256 GitHub publishes for a release file, from release JSON (empty if unknown).
asset_digest() {
	[ -s "$1" ] || return 0
	jsonfilter -i "$1" -e "@.assets[@.name='$2'].digest" 2>/dev/null | head -n 1 | sed -n 's/^sha256:\([0-9a-f]\{64\}\)$/\1/p'
}

# A release file's URL in the GitHub API, from release JSON (empty if unknown).
# Asked for application/octet-stream, it answers with the file itself.
asset_api_url() {
	[ -s "$1" ] || return 0
	jsonfilter -i "$1" -e "@.assets[@.name='$2'].url" 2>/dev/null | head -n 1 |
		sed -n 's#^\(https://api\.github\.com/repos/[^/]*/[^/]*/releases/assets/[0-9][0-9]*\)$#\1#p'
}

# download URL FILE LABEL [SHA256] [API_URL]: without curl the API's URL
# first (github.com's redirect carries a Content-Security-Policy header that
# can outgrow uclient-fetch's 4 KB line buffer, and it stalls there), then
# direct, then (only when the sha256 is known) two mirrors, then direct again.
# A file whose sha256 doesn't match is thrown away and the next source is
# tried; without a sha256 only GitHub itself is used.
download() {
	_du="$1"
	_dd="$2"
	_dl="$3"
	_dw="${4:-}"
	_da="${5:-}"
	[ "$FETCHER" != curl ] || _da=""
	set -- "$_du"
	[ -z "$_da" ] || set -- "$_da" "$_du"
	if [ -n "$_dw" ]; then
		for _m in $MIRRORS; do set -- "$@" "$_m$_du"; done
	fi
	set -- "$@" "$_du"
	_n=0
	_total=$#
	for _try in "$@"; do
		_n=$((_n + 1))
		if [ "$_n" -eq 1 ]; then
			msg "Downloading $_dl"
		else
			sleep 2
			msg "Downloading $_dl via $(host_of "$_try") (attempt $_n/$_total)"
		fi
		_acc=""
		[ "$_try" != "$_da" ] || _acc="application/octet-stream"
		if fetch_once "$_try" "$_dd" "" "$_acc"; then
			if [ -n "$_dw" ] && [ "$(sha256sum "$_dd" 2>/dev/null | awk '{ print $1 }')" != "$_dw" ]; then
				warn "$(host_of "$_try") sent a file that doesn't match GitHub's sha256: discarded"
				rm -f "$_dd"
				continue
			fi
			_kb=$((($(wc -c <"$_dd") + 1023) / 1024))
			debug "$_dl: $_kb KB from $(host_of "$_try")"
			return 0
		fi
	done
	return 1
}

verify_archive() {
	_af="$1"
	_an="$(basename "$_af")"
	_sz="$(wc -c <"$_af" 2>/dev/null | tr -d " ")"
	case "$_sz" in "" | *[!0-9]*) _sz=0 ;; esac
	[ "$_sz" -gt 1024 ] || {
		err "$_an is suspiciously small ($_sz bytes)"
		return 1
	}
	_magic="$(head -c 4 "$_af" 2>/dev/null)"
	case "$_magic" in
	'!<ar' | ADB*) return 0 ;;
	esac
	tar -tzf "$_af" >/dev/null 2>&1 && return 0
	err "$_an is not a valid .$EXT package"
	return 1
}

free_kb() {
	df -Pk "$1" 2>/dev/null | awk 'NR == 2 { print $4 }'
}

# ---------- packages ----------

pkg_is_installed() {
	if [ "$PKG_IS_APK" -eq 1 ]; then
		apk info -e "$1" >/dev/null 2>&1
	else
		opkg status "$1" 2>/dev/null | grep -q '^Status: .* installed'
	fi
}

# Installed version without the -rN release suffix.
pkg_version() {
	if [ "$PKG_IS_APK" -eq 1 ]; then
		_pv="$(apk list --installed "$1" 2>/dev/null | sed -n "s/^$1-\([^ ]*\) .*/\1/p" | head -n 1)"
	else
		_pv="$(opkg status "$1" 2>/dev/null | sed -n 's/^Version: *//p' | head -n 1)"
	fi
	printf '%s' "${_pv%-r*}"
}

# Succeeds when version $1 >= $2 (X.Y.Z, numeric per part).
version_ge() {
	_va="${1#v}"
	_vb="${2#v}"
	_i=0
	while [ "$_i" -lt 3 ]; do
		_pa="${_va%%.*}"
		_pb="${_vb%%.*}"
		[ "$_pa" = "$_va" ] && _va="" || _va="${_va#*.}"
		[ "$_pb" = "$_vb" ] && _vb="" || _vb="${_vb#*.}"
		case "$_pa" in '' | *[!0-9]*) _pa=0 ;; esac
		case "$_pb" in '' | *[!0-9]*) _pb=0 ;; esac
		[ "$_pa" -gt "$_pb" ] && return 0
		[ "$_pa" -lt "$_pb" ] && return 1
		_i=$((_i + 1))
	done
	return 0
}

wait_opkg_lock() {
	[ "$PKG_IS_APK" -eq 0 ] || return 0
	_w=0
	while pidof opkg >/dev/null 2>&1; do
		[ "$_w" -eq 0 ] && msg "Waiting for another opkg to finish"
		_w=$((_w + 1))
		[ "$_w" -ge 60 ] && {
			warn "opkg is still busy after 60s"
			return 0
		}
		sleep 1
	done
	return 0
}

apk_cmd() {
	_tag="$1"
	shift
	if apk --help 2>&1 | grep -q -- '--wait'; then
		run_logged "$_tag" apk --wait "$APK_LOCK_WAIT" "$@"
	else
		run_logged "$_tag" apk "$@"
	fi
}

pkg_refresh() {
	if [ "$DRY_RUN" -eq 1 ]; then
		dry "refresh the $PKG_MANAGER package lists"
		return 0
	fi
	msg "Refreshing $PKG_MANAGER package lists"
	if [ "$PKG_IS_APK" -eq 1 ]; then
		apk_cmd apk-update update
	else
		wait_opkg_lock
		run_logged opkg-update opkg update
	fi
}

# pkg_install_files TAG FORCE FILE...: FORCE=1 reinstalls the same version or
# goes back to an older one (opkg; apk takes a given file as it is).
pkg_install_files() {
	_tag="$1"
	_force="$2"
	shift 2
	if [ "$PKG_IS_APK" -eq 1 ]; then
		# Packages from GitHub releases are not signed with the feed key.
		apk_cmd "$_tag" add --allow-untrusted "$@"
	else
		wait_opkg_lock
		if [ "$_force" -eq 1 ]; then
			run_logged "$_tag" opkg install --force-reinstall --force-downgrade "$@"
		else
			run_logged "$_tag" opkg install "$@"
		fi
	fi
}

# ---------- checks ----------

sync_time() {
	_year="$(date +%Y 2>/dev/null)"
	case "$_year" in '' | *[!0-9]*) _year=0 ;; esac
	[ "$_year" -ge 2024 ] && return 0
	warn "The system clock is wrong ($(date 2>/dev/null)); HTTPS needs the right time"
	if [ "$DRY_RUN" -eq 1 ]; then
		dry "set the clock with ntpd"
		return 0
	fi
	if command_exists ntpd; then
		msg "Setting the clock with ntpd (up to 20s)"
		# ntpd -q waits for an answer for as long as it takes: bound it.
		ntpd -n -q -p 216.239.35.0 -p 162.159.200.1 -p 216.239.35.4 >>"$LOG_FILE" 2>&1 &
		_np=$!
		_i=0
		while kill -0 "$_np" 2>/dev/null && [ "$_i" -lt 20 ]; do
			sleep 1
			_i=$((_i + 1))
		done
		kill "$_np" 2>/dev/null
		wait "$_np" 2>/dev/null
	fi
	_year="$(date +%Y 2>/dev/null)"
	case "$_year" in '' | *[!0-9]*) _year=0 ;; esac
	if [ "$_year" -ge 2024 ]; then
		ok "Clock set: $(date 2>/dev/null)"
	else
		warn "The clock is still wrong: downloads may fail (set it in System → System → Sync with NTP server)"
	fi
}

check_system() {
	msg "Checking system requirements"
	[ -r /etc/openwrt_release ] || {
		err "This installer supports OpenWrt only"
		return 1
	}
	# shellcheck disable=SC1091
	. /etc/openwrt_release
	OWRT_RELEASE="${DISTRIB_RELEASE:-}"
	OWRT_ARCH="${DISTRIB_ARCH:-}"
	OWRT_TARGET="${DISTRIB_TARGET:-}"
	_major="${OWRT_RELEASE%%.*}"
	case "$_major" in
	'' | *[!0-9]*)
		warn "OpenWrt ${OWRT_RELEASE:-?} is a snapshot or unknown release: continuing"
		;;
	*)
		[ "$_major" -ge 24 ] || {
			err "Dawnline needs OpenWrt 24.10 or newer (this is $OWRT_RELEASE)"
			return 1
		}
		;;
	esac
	ok "OpenWrt $OWRT_RELEASE · $OWRT_TARGET · $OWRT_ARCH · $PKG_MANAGER"

	_overlay="$(free_kb /overlay)"
	[ -n "$_overlay" ] || _overlay="$(free_kb /)"
	if [ -n "$_overlay" ]; then
		[ "$_overlay" -ge "$REQUIRED_OVERLAY_KB" ] || {
			err "Not enough flash: $((_overlay / 1024)) MiB free, $((REQUIRED_OVERLAY_KB / 1024)) MiB needed"
			return 1
		}
		debug "Flash: $((_overlay / 1024)) MiB free"
	fi

	# The in-app updater (Dawnline → Components) uses the same package manager.
	# The updater holds this lock for a whole job; holding it here keeps an
	# automatic update from starting while the installer works.
	if command_exists flock && mkdir -p /var/run/dawnline 2>/dev/null; then
		exec 8>>"$UPDATE_LOCK"
		flock -n 8 || {
			err "An update started from Dawnline → Components is running: wait for it to finish"
			return 1
		}
	elif [ -r "$UPDATE_JOB" ]; then
		_js="$(jsonfilter -i "$UPDATE_JOB" -e '@.state' 2>/dev/null)"
		_jp="$(jsonfilter -i "$UPDATE_JOB" -e '@.pid' 2>/dev/null)"
		if [ "$_js" = running ] && [ -n "$_jp" ] && kill -0 "$_jp" 2>/dev/null; then
			err "An update started from Dawnline → Components is running (pid $_jp): wait for it to finish"
			return 1
		fi
	fi
}

check_dns() {
	command_exists nslookup || return 0
	nslookup github.com >/dev/null 2>&1 && return 0
	err "github.com does not resolve: DNS on the router does not work"
	err "Check the WAN link, or point dnsmasq at a reachable resolver"
	err "(Network → DHCP and DNS → Forwards, e.g. 1.1.1.1), then run the installer again."
	return 1
}

record_state() {
	pkg_is_installed "$PKG_NAME" && WAS_INSTALLED=1
	[ "$WAS_INSTALLED" -eq 1 ] || return 0
	WAS_VERSION="$(pkg_version "$PKG_NAME")"
	ls /etc/rc.d/S*dawnline >/dev/null 2>&1 && WAS_ENABLED=1
	_r="$(ubus call service list '{"name":"dawnline"}' 2>/dev/null | jsonfilter -q -e '@.dawnline.instances.agent.running' 2>/dev/null)"
	[ "$_r" = true ] && WAS_RUNNING=1
	debug "Installed: $WAS_VERSION, enabled=$WAS_ENABLED, running=$WAS_RUNNING"
}

# ---------- release ----------

is_interactive() {
	[ "$ASSUME_YES" -eq 0 ] && [ -t 0 ]
}

valid_version() {
	printf '%s\n' "$1" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+$'
}

select_release() {
	[ -z "$TAG" ] || return 0
	is_interactive || return 0
	msg "Fetching the release list"
	_rl="$TMP_DIR/releases.json"
	fetch_meta "https://api.github.com/repos/$REPO/releases?per_page=30" "$_rl" || {
		warn "The release list is not available; using the latest release"
		return 0
	}
	_tags="$(jsonfilter -i "$_rl" -e '@[@.draft=false && @.prerelease=false].tag_name' 2>/dev/null)"
	[ -n "$_tags" ] || _tags="$(jsonfilter -i "$_rl" -e '@[*].tag_name' 2>/dev/null)"
	# Newest first. BusyBox sort ignores -t/-k numeric keys here (falls back to
	# an ascending string sort), so pad each part and reverse-sort as strings.
	_tags="$(printf '%s\n' "$_tags" | sed 's/^v//' | grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' |
		awk -F. '{ printf "%06d%06d%06d %s\n", $1, $2, $3, $0 }' | sort -r | cut -d' ' -f2 |
		uniq | head -n 10)"
	_count=0
	for _t in $_tags; do _count=$((_count + 1)); done
	[ "$_count" -gt 1 ] || return 0
	[ "$QUIET" -eq 1 ] || printf '\n'
	printf '  Select the Dawnline release:\n'
	_i=1
	for _t in $_tags; do
		_note=""
		[ "$_i" -eq 1 ] && _note=" (recommended)"
		[ "$_t" = "$WAS_VERSION" ] && _note="$_note (installed)"
		printf '    %2d) %s%s\n' "$_i" "$_t" "$_note"
		_i=$((_i + 1))
	done
	printf '\n'
	prompt "Choice [1]: "
	read -r _answer || _answer=""
	case "$_answer" in
	'') _answer=1 ;;
	*[!0-9]*)
		warn "Unknown choice; using the latest release"
		return 0
		;;
	esac
	if [ "$_answer" -lt 1 ] || [ "$_answer" -gt "$_count" ]; then
		warn "Choice out of range; using the latest release"
		return 0
	fi
	_i=1
	for _t in $_tags; do
		[ "$_i" -eq "$_answer" ] && TAG="$_t"
		_i=$((_i + 1))
	done
	log_line "INFO  Selected release: $TAG"
}

latest_via_redirect() {
	# Without the API (rate limit): github.com/<repo>/releases/latest redirects
	# to …/tag/vX.Y.Z. Only curl reports where a redirect ended.
	[ "$FETCHER" = curl ] || return 1
	_u="$(curl -fsSIL -o /dev/null -w '%{url_effective}' --connect-timeout "$CONNECT_TIMEOUT" \
		--max-time "$METADATA_TIMEOUT" "https://github.com/$REPO/releases/latest" 2>/dev/null)"
	_v="${_u##*/}"
	_v="${_v#v}"
	valid_version "$_v" || return 1
	printf '%s' "$_v"
}

resolve_release() {
	_rj="$TMP_DIR/release.json"
	if [ -n "$TAG" ]; then
		msg "Looking up release $TAG"
		if fetch_meta "https://api.github.com/repos/$REPO/releases/tags/v$TAG" "$_rj"; then
			_t="$(jsonfilter -i "$_rj" -e '@.tag_name' 2>/dev/null)"
			[ "${_t#v}" = "$TAG" ] || {
				err "GitHub returned release ${_t:-?} for $TAG"
				return 1
			}
		else
			warn "GitHub API did not answer (rate limit?); trying the release files directly"
			rm -f "$_rj"
		fi
		VERSION="$TAG"
	else
		msg "Looking up the latest release"
		if fetch_meta "https://api.github.com/repos/$REPO/releases/latest" "$_rj"; then
			VERSION="$(jsonfilter -i "$_rj" -e '@.tag_name' 2>/dev/null)"
			VERSION="${VERSION#v}"
		else
			rm -f "$_rj"
			VERSION="$(latest_via_redirect)" || {
				err "Cannot reach the GitHub API (or its rate limit is hit: try again in a few minutes,"
				err "or name the release: --tag X.Y.Z)"
				return 1
			}
		fi
		valid_version "$VERSION" || {
			err "Cannot determine the latest Dawnline release (got '${VERSION:-nothing}')"
			return 1
		}
	fi

	ASSET="$PKG_NAME-$VERSION.$EXT"
	ASSET_BASE="https://github.com/$REPO/releases/download/v$VERSION"
	if [ -s "$_rj" ]; then
		_size="$(jsonfilter -i "$_rj" -e "@.assets[@.name='$ASSET'].size" 2>/dev/null | head -n 1)"
		[ -n "$_size" ] || {
			err "Release $VERSION has no $ASSET"
			return 1
		}
		[ -n "$(jsonfilter -i "$_rj" -e "@.assets[@.name='sha256sums.txt'].name" 2>/dev/null)" ] || {
			err "Release $VERSION has no sha256sums.txt"
			return 1
		}
		DOWNLOAD_BYTES=$((DOWNLOAD_BYTES + _size))
		ok "Release $VERSION ($ASSET)"
	else
		DOWNLOAD_BYTES=$((DOWNLOAD_BYTES + 1048576))
		msg "Release $VERSION ($ASSET, not confirmed by the API yet)"
	fi

	if [ "$WAS_INSTALLED" -eq 0 ]; then
		MODE="install"
	elif [ "$WAS_VERSION" = "$VERSION" ]; then
		MODE="reinstall"
	elif version_ge "$VERSION" "$WAS_VERSION"; then
		MODE="upgrade"
	else
		MODE="downgrade"
	fi
}

lang_name() {
	case "$1" in
	ru) printf 'Russian' ;;
	*) printf '%s' "$1" ;;
	esac
}

# LuCI's language, when Dawnline has a translation for it: its setting, or with
# "auto" (the browser's) a LuCI translation that is installed (base.<lang>.lmo).
luci_lang() {
	_ll="$(uci -q get luci.main.lang)"
	for _l in $I18N_LANGS; do
		case "$_ll" in "$_l" | "$_l"[_-]*)
			printf '%s' "$_l"
			return 0
			;;
		esac
	done
	case "$_ll" in '' | auto) ;; *) return 0 ;; esac
	for _l in $I18N_LANGS; do
		[ -f "/usr/lib/lua/luci/i18n/base.$_l.lmo" ] && {
			printf '%s' "$_l"
			return 0
		}
	done
	return 0
}

# The admin's translation: an installed one is kept (it must match the app's
# version), else --lang or LuCI's own language decides.
resolve_i18n() {
	I18N_LANG=""
	for _l in $I18N_LANGS; do
		pkg_is_installed "luci-i18n-dawnline-$_l" && I18N_LANG="$_l"
	done
	if [ -z "$I18N_LANG" ]; then
		case "$I18N_CHOICE" in
		none) ;;
		auto) I18N_LANG="$(luci_lang)" ;;
		*) I18N_LANG="$I18N_CHOICE" ;;
		esac
	fi
	[ -n "$I18N_LANG" ] || return 0
	I18N_PKG="luci-i18n-dawnline-$I18N_LANG"
	I18N_ASSET="$I18N_PKG-$VERSION.$EXT"
	_rj="$TMP_DIR/release.json"
	if [ -s "$_rj" ]; then
		_size="$(jsonfilter -i "$_rj" -e "@.assets[@.name='$I18N_ASSET'].size" 2>/dev/null | head -n 1)"
		if [ -z "$_size" ]; then
			# Releases before the translations have none.
			warn "Release $VERSION has no $(lang_name "$I18N_LANG") translation: Dawnline stays in English"
			I18N_LANG=""
			I18N_PKG=""
			I18N_ASSET=""
			return 0
		fi
		DOWNLOAD_BYTES=$((DOWNLOAD_BYTES + _size))
	else
		DOWNLOAD_BYTES=$((DOWNLOAD_BYTES + 262144))
	fi
}

# AmneziaWG packages are built per firmware version and target by the
# awg-openwrt projects: <name>_v<release>_<arch>_<target>_<subtarget>.<ext>
awg_postfix() {
	printf '_v%s_%s_%s.%s' "$OWRT_RELEASE" "$OWRT_ARCH" "$(printf '%s' "$OWRT_TARGET" | tr '/' '_')" "$EXT"
}

awg_repo() {
	case "$1" in
	slava) printf 'Slava-Shchipunov/awg-openwrt' ;;
	grey) printf '2Grey/awg-openwrt' ;;
	esac
}

resolve_awg() {
	if pkg_is_installed kmod-amneziawg && pkg_is_installed amneziawg-tools; then
		AWG_ACTION="keep"
		ok "AmneziaWG is installed ($(pkg_version amneziawg-tools))"
		return 0
	fi
	if [ "$AWG_SOURCE" = skip ]; then
		AWG_ACTION="skip"
		warn "AmneziaWG is not installed and --awg skip is set"
		return 0
	fi
	AWG_ACTION="install"
	case "$AWG_SOURCE" in
	slava) _srcs="slava" ;;
	grey) _srcs="grey" ;;
	*) _srcs="slava grey" ;;
	esac
	msg "AmneziaWG is not installed: looking for a build for OpenWrt $OWRT_RELEASE ($OWRT_TARGET)"
	_pf="$(awg_postfix)"
	AWG_CANDIDATES=""
	for _s in $_srcs; do
		_repo="$(awg_repo "$_s")"
		_aj="$TMP_DIR/awg-$_s.json"
		if fetch_meta "https://api.github.com/repos/$_repo/releases/tags/v$OWRT_RELEASE" "$_aj"; then
			_names="$(jsonfilter -i "$_aj" -e '@.assets[*].name' 2>/dev/null)"
			_have=1
			for _p in $AWG_PKGS; do
				printf '%s\n' "$_names" | grep -qxF "$_p$_pf" || _have=0
			done
			if [ "$_have" -eq 1 ]; then
				for _p in $AWG_PKGS; do
					_s1="$(jsonfilter -i "$_aj" -e "@.assets[@.name='$_p$_pf'].size" 2>/dev/null | head -n 1)"
					DOWNLOAD_BYTES=$((DOWNLOAD_BYTES + ${_s1:-0}))
				done
				AWG_CANDIDATES="$AWG_CANDIDATES $_s"
				debug "$_repo has a build for this firmware"
				# The first source that has it is the one used.
				break
			fi
			debug "$_repo has no build for v$OWRT_RELEASE ($OWRT_ARCH, $OWRT_TARGET)"
		else
			# Unknown (API unavailable): try it when downloading.
			AWG_CANDIDATES="$AWG_CANDIDATES $_s"
			DOWNLOAD_BYTES=$((DOWNLOAD_BYTES + 1048576))
		fi
	done
	AWG_CANDIDATES="${AWG_CANDIDATES# }"
	[ -n "$AWG_CANDIDATES" ] && return 0
	err "No AmneziaWG build for OpenWrt $OWRT_RELEASE ($OWRT_ARCH, $OWRT_TARGET) in: $(for _s in $_srcs; do awg_repo "$_s"; printf ' '; done)"
	err "Install kmod-amneziawg, amneziawg-tools and luci-proto-amneziawg by hand, then run"
	err "this again, or install Dawnline without it: --awg skip"
	return 1
}

check_tmp_space() {
	_tf="$(free_kb /tmp)"
	[ -n "$_tf" ] || return 0
	_need=$(((DOWNLOAD_BYTES + 1023) / 1024 + TMP_HEADROOM_KB))
	debug "/tmp: $((_tf / 1024)) MiB free, about $((_need / 1024)) MiB needed"
	[ "$_tf" -ge "$_need" ] && return 0
	err "Not enough RAM in /tmp: $((_tf / 1024)) MiB free, about $((_need / 1024)) MiB needed"
	return 1
}

print_plan() {
	msg "Plan"
	case "$MODE" in
	install) msg "  Dawnline: install $VERSION" ;;
	upgrade) msg "  Dawnline: upgrade $WAS_VERSION → $VERSION (a backup is made first)" ;;
	reinstall) msg "  Dawnline: reinstall $VERSION (a backup is made first)" ;;
	downgrade) msg "  Dawnline: downgrade $WAS_VERSION → $VERSION (a backup is made first)" ;;
	esac
	msg "  Package manager: $PKG_MANAGER ($ASSET)"
	if [ -n "$I18N_PKG" ]; then
		msg "  Translation: $(lang_name "$I18N_LANG") ($I18N_PKG)"
	else
		msg "  Translation: none (Russian: --lang ru)"
	fi
	case "$AWG_ACTION" in
	keep) msg "  AmneziaWG: keep the installed one" ;;
	skip) msg "  AmneziaWG: skip (install it later from Dawnline → Components)" ;;
	install)
		_l=""
		for _s in $AWG_CANDIDATES; do _l="${_l:+$_l, then }$(awg_repo "$_s")"; done
		msg "  AmneziaWG: install from $_l"
		;;
	esac
	msg "  Recovery snapshot: $SNAPSHOT_ROOT/"
}

confirm() {
	[ "$DRY_RUN" -eq 1 ] && return 0
	is_interactive || return 0
	prompt "Continue? [Y/n] "
	# Ctrl-D (end of input) cancels, like n.
	if read -r _answer; then
		case "$_answer" in
		'' | y | Y | yes | Yes | YES) return 0 ;;
		esac
	else
		printf '\n'
	fi
	msg "Cancelled: nothing was changed"
	exit 0
}

# ---------- download phase ----------

# download_release_file NAME: one file of the release into $TMP_DIR, verified.
download_release_file() {
	_name="$1"
	_sums="$TMP_DIR/sha256sums.txt"
	# The checksum: GitHub's own (API), else the release's sha256sums.txt straight from GitHub.
	_want="$(asset_digest "$TMP_DIR/release.json" "$_name")"
	if [ -z "$_want" ]; then
		[ -s "$_sums" ] || download "$ASSET_BASE/sha256sums.txt" "$_sums" sha256sums.txt "" \
			"$(asset_api_url "$TMP_DIR/release.json" sha256sums.txt)" || {
			err "Download failed: sha256sums.txt (does release $VERSION exist?)"
			return 1
		}
		_want="$(awk -v f="$_name" '$2 == f || $2 == "*" f { print $1; exit }' "$_sums")"
		[ -n "$_want" ] || {
			err "sha256sums.txt has no entry for $_name: not installing an unverified package"
			return 1
		}
	fi
	download "$ASSET_BASE/$_name" "$TMP_DIR/$_name" "$_name" "$_want" "$(asset_api_url "$TMP_DIR/release.json" "$_name")" || {
		err "Download failed: $_name"
		return 1
	}
	verify_archive "$TMP_DIR/$_name" || return 1
	ok "$_name verified (sha256, package format)"
}

download_dawnline() {
	download_release_file "$ASSET" || return 1
	ASSET_FILE="$TMP_DIR/$ASSET"
	[ -n "$I18N_ASSET" ] || return 0
	download_release_file "$I18N_ASSET" || return 1
	I18N_FILE="$TMP_DIR/$I18N_ASSET"
}

download_awg() {
	[ "$AWG_ACTION" = install ] || return 0
	_pf="$(awg_postfix)"
	for _s in $AWG_CANDIDATES; do
		_repo="$(awg_repo "$_s")"
		_files=""
		_okd=1
		for _p in $AWG_PKGS; do
			_f="$TMP_DIR/$_p$_pf"
			# Verified when GitHub publishes the file's sha256 (then mirrors may serve it).
			_want="$(asset_digest "$TMP_DIR/awg-$_s.json" "$_p$_pf")"
			if download "https://github.com/$_repo/releases/download/v$OWRT_RELEASE/$_p$_pf" "$_f" "$_p ($_repo)" "$_want" \
				"$(asset_api_url "$TMP_DIR/awg-$_s.json" "$_p$_pf")" &&
				verify_archive "$_f"; then
				_files="$_files $_f"
			else
				_okd=0
				break
			fi
		done
		if [ "$_okd" -eq 1 ]; then
			AWG_REPO="$_repo"
			AWG_FILES="${_files# }"
			ok "AmneziaWG packages from $_repo verified ($([ -n "$_want" ] && printf 'sha256, ')package format)"
			return 0
		fi
		warn "No usable AmneziaWG build for OpenWrt $OWRT_RELEASE in $_repo"
	done
	err "No AmneziaWG build for OpenWrt $OWRT_RELEASE ($OWRT_ARCH, $OWRT_TARGET) could be downloaded."
	err "Install kmod-amneziawg, amneziawg-tools and luci-proto-amneziawg by hand, then run"
	err "this again, or install Dawnline without it: --awg skip"
	return 1
}

# ---------- transaction ----------

prune_snapshots() {
	_keep="${DAWNLINE_SNAPSHOT_KEEP:-3}"
	case "$_keep" in '' | *[!0-9]*) _keep=3 ;; esac
	[ "$_keep" -ge 1 ] || _keep=1
	# Names are YYYYmmdd-HHMMSS: a reverse string sort is newest first.
	ls -1d "$SNAPSHOT_ROOT"/*/ 2>/dev/null | sort -r | tail -n "+$((_keep + 1))" |
		while IFS= read -r _d; do
			[ -n "$_d" ] && rm -rf "$_d"
		done
	return 0
}

snapshot_create() {
	_stamp="$(date +%Y%m%d-%H%M%S 2>/dev/null || echo "$$")"
	if [ "$DRY_RUN" -eq 1 ]; then
		dry "save /etc/config/{$(echo "$SNAPSHOT_CONFIGS" | tr ' ' ',')} and the service state to $SNAPSHOT_ROOT/$_stamp"
		return 0
	fi
	msg "Creating a recovery snapshot"
	mkdir -p "$DATA_DIR" && chmod 700 "$DATA_DIR" 2>/dev/null
	SNAPSHOT_DIR="$SNAPSHOT_ROOT/$_stamp"
	[ -d "$SNAPSHOT_DIR" ] && SNAPSHOT_DIR="$SNAPSHOT_DIR-$$"
	mkdir -p "$SNAPSHOT_DIR" || return 1
	chmod 700 "$SNAPSHOT_ROOT" "$SNAPSHOT_DIR" 2>/dev/null
	for _c in $SNAPSHOT_CONFIGS; do
		[ -f "/etc/config/$_c" ] || continue
		cp -p "/etc/config/$_c" "$SNAPSHOT_DIR/$_c" || return 1
	done
	printf 'installed=%s\nversion=%s\nenabled=%s\nrunning=%s\ntarget=%s\n' \
		"$WAS_INSTALLED" "$WAS_VERSION" "$WAS_ENABLED" "$WAS_RUNNING" "$VERSION" >"$SNAPSHOT_DIR/state" || return 1
	chmod 600 "$SNAPSHOT_DIR"/* 2>/dev/null
	TX_ACTIVE=1
	prune_snapshots
	ok "Recovery snapshot: $SNAPSHOT_DIR"
}

dawnline_backup() {
	[ "$WAS_INSTALLED" -eq 1 ] && [ -x /usr/bin/dawnline ] || return 0
	if [ "$DRY_RUN" -eq 1 ]; then
		dry "run 'dawnline backup --reason pre-update'"
		return 0
	fi
	msg "Making a Dawnline backup before the $MODE"
	_bn="$(/usr/bin/dawnline backup --reason pre-update 2>>"$LOG_FILE")"
	if [ -n "$_bn" ] && [ -f "$DATA_DIR/backups/$_bn" ]; then
		ok "Backup: $DATA_DIR/backups/$_bn"
	else
		warn "dawnline backup failed (the recovery snapshot still has the config)"
	fi
}

install_awg() {
	[ "$AWG_ACTION" = install ] || return 0
	if [ "$DRY_RUN" -eq 1 ]; then
		dry "install AmneziaWG from $AWG_REPO: $AWG_PKGS"
		return 0
	fi
	msg "Installing AmneziaWG from $AWG_REPO"
	# shellcheck disable=SC2086
	pkg_install_files awg 0 $AWG_FILES || {
		err "AmneziaWG installation failed"
		return 1
	}
	ok "AmneziaWG $(pkg_version amneziawg-tools) installed"
}

# netifd reads its protocol handlers only when it starts: a network that was
# up before AmneziaWG was installed doesn't know the amneziawg protocol, and no
# tunnel can come up. Restarted detached and last, so an SSH session dropping
# with it can't cut the install short.
awg_netifd_restart() {
	[ "$AWG_ACTION" != skip ] && [ -x /lib/netifd/proto/amneziawg.sh ] || return 0
	ubus call network get_proto_handlers 2>/dev/null | grep -q '"amneziawg"' && return 0
	msg "Restarting the network so it knows AmneziaWG (connections drop for a few seconds)"
	log_line "INFO  network restart: netifd has no amneziawg protocol handler"
	(
		trap '' HUP
		sleep 2
		/etc/init.d/network restart
	) </dev/null >/dev/null 2>&1 &
}

install_dawnline() {
	_force=0
	case "$MODE" in reinstall | downgrade) _force=1 ;; esac
	if [ "$DRY_RUN" -eq 1 ]; then
		dry "$MODE Dawnline $VERSION ($ASSET${I18N_ASSET:+, $I18N_ASSET})"
		return 0
	fi
	msg "Installing Dawnline $VERSION"
	# The translation in the same transaction: it depends on this very version.
	if [ -n "$I18N_FILE" ]; then
		pkg_install_files dawnline "$_force" "$ASSET_FILE" "$I18N_FILE"
	else
		pkg_install_files dawnline "$_force" "$ASSET_FILE"
	fi
}

healthcheck() {
	[ "$DRY_RUN" -eq 1 ] && return 0
	msg "Running the healthcheck"
	pkg_is_installed "$PKG_NAME" || {
		err "$PKG_NAME is not registered with $PKG_MANAGER"
		return 1
	}
	[ -x /usr/bin/dawnline ] || {
		err "/usr/bin/dawnline is missing"
		return 1
	}
	_pv="$(pkg_version "$PKG_NAME")"
	[ "$_pv" = "$VERSION" ] || {
		err "$PKG_MANAGER reports $PKG_NAME $_pv, expected $VERSION"
		return 1
	}
	_rv="$(/usr/bin/dawnline version 2>&1)"
	[ "$_rv" = "$VERSION" ] || {
		err "dawnline version reports '$_rv', expected $VERSION"
		return 1
	}
	_w=0
	until ubus list luci.dawnline >/dev/null 2>&1; do
		_w=$((_w + 1))
		if [ "$_w" -eq "$UBUS_WAIT" ]; then
			warn "rpcd has not loaded the Dawnline backend yet; restarting rpcd"
			/etc/init.d/rpcd restart >/dev/null 2>&1
		fi
		[ "$_w" -ge $((UBUS_WAIT + 10)) ] && {
			err "The LuCI backend does not answer (ubus list luci.dawnline)"
			return 1
		}
		sleep 1
	done
	_r="$(ubus call service list '{"name":"dawnline"}' 2>/dev/null | jsonfilter -q -e '@.dawnline.instances.agent.running' 2>/dev/null)"
	if [ "$_r" != true ]; then
		warn "The Dawnline agent is not running yet (see Dawnline → Diagnostics)"
	fi
	if [ -n "$I18N_PKG" ] && [ "$(pkg_version "$I18N_PKG")" != "$VERSION" ]; then
		warn "$I18N_PKG $VERSION is not installed: Dawnline shows in English"
	fi
	ok "Healthcheck passed: $PKG_NAME $VERSION, LuCI backend answers"
}

# An upgrade keeps a service the user had disabled disabled (the package's
# postinst always enables and starts it).
keep_service_intent() {
	[ "$DRY_RUN" -eq 0 ] && [ "$WAS_INSTALLED" -eq 1 ] && [ "$WAS_ENABLED" -eq 0 ] || return 0
	[ -x /etc/init.d/dawnline ] || return 0
	msg "Dawnline was disabled before the $MODE: keeping it disabled and stopped"
	/etc/init.d/dawnline disable >/dev/null 2>&1
	/etc/init.d/dawnline stop >/dev/null 2>&1
	return 0
}

# LuCI reads a language's catalogs once per web server process: a new or
# replaced translation needs a fresh one.
reload_luci() {
	[ "$DRY_RUN" -eq 0 ] && [ -n "$I18N_FILE" ] || return 0
	msg "Restarting the web server so LuCI reads the translation"
	/etc/init.d/uhttpd restart >/dev/null 2>&1 ||
		warn "uhttpd did not restart: the translation shows after a reboot"
}

commit_transaction() {
	TX_COMMITTED=1
	TX_ACTIVE=0
	[ -n "$SNAPSHOT_DIR" ] && echo "$VERSION" >"$SNAPSHOT_DIR/installed-release" 2>/dev/null
	return 0
}

restore_snapshot() {
	[ "$TX_ACTIVE" -eq 1 ] && [ "$TX_COMMITTED" -eq 0 ] || return 0
	[ -n "$SNAPSHOT_DIR" ] && [ -d "$SNAPSHOT_DIR" ] || return 0
	TX_ACTIVE=0
	warn "Restoring the configuration from $SNAPSHOT_DIR"
	_changed=""
	for _c in $SNAPSHOT_CONFIGS; do
		[ -f "$SNAPSHOT_DIR/$_c" ] || continue
		cmp -s "$SNAPSHOT_DIR/$_c" "/etc/config/$_c" && continue
		cp -p "$SNAPSHOT_DIR/$_c" "/etc/config/$_c" 2>/dev/null && _changed="$_changed $_c"
	done
	[ -f /etc/config/dawnline ] && chmod 600 /etc/config/dawnline 2>/dev/null
	for _c in $_changed; do
		log_line "INFO  restored /etc/config/$_c"
		case "$_c" in
		network) ubus call network reload >/dev/null 2>&1 ;;
		firewall) /etc/init.d/firewall reload >/dev/null 2>&1 ;;
		dhcp) /etc/init.d/dnsmasq reload >/dev/null 2>&1 ;;
		uhttpd) /etc/init.d/uhttpd reload >/dev/null 2>&1 ;;
		esac
	done
	if [ -x /etc/init.d/dawnline ]; then
		if [ "$WAS_INSTALLED" -eq 1 ]; then
			if [ "$WAS_ENABLED" -eq 1 ]; then
				/etc/init.d/dawnline enable >/dev/null 2>&1
			else
				/etc/init.d/dawnline disable >/dev/null 2>&1
			fi
			if [ "$WAS_RUNNING" -eq 1 ]; then
				/etc/init.d/dawnline restart >/dev/null 2>&1
			else
				/etc/init.d/dawnline stop >/dev/null 2>&1
			fi
		else
			/etc/init.d/dawnline stop >/dev/null 2>&1
			/etc/init.d/dawnline disable >/dev/null 2>&1
		fi
	fi
	if [ -n "$_changed" ]; then
		warn "Restored:$_changed; service state as before"
	else
		warn "No config had changed; service state as before"
	fi
	warn "Packages are not rolled back."
	if [ "$WAS_INSTALLED" -eq 1 ] && [ -n "$WAS_VERSION" ] && [ "$WAS_VERSION" != "$VERSION" ]; then
		warn "To go back to Dawnline $WAS_VERSION: sh install.sh --tag $WAS_VERSION"
	elif [ "$WAS_INSTALLED" -eq 0 ] && [ -x /etc/init.d/dawnline ]; then
		warn "Dawnline is installed but stopped: fix the cause and run the installer again,"
		warn "or remove it with uninstall.sh"
	fi
}

cleanup() {
	_rc=$?
	trap '' HUP INT TERM
	stream_stop
	restore_snapshot
	[ -n "$TMP_DIR" ] && rm -rf "$TMP_DIR" 2>/dev/null
	release_lock
	return "$_rc"
}

on_hup() { exit 129; }
on_int() { exit 130; }
on_term() { exit 143; }
# stdout or stderr closed: ignore further SIGPIPE so the EXIT cleanup runs.
on_pipe() {
	trap '' PIPE
	exit 141
}

lan_url() {
	_ip="$(uci -q get network.lan.ipaddr 2>/dev/null | cut -d/ -f1 | awk '{ print $1 }')"
	[ -n "$_ip" ] || _ip="192.168.1.1"
	printf 'http://%s/cgi-bin/luci/admin/network/dawnline/server' "$_ip"
}

main() {
	trap cleanup EXIT
	trap on_hup HUP
	trap on_int INT
	trap on_term TERM
	trap on_pipe PIPE

	parse_args "$@" || exit 2

	[ "$(id -u 2>/dev/null || echo 1)" = 0 ] || fail "Run the installer as root"
	acquire_lock || exit 1
	# A dry run keeps the log of the last real install.
	[ "$DRY_RUN" -eq 1 ] && LOG_FILE="/tmp/dawnline-install.dry.log"
	: >"$LOG_FILE" 2>/dev/null && chmod 600 "$LOG_FILE" 2>/dev/null && LOG_READY=1
	log_line "INFO  Dawnline Installer $INSTALLER_VERSION: $0 $*"
	init_tmp_dir || fail "Cannot create a temporary directory in /tmp"
	detect_fetcher || fail "No download tool"
	detect_package_manager || fail "No supported package manager"
	banner
	[ "$DRY_RUN" -eq 1 ] && msg "Dry run: nothing on the router is changed"

	sync_time
	check_system || fail "The system does not meet the requirements"
	check_tools || fail "Required tools are missing"
	check_dns || fail "Name resolution does not work"
	record_state

	select_release
	resolve_release || fail "Could not resolve the Dawnline release"
	resolve_i18n
	resolve_awg || fail "AmneziaWG is not available for this firmware"
	check_tmp_space || fail "Not enough free memory for the downloads"
	print_plan
	confirm

	msg "Downloading release files"
	download_dawnline || fail "Download or verification failed"
	download_awg || fail "AmneziaWG download failed"

	pkg_refresh || fail "The package lists could not be updated"
	snapshot_create || fail "Could not create the recovery snapshot"
	# From here on an SSH drop must not kill the package manager half-way:
	# the install finishes (or rolls back) on its own, the log has the rest.
	trap '' HUP
	dawnline_backup
	install_awg || fail "AmneziaWG installation failed"
	install_dawnline || fail "Dawnline installation failed"
	healthcheck || fail "The installed Dawnline did not pass the healthcheck"
	keep_service_intent
	commit_transaction
	reload_luci
	trap on_hup HUP

	_took=$(($(date +%s 2>/dev/null || echo "$START_TS") - START_TS))
	if [ "$DRY_RUN" -eq 1 ]; then
		ok "Dry run finished in ${_took}s: the plan is valid, nothing was changed"
		msg "Log: $LOG_FILE"
		return 0
	fi
	case "$MODE" in
	upgrade | downgrade) ok "Dawnline $VERSION installed in ${_took}s (was $WAS_VERSION)" ;;
	*) ok "Dawnline $VERSION installed in ${_took}s" ;;
	esac
	[ "$AWG_ACTION" = skip ] && warn "AmneziaWG is not installed: add it in Dawnline → Components before creating a server"
	msg "Log: $LOG_FILE"
	msg "Recovery snapshot: $SNAPSHOT_DIR"
	if [ "$MODE" = install ]; then
		msg "Open LuCI → Network → Dawnline and run the setup wizard:"
	else
		msg "Open LuCI → Network → Dawnline:"
	fi
	msg "  $(lan_url)"
	awg_netifd_restart
}

main "$@"
