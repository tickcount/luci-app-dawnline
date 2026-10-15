// Dawnline — data model: reads /etc/config/dawnline, validates and mutates it,
// allocates addresses, generates keys and renders client configurations.

import { cursor } from 'uci';
import { readfile } from 'fs';
import {
	q, sh, sh_out, valid_name, valid_key, valid_host, valid_date, slugify,
	parse_cidr, cidr_str, cidr_overlaps, int2ip, ip2int, in_cidr, rand_token, rand_hex, rand_int, rand_bytes,
	date_end, month_key, read_json, write_json, ensure_dir, lock, unlock, DATA_DIR, RUN_DIR, uniq
} from 'dawnline.util';
import * as net from 'dawnline.net';
import * as loop from 'dawnline.loop';

export const CONFIG = 'dawnline';
export const ACCESS = [ 'lan', 'internet', 'both' ];
export const KINDS = [ 'computer', 'phone', 'tablet', 'router', 'other' ];
export const OBF_KEYS = [ 'jc', 'jmin', 'jmax', 's1', 's2', 's3', 's4', 'h1', 'h2', 'h3', 'h4', 'i1', 'i2', 'i3', 'i4', 'i5',
	// AmneziaWG 3.x
	'header_protection_key', 'content_padding_addition', 'rekey_after_time', 'rekey_timeout', 'reject_after_time',
	'keepalive_timeout', 'max_handshake_attempts', 'random_trailers', 'disable_cookies' ];

/** Names in .conf files (and AmneziaVPN keys); netifd uses `awg_<key>`. */
export const OBF_CONF = {
	jc: 'Jc', jmin: 'Jmin', jmax: 'Jmax', s1: 'S1', s2: 'S2', s3: 'S3', s4: 'S4',
	h1: 'H1', h2: 'H2', h3: 'H3', h4: 'H4', i1: 'I1', i2: 'I2', i3: 'I3', i4: 'I4', i5: 'I5',
	header_protection_key: 'HeaderProtectionKey', content_padding_addition: 'ContentPaddingAddition',
	rekey_after_time: 'RekeyAfterTime', rekey_timeout: 'RekeyTimeout', reject_after_time: 'RejectAfterTime',
	keepalive_timeout: 'KeepaliveTimeout', max_handshake_attempts: 'MaxHandshakeAttempts',
	random_trailers: 'RandomTrailers', disable_cookies: 'DisableCookies',
};

function toint(v, dflt) {
	if (v == null || v == '')
		return dflt;
	let n = +v;
	return n != n ? dflt : int(n);
}

function num(v, dflt) {
	if (v == null || v == '')
		return dflt;
	let n = +v;
	return n != n ? dflt : n;
}

function bool(v, dflt) {
	if (v == null || v == '')
		return dflt;
	return v == '1' || v == 'true' || v == 'yes' || v == 'on';
}

function list(v) {
	if (v == null)
		return [];
	return type(v) == 'array' ? v : split(trim(v), /[[:space:],]+/);
}

/* ---------- load ---------- */

export function open_cursor() {
	let c = cursor();
	c.load(CONFIG);
	return c;
};

export function load(c) {
	c ??= open_cursor();
	let s = c.get_all(CONFIG, 'settings') ?? {};
	let m = {
		settings: {
			portal_enabled: bool(s.portal_enabled, false),
			portal_port: toint(s.portal_port, 8443),
			// Also answer on 443 from the internet (mobile networks often drop TLS on other ports).
			portal_443: bool(s.portal_443, true),
			portal_host: s.portal_host ?? '',
			// More addresses for the same links (the main one is portal_host).
			portal_alt: filter(type(s.portal_alt) == 'array' ? s.portal_alt : s.portal_alt ? [ s.portal_alt ] : [], (x) => x != ''),
			portal_cert: s.portal_cert ?? '',
			portal_key: s.portal_key ?? '',
			portal_title: s.portal_title ?? 'Dawnline',
			// Where unknown portal links go instead of a bare 404 (empty = 404).
			portal_redirect: s.portal_redirect ?? '',
			paused_all: bool(s.paused_all, false),
			default_device_limit: toint(s.default_device_limit, 3),
			geo_enabled: bool(s.geo_enabled, true),
			geo_provider: s.geo_provider == 'ipapi.co' ? 'ipapi.co' : 'ipwho.is',
			hostnames: bool(s.hostnames, true),
			domain: s.domain ?? 'lan',
			log_connections: bool(s.log_connections, true),
			// Repair tunnels and services on its own (the agent, every minute).
			watchdog: bool(s.watchdog, true),
			// Second DNS for "home names" devices, used by the device when the tunnel is down.
			home_dns_fallback: s.home_dns_fallback == 'none' ? '' : (s.home_dns_fallback ?? '1.1.1.1'),
			// Raw retention values; dawnline.live policy() interprets them.
			retention: {
				log_keep_days: s.log_keep_days, log_max: s.log_max, log_category: s.log_category,
				log_connections: s.log_connections, log_persist: s.log_persist,
				usage_keep_days: s.usage_keep_days, usage_keep_months: s.usage_keep_months,
			},
		},
		servers: {},
		people: {},
		devices: {},
		services: {},
	};

	c.foreach(CONFIG, 'server', (r) => {
		let id = r['.name'];
		let srv = {
			id,
			name: r.name ?? id,
			ifname: r.ifname ?? id,
			port: toint(r.port, 51820),
			subnet: r.subnet ?? '',
			endpoint: r.endpoint ?? '',
			mtu: toint(r.mtu, 1380),
			dns: list(r.dns),
			keepalive: toint(r.keepalive, 25),
			private_key: r.private_key ?? '',
			public_key: r.public_key ?? '',
			preset: r.preset ?? 'standard',
			lan_zone: r.lan_zone ?? 'lan',
			wan_zone: r.wan_zone ?? 'wan',
			auto_wan: bool(r.auto_wan, true),
			wan_device: r.wan_device ?? '',
			auto_lan: bool(r.auto_lan, true),
			lan_devices: list(r.lan_device),
			detected_wan: r.detected_wan ?? '',
			detected_lan: r.detected_lan ?? '',
			lan_like: bool(r.lan_like, true),
			// Devices of people with home access reach each other through the tunnel.
			device_mesh: bool(r.device_mesh, true),
			enabled: bool(r.enabled, true),
			obf: {},
		};
		for (let k in OBF_KEYS)
			if (r[k] != null && r[k] != '')
				srv.obf[k] = `${r[k]}`;
		m.servers[id] = srv;
	});

	c.foreach(CONFIG, 'person', (r) => {
		let id = r['.name'];
		m.people[id] = {
			id,
			server: r.server ?? '',
			name: r.name ?? id,
			access: index(ACCESS, r.access) >= 0 ? r.access : 'internet',
			device_limit: toint(r.device_limit, m.settings.default_device_limit),
			code: r.code ?? '',
			expires: r.expires ?? '',
			quota_gb: num(r.quota_gb, 0),
			quota_period: r.quota_period == 'total' ? 'total' : 'month',
			paused: bool(r.paused, false),
			hours: r.hours ?? '',
			expire_action: index([ 'pause', 'notify', 'remove' ], r.expire_action) >= 0 ? r.expire_action : 'pause',
			// Home-only access: keep the device's own DNS, or use home names (Dawnline's resolver).
			dns_mode: r.dns_mode == 'home' ? 'home' : 'device',
			expire_warn: toint(r.expire_warn, 3),
			bonus_gb: num(r.bonus_gb, 0),
			bonus_month: r.bonus_month ?? '',
			services: list(r.service),
			note: r.note ?? '',
			created: toint(r.created, 0),
			devices: [],
		};
	});

	c.foreach(CONFIG, 'device', (r) => {
		let id = r['.name'];
		let d = {
			id,
			person: r.person ?? '',
			name: r.name ?? id,
			kind: index(KINDS, r.kind) >= 0 ? r.kind : 'other',
			address: r.address ?? '',
			public_key: r.public_key ?? '',
			private_key: r.private_key ?? '',
			preshared_key: r.preshared_key ?? '',
			created: toint(r.created, 0),
			created_by: r.created_by ?? 'admin',
			disabled: bool(r.disabled, false),
		};
		m.devices[id] = d;
		if (m.people[d.person])
			push(m.people[d.person].devices, id);
	});

	c.foreach(CONFIG, 'service', (r) => {
		let id = r['.name'];
		m.services[id] = {
			id,
			name: r.name ?? id,
			address: r.address ?? '',
			ports: list(r.port),
		};
	});

	return m;
};

/* ---------- derived state ---------- */

/** Parse "07:00-23:00" → [startMin, endMin] or null. */
export function parse_hours(s) {
	let m = match(s ?? '', /^([0-9]{1,2}):([0-9]{2})-([0-9]{1,2}):([0-9]{2})$/);
	if (!m)
		return null;
	let a = +m[1] * 60 + +m[2], b = +m[3] * 60 + +m[4];
	if (a >= 1440 || b > 1440 || a == b)
		return null;
	return [ a, b ];
};

function within_hours(h, ts) {
	let t = localtime(ts);
	let cur = t.hour * 60 + t.min;
	return h[0] < h[1] ? (cur >= h[0] && cur < h[1]) : (cur >= h[0] || cur < h[1]);
}

/** Bytes used in the person's quota period. */
export function person_usage(p, usage) {
	let u = usage?.people?.[p.id];
	if (!u)
		return 0;
	if (p.quota_period == 'total')
		return (u.total?.[0] ?? 0) + (u.total?.[1] ?? 0);
	let mm = u.months?.[month_key()];
	return mm ? mm[0] + mm[1] : 0;
};

/** Quota in bytes for the current period (base + this month's bonus), 0 = unlimited. */
export function person_quota(p) {
	if (!(p.quota_gb > 0))
		return 0;
	let gb = p.quota_gb;
	if (p.bonus_gb > 0 && p.bonus_month == month_key())
		gb += p.bonus_gb;
	return gb * 1073741824;
};

export function person_expired(p, ts) {
	if (p.expires == '')
		return false;
	let end = date_end(p.expires);
	return end != null && (ts ?? time()) > end;
};

/**
 * Effective state of a person: 'active', or why they are off:
 * 'paused' (admin), 'paused_all', 'expired', 'quota', 'hours', 'no_server'.
 */
export function person_state(m, p, usage, ts) {
	ts ??= time();
	let srv = m.servers[p.server];
	if (!srv || !srv.enabled)
		return 'no_server';
	if (p.paused)
		return 'paused';
	if (m.settings.paused_all)
		return 'paused_all';
	// "notify" keeps access after the end date (shown in Overview and People).
	if (person_expired(p, ts) && p.expire_action != 'notify')
		return 'expired';
	let quota = person_quota(p);
	if (quota > 0 && person_usage(p, usage) >= quota)
		return 'quota';
	let h = parse_hours(p.hours);
	if (h && !within_hours(h, ts))
		return 'hours';
	return 'active';
};

export function load_usage() {
	return read_json(`${RUN_DIR}/usage.json`, null) ?? read_json(`${DATA_DIR}/usage.json`, { devices: {}, people: {} });
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

export function genpsk() {
	return sh_out('awg genpsk');
};

/* ---------- networks ---------- */

/** IPv4 subnets of the router's LAN zone (from netifd), as CIDR strings. */
/** Router address inside the server subnet (first host). */
export function server_address(srv) {
	let c = parse_cidr(srv.subnet);
	return c ? int2ip(c.first) : null;
};

export function alloc_address(m, srv) {
	let c = parse_cidr(srv.subnet);
	if (!c)
		return null;
	let used = {};
	used[c.first] = true;
	for (let id, d in m.devices) {
		let p = m.people[d.person];
		if (p && p.server == srv.id) {
			let n = ip2int(d.address);
			if (n != null)
				used[n] = true;
		}
	}
	for (let n = c.first + 1; n <= c.last; n++)
		if (!used[n])
			return int2ip(n);
	return null;
};

/* ---------- obfuscation ---------- */

const OBF_SPEC = { jc: [ 0, 10 ], jmin: [ 64, 1024 ], jmax: [ 64, 1024 ], s1: [ 0, 64 ], s2: [ 0, 64 ], s3: [ 0, 64 ], s4: [ 0, 32 ] };

function rand_h(used) {
	for (let i = 0; i < 50; i++) {
		let v = rand_int(5, 2147483647);
		if (!used[v]) {
			used[v] = true;
			return `${v}`;
		}
	}
}

/**
 * What the installed AmneziaWG can do, from the netifd protocol script (the
 * options it passes on) and the `awg` tool (the keys it accepts):
 *   v2 — S3/S4, I1-I5, header ranges (AWG 1.5/2.0)
 *   v3 — header protection, trailers, padding, timing (AWG 3.1)
 */
export function awg_caps() {
	let script = readfile('/lib/netifd/proto/amneziawg.sh') ?? '';
	let tool = sh_out("grep -a -o -m1 'HeaderProtectionKey' /usr/bin/awg 2>/dev/null") ?? '';
	let v2 = index(script, 'awg_s3') >= 0 && index(script, 'awg_i1') >= 0;
	let v3 = v2 && index(script, 'awg_header_protection_key') >= 0 && tool != '';
	return { v2, v3 };
};

/** First junk packet shaped like a DNS answer (AmneziaVPN's own default for 3.1). */
const DNS_MIMIC = '<r 2><b 0x858000010001000000000669636c6f756403636f6d0000010001c00c000100010000105a00044d583737>';

/**
 * Generate obfuscation parameters for a method:
 *   off      plain WireGuard-compatible packets
 *   standard junk packets and random headers (any AmneziaWG client)
 *   strong   more and larger junk (any AmneziaWG client)
 *   max      AmneziaWG 3.1: protected headers, random trailers, padding,
 *            jittered timers and a DNS-like first packet — the values
 *            AmneziaVPN itself uses for 3.1 servers
 */
export function obf_preset(name) {
	if (name == 'max')
		return {
			jc: `${rand_int(4, 6)}`, jmin: '10', jmax: '50',
			s1: '12', s2: '12', s3: '12', s4: '12',
			h1: '1', h2: '2', h3: '3', h4: '4',
			i1: DNS_MIMIC,
			header_protection_key: genkey(),
			content_padding_addition: '10-100',
			rekey_after_time: '100-120', rekey_timeout: '3-7', reject_after_time: '150-180',
			keepalive_timeout: '5-15', max_handshake_attempts: '15-20',
			random_trailers: 'on', disable_cookies: 'on',
		};
	if (name == 'off')
		return { jc: '0', jmin: '0', jmax: '0', s1: '0', s2: '0', h1: '1', h2: '2', h3: '3', h4: '4' };
	let strong = name == 'strong';
	let o = {};
	o.jc = `${strong ? rand_int(6, 10) : rand_int(3, 6)}`;
	let jmin = rand_int(64, strong ? 128 : 96);
	o.jmin = `${jmin}`;
	o.jmax = `${jmin + rand_int(strong ? 200 : 32, strong ? 600 : 160)}`;
	let s1 = rand_int(15, 64), s2 = rand_int(15, 64);
	while (s1 + 56 == s2)
		s2 = rand_int(15, 64);
	o.s1 = `${s1}`;
	o.s2 = `${s2}`;
	let used = {};
	for (let k in [ 'h1', 'h2', 'h3', 'h4' ])
		o[k] = rand_h(used);
	return o;
};

export function obf_errors(o) {
	let errs = [];
	for (let k, r in OBF_SPEC) {
		let v = o[k];
		if (v == null || v == '')
			continue;
		if (!match(v, /^[0-9]+$/) || +v < r[0] || +v > r[1]) {
			if (!(v == '0' && (k == 'jmin' || k == 'jmax')))
				push(errs, `${k}=${v} (${r[0]}-${r[1]})`);
		}
	}
	if (o.jmin != null && o.jmax != null && +o.jmin > +o.jmax)
		push(errs, 'jmin > jmax');
	if (o.s1 != null && o.s2 != null && +o.s1 + 56 == +o.s2)
		push(errs, 's1 + 56 = s2');
	let hs = {};
	for (let k in [ 'h1', 'h2', 'h3', 'h4' ]) {
		let v = o[k];
		if (v == null || v == '')
			continue;
		if (!match(v, /^[0-9]+(-[0-9]+)?$/))
			push(errs, `${k} must be a number or range`);
		else if (hs[v])
			push(errs, 'h1-h4 must be distinct');
		hs[v] = true;
	}
	return errs;
};

/* ---------- client configuration ---------- */

export function endpoint_host(m, srv) {
	return srv.endpoint || m.settings.portal_host || '';
};

/**
 * DNS for a server's clients: the router's tunnel address, which never
 * changes after setup. The router forwards each query where it belongs (the
 * LAN's DNS, from the LAN side; or the plain resolver), so configurations on
 * devices keep working when the LAN, its DNS or the netns address change.
 */
export function dns_list(m, srv) {
	if (!srv)
		return [];
	if (length(srv.dns))
		return srv.dns;
	let a = server_address(srv);
	return a ? [ a ] : [];
};

/**
 * DNS written into a device's configuration. Home-only people keep their
 * device's DNS unless they chose home names; then the first server is
 * Dawnline's plain resolver (reached through the tunnel) and the second the
 * fallback the device uses when the tunnel is down.
 */
export function client_dns(m, srv, p) {
	if (p?.access != 'lan')
		return dns_list(m, srv);
	if (p.dns_mode != 'home')
		return [];
	let a = server_address(srv);
	let out = a ? [ a ] : [];
	if (m.settings.home_dns_fallback && m.settings.home_dns_fallback != a)
		push(out, m.settings.home_dns_fallback);
	return out;
};

export function allowed_ips(m, srv, p) {
	if (p.access == 'lan') {
		let nets = net.server_net(srv).nets;
		// With devices reaching each other, the whole tunnel network (the router's
		// address is in it); otherwise only the router's own address.
		let a = server_address(srv);
		if (srv.device_mesh && srv.subnet)
			push(nets, srv.subnet);
		else if (a)
			push(nets, `${a}/32`);
		// The resolver address must be reachable through the tunnel too (not the fallback).
		let dns = client_dns(m, srv, p)[0];
		if (dns)
			push(nets, `${dns}/32`);
		return net.collapse(nets);
	}
	return [ '0.0.0.0/0', '::/0' ];
};

/** Everything a client needs; `conf` is the .conf text. */
/** True when the obfuscation settings change nothing on the wire (plain WireGuard). */
export function obf_neutral(o) {
	for (let k in OBF_KEYS) {
		let v = o?.[k];
		if (v == null || v == '')
			continue;
		let want = { h1: '1', h2: '2', h3: '3', h4: '4' }[k] ?? '0';
		if (`${v}` != want)
			return false;
	}
	return true;
};

export function client_config(m, dev) {
	let p = m.people[dev.person];
	let srv = p ? m.servers[p.server] : null;
	if (!srv)
		return null;
	let host = endpoint_host(m, srv);
	let ep = match(host, /:/) && !match(host, /^\[/) ? `[${host}]` : host;
	let allowed = allowed_ips(m, srv, p);
	let dns = client_dns(m, srv, p);
	let lines = [ '[Interface]' ];
	push(lines, `PrivateKey = ${dev.private_key || '<private key stays on your device>'}`);
	push(lines, `Address = ${dev.address}/32`);
	if (length(dns))
		push(lines, `DNS = ${join(', ', dns)}`);
	push(lines, `MTU = ${srv.mtu}`);
	// "Off" is plain WireGuard: neutral values (no junk, H1-H4 = 1-4) are left
	// out, so any WireGuard app accepts the file.
	if (!obf_neutral(srv.obf))
		for (let k in OBF_KEYS)
			if (srv.obf[k] != null && srv.obf[k] != '')
				push(lines, `${OBF_CONF[k]} = ${srv.obf[k]}`);
	push(lines, '', '[Peer]');
	push(lines, `PublicKey = ${srv.public_key}`);
	if (dev.preshared_key)
		push(lines, `PresharedKey = ${dev.preshared_key}`);
	push(lines, `AllowedIPs = ${join(', ', allowed)}`);
	push(lines, `Endpoint = ${ep}:${srv.port}`);
	if (srv.keepalive > 0)
		push(lines, `PersistentKeepalive = ${srv.keepalive}`);
	return {
		name: dev.name,
		person: p.name,
		server: srv.name,
		filename: `${substr(replace(lc(p.id + '-' + dev.name), /[^a-z0-9]+/g, '-'), 0, 15)}.conf`,
		conf: join('\n', lines) + '\n',
		has_private_key: dev.private_key != '',
		amnezia: {
			host,
			port: srv.port,
			mtu: `${srv.mtu}`,
			dns,
			allowed_ips: allowed,
			client_ip: dev.address,
			client_priv_key: dev.private_key,
			client_pub_key: dev.public_key,
			psk_key: dev.preshared_key,
			server_pub_key: srv.public_key,
			persistent_keep_alive: `${srv.keepalive}`,
			obfuscation: srv.obf,
		},
	};
};

/* ---------- issued configurations ---------- */

const ISSUED = `${DATA_DIR}/issued.json`;

function fnv32(str) {
	let h = 2166136261;
	for (let i = 0; i < length(str); i++)
		h = ((h ^ ord(str, i)) * 16777619) & 0xffffffff;
	return sprintf('%08x', h);
}

/** What a device holds, minus its private key: changes when it must import again. */
export function config_fingerprint(m, dev) {
	let c = dev ? client_config(m, dev) : null;
	return c ? fnv32(join('\n', filter(split(c.conf, '\n'), (l) => !match(l, /^PrivateKey/)))) : null;
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

/* ---------- mutations (caller commits) ---------- */

function fail(msg) {
	die(msg);
}

/*
 * Personal codes are three pronounceable words of three syllables each
 * (kamiro-telosu-bavine): easy to read out or type, ~2^55 combinations, and
 * guessing is rate-limited by the portal. The code is the whole link path.
 */
export const WORD_CODE = /^[a-z]{6}-[a-z]{6}-[a-z]{6}$/;
const SYL_C = 'bdfgklmnprstvz', SYL_V = 'aeiou';
const CODE_AVOID = [ 'suka', 'pido', 'muda', 'zalup', 'dura', 'gavn' ];

function pick(alphabet) {
	let n = length(alphabet), lim = 256 - 256 % n;
	for (;;) {
		let b = ord(rand_bytes(1), 0);
		if (b < lim)
			return substr(alphabet, b % n, 1);
	}
}

export function new_code() {
	for (;;) {
		let words = [];
		for (let w = 0; w < 3; w++) {
			let s = '';
			for (let i = 0; i < 3; i++)
				s += pick(SYL_C) + pick(SYL_V);
			push(words, s);
		}
		let code = join('-', words);
		if (!length(filter(CODE_AVOID, (x) => index(code, x) >= 0)))
			return code;
	}
};

export function create_person(c, m, a) {
	if (!valid_name(a.name))
		fail('Enter a name (up to 48 characters).');
	// The id is a UCI section name: letters, digits and underscores only (a dash
	// makes uci drop the section). Repeated names get _2, _3, …
	let base = replace(a.slug ?? slugify(a.name), /-/g, '_');
	if (!match(base, /^[a-z0-9_]{1,32}$/))
		fail('The id may use lowercase letters, digits and underscores.');
	let taken = (id) => m.people[id] || m.servers[id] || m.devices[id] || m.services[id] || id == 'settings';
	let slug = base;
	for (let n = 2; taken(slug); n++) {
		if (n > 99)
			fail(`"${base}" is already taken.`);
		slug = `${substr(base, 0, 28)}_${n}`;
	}
	let srv_id = a.server ?? keys(m.servers)[0];
	if (!m.servers[srv_id])
		fail('Set up a server first.');
	let access = a.access ?? 'internet';
	if (index(ACCESS, access) < 0)
		fail('Access must be lan, internet or both.');
	let limit = toint(a.device_limit, m.settings.default_device_limit);
	if (limit < 1 || limit > 32)
		fail('Device limit must be between 1 and 32.');
	if (a.expires && !valid_date(a.expires))
		fail('End date must be YYYY-MM-DD.');
	let quota = num(a.quota_gb, 0);
	if (quota < 0 || quota > 100000)
		fail('Monthly data must be a positive number of GB.');

	c.set(CONFIG, slug, 'person');
	c.set(CONFIG, slug, 'server', srv_id);
	c.set(CONFIG, slug, 'name', trim(a.name));
	c.set(CONFIG, slug, 'access', access);
	c.set(CONFIG, slug, 'device_limit', `${limit}`);
	c.set(CONFIG, slug, 'code', new_code());
	c.set(CONFIG, slug, 'created', `${time()}`);
	if (a.expires)
		c.set(CONFIG, slug, 'expires', a.expires);
	if (quota > 0) {
		c.set(CONFIG, slug, 'quota_gb', `${quota}`);
		c.set(CONFIG, slug, 'quota_period', a.quota_period == 'total' ? 'total' : 'month');
	}
	return slug;
};

/**
 * Immediate edit of a person from the admin page. Only keys present in `a`
 * change; '' clears optional values (end date, data limit, hours).
 */
export function update_person(c, m, id, a) {
	let p = m.people[id];
	if (!p)
		fail('Unknown person.');
	let set = (k, v) => (v == null || v == '') ? c.delete(CONFIG, id, k) : c.set(CONFIG, id, k, `${v}`);
	if (a.name != null) {
		if (!valid_name(a.name))
			fail('Enter a name (up to 48 characters).');
		set('name', trim(a.name));
	}
	if (a.access != null) {
		if (index(ACCESS, a.access) < 0)
			fail('Access must be lan, internet or both.');
		set('access', a.access);
	}
	if (a.device_limit != null) {
		let n = toint(a.device_limit, 0);
		if (n < 1 || n > 32)
			fail('Device limit must be between 1 and 32.');
		if (n < length(p.devices))
			fail(`${p.name} already has ${length(p.devices)} devices. Remove one first to lower the limit to ${n}.`);
		set('device_limit', n);
	}
	if (a.expires != null) {
		if (a.expires != '' && !valid_date(a.expires))
			fail('End date must be YYYY-MM-DD.');
		set('expires', a.expires);
	}
	if (a.expire_action != null) {
		if (index([ 'pause', 'notify', 'remove' ], a.expire_action) < 0)
			fail('Unknown end action.');
		set('expire_action', a.expire_action == 'pause' ? '' : a.expire_action);
	}
	if (a.dns_mode != null) {
		if (index([ 'device', 'home' ], a.dns_mode) < 0)
			fail('Unknown DNS choice.');
		set('dns_mode', a.dns_mode == 'device' ? '' : a.dns_mode);
	}
	if (a.expire_warn != null) {
		let n = toint(a.expire_warn, -1);
		if (n < 0 || n > 60)
			fail('Warning must be 0-60 days.');
		set('expire_warn', n == 3 ? '' : n);
	}
	if (a.quota_gb != null) {
		let q = num(a.quota_gb, -1);
		if (a.quota_gb != '' && (q < 0 || q > 100000))
			fail('Data limit must be a positive number of GB.');
		set('quota_gb', q > 0 ? q : '');
	}
	if (a.quota_period != null)
		set('quota_period', a.quota_period == 'total' ? 'total' : '');
	if (a.bonus_gb != null) {
		let b = num(a.bonus_gb, -1);
		if (b < 0 || b > 100000)
			fail('Extra data must be a positive number of GB.');
		set('bonus_gb', b > 0 ? b : '');
		set('bonus_month', b > 0 ? month_key() : '');
	}
	if (a.hours != null) {
		if (a.hours != '' && !parse_hours(a.hours))
			fail('Hours must look like 07:00-23:00.');
		set('hours', a.hours);
	}
	if (a.note != null)
		set('note', substr(trim(a.note), 0, 500));
	if (type(a.services) == 'array') {
		for (let sid in a.services)
			if (!m.services[sid])
				fail(`Unknown service ${sid}.`);
		if (length(a.services))
			c.set(CONFIG, id, 'service', a.services);
		else
			c.delete(CONFIG, id, 'service');
	}
	if (a.paused != null)
		set('paused', a.paused ? '1' : '');
};

/**
 * Add a device for a person. `opts.by` is 'admin' or 'portal'; the portal
 * enforces the device limit. `opts.public_key` keeps the private key on the
 * client (browser-generated keys).
 */
export function create_device(c, m, person_id, name, kind, opts) {
	opts ??= {};
	let p = m.people[person_id];
	if (!p)
		fail('Unknown person.');
	let srv = m.servers[p.server];
	if (!srv)
		fail('The person has no server.');
	name = trim(name ?? '');
	if (!valid_name(name))
		fail('Enter a device name (up to 48 characters).');
	if (index(KINDS, kind) < 0)
		kind = 'other';
	if (opts.by == 'portal' && length(p.devices) >= p.device_limit)
		fail(`Device limit reached (${p.device_limit}).`);
	for (let id in p.devices)
		if (lc(m.devices[id].name) == lc(name))
			fail(`"${name}" already exists.`);
	let addr = alloc_address(m, srv);
	if (!addr)
		fail('No free addresses left in the server subnet.');

	let priv = '', pub;
	if (opts.public_key) {
		if (!valid_key(opts.public_key))
			fail('Invalid public key.');
		pub = opts.public_key;
	}
	else {
		priv = genkey();
		pub = pubkey(priv);
	}
	if (!pub)
		fail('Key generation failed (is amneziawg-tools installed?).');
	for (let id, d in m.devices)
		if (d.public_key == pub)
			fail('This key is already in use.');

	let id = `d_${rand_hex(4)}`;
	c.set(CONFIG, id, 'device');
	c.set(CONFIG, id, 'person', person_id);
	c.set(CONFIG, id, 'name', name);
	c.set(CONFIG, id, 'kind', kind);
	c.set(CONFIG, id, 'address', addr);
	c.set(CONFIG, id, 'public_key', pub);
	if (priv)
		c.set(CONFIG, id, 'private_key', priv);
	c.set(CONFIG, id, 'preshared_key', genpsk());
	c.set(CONFIG, id, 'created', `${time()}`);
	c.set(CONFIG, id, 'created_by', opts.by ?? 'admin');

	// Keep the in-memory model consistent for callers that continue.
	m.devices[id] = { id, person: person_id, name, kind, address: addr, public_key: pub, private_key: priv,
		preshared_key: c.get(CONFIG, id, 'preshared_key'), created: time(), created_by: opts.by ?? 'admin', disabled: false };
	push(p.devices, id);
	return id;
};

export function rename_device(c, m, id, name) {
	let d = m.devices[id];
	if (!d)
		fail('Unknown device.');
	name = trim(name ?? '');
	if (!valid_name(name))
		fail('Enter a device name (up to 48 characters).');
	for (let o in m.people[d.person]?.devices ?? [])
		if (o != id && lc(m.devices[o].name) == lc(name))
			fail(`"${name}" already exists.`);
	c.set(CONFIG, id, 'name', name);
	d.name = name;
};

export function delete_device(c, m, id) {
	let d = m.devices[id];
	if (!d)
		fail('Unknown device.');
	c.delete(CONFIG, id);
	let p = m.people[d.person];
	if (p)
		p.devices = filter(p.devices, (x) => x != id);
	delete m.devices[id];
};

export function rotate_device(c, m, id) {
	let d = m.devices[id];
	if (!d)
		fail('Unknown device.');
	let priv = genkey(), pub = pubkey(priv);
	if (!pub)
		fail('Key generation failed.');
	c.set(CONFIG, id, 'private_key', priv);
	c.set(CONFIG, id, 'public_key', pub);
	c.set(CONFIG, id, 'preshared_key', genpsk());
};

export function delete_person(c, m, id) {
	let p = m.people[id];
	if (!p)
		fail('Unknown person.');
	for (let d in p.devices)
		c.delete(CONFIG, d);
	c.delete(CONFIG, id);
};

/** Validate a server definition (as loaded) against the rest of the router. */
export function server_errors(m, srv, others_subnets) {
	let errs = [];
	if (!match(srv.ifname, /^[a-z][a-z0-9_]{0,11}$/))
		push(errs, 'Interface name: 1-12 lowercase letters, digits or _.');
	if (srv.port < 1 || srv.port > 65535)
		push(errs, 'Port must be 1-65535.');
	let c = parse_cidr(srv.subnet);
	if (!c)
		push(errs, 'Subnet must look like 10.77.0.0/24.');
	else
		for (let o in others_subnets ?? []) {
			let oc = parse_cidr(o);
			if (oc && cidr_overlaps(c, oc))
				push(errs, `Subnet overlaps ${o}.`);
		}
	if (srv.endpoint != '' && !valid_host(srv.endpoint))
		push(errs, 'Endpoint must be a hostname or IP address.');
	push(errs, ...obf_errors(srv.obf));
	return errs;
};

/** Someone else already forwards this TCP port from outside (a port forward we must not take over). */
export function wan_port_taken(port) {
	let c = cursor();
	c.load('firewall');
	let taken = false;
	c.foreach('firewall', 'redirect', (r) => {
		if (match(r['.name'], /^dawnline_/) || r.enabled == '0' || (r.target ?? 'DNAT') != 'DNAT')
			return;
		for (let p in split(`${r.src_dport ?? ''}`, /[ ,]+/)) {
			let m = match(p, /^(\d+)(?:[-:](\d+))?$/);
			if (m && +m[1] <= port && port <= +(m[2] ?? m[1]))
				taken = true;
		}
	});
	return taken;
};

export function wan443_taken() {
	return wan_port_taken(443);
};

/** Every address the links use, the main one first. */
export function portal_hosts(m) {
	let out = [];
	for (let h in [ m.settings.portal_host, ...m.settings.portal_alt ])
		if (h && index(out, h) < 0)
			push(out, h);
	return out;
};

/** IP addresses have no certificate: the portal also answers plain HTTP for them. */
export function portal_http(m) {
	return length(filter(portal_hosts(m), (h) => ip2int(h) != null)) > 0;
};

/** Where the portal listens for plain HTTP (next to its HTTPS port). */
export function portal_http_port(m) {
	return m.settings.portal_port + 1;
};

/** The port in plain-HTTP links: 80 when standard ports are on and free. */
export function portal_http_public(m) {
	return m.settings.portal_443 && !wan_port_taken(80) ? 80 : portal_http_port(m);
};

/** The port in personal links: 443 when the portal also answers there. */
export function portal_public_port(m) {
	let s = m.settings;
	if (s.portal_port == 443 || !s.portal_443 || wan443_taken())
		return s.portal_port;
	return 443;
};

/** The link on one address: https for names, plain http for IP addresses. */
export function portal_link(m, p, host) {
	// No portal, no link: the page would not answer.
	if (!m.settings.portal_enabled || !host || !m.servers[p.server] || !match(p.code ?? '', WORD_CODE))
		return null;
	if (ip2int(host) != null) {
		let hp = portal_http_public(m);
		return `http://${host}${hp == 80 ? '' : `:${hp}`}/${p.code}`;
	}
	let pp = portal_public_port(m);
	return `https://${host}${pp == 443 ? '' : `:${pp}`}/${p.code}`;
};

/** The main link (QR, invite card, Copy link). */
export function portal_url(m, p) {
	return portal_link(m, p, portal_hosts(m)[0]);
};

/** Every link to the same portal, the main one first. */
export function portal_urls(m, p) {
	return filter(map(portal_hosts(m), (h) => portal_link(m, p, h)), (x) => x != null);
};
