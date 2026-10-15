// Dawnline — data model: reads /etc/config/dawnline, validates and mutates it
// and allocates addresses. Nothing here knows how the tunnel works: dawnline.awg
// renders AmneziaWG configurations and runs the tunnels.

import { cursor } from 'uci';
import {
	valid_name, valid_key, valid_host, valid_date, slugify, parse_cidr, cidr_overlaps, int2ip, ip2int,
	rand_hex, rand_bytes, date_end, month_key, read_json, DATA_DIR, RUN_DIR, uniq
} from 'dawnline.util';
import * as net from 'dawnline.net';
import { policy as updates_policy } from 'dawnline.updates';

export const CONFIG = 'dawnline';
/**
 * Servers whose network interface Dawnline may not set up (the name belongs
 * to an interface it did not create, or is invalid): { id: why }. Written by
 * dawnline.netifd; such a server has no tunnel anywhere (firewall, access
 * table, "like a home device"), so nothing of Dawnline lands on that interface.
 */
export const BLOCKED = `${RUN_DIR}/netifd-blocked.json`;
export const ACCESS = [ 'lan', 'internet', 'both' ];
export const KINDS = [ 'computer', 'phone', 'tablet', 'router', 'other' ];
/** Devices of different people reaching each other: never, everyone with home access, or within a circle. */
export const MESH = [ 'off', 'all', 'circles' ];
/** Circle colours (index into the admin palette). */
export const CIRCLE_COLORS = 8;
/** AmneziaWG obfuscation options stored on a server (netifd uses `awg_<key>`; dawnline.awg renders them). */
export const OBF_KEYS = [ 'jc', 'jmin', 'jmax', 's1', 's2', 's3', 's4', 'h1', 'h2', 'h3', 'h4', 'i1', 'i2', 'i3', 'i4', 'i5',
	// AmneziaWG 3.x
	'header_protection_key', 'content_padding_addition', 'rekey_after_time', 'rekey_timeout', 'reject_after_time',
	'keepalive_timeout', 'max_handshake_attempts', 'random_trailers', 'disable_cookies' ];
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
			// Settings → Updates (automatic checks and updates of the components).
			updates: updates_policy(s),
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
		circles: {},
	};

	let blocked = read_json(BLOCKED, {});
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
			// Devices of people with home access reach each other: off, all, or within circles.
			// (Older configs: device_mesh 0/1.)
			mesh: index(MESH, r.mesh) >= 0 ? r.mesh : (bool(r.device_mesh, true) ? 'all' : 'off'),
			enabled: bool(r.enabled, true),
			// AmneziaWG disguise values, read by dawnline.awg.
			obf: {},
		};
		for (let k in OBF_KEYS)
			if (r[k] != null && r[k] != '')
				srv.obf[k] = `${r[k]}`;
		// A person's own devices reach each other whenever the mesh is not off.
		srv.device_mesh = srv.mesh != 'off';
		if (blocked[id])
			srv.blocked = blocked[id];
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
			// Home networks (interfaces) this person reaches; empty = all of the server's.
			home_nets: list(r.home_net),
			circle: r.circle ?? '',
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

	c.foreach(CONFIG, 'circle', (r) => {
		let id = r['.name'];
		m.circles[id] = { id, server: r.server ?? '', name: r.name ?? id, color: toint(r.color, 0) % CIRCLE_COLORS };
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

/* ---------- tunnels and addresses ---------- */

/** A server's interface name: also a netifd section and an nft string, so nothing else. */
export function valid_ifname(s) {
	return type(s) == 'string' && match(s, /^[a-z][a-z0-9_]{0,11}$/) != null;
};

/** Router address inside the AmneziaWG subnet (first host). */
export function server_address(srv) {
	let c = parse_cidr(srv.subnet);
	return c ? int2ip(c.first) : null;
};

/**
 * The link a server's devices come in on: { ifname, subnet, address (the
 * router's) }, as a list so the access table, firewall zone, "like a home
 * device" and DNS treat every tunnel interface alike. None for a server
 * without keys, subnet or a valid interface name (an imported config), or
 * whose interface name is taken (BLOCKED).
 */
export function tunnels(srv) {
	let c = srv?.private_key && !srv.blocked && valid_ifname(srv.ifname) ? parse_cidr(srv.subnet) : null;
	return c ? [ { ifname: srv.ifname, subnet: srv.subnet, address: int2ip(c.first) } ] : [];
};

/** The server's tunnel link, or null. */
export function tunnel(srv) {
	return tunnels(srv)[0];
};

/** The first free address in the server's subnet (the router has the first). */
export function alloc_address(m, srv) {
	let t = parse_cidr(srv.subnet);
	if (!t)
		return null;
	let used = {};
	used[t.first] = true;
	for (let id, d in m.devices) {
		let p = m.people[d.person];
		if (p && p.server == srv.id) {
			let n = ip2int(d.address);
			if (n != null)
				used[n] = true;
		}
	}
	for (let n = t.first + 1; n <= t.last; n++)
		if (!used[n])
			return int2ip(n);
	return null;
};

/* ---------- what clients get ---------- */

export function endpoint_host(m, srv) {
	return srv.endpoint || m.settings.portal_host || '';
};

/**
 * DNS for a server's clients: the router's address in the tunnel subnet,
 * which never changes after setup. The router forwards each query where it
 * belongs (the LAN's DNS, from the LAN side; or the plain resolver), so
 * configurations on devices keep working when the LAN, its DNS or the netns
 * address change.
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
 * DNS a device uses. Home-only people keep their device's DNS unless they
 * chose home names; then the first server is Dawnline's plain resolver
 * (reached through the tunnel) and the second the fallback the device uses
 * when the tunnel is down.
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

/**
 * The home networks a person reaches: all of the server's, or only the
 * interfaces ticked on their page (networks added later are not included).
 */
export function person_home(srv, p, snap) {
	let sn = net.server_net(srv, snap);
	let pick = p?.home_nets ?? [];
	if (!length(pick))
		return { all: true, nets: sn.nets, devs: map(sn.home, (h) => h.dev) };
	let nets = [], devs = [];
	for (let h in sn.home)
		if (index(pick, h.dev) >= 0) {
			push(nets, ...h.nets);
			push(devs, h.dev);
		}
	return { all: false, nets: net.collapse(nets), devs };
};

/** The circle a person is in on their server (circles mode only), or null. */
export function person_circle(m, p) {
	let c = m.circles[p?.circle];
	return c && c.server == p.server ? c : null;
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
	// Any kind of section (store.id_taken, which imports this module).
	let taken = (id) => m.people[id] || m.servers[id] || m.devices[id] || m.services[id] || m.circles[id] ||
		index([ 'settings', 'main', 'global', 'defaults' ], id) >= 0;
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
		let have = length(p.devices);
		if (n < have)
			fail(`${p.name} already has ${have} devices. Remove one first to lower the limit to ${n}.`);
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
	if (a.circle != null) {
		let ci = m.circles[a.circle];
		if (a.circle != '' && (!ci || ci.server != p.server))
			fail('Unknown circle.');
		set('circle', a.circle);
	}
	if (type(a.home_nets) == 'array') {
		let nets = uniq(filter(map(a.home_nets, (x) => trim(`${x}`)), (x) => match(x, /^[A-Za-z0-9_.@-]{1,32}$/)));
		if (length(nets))
			c.set(CONFIG, id, 'home_net', nets);
		else
			c.delete(CONFIG, id, 'home_net');
	}
	if (a.paused != null)
		set('paused', a.paused ? '1' : '');
};

/**
 * Add a device for a person. `opts.keys` = { private_key?, public_key,
 * preshared_key } from dawnline.awg (or a public key the browser generated).
 * `opts.by` is 'admin' or 'portal'; the portal is held to the device limit.
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
	let k = opts.keys ?? {};
	if (!valid_key(k.public_key))
		fail('Key generation failed (is amneziawg-tools installed?).');
	for (let o, d in m.devices)
		if (d.public_key == k.public_key)
			fail('This key is already in use.');

	let id = `d_${rand_hex(4)}`;
	let dev = { id, person: person_id, name, kind, address: addr, public_key: k.public_key, private_key: k.private_key ?? '',
		preshared_key: k.preshared_key ?? '', created: time(), created_by: opts.by ?? 'admin', disabled: false };
	c.set(CONFIG, id, 'device');
	c.set(CONFIG, id, 'person', person_id);
	c.set(CONFIG, id, 'name', name);
	c.set(CONFIG, id, 'kind', kind);
	c.set(CONFIG, id, 'address', addr);
	for (let f in [ 'public_key', 'private_key', 'preshared_key' ])
		if (dev[f])
			c.set(CONFIG, id, f, dev[f]);
	c.set(CONFIG, id, 'created', `${dev.created}`);
	c.set(CONFIG, id, 'created_by', dev.created_by);

	// Keep the in-memory model consistent for callers that continue.
	m.devices[id] = dev;
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

/** New keys from dawnline.awg (the caller makes them: the model does not run tools). */
export function rotate_device(c, m, id, keys) {
	let d = m.devices[id];
	if (!d)
		fail('Unknown device.');
	if (!valid_key(keys?.public_key) || !keys?.private_key)
		fail('Key generation failed.');
	c.set(CONFIG, id, 'private_key', keys.private_key);
	c.set(CONFIG, id, 'public_key', keys.public_key);
	if (keys.preshared_key)
		c.set(CONFIG, id, 'preshared_key', keys.preshared_key);
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
	if (!valid_ifname(srv.ifname))
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
			let m = match(p, /^(\d+)([-:](\d+))?$/);
			if (m && +m[1] <= port && port <= +(m[3] || m[1]))
				taken = true;
		}
	});
	return taken;
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

/** The port in plain-HTTP links (the portal never takes 80 or 443 for itself). */
export function portal_http_public(m) {
	return portal_http_port(m);
};

/** The port in personal links: the portal's own. */
export function portal_public_port(m) {
	return m.settings.portal_port;
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
