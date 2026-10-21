// Dawnline — the AmneziaWG core: keys, disguise (obfuscation) and the values
// AmneziaWG refuses, client configurations (.conf, AmneziaVPN key), the
// netifd options of a server's tunnel, its peers (`awg syncconf`, no
// restart), live counters, the words for why a tunnel is kept down
// (blocked_text) and what the watchdog and Health check about it. Plain
// WireGuard is AmneziaWG with the disguise off.

import { readfile, stat, unlink } from 'fs';
import {
	q, sh, sh_out, rand_int, rand_bytes, valid_key, ip2int, tunnel_name, ensure_dir, write_file, read_json, write_json, lock, unlock,
	slog, iface_status, DATA_DIR, RUN_DIR
} from 'dawnline.util';
import * as core from 'dawnline.core';
import * as net from 'dawnline.net';
import { ipv6_groups } from 'dawnline.schema';
import * as pkg from 'dawnline.pkg';
import * as builds from 'dawnline.awg_builds';
import { _, L_ } from 'dawnline.i18n';

/** Names in .conf files (and AmneziaVPN keys); netifd uses `awg_<key>`. */
export const OBF_CONF = {
	jc: 'Jc', jmin: 'Jmin', jmax: 'Jmax', s1: 'S1', s2: 'S2', s3: 'S3', s4: 'S4',
	h1: 'H1', h2: 'H2', h3: 'H3', h4: 'H4', i1: 'I1', i2: 'I2', i3: 'I3', i4: 'I4', i5: 'I5',
	header_protection_key: 'HeaderProtectionKey', content_padding_addition: 'ContentPaddingAddition',
	rekey_after_time: 'RekeyAfterTime', rekey_timeout: 'RekeyTimeout', reject_after_time: 'RejectAfterTime',
	keepalive_timeout: 'KeepaliveTimeout', max_handshake_attempts: 'MaxHandshakeAttempts',
	random_trailers: 'RandomTrailers', disable_cookies: 'DisableCookies',
};

const TOOL = '/usr/bin/awg', PROTO = '/lib/netifd/proto/amneziawg.sh';
/** The packages AmneziaWG comes in (the Components tab installs them). */
const PACKAGES = [ 'kmod-amneziawg', 'amneziawg-tools' ];
// A module constant, compiled once (a literal is compiled each time it runs):
// dump() checks it on every line of each tunnel's `awg show <ifname> dump`, every second.
const DIGITS = /^[0-9]+$/;

/** netifd knows the amneziawg protocol (it reads the proto scripts when it starts). */
function proto_handler() {
	try {
		return 'amneziawg' in (json(sh_out('ubus call network get_proto_handlers 2>/dev/null') || '{}') ?? {});
	}
	catch (e) {
		return false;
	}
}

/**
 * What of AmneziaWG is on the router:
 *   tools    the awg tool and the netifd protocol script (amneziawg-tools)
 *   kmod     the kernel module, loaded or on disk for the running kernel
 *   loaded   the module is loaded
 *   handler  netifd lists the amneziawg protocol
 *   missing  packages that are not installed; ok: everything is in place
 */
export function state() {
	let tools = stat(TOOL) != null && stat(PROTO) != null;
	let loaded = stat('/sys/module/amneziawg') != null;
	let rel = trim(readfile('/proc/sys/kernel/osrelease') ?? '');
	let kmod = loaded || (rel != '' && stat(`/lib/modules/${rel}/amneziawg.ko`) != null);
	let handler = tools && proto_handler();
	let missing = filter(PACKAGES, (p) => p == 'kmod-amneziawg' ? !kmod : !tools);
	return { tools, kmod, loaded, handler, missing, ok: !length(missing) && loaded && handler };
};

/**
 * state(), after loading an installed module that isn't loaded yet: nothing loads
 * it before the first tunnel comes up, so "not loaded" alone is no fault.
 */
export function load() {
	let s = state();
	if (!s.kmod || s.loaded)
		return s;
	system('modprobe amneziawg >/dev/null 2>&1');
	return state();
};

/** The kernel module and the awg tool are on the router. */
export function installed() {
	let s = state();
	return s.tools && s.kmod;
};

/* ---------- keys ---------- */

export function genkey() {
	return sh_out('awg genkey');
};

export function pubkey(priv) {
	if (!valid_key(priv))
		return null;
	return sh_out(`printf %s ${q(priv)} | awg pubkey`);
};

/** A preshared key is 32 random bytes: no tool needed (`awg genpsk` does the same). */
export function genpsk() {
	return b64enc(rand_bytes(32));
};

/**
 * Keys for a new device. With `public_key` (made in the browser) the private
 * key never reaches the router. Never without a preshared key.
 */
export function new_keys(public_key) {
	let psk = genpsk();
	if (!valid_key(psk))
		die(_('Key generation failed (no random data).'));
	if (public_key) {
		if (!valid_key(public_key))
			die(_('Invalid public key.'));
		return { public_key, preshared_key: psk };
	}
	let priv = genkey(), pub = pubkey(priv);
	if (!pub)
		die(_('Key generation failed (is amneziawg-tools installed?).'));
	return { private_key: priv, public_key: pub, preshared_key: psk };
};

/** A server's own key pair (set up once, on the server). */
export function server_keys() {
	let priv = genkey(), pub = pubkey(priv);
	if (!pub)
		die(_('Key generation failed (is amneziawg-tools installed?).'));
	return { private_key: priv, public_key: pub };
};

/* ---------- obfuscation ---------- */

// Junk packets may be tiny (the 3.1 preset sends 10-50 bytes, as AmneziaVPN
// does); the ceiling keeps them under the path MTU.
const OBF_SPEC = { jc: [ 0, 10 ], jmin: [ 0, 1024 ], jmax: [ 0, 1024 ], s1: [ 0, 64 ], s2: [ 0, 64 ], s3: [ 0, 64 ], s4: [ 0, 32 ] };

function rand_h(used) {
	for (let i = 0; i < 50; i++) {
		let v = rand_int(5, 2147483647);
		if (!used[v]) {
			used[v] = true;
			return `${v}`;
		}
	}
}

// caps() answers from here while the tool, the protocol script, the module
// file, the install record and the loaded module are the same (tmpfs: a
// reboot starts over).
const CAPS = `${RUN_DIR}/awg-caps.json`;

/**
 * What the installed AmneziaWG can do: the netifd protocol script (the
 * options it passes on) and the `awg` tool (the keys it accepts) say what the
 * tools know, the kernel module's package version what the kernel runs, and
 * a feature counts only when both have it (tools 3.1 over a 2.0 module would
 * configure header protection that the kernel silently lacks). While an
 * update waits for a reboot (its old module stayed loaded) the kernel runs
 * the generation from before it, as the install recorded it:
 *   v2 — S3/S4, I1-I5, header ranges (AWG 1.5/2.0)
 *   v3 — header protection, trailers, padding, timing (AWG 3.1)
 *   tools / kmod — their generations ('1.0', '2.0', '3.1'; null unknown)
 *   mismatch — the two differ
 *   pending — an installed module waits for a reboot (dawnline.awg_builds)
 */
export function caps() {
	let rel = trim(readfile('/proc/sys/kernel/osrelease') ?? '');
	let core = builds.module_core();
	let key = `${stat(`/lib/modules/${rel}/amneziawg.ko`)?.mtime ?? 0}/${stat(TOOL)?.mtime ?? 0}/${stat(PROTO)?.mtime ?? 0}` +
		`/${stat(builds.RECORD)?.mtime ?? 0}/${core ?? 0}`;
	let cached = read_json(CAPS, null);
	if (cached?.key == key && cached.caps)
		return cached.caps;
	let script = readfile(PROTO) ?? '';
	let tool = sh_out("grep -a -o -m1 'HeaderProtectionKey' /usr/bin/awg 2>/dev/null") ?? '';
	let t2 = index(script, 'awg_s3') >= 0 && index(script, 'awg_i1') >= 0;
	let t3 = t2 && index(script, 'awg_header_protection_key') >= 0 && tool != '';
	let tools = !stat(TOOL) ? null : t3 ? '3.1' : t2 ? '2.0' : '1.0';
	// A module installed by hand has no package, so no generation (also when
	// a pending update replaces it): then the tools are believed.
	let rec = read_json(builds.RECORD, null), boot = builds.boot_id();
	let kmod = builds.running_gen(rec, boot, core, pkg.version('kmod-amneziawg'));
	let out = {
		v2: t2 && (kmod == null || kmod != '1.0'),
		v3: t3 && (kmod == null || kmod == '3.1'),
		tools, kmod, mismatch: tools != null && kmod != null && tools != kmod,
		pending: builds.pending(rec, boot, core),
	};
	ensure_dir(RUN_DIR);
	write_json(CAPS, { key, caps: out }, 0o644);
	return out;
};

/**
 * Why this AmneziaWG cannot run a server's disguise values, as a reason to
 * keep the server down (blocked_text): { code: 'disguise', need, installed }
 * (installed null: none), or null when it can. A 3.1 preset after a rollback
 * to a 2.0 build would come up without the header protection every device
 * expects, so such a server is kept down instead (dawnline.netifd).
 */
export function obf_unsupported(o) {
	let c = caps();
	let has = (keys) => length(filter(keys, (k) => o?.[k] != null && o[k] != '')) > 0;
	let v3 = [ 'header_protection_key', 'content_padding_addition', 'rekey_after_time', 'rekey_timeout', 'reject_after_time',
		'keepalive_timeout', 'max_handshake_attempts', 'random_trailers', 'disable_cookies' ];
	let v2 = [ 's3', 's4', 'i1', 'i2', 'i3', 'i4', 'i5' ];
	let ranged = length(filter([ 'h1', 'h2', 'h3', 'h4' ], (k) => match(`${o?.[k] ?? ''}`, /-/))) > 0;
	if (has(v3) && !c.v3)
		return { code: 'disguise', need: '3.1', installed: c.kmod ?? c.tools };
	if ((has(v2) || ranged) && !c.v2)
		return { code: 'disguise', need: '2.0', installed: c.kmod ?? c.tools };
	return null;
};

/**
 * Signature packets shaped like DNS, made fresh for each server: the same
 * fixed bytes on every router (AmneziaVPN's own 3.1 default is one constant
 * answer about icloud.com) would be one rule for a DPI to match. A query and
 * an answer about a name of this server's own, with its own TTL and address.
 *   <r N> random bytes, <rc N> random letters, <b 0x..> fixed bytes
 */
function dns_name_hex() {
	let hex = (s) => {
		let out = '';
		for (let i = 0; i < length(s); i++)
			out += sprintf('%02x', ord(s, i));
		return out;
	};
	let tld = [ 'com', 'net', 'org', 'io' ][rand_int(0, 3)];
	let n = rand_int(5, 9);
	return { labels: `<b 0x${sprintf('%02x', n)}><rc ${n}><b 0x${sprintf('%02x', length(tld))}${hex(tld)}00>`, len: n + length(tld) + 2 };
}

function dns_query() {
	let name = dns_name_hex();
	// id, flags (standard query, recursion desired), 1 question, name, type A, class IN
	return `<r 2><b 0x01000001000000000000>${name.labels}<b 0x00010001>`;
}

function dns_answer() {
	let name = dns_name_hex();
	let ttl = sprintf('%08x', rand_int(300, 86400));
	// id, flags (answer, authoritative, recursion), 1 question, 1 answer, name, A IN, pointer, A IN, ttl, 4 bytes
	return `<r 2><b 0x85800001000100000000>${name.labels}<b 0x00010001c00c00010001${ttl}0004><r 4>`;
}

/**
 * Generate obfuscation parameters for a method:
 *   off      plain WireGuard-compatible packets
 *   balanced AmneziaWG 2.0: junk packets, random headers, padded cookie and
 *            data packets, DNS-shaped signature packets
 *   max      AmneziaWG 3.1: protected headers, random trailers, padding,
 *            jittered timers and a DNS-like first packet — the values
 *            AmneziaVPN itself uses for 3.1 servers
 * Servers made before 0.8 may still carry the old "standard" or "strong"
 * values (1.0-style junk only): they keep running as they are, the picker
 * offers Balanced or Maximum instead.
 */
export function obf_preset(name) {
	if (name == 'max') {
		// 32 random bytes, as `awg genkey` makes them (no process). Without
		// one the server would come up with weak or no header protection.
		let hpk = genpsk();
		if (!valid_key(hpk))
			die(_('Key generation failed (no random data).'));
		return {
			jc: `${rand_int(4, 6)}`, jmin: '10', jmax: '50',
			s1: '12', s2: '12', s3: '12', s4: '12',
			h1: '1', h2: '2', h3: '3', h4: '4',
			i1: dns_query(), i2: dns_answer(),
			header_protection_key: hpk,
			content_padding_addition: '10-100',
			rekey_after_time: '100-120', rekey_timeout: '3-7', reject_after_time: '150-180',
			keepalive_timeout: '5-15', max_handshake_attempts: '15-20',
			random_trailers: 'on', disable_cookies: 'on',
		};
	}
	if (name == 'off')
		return { jc: '0', jmin: '0', jmax: '0', s1: '0', s2: '0', h1: '1', h2: '2', h3: '3', h4: '4' };
	let o = {};
	o.jc = `${rand_int(4, 8)}`;
	let jmin = rand_int(64, 128);
	o.jmin = `${jmin}`;
	o.jmax = `${jmin + rand_int(150, 400)}`;
	let s1 = rand_int(15, 64), s2 = rand_int(15, 64);
	while (s1 + 56 == s2)
		s2 = rand_int(15, 64);
	o.s1 = `${s1}`;
	o.s2 = `${s2}`;
	let used = {};
	for (let k in [ 'h1', 'h2', 'h3', 'h4' ])
		o[k] = rand_h(used);
	// AmneziaWG 2.0: padded cookie and data packets (S4 costs MTU, kept
	// small: core.tunnel_mtu) and DNS-shaped signature packets before each
	// handshake — what 1.0 traffic lacks and gets recognised by.
	o.s3 = `${rand_int(8, 48)}`;
	o.s4 = `${rand_int(4, 16)}`;
	o.i1 = dns_query();
	o.i2 = dns_answer();
	return o;
};

/* ---------- disguise values AmneziaWG refuses ---------- */

// Checked with ltrim, not regexes: this module loads with every portal request.
const DEC = '0123456789', HEX = '0123456789abcdefABCDEF';

/** A whole number in digits up to `top`, or null (no spaces: callers trim where the tools drop them). */
function uint(v, top) {
	let s = `${v}`;
	if (s == '' || length(s) > 10 || ltrim(s, DEC) != '')
		return null;
	return +s <= top ? +s : null;
}

/** A number or a range as AmneziaWG writes them ("5", "5-15"), each end up to `top`: [ lo, hi ], or null. */
function uint_range(v, top) {
	let p = split(trim(`${v}`), '-');
	let lo = length(p) <= 2 ? uint(p[0], top) : null;
	let hi = length(p) == 2 ? uint(p[1], top) : lo;
	return lo != null && hi != null && lo <= hi ? [ lo, hi ] : null;
}

/** Value `k` of disguise values `o` is set. */
function given(o, k) {
	return o[k] != null && o[k] != '';
}

/**
 * Packet types H1-H4: a number or a range each, apart from the others (the
 * kernel refuses an overlap). One not given keeps WireGuard's own type, 1-4.
 */
function headers_unsafe(o, errs) {
	let hs = [];
	for (let i = 1; i <= 4; i++) {
		let r = given(o, `h${i}`) ? uint_range(o[`h${i}`], 4294967295) : [ i, i ];
		if (!r)
			push(errs, sprintf(_('%s must be a number or a range like 100-200, up to 4294967295.'), OBF_CONF[`h${i}`]));
		push(hs, r);
	}
	for (let i = 0; i < 4; i++)
		for (let j = i + 1; j < 4; j++)
			if (hs[i] && hs[j] && hs[i][0] <= hs[j][1] && hs[j][0] <= hs[i][1])
				push(errs, sprintf(_('%s and %s overlap: each packet type needs values of its own.'), OBF_CONF[`h${i + 1}`], OBF_CONF[`h${j + 1}`]));
}

/**
 * One tag of a signature packet as both the kernel and amneziawg-go read it:
 * <b 0x..> fixed bytes (an even number of hex digits), <r N>, <rc N>, <rd N>
 * (N random bytes, letters, digits; a negative N writes past the packet in
 * the kernel, kmod #267) or <t> (the time). <c> is the kernel's alone and
 * <d>, <ds>, <dz> amneziawg-go's: devices on the other refuse them.
 */
function itag_ok(tag) {
	if (tag == 't')
		return true;
	let sp = index(tag, ' ');
	if (sp < 0)
		return false;
	let key = substr(tag, 0, sp), val = substr(tag, sp + 1);
	if (key == 'b')
		return length(val) > 2 && length(val) % 2 == 0 && substr(val, 0, 2) == '0x' && ltrim(substr(val, 2), HEX) == '';
	if (key == 'r' || key == 'rc' || key == 'rd')
		return (uint(val, 1000) ?? 0) >= 1;
	return false;
}

/** What is wrong with signature packet `name` (I1-I5) holding `s`, as a sentence; null when nothing. */
function itag_error(name, s) {
	// In a .conf file `#` starts a comment and a line break ends the line: the rest would be lost.
	if (index(s, '#') >= 0 || index(s, '\n') >= 0 || index(s, '\r') >= 0)
		return sprintf(_('%s may not contain # or a line break.'), name);
	// Text between tags is skipped by both parsers.
	for (let a = index(s, '<'); a >= 0; a = index(s, '<')) {
		let b = index(substr(s, a), '>');
		if (b < 0)
			return sprintf(_('%s has a tag that is not closed with >.'), name);
		let tag = substr(s, a + 1, b - 1);
		if (!itag_ok(tag))
			return sprintf(_('%s: <%s> is not a tag AmneziaWG apps accept: use <b 0x…> with an even number of hex digits, <r N>, <rc N> or <rd N> with N from 1 to 1000, or <t>.'),
				name, length(tag) > 24 ? `${substr(tag, 0, 24)}…` : tag);
		s = substr(s, a + b + 1);
	}
	return null;
}

/** Signature packets I1-I5: their tags, and all of them in one device's configuration (one QR code). */
function itags_unsafe(o, errs) {
	let total = 0;
	for (let k in [ 'i1', 'i2', 'i3', 'i4', 'i5' ]) {
		if (!given(o, k))
			continue;
		total += length(`${o[k]}`);
		let e = itag_error(OBF_CONF[k], `${o[k]}`);
		if (e)
			push(errs, e);
	}
	if (total > 2000)
		push(errs, sprintf(_('I1-I5 together must be at most 2000 characters, not %d.'), total));
}

/**
 * What in disguise values `o` AmneziaWG would refuse, crash on or break
 * devices with: what an import, a restore or a hand edit in uci must never
 * hand to the kernel (dawnline.backup, dawnline.netifd). Only those rules,
 * none of Dawnline's own bounds (obf_errors): a backup the kernel takes stays
 * usable. Sentences in the reader's language; [] when the values are safe.
 */
export function obf_unsafe(o) {
	o ??= {};
	let errs = [];
	let num = (k) => given(o, k) ? uint(trim(`${o[k]}`), 65535) : 0;
	// 16-bit numbers for the tools; Jmin above Jmax sizes junk past its buffer (kmod #225).
	for (let k in [ 'jc', 'jmin', 'jmax', 's1', 's2', 's3', 's4' ])
		if (num(k) == null)
			push(errs, sprintf(_('%s must be a whole number from 0 to 65535.'), OBF_CONF[k]));
	if (given(o, 'jmin') && given(o, 'jmax') && num('jmin') != null && num('jmax') != null && num('jmin') > num('jmax'))
		push(errs, _('Jmin must not be larger than Jmax.'));
	headers_unsafe(o, errs);
	// Header protection: a 32-byte key, and every padding at least the 12 bytes of its nonce (the kernel checks).
	if (given(o, 'header_protection_key')) {
		if (!valid_key(o.header_protection_key))
			push(errs, _('The header protection key is not a key.'));
		for (let k in [ 's1', 's2', 's3', 's4' ])
			if (num(k) != null && num(k) < 12)
				push(errs, sprintf(_('%s must be at least 12 with header protection.'), OBF_CONF[k]));
	}
	// 3.1 timers and counts: 0 alone is the kernel's default; a 0 in a range
	// would fire at once. Keys are dropped after 180 seconds whatever is set.
	for (let k in [ 'rekey_after_time', 'rekey_timeout', 'reject_after_time', 'keepalive_timeout', 'max_handshake_attempts' ]) {
		let r = given(o, k) ? uint_range(o[k], 65535) : [ 0, 0 ];
		if (!r || (r[0] == 0 && r[1] > 0))
			push(errs, sprintf(_('%s must be a number or a range like 5-15, from 1 to 65535.'), OBF_CONF[k]));
		else if (k == 'reject_after_time' && r[1] > 180)
			push(errs, _('RejectAfterTime must be at most 180 seconds.'));
	}
	if (given(o, 'content_padding_addition') && !uint_range(o.content_padding_addition, 65535))
		push(errs, sprintf(_('%s must be a number or a range like 10-100, up to 65535.'), OBF_CONF.content_padding_addition));
	// What both netifd and the .conf parser read as a switch.
	for (let k in [ 'random_trailers', 'disable_cookies' ])
		if (given(o, k) && index([ 'on', 'off', '1', '0' ], `${o[k]}`) < 0)
			push(errs, sprintf(_('%s must be on or off.'), OBF_CONF[k]));
	itags_unsafe(o, errs);
	return errs;
};

/**
 * What is wrong with the disguise values of a server Dawnline sets up: what
 * AmneziaWG refuses (obf_unsafe), and Dawnline's own bounds on top (junk that
 * stays under the path MTU, a handshake initiation and response that never
 * share a size). Its presets pass it. Sentences in the reader's language; []
 * when the values are fine.
 */
export function obf_errors(o) {
	o ??= {};
	let errs = obf_unsafe(o);
	for (let k, r in OBF_SPEC) {
		let n = given(o, k) ? uint(trim(`${o[k]}`), 65535) : null;
		if (n != null && (n < r[0] || n > r[1]))
			push(errs, sprintf(_('%s must be from %d to %d.'), OBF_CONF[k], r[0], r[1]));
	}
	if (o.s1 != null && o.s2 != null && +o.s1 + 56 == +o.s2)
		push(errs, _('S2 must not be S1 + 56: the handshake initiation and response would have the same size.'));
	return errs;
};

/**
 * Disguise values `o` as anyone who may read the status sees them: all but
 * the header protection key, a secret every device of the server shares
 * (with it and the server's public key, captured traffic can be unmasked).
 * Devices get it in their own configuration (client_config).
 */
export function obf_public(o) {
	let out = { ...(o ?? {}) };
	delete out.header_protection_key;
	return out;
};

/*
 * Everything but a device's own local network, for a device whose local
 * network stays outside the tunnel (lan_bypass): every IPv4 address outside
 * the private ranges the access table drops for internet people anyway
 * (dawnline.nft PRIVATE4: 10/8, 172.16/12, 192.168/16, 100.64/10,
 * 169.254/16, 224/3), and every IPv6 address outside fc00::/7, fe80::/10
 * and ff00::/8. Fixed lists (tests/ucode/awg.test.uc proves each is exactly
 * that complement); what of the private ranges goes through the tunnel after
 * all (DNS, home) is added to them.
 */
export const BYPASS4 = [
	'0.0.0.0/5', '8.0.0.0/7', '11.0.0.0/8', '12.0.0.0/6', '16.0.0.0/4', '32.0.0.0/3', '64.0.0.0/3', '96.0.0.0/6',
	'100.0.0.0/10', '100.128.0.0/9', '101.0.0.0/8', '102.0.0.0/7', '104.0.0.0/5', '112.0.0.0/4', '128.0.0.0/3', '160.0.0.0/5',
	'168.0.0.0/8', '169.0.0.0/9', '169.128.0.0/10', '169.192.0.0/11', '169.224.0.0/12', '169.240.0.0/13', '169.248.0.0/14',
	'169.252.0.0/15', '169.255.0.0/16', '170.0.0.0/7', '172.0.0.0/12', '172.32.0.0/11', '172.64.0.0/10', '172.128.0.0/9',
	'173.0.0.0/8', '174.0.0.0/7', '176.0.0.0/4', '192.0.0.0/9', '192.128.0.0/11', '192.160.0.0/13', '192.169.0.0/16',
	'192.170.0.0/15', '192.172.0.0/14', '192.176.0.0/12', '192.192.0.0/10', '193.0.0.0/8', '194.0.0.0/7', '196.0.0.0/6',
	'200.0.0.0/5', '208.0.0.0/4',
];
export const BYPASS6 = [ '::/1', '8000::/2', 'c000::/3', 'e000::/4', 'f000::/5', 'f800::/6', 'fe00::/9', 'fec0::/10' ];

/** An IPv6 address BYPASS6 leaves out: in fc00::/7, fe80::/10 or ff00::/8 (the first 16 bits decide). False for anything else. */
function private6(a) {
	let g = ipv6_groups(a)?.[0];
	return g != null && ((g & 0xfe00) == 0xfc00 || (g & 0xffc0) == 0xfe80 || (g & 0xff00) == 0xff00);
}

/**
 * What a device sends into the tunnel (its AllowedIPs; the server's peer
 * line stays its address/32). Home only: the person's home networks, the
 * tunnel network or the router's address, and the DNS. Internet: everything,
 * or with `dev.lan_bypass` everything but the device's own local network
 * (BYPASS4, BYPASS6), every DNS server it is given (IPv4 and IPv6) and for
 * home access what Home only gets. Without `dev`, as for a device without
 * lan_bypass.
 */
export function allowed_ips(m, srv, p, dev) {
	if (p.access != 'lan' && !dev?.lan_bypass)
		return [ '0.0.0.0/0', '::/0' ];
	let home = () => {
		let nets = core.person_home(srv, p).nets;
		// With devices reaching each other, the whole tunnel network (the router's
		// address is in it); otherwise only the router's own address.
		let a = core.server_address(srv);
		if (srv.device_mesh && srv.subnet)
			push(nets, srv.subnet);
		else if (a)
			push(nets, `${a}/32`);
		return nets;
	};
	let dns = core.client_dns(m, srv, p);
	if (p.access == 'lan') {
		// The resolver address must be reachable through the tunnel too (not the fallback).
		let nets = home();
		if (dns[0])
			push(nets, `${dns[0]}/32`);
		return net.collapse(nets);
	}
	// Every DNS server stays in the tunnel: a private one left out would be
	// asked on whatever network the device is on (a public one is in the rest).
	let nets = [ ...BYPASS4 ], nets6 = [];
	for (let a in dns)
		if (ip2int(a) != null)
			push(nets, `${a}/32`);
		else if (private6(a))
			push(nets6, `${a}/128`);
	if (p.access == 'both')
		push(nets, ...home());
	return [ ...net.collapse(nets), ...BYPASS6, ...uniq(nets6) ];
};


/** True when the obfuscation settings change nothing on the wire (plain WireGuard). */
export function obf_neutral(o) {
	for (let k in core.OBF_KEYS) {
		let v = o?.[k];
		if (v == null || v == '')
			continue;
		let want = { h1: '1', h2: '2', h3: '3', h4: '4' }[k] ?? '0';
		if (`${v}` != want)
			return false;
	}
	return true;
};

/**
 * The junk a device sends is its own: within the preset's own ranges, the
 * count and sizes are shifted a little by the device (deterministic, so the
 * configuration keeps its fingerprint), so two phones of one family do not
 * share one profile. Server-side values (headers, padding sizes, the header
 * protection key) stay the server's.
 */
function client_obf(srv, dev) {
	let o = { ...srv.obf };
	if (obf_neutral(o) || !(+o.jc > 0))
		return o;
	let key = `${srv.id}/${dev.id}/${srv.obf.h1 ?? ''}`;
	let seed = 2166136261;
	for (let i = 0; i < length(key); i++)
		seed = ((seed ^ ord(key, i)) * 16777619) & 0x7fffffff;
	let pick = (n) => {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		return seed % n;
	};
	let jc = +o.jc, jmin = +o.jmin, jmax = +o.jmax;
	o.jc = `${max(1, min(10, jc + pick(3) - 1))}`;
	if (jmax > jmin + 32) {
		let d = pick(17);
		o.jmin = `${jmin + d}`;
		o.jmax = `${jmax - pick(17)}`;
		if (+o.jmax <= +o.jmin)
			o.jmax = `${+o.jmin + 32}`;
	}
	return o;
}

/**
 * The keep-alive `dev` gets (its own or the server's, core.device_keepalive)
 * as [ lo, hi ] seconds; null when it is off (0). With 3.1 (header
 * protection: its apps take ranges) jittered over ten seconds like the other
 * timers, since a fixed beat would be the one regular thing left. The online
 * window follows its upper end (dawnline.live).
 */
export function keepalive_range(srv, dev) {
	let k = core.device_keepalive(srv, dev);
	if (!(k > 0))
		return null;
	return srv.obf?.header_protection_key ? [ k, k + 10 ] : [ k, k ];
};

/**
 * The longest an idle device goes between two handshakes, in seconds; null
 * when its keep-alive is off (an idle device then sends nothing at all). Its
 * keep-alive packets are what it sends, and the first one after its key's
 * rekey time (RekeyAfterTime, WireGuard's 120 s; past 180 s the key is
 * refused anyway) starts a handshake (kmod send.c keep_key_fresh): up to one
 * keep-alive past that time, or each keep-alive once they are further apart.
 */
export function idle_handshake(srv, dev) {
	let ka = keepalive_range(srv, dev);
	if (!ka)
		return null;
	let rekey = min(uint_range(srv.obf?.rekey_after_time ?? '', 65535)?.[1] || 120, 180);
	return ka[0] > rekey ? ka[1] : rekey + ka[1];
};

/**
 * keepalive_range() as the apps write it ("25-35", "25"); null when off. The
 * .conf and the AmneziaVPN key carry the same text (AmneziaVPN hands it on as
 * written, ranges included).
 */
function keepalive_text(srv, dev) {
	let r = keepalive_range(srv, dev);
	if (!r)
		return null;
	return r[0] == r[1] ? `${r[0]}` : `${r[0]}-${r[1]}`;
}

export function client_config(m, dev) {
	let p = m.people[dev.person];
	let srv = p ? m.servers[p.server] : null;
	if (!srv)
		return null;
	let host = core.endpoint_host(m, srv);
	let ep = index(host, ':') >= 0 && substr(host, 0, 1) != '[' ? `[${host}]` : host;
	let allowed = allowed_ips(m, srv, p, dev);
	let dns = core.client_dns(m, srv, p);
	let mtu = core.device_mtu(srv, dev);
	let lines = [ '[Interface]' ];
	push(lines, `PrivateKey = ${dev.private_key || '<private key stays on your device>'}`);
	push(lines, `Address = ${dev.address}/32`);
	if (length(dns))
		push(lines, `DNS = ${join(', ', dns)}`);
	push(lines, `MTU = ${mtu}`);
	// "Off" is plain WireGuard: neutral values (no junk, H1-H4 = 1-4) are left
	// out, so any WireGuard app accepts the file.
	let obf = client_obf(srv, dev);
	if (!obf_neutral(obf))
		for (let k in core.OBF_KEYS)
			if (obf[k] != null && obf[k] != '')
				push(lines, `${OBF_CONF[k]} = ${obf[k]}`);
	push(lines, '', '[Peer]');
	push(lines, `PublicKey = ${srv.public_key}`);
	if (dev.preshared_key)
		push(lines, `PresharedKey = ${dev.preshared_key}`);
	push(lines, `AllowedIPs = ${join(', ', allowed)}`);
	push(lines, `Endpoint = ${ep}:${srv.port}`);
	let keepalive = keepalive_text(srv, dev);
	if (keepalive)
		push(lines, `PersistentKeepalive = ${keepalive}`);
	return {
		name: dev.name,
		person: p.name,
		server: srv.name,
		// The file name is the tunnel's name in WireGuard apps: the server's, in the portal and the admin alike.
		filename: `${tunnel_name(srv.name)}.conf`,
		conf: join('\n', lines) + '\n',
		has_private_key: dev.private_key != '',
		amnezia: {
			host,
			port: srv.port,
			mtu: `${mtu}`,
			dns,
			allowed_ips: allowed,
			client_ip: dev.address,
			client_priv_key: dev.private_key,
			client_pub_key: dev.public_key,
			psk_key: dev.preshared_key,
			server_pub_key: srv.public_key,
			persistent_keep_alive: keepalive ?? '0',
			obfuscation: obf,
		},
	};
};




/* ---------- the server's tunnel ---------- */

/** netifd options of the server's interface (proto amneziawg). */
export function netifd_options(srv) {
	let addr = core.server_address(srv);
	let prefix = split(srv.subnet, '/')[1];
	let o = {
		proto: 'amneziawg',
		private_key: srv.private_key,
		listen_port: srv.port,
		addresses: [ `${addr}/${prefix}` ],
		mtu: core.tunnel_mtu(srv),
	};
	for (let k in core.OBF_KEYS)
		o[`awg_${k}`] = srv.obf[k];
	// DisableCookies is the devices' alone (their .conf and key keep it): on
	// the server it would turn off WireGuard's own defence against a flood of
	// handshakes (cookie replies and a per-address limit, only ever under
	// load), and anyone who held a configuration could keep both cores busy.
	// Null takes it off an interface that had it.
	o.awg_disable_cookies = null;
	return o;
};

/** Person states whose devices stay in the tunnel: active, and the limits the portal explains. */
export const SOFT_STATES = [ 'active', 'quota', 'hours' ];

/**
 * The devices sync_peers() loads into server `sid`'s tunnel, in the model's
 * order (an empty list when none). Pure: the model and the people's states
 * (apply.states_for). Health and the agent compare a running tunnel with it.
 */
export function tunnel_devices(m, sid, states) {
	let out = [];
	let own = m.servers?.[sid]?.public_key;
	for (let did, d in m.devices) {
		let p = m.people[d.person];
		// One malformed line makes syncconf refuse the whole server: such a device
		// stays out (Health's Data check names it), and so does one with the
		// server's own key, which the kernel silently ignores (it would look
		// missing for ever). Over the data limit or outside the allowed hours the
		// tunnel stays: the access table blocks everything but the portal, which
		// says why (a silent handshake failure would look like a broken VPN).
		if (p && p.server == sid && !d.disabled && index(SOFT_STATES, states[p.id]) >= 0 && valid_key(d.public_key) && ip2int(d.address) != null &&
			(!own || d.public_key != own))
			push(out, d);
	}
	return out;
};

/**
 * How the peers dump() read on `ifname` differ from the devices that belong
 * there (tunnel_devices): { loaded, missing, extra }, counted by key, not by
 * number (a stale peer standing in for a missing one would make the numbers
 * match). Pure.
 */
export function peer_diff(devs, dmp, ifname) {
	let want = {};
	for (let d in devs)
		want[d.public_key] = true;
	let loaded = 0, extra = 0, found = 0;
	for (let k, p in dmp.peers)
		if (p.ifname == ifname) {
			loaded++;
			if (want[k])
				found++;
			else
				extra++;
		}
	return { loaded, missing: length(keys(want)) - found, extra };
};

/** Push the peer list of every server to the kernel without restarting it. */
export function sync_peers(m, states) {
	ensure_dir(RUN_DIR);
	let res = {};
	for (let id, srv in m.servers) {
		// Only Dawnline's own interfaces: never another tunnel of the same name (core.tunnels).
		if (!srv.enabled || !length(core.tunnels(srv)))
			continue;
		if (system(`awg show ${q(srv.ifname)} public-key >/dev/null 2>&1`) != 0) {
			res[id] = 'down';
			continue;
		}
		let lines = [ '[Interface]', `PrivateKey = ${srv.private_key}`, `ListenPort = ${srv.port}`, '' ];
		for (let d in tunnel_devices(m, id, states)) {
			push(lines, '[Peer]', `PublicKey = ${d.public_key}`);
			if (d.preshared_key)
				push(lines, `PresharedKey = ${d.preshared_key}`);
			push(lines, `AllowedIPs = ${d.address}/32`, '');
		}
		let f = `${RUN_DIR}/${srv.ifname}.conf`;
		write_file(f, join('\n', lines));
		let r = sh(`awg syncconf ${q(srv.ifname)} ${f}`);
		unlink(f);
		res[id] = r.code == 0 ? 'ok' : trim(r.out);
		if (r.code != 0)
			slog('awg', 'error', L_("couldn't load devices into the tunnel"), trim(r.out), srv.name);
	}
	return res;
};

/** The interface's index while it exists (a new one each time netifd sets the tunnel up), else null. */
function ifindex(ifname) {
	let s = trim(readfile(`/sys/class/net/${ifname}/ifindex`) ?? '');
	return s != '' ? +s : null;
}

/*
 * One interface's `awg show <ifname> dump` into `out` (see dump()). Lines are
 * told apart by their shape, not their length (each AmneziaWG generation adds
 * fields to the interface line): an interface line carries its private and
 * public key and a port, a peer line the peer's key, a preshared key or
 * "(none)" and an endpoint. Unlike `show all`, the lines have no ifname.
 */
function read_iface(out, ifname) {
	// Read around the call: a link set up again in between gave counters of either one.
	let before = ifindex(ifname);
	// Not there (a tunnel netifd could not bring up, AmneziaWG gone after an
	// upgrade): no process to learn it. One that appears is read next time.
	if (before == null) {
		out.reads[ifname] = 'down';
		return;
	}
	let r = sh(`awg show ${q(ifname)} dump`);
	let ix = ifindex(ifname);
	let iface = null, peers = {};
	if (r.code == 0)
		for (let line in split(r.out, '\n')) {
			let f = split(line, '\t');
			if (length(f) < 4 || !valid_key(f[0]))
				continue;
			let key2 = valid_key(f[1]);
			if (key2 && match(f[2], DIGITS))
				iface = { public_key: f[1], port: +f[2], ifindex: ix };
			else if (length(f) >= 8 && (key2 || f[1] == '(none)'))
				peers[f[0]] = {
					ifname,
					endpoint: f[2] == '(none)' ? '' : f[2],
					handshake: +f[4],
					rx: +f[5],
					tx: +f[6],
				};
		}
	let read = iface != null;
	// Gone during the read: its peers and their counters are gone with it.
	if (ix == null) {
		out.reads[ifname] = 'down';
		return;
	}
	if (!read || ix != before) {
		out.reads[ifname] = 'error';
		out.ok = false;
		return;
	}
	out.reads[ifname] = 'read';
	out.ifaces[ifname] = iface;
	for (let k, p in peers)
		out.peers[k] = p;
}

/**
 * Dawnline's own tunnels, one `awg show <ifname> dump` each for `ifnames`
 * (live.tunnel_ifnames): never `all`, so another AmneziaWG interface on the
 * router (a client tunnel with long I1-I5, say) neither slows the 1-second
 * watcher down nor has its keys read. Returns { ok, reads: { ifname: 'read' |
 * 'down' | 'error' }, ifaces: { ifname: { public_key, port, ifindex } },
 * peers: { pubkey: { ifname, endpoint, handshake, rx, tx } } }, with only
 * what was read in `ifaces` and `peers`:
 *   down   the interface does not exist (/sys/class/net has no such link;
 *          no process is started for it): its peers and counters are gone
 *   error  it exists but could not be read (or was set up again during the
 *          read): that says nothing about its peers
 * `ok` is false when any of them is 'error' (true for an empty list).
 */
export function dump(ifnames) {
	let out = { ok: true, reads: {}, ifaces: {}, peers: {} };
	for (let ifn in ifnames ?? [])
		read_iface(out, ifn);
	return out;
};

/** Is the server's tunnel up and listening (for status and Overview). */
export function server_state(srv) {
	let st = iface_status(srv.ifname);
	return { up: !!st?.up, uptime: st?.uptime ?? 0 };
};

/* ---------- why a tunnel is kept down ---------- */

/*
 * dawnline.netifd keeps a server's tunnel down for a reason, kept per server
 * in core.BLOCKED and loaded as `srv.blocked`. apply writes it, at boot and
 * from the agent with no language, so it holds a code and its values, made
 * into text when read:
 *   { code: 'ifname', ifname }             the interface name is invalid
 *   { code: 'taken', ifname }              network.<ifname> exists and isn't Dawnline's
 *   { code: 'disguise', need, installed }  obf_unsupported()
 *   { code: 'disguise_invalid' }           obf_unsafe() finds values AmneziaWG refuses
 *                                          (said again from the server's values when read)
 * Files written by older versions hold the English fragment ("has an invalid
 * interface name …"), shown as it is.
 */

/** A reason as the service log says it after the server's name: English, like every log line. */
export function blocked_note(r) {
	if (type(r) != 'object')
		return `${r}`;
	if (r.code == 'ifname')
		return sprintf(L_('has an invalid interface name "%s"'), r.ifname);
	if (r.code == 'taken')
		return sprintf(L_("can't use the network interface %s: it exists and isn't Dawnline's"), r.ifname);
	if (r.code == 'disguise')
		return r.installed ? sprintf(L_('is kept down: its disguise needs AmneziaWG %s (installed: %s)'), r.need, r.installed)
			: sprintf(L_('is kept down: its disguise needs AmneziaWG %s (installed: none)'), r.need);
	if (r.code == 'disguise_invalid')
		return L_('is kept down: its disguise has values AmneziaWG cannot take');
	return L_('is kept down');
};

/** What to do about a reason (blocked_note), for the service log's details. */
export function blocked_fix(r) {
	if (r?.code == 'disguise')
		return L_('Install that AmneziaWG build in Dawnline → Components, or switch the disguise on the Server page.');
	if (r?.code == 'disguise_invalid')
		return L_('Choose a disguise on the Server page: it replaces the values set by hand.');
	return L_('Choose another interface name in the server settings.');
};

/**
 * Why the server's tunnel is kept down (`srv.blocked`), as a sentence with
 * its name in the reader's language: what the admin UI shows. Null when it
 * is not kept down.
 */
export function blocked_text(srv) {
	let r = srv?.blocked;
	if (!r)
		return null;
	if (type(r) != 'object')
		return `${srv.name} ${r}.`;
	if (r.code == 'ifname')
		return sprintf(_('%s has an invalid interface name "%s".'), srv.name, r.ifname);
	if (r.code == 'taken')
		return sprintf(_("%s can't use the network interface %s: it exists and isn't Dawnline's."), srv.name, r.ifname);
	if (r.code == 'disguise')
		return r.installed
			? sprintf(_('%s is kept down: its disguise needs AmneziaWG %s (installed: %s).'), srv.name, r.need, r.installed)
			: sprintf(_('%s is kept down: its disguise needs AmneziaWG %s (installed: none).'), srv.name, r.need);
	// Which values, from the server's own (the reason is kept as a code).
	if (r.code == 'disguise_invalid')
		return trim(sprintf(_('%s is kept down: its disguise has values AmneziaWG cannot take. %s'), srv.name, join(' ', obf_unsafe(srv.obf))));
	return sprintf(_('%s is kept down.'), srv.name);
};

/* ---------- watchdog ---------- */

/** Why a tunnel is down, from netifd and the last related syslog lines. */
export function iface_errors(ifname) {
	let s = iface_status(ifname);
	let errs = map(s?.errors ?? [], (e) => e.code + (length(e.data ?? []) ? ` (${join(' ', e.data)})` : ''));
	// Only what explains a failure, not the ordinary "is now up/down" lines.
	let lines = sh_out(`logread -l 400 2>/dev/null | grep -E ${q(`${ifname}|amneziawg`)} | grep -iE 'error|fail|invalid|unrecogni|cannot|unable|not found|refused|denied' | tail -n 6`);
	return join('\n', filter([ length(errs) ? `netifd: ${join(', ', errs)}` : null, lines ], (x) => x));
};

/**
 * What the watchdog looks at for AmneziaWG (see dawnline.watchdog):
 * AmneziaWG itself, then every running server's tunnel. `ctx.udp_listening`,
 * `ctx.reapply` and `ctx.owner` (dawnline.netifd) come from the watchdog
 * (ops, apply and netifd import this module).
 */
export function probes(m, ctx) {
	let out = [];
	let srvs = filter(values(m.servers), (x) => x.enabled && x.private_key);
	if (!length(srvs))
		return out;
	// AmneziaWG itself first: without it no tunnel can run (they come back on the next pass).
	// Missing packages and an unknown protocol are reported once; only the module can be loaded here.
	let st = state();
	let base = { id: 'awg', src: 'awg', name: 'AmneziaWG', who: 'AmneziaWG', back: L_('is ready again') };
	if (!st.tools || !st.kmod) {
		push(out, { ...base, ok: false, repair: null,
			problem: st.tools ? L_("kernel module isn't installed: no tunnel can run - install it in Dawnline → Components")
				: L_("isn't installed: no tunnel can run - install it in Dawnline → Components"),
			detail: () => sprintf(L_('Missing: %s.'), join(', ', st.missing)) });
		return out;
	}
	push(out, { ...base, ok: st.loaded && st.handler,
		problem: !st.loaded ? L_("kernel module isn't loaded") : L_("isn't known to the network service - restart the network or reboot"),
		detail: !st.loaded
			? () => sh_out("modprobe amneziawg 2>&1; dmesg 2>/dev/null | grep -i amneziawg | grep -iE 'error|fail|invalid|unknown|disagrees|taint' | tail -n 4")
			: () => L_('netifd reads its protocol handlers when it starts; it was running before AmneziaWG was installed.'),
		repair: !st.loaded ? { what: L_('loading it'), run: () => system('modprobe amneziawg >/dev/null 2>&1') } : null,
	});
	// Without the protocol handler ifup cannot work: the tunnels are not probed (or restarted) one by one.
	if (st.loaded && !st.handler)
		return out;
	for (let srv in srvs) {
		// A tunnel Dawnline may not set up (dawnline.netifd) is reported, never restarted:
		// an interface of the same name that isn't Dawnline's may be your LAN.
		let own = core.valid_ifname(srv.ifname) ? ctx.owner?.(srv.ifname) : null;
		let why = srv.blocked ?? (!core.valid_ifname(srv.ifname) ? { code: 'ifname', ifname: srv.ifname }
			: own != null && own != srv.id ? { code: 'taken', ifname: srv.ifname } : null);
		if (why) {
			push(out, {
				id: `up_${srv.id}`, src: 'awg', name: `${srv.name} · AmneziaWG`, who: srv.name, ok: false, repair: null,
				problem: blocked_note(why), back: L_('AmneziaWG is running again'),
				detail: () => blocked_fix(why),
			});
			continue;
		}
		let s = iface_status(srv.ifname);
		let up = !!s?.up;
		push(out, {
			id: `up_${srv.id}`, src: 'awg', name: `${srv.name} · AmneziaWG`, who: srv.name, ok: up && ctx.udp_listening(srv.port),
			problem: !s ? L_('AmneziaWG is missing from the router') : !up ? L_("AmneziaWG isn't running")
				: sprintf(L_("AmneziaWG isn't accepting connections on port %d"), srv.port),
			back: sprintf(L_('AmneziaWG is running again · accepting connections on port %d'), srv.port),
			detail: () => iface_errors(srv.ifname),
			repair: s ? { what: L_('restarting it'), run: () => system(`ifup ${q(srv.ifname)}`) } : { what: L_('setting it up again'), run: ctx.reapply },
		});
	}
	return out;
};

/* ---------- issued configurations ---------- */

const ISSUED = `${DATA_DIR}/issued.json`;
// The lines a fingerprint leaves out. A module constant, compiled once, not
// for each line of each device's configuration.
const DEVICE_OWN = /^(PrivateKey|Jc|Jmin|Jmax) /;

function fnv32(str) {
	let h = 2166136261;
	for (let i = 0; i < length(str); i++)
		h = ((h ^ ord(str, i)) * 16777619) & 0xffffffff;
	return sprintf('%08x', h);
}

/**
 * What a device holds, minus its private key: changes when it must import
 * again. The junk count and sizes (Jc, Jmin, Jmax) are the device's own and
 * never have to match the server, so they are left out: a change there is
 * no reason to import again.
 */
export function config_fingerprint(m, dev) {
	let c = dev ? client_config(m, dev) : null;
	return c ? fnv32(join('\n', filter(split(c.conf, '\n'), (l) => !match(l, DEVICE_OWN)))) : null;
};

/** Device id → fingerprint of the configuration last shown or downloaded. */
export function issued() {
	return read_json(ISSUED, {});
};

/** Remember that a device was just given its current configuration. */
export function mark_issued(m, id) {
	let fp = config_fingerprint(m, m.devices[id]);
	if (!fp)
		return;
	let l = lock('issued');
	let all = issued();
	if (all[id] != fp) {
		all[id] = fp;
		for (let k in keys(all))
			if (!m.devices[k])
				delete all[k];
		ensure_dir(DATA_DIR, 0o700);
		write_json(ISSUED, all, 0o600);
	}
	unlock(l);
};

/* ---------- set up again (Reconnect) ---------- */

const RECONNECT = `${DATA_DIR}/reconnect.json`;

/** Device id → when the person asked to set it up again (router clock). */
export function reconnects() {
	return read_json(RECONNECT, {});
};

/**
 * The handshake a device counts with: none from before it was set up again,
 * so it shows "Not set up yet" until it connects after that.
 */
export function handshake_since(hs, since) {
	return since && hs <= since ? 0 : hs;
};

/** A device is set up again: handshakes up to `at` (router clock) are its old configuration's. */
export function mark_reconnect(m, id, at) {
	let l = lock('reconnect');
	let all = reconnects();
	all[id] = at ?? time();
	for (let k in keys(all))
		if (!m.devices[k])
			delete all[k];
	ensure_dir(DATA_DIR, 0o700);
	write_json(RECONNECT, all, 0o600);
	unlock(l);
};

