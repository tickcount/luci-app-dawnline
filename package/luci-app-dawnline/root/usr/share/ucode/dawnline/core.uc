// Dawnline — data model: reads /etc/config/dawnline, validates and mutates it
// and allocates addresses. Nothing here knows how the tunnel works: dawnline.awg
// renders AmneziaWG configurations and runs the tunnels.

import { cursor } from 'uci';
import {
	valid_name, valid_device_name, DEVICE_NAME_MAX, valid_key, valid_host, valid_iface, valid_date, slugify, host_label, ucut, name_rule, parse_cidr, cidr_overlaps, int2ip, ip2int,
	rand_hex, rand_bytes, date_end, month_key, read_json, DATA_DIR, RUN_DIR, uniq
} from 'dawnline.util';
import { _, N_ } from 'dawnline.i18n';
import * as net from 'dawnline.net';
import * as schema from 'dawnline.schema';
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
/** Kinds that mostly live on mobile networks: their configurations carry a smaller MTU. */
export const MOBILE_KINDS = [ 'phone', 'tablet' ];
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
	// Types, defaults and ranges of the settings live in dawnline.schema (one
	// place): what is read here is what settings_update would have accepted.
	let g = (k) => schema.get(s, k);
	let m = {
		settings: {
			portal_enabled: g('portal_enabled'),
			portal_port: g('portal_port'),
			portal_host: g('portal_host'),
			// More addresses for the same links (the main one is portal_host).
			portal_alt: g('portal_alt'),
			portal_cert: g('portal_cert'),
			portal_key: g('portal_key'),
			// Where unknown portal links go instead of a bare 404 (empty = 404).
			portal_redirect: g('portal_redirect'),
			default_device_limit: g('default_device_limit'),
			geo_enabled: g('geo_enabled'),
			geo_provider: g('geo_provider'),
			hostnames: g('hostnames'),
			domain: g('domain'),
			log_connections: g('log_connections'),
			// Repair tunnels and services on its own (the agent, every minute).
			watchdog: g('watchdog'),
			// Second DNS for "home names" devices, used by the device when the tunnel is down.
			home_dns_fallback: g('home_dns_fallback'),
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
			// 0 = automatic (tunnel_mtu, device_mtu).
			mtu: toint(r.mtu, 0),
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
			// When the personal link was last made (0 for links from before this was kept).
			code_set: toint(r.code_set, 0),
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
			// The device's own link values (admin only): 0 / null = the server's
			// (device_mtu, device_keepalive). Out of range is kept as read, so
			// model_errors can name it; the configuration then uses the server's.
			mtu: toint(r.mtu, 0),
			keepalive: r.keepalive == null || r.keepalive == '' ? null : toint(r.keepalive, null),
			// Its own local network stays outside the tunnel (awg.allowed_ips).
			lan_bypass: bool(r.lan_bypass, false),
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

/** Bytes used in the person's quota period (the month of `ts`, default now). */
export function person_usage(p, usage, ts) {
	let u = usage?.people?.[p.id];
	if (!u)
		return 0;
	if (p.quota_period == 'total')
		return (u.total?.[0] ?? 0) + (u.total?.[1] ?? 0);
	let mm = u.months?.[month_key(ts)];
	return mm ? mm[0] + mm[1] : 0;
};

/** Quota in bytes for the period of `ts` (default now): base + that month's bonus, 0 = unlimited. */
export function person_quota(p, ts) {
	if (!(p.quota_gb > 0))
		return 0;
	let gb = p.quota_gb;
	if (p.bonus_gb > 0 && p.bonus_month == month_key(ts))
		gb += p.bonus_gb;
	return gb * 1073741824;
};

export function person_expired(p, ts) {
	if (p.expires == '')
		return false;
	let end = date_end(p.expires);
	return end != null && (ts ?? time()) > end;
};

/** The person's state whatever their server is doing (paused, expired, …, or 'active'). */
export function own_state(m, p, usage, ts) {
	ts ??= time();
	if (p.paused)
		return 'paused';
	// "notify" keeps access after the end date (shown in Overview and People).
	if (person_expired(p, ts) && p.expire_action != 'notify')
		return 'expired';
	let quota = person_quota(p, ts);
	if (quota > 0 && person_usage(p, usage, ts) >= quota)
		return 'quota';
	let h = parse_hours(p.hours);
	if (h && !within_hours(h, ts))
		return 'hours';
	return 'active';
};

/**
 * Effective state of a person: 'active', or why they are off:
 * 'paused' (admin), 'expired', 'quota', 'hours', 'no_server',
 * 'server_off' (their server is turned off: about the server, not the person).
 */
export function person_state(m, p, usage, ts) {
	let srv = m.servers[p.server];
	if (!srv)
		return 'no_server';
	if (!srv.enabled)
		return 'server_off';
	return own_state(m, p, usage, ts);
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

/*
 * Automatic MTU. A path is assumed to carry 1460 bytes (1500 less PPPoE,
 * 464XLAT or DS-Lite), the tunnel's own headers take 80 over IPv6, and
 * AmneziaWG's S4 adds its bytes to every data packet (its padding and random
 * trailers stay within the largest packet already seen, so they cost
 * nothing). Phones and tablets get 1280, the IPv6 minimum: mobile paths vary.
 */
const AUTO_MTU = 1380;
const MOBILE_MTU = 1280;
/** What an MTU set by hand may be (the server's and a device's alike). */
export const MTU_RANGE = [ 1280, 1500 ];
/** What a keep-alive set by hand may be, in seconds (0 = off). */
export const KEEPALIVE_RANGE = [ 0, 600 ];

function in_range(n, r) {
	return type(n) == 'int' && n >= r[0] && n <= r[1];
}

/** The server's tunnel MTU: the one set, or automatic for its disguise. */
export function tunnel_mtu(srv) {
	return srv.mtu || max(MOBILE_MTU, AUTO_MTU - toint(srv.obf?.s4, 0));
};

/**
 * The MTU a device's configuration carries: the device's own when the admin
 * set one, else the tunnel's, at most 1280 for phones and tablets.
 */
export function device_mtu(srv, dev) {
	if (in_range(dev.mtu, MTU_RANGE))
		return dev.mtu;
	let mtu = tunnel_mtu(srv);
	return index(MOBILE_KINDS, dev.kind) >= 0 ? min(mtu, MOBILE_MTU) : mtu;
};

/**
 * The keep-alive a device's configuration carries, in seconds (0 = off): the
 * device's own when the admin set one, else the server's. Both ends never
 * have to agree on it (the server's peers carry none), so it is the device's.
 */
export function device_keepalive(srv, dev) {
	return in_range(dev?.keepalive, KEEPALIVE_RANGE) ? dev.keepalive : srv.keepalive;
};

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
		fail(name_rule());
	// The id is a UCI section name: letters, digits and underscores only (a dash
	// makes uci drop the section). Repeated names get _2, _3, …
	let base = replace(a.slug ?? slugify(a.name), /-/g, '_');
	if (!match(base, /^[a-z0-9_]{1,32}$/))
		fail(_('The id may use lowercase letters, digits and underscores.'));
	// Any kind of section (store.id_taken, which imports this module).
	let taken = (id) => m.people[id] || m.servers[id] || m.devices[id] || m.services[id] || m.circles[id] ||
		index([ 'settings', 'main', 'global', 'defaults' ], id) >= 0;
	let slug = base;
	for (let n = 2; taken(slug); n++) {
		if (n > 99)
			fail(sprintf(_('"%s" is already taken.'), base));
		slug = `${substr(base, 0, 28)}_${n}`;
	}
	let srv_id = a.server ?? keys(m.servers)[0];
	if (!m.servers[srv_id])
		fail(_('Set up a server first.'));
	let access = a.access ?? 'internet';
	if (index(ACCESS, access) < 0)
		fail(_('Access must be lan, internet or both.'));
	let limit = toint(a.device_limit, m.settings.default_device_limit);
	if (limit < 1 || limit > 32)
		fail(_('Device limit must be between 1 and 32.'));
	if (a.expires && !valid_date(a.expires))
		fail(_('End date must be YYYY-MM-DD.'));
	let quota = num(a.quota_gb, 0);
	if (quota < 0 || quota > 100000)
		fail(_('Monthly data must be a positive number of GB.'));

	c.set(CONFIG, slug, 'person');
	c.set(CONFIG, slug, 'server', srv_id);
	c.set(CONFIG, slug, 'name', trim(a.name));
	c.set(CONFIG, slug, 'access', access);
	c.set(CONFIG, slug, 'device_limit', `${limit}`);
	c.set(CONFIG, slug, 'code', new_code());
	c.set(CONFIG, slug, 'code_set', `${time()}`);
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
		fail(_('Unknown person.'));
	let set = (k, v) => (v == null || v == '') ? c.delete(CONFIG, id, k) : c.set(CONFIG, id, k, `${v}`);
	if (a.name != null) {
		if (!valid_name(a.name))
			fail(name_rule());
		set('name', trim(a.name));
	}
	if (a.access != null) {
		if (index(ACCESS, a.access) < 0)
			fail(_('Access must be lan, internet or both.'));
		set('access', a.access);
	}
	if (a.device_limit != null) {
		let n = toint(a.device_limit, 0);
		if (n < 1 || n > 32)
			fail(_('Device limit must be between 1 and 32.'));
		let have = length(p.devices);
		if (n < have)
			fail(sprintf(N_(have, '%s already has %d device. Remove one first to lower the limit to %d.',
				'%s already has %d devices. Remove one first to lower the limit to %d.'), p.name, have, n));
		set('device_limit', n);
	}
	if (a.expires != null) {
		if (a.expires != '' && !valid_date(a.expires))
			fail(_('End date must be YYYY-MM-DD.'));
		set('expires', a.expires);
	}
	if (a.expire_action != null) {
		if (index([ 'pause', 'notify', 'remove' ], a.expire_action) < 0)
			fail(_('Unknown end action.'));
		set('expire_action', a.expire_action == 'pause' ? '' : a.expire_action);
	}
	if (a.dns_mode != null) {
		if (index([ 'device', 'home' ], a.dns_mode) < 0)
			fail(_('Unknown DNS choice.'));
		set('dns_mode', a.dns_mode == 'device' ? '' : a.dns_mode);
	}
	if (a.expire_warn != null) {
		let n = toint(a.expire_warn, -1);
		if (n < 0 || n > 60)
			fail(_('Warning must be 0-60 days.'));
		set('expire_warn', n == 3 ? '' : n);
	}
	if (a.quota_gb != null) {
		let q = num(a.quota_gb, -1);
		if (a.quota_gb != '' && (q < 0 || q > 100000))
			fail(_('Data limit must be a positive number of GB.'));
		set('quota_gb', q > 0 ? q : '');
	}
	if (a.quota_period != null)
		set('quota_period', a.quota_period == 'total' ? 'total' : '');
	if (a.bonus_gb != null) {
		let b = num(a.bonus_gb, -1);
		if (b < 0 || b > 100000)
			fail(_('Extra data must be a positive number of GB.'));
		set('bonus_gb', b > 0 ? b : '');
		set('bonus_month', b > 0 ? month_key() : '');
	}
	if (a.hours != null) {
		if (a.hours != '' && !parse_hours(a.hours))
			fail(_('Hours must look like 07:00-23:00.'));
		set('hours', a.hours);
	}
	if (a.note != null)
		set('note', ucut(trim(a.note), 500));
	if (type(a.services) == 'array') {
		for (let sid in a.services)
			if (!m.services[sid])
				fail(sprintf(_('Unknown service %s.'), sid));
		if (length(a.services))
			c.set(CONFIG, id, 'service', a.services);
		else
			c.delete(CONFIG, id, 'service');
	}
	if (a.circle != null) {
		let ci = m.circles[a.circle];
		if (a.circle != '' && (!ci || ci.server != p.server))
			fail(_('Unknown circle.'));
		set('circle', a.circle);
	}
	// Another server: every device gets an address in its tunnel (so each
	// needs its configuration again); circles and home networks are the old
	// server's and go.
	if (a.server != null && a.server != '' && a.server != p.server) {
		if (!m.servers[a.server])
			fail(_('Unknown server.'));
		set('server', a.server);
		p.server = a.server;
		for (let did in p.devices) {
			let addr = alloc_address(m, m.servers[a.server]);
			if (!addr)
				fail(sprintf(_('No free address left on %s.'), m.servers[a.server].name));
			m.devices[did].address = addr;
			c.set(CONFIG, did, 'address', addr);
		}
		c.delete(CONFIG, id, 'circle');
		c.delete(CONFIG, id, 'home_net');
	}
	if (type(a.home_nets) == 'array') {
		let nets = uniq(filter(map(a.home_nets, (x) => trim(`${x}`)), valid_iface));
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
 * `opts.lan_bypass` true keeps the device's own local network outside the
 * tunnel (awg.allowed_ips).
 */
export function create_device(c, m, person_id, name, kind, opts) {
	opts ??= {};
	let p = m.people[person_id];
	if (!p)
		fail(_('Unknown person.'));
	let srv = m.servers[p.server];
	if (!srv)
		fail(_('The person has no server.'));
	name = trim(name ?? '');
	if (!valid_device_name(name))
		fail(sprintf(_('Enter a device name: up to %d letters, digits, spaces and - _ .'), DEVICE_NAME_MAX));
	if (index(KINDS, kind) < 0)
		kind = 'other';
	if (opts.by == 'portal' && length(p.devices) >= p.device_limit)
		fail(sprintf(_('Device limit reached (%d).'), p.device_limit));
	for (let id in p.devices)
		if (lc(m.devices[id].name) == lc(name))
			fail(sprintf(_('"%s" already exists.'), name));
	let addr = alloc_address(m, srv);
	if (!addr)
		fail(_('No free addresses left in the server subnet.'));
	let k = opts.keys ?? {};
	if (!valid_key(k.public_key))
		fail(_('Key generation failed (is amneziawg-tools installed?).'));
	for (let o, d in m.devices)
		if (d.public_key == k.public_key)
			fail(_('This key is already in use.'));
	// A server's own key (it is in every configuration): the kernel would silently ignore such a peer.
	for (let sid, s in m.servers)
		if (s.public_key == k.public_key)
			fail(_('This key is already in use.'));

	let id = `d_${rand_hex(4)}`;
	let dev = { id, person: person_id, name, kind, address: addr, public_key: k.public_key, private_key: k.private_key ?? '',
		preshared_key: k.preshared_key ?? '', created: time(), created_by: opts.by ?? 'admin', disabled: false,
		mtu: 0, keepalive: null, lan_bypass: opts.lan_bypass === true };
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
	if (dev.lan_bypass)
		c.set(CONFIG, id, 'lan_bypass', '1');

	// Keep the in-memory model consistent for callers that continue.
	m.devices[id] = dev;
	push(p.devices, id);
	return id;
};

export function rename_device(c, m, id, name) {
	let d = m.devices[id];
	if (!d)
		fail(_('Unknown device.'));
	name = trim(name ?? '');
	if (!valid_device_name(name))
		fail(sprintf(_('Enter a device name: up to %d letters, digits, spaces and - _ .'), DEVICE_NAME_MAX));
	for (let o in m.people[d.person]?.devices ?? [])
		if (o != id && lc(m.devices[o].name) == lc(name))
			fail(sprintf(_('"%s" already exists.'), name));
	c.set(CONFIG, id, 'name', name);
	d.name = name;
};

/**
 * The admin's link settings of a device: `a` = { mtu?, keepalive?,
 * lan_bypass? }, only keys present change; '' takes a number back to the
 * server's (0 is a keep-alive of its own: off). Each is in the device's
 * configuration alone (the server's peers carry neither), so a change asks
 * that device to import again and touches nothing on the router. Returns the
 * names of the options that changed.
 */
export function set_device_link(c, m, id, a) {
	let d = m.devices[id];
	if (!d)
		fail(_('Unknown device.'));
	let changed = [];
	let put = (k, v, was) => {
		if (v == was)
			return;
		if (v == null)
			c.delete(CONFIG, id, k);
		else
			c.set(CONFIG, id, k, `${v}`);
		push(changed, k);
	};
	let number = (v, r, msg) => {
		let s = trim(`${v}`);
		if (s == '')
			return null;
		if (!match(s, /^[0-9]{1,4}$/) || +s < r[0] || +s > r[1])
			fail(msg);
		return +s;
	};
	if (a.mtu != null)
		put('mtu', number(a.mtu, MTU_RANGE, _('MTU must be 1280-1500.')), d.mtu || null);
	if (a.keepalive != null)
		put('keepalive', number(a.keepalive, KEEPALIVE_RANGE, _('Keep-alive must be 0-600 seconds.')), d.keepalive);
	if (a.lan_bypass != null)
		put('lan_bypass', a.lan_bypass === true ? 1 : null, d.lan_bypass ? 1 : null);
	return changed;
};

export function delete_device(c, m, id) {
	let d = m.devices[id];
	if (!d)
		fail(_('Unknown device.'));
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
		fail(_('Unknown device.'));
	if (!valid_key(keys?.public_key) || !keys?.private_key)
		fail(_('Key generation failed.'));
	c.set(CONFIG, id, 'private_key', keys.private_key);
	c.set(CONFIG, id, 'public_key', keys.public_key);
	if (keys.preshared_key)
		c.set(CONFIG, id, 'preshared_key', keys.preshared_key);
};

export function delete_person(c, m, id) {
	let p = m.people[id];
	if (!p)
		fail(_('Unknown person.'));
	for (let d in p.devices)
		c.delete(CONFIG, d);
	c.delete(CONFIG, id);
};

const PRIVATE_NETS = map([ '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16' ], parse_cidr);

/** The parsed subnet lies inside one of the private ranges. */
export function private_cidr(c) {
	for (let p in PRIVATE_NETS)
		if (c.net >= p.net && c.net + c.size <= p.net + p.size)
			return true;
	return false;
};

/** Validate a server definition (as loaded) against the rest of the router. */
export function server_errors(m, srv, others_subnets) {
	let errs = [];
	if (!valid_ifname(srv.ifname))
		push(errs, _('Interface name: 1-12 lowercase letters, digits or _.'));
	if (srv.port < 1 || srv.port > 65535)
		push(errs, _('Port must be 1-65535.'));
	let c = parse_cidr(srv.subnet);
	if (!c)
		push(errs, _('Subnet must look like 10.77.0.0/24.'));
	else
		for (let o in others_subnets ?? []) {
			let oc = parse_cidr(o);
			if (oc && cidr_overlaps(c, oc))
				push(errs, sprintf(_('Subnet overlaps %s.'), o));
		}
	if (srv.endpoint != '' && !valid_host(srv.endpoint))
		push(errs, _('Endpoint must be a hostname or IP address.'));
	return errs;
};

/**
 * What is wrong inside a model as a whole, beyond each server: devices with
 * an address outside their server's subnet, the server's own address, a
 * prefix on it or one shared with another device (the access sets are keyed
 * by address, and one bad peer line makes `awg syncconf` refuse the whole
 * server), malformed keys, an MTU or keep-alive of their own out of range,
 * people and devices pointing at servers, people, circles or services that do
 * not exist, and two people with one link. [] when it is consistent. Import,
 * restore and Health check it; the runtime sync skips what it would reject
 * (dawnline.awg, dawnline.nft), and a configuration takes the server's value
 * for a link value out of range (device_mtu, device_keepalive).
 */
export function model_errors(m) {
	let errs = [];
	let codes = {}, addrs = {};
	for (let id, p in m.people) {
		if (p.server != '' && !m.servers[p.server])
			push(errs, sprintf(_('Person %s: server %s does not exist.'), p.name, p.server));
		if (p.circle != '' && !m.circles[p.circle])
			push(errs, sprintf(_('Person %s: circle %s does not exist.'), p.name, p.circle));
		for (let sid in p.services)
			if (!m.services[sid])
				push(errs, sprintf(_('Person %s: home service %s does not exist.'), p.name, sid));
		if (p.code != '') {
			if (codes[p.code])
				push(errs, sprintf(_('Person %s: has the same personal link as %s.'), p.name, codes[p.code]));
			codes[p.code] = p.name;
		}
	}
	for (let id, d in m.devices) {
		let p = m.people[d.person];
		if (!p) {
			push(errs, sprintf(_('Device %s: person %s does not exist.'), d.name, d.person));
			continue;
		}
		let say = (msg, ...args) => push(errs, sprintf(msg, d.name, p.name, ...args));
		if (!valid_key(d.public_key))
			say(_('Device %s of %s: the public key is not a key.'));
		if (d.private_key != '' && !valid_key(d.private_key))
			say(_('Device %s of %s: the private key is not a key.'));
		if (d.preshared_key != '' && !valid_key(d.preshared_key))
			say(_('Device %s of %s: the preshared key is not a key.'));
		// Its own link values (0 / null: the server's); one out of range is never used.
		if (d.mtu && !in_range(d.mtu, MTU_RANGE))
			say(_('Device %s of %s: MTU %d is not between 1280 and 1500.'), d.mtu);
		if (d.keepalive != null && !in_range(d.keepalive, KEEPALIVE_RANGE))
			say(_('Device %s of %s: keep-alive %d is not between 0 and 600 seconds.'), d.keepalive);
		let n = ip2int(d.address);
		if (n == null) {
			if (d.address)
				say(_('Device %s of %s: address %s is not a plain IPv4 address.'), d.address);
			else
				say(_('Device %s of %s: address (none) is not a plain IPv4 address.'));
			continue;
		}
		let srv = m.servers[p.server];
		// AmneziaWG ignores a peer with the interface's own key (dawnline.awg tunnel_devices leaves it out).
		if (srv?.public_key && d.public_key == srv.public_key)
			say(_("Device %s of %s: the public key is the server's own."));
		let t = srv ? parse_cidr(srv.subnet) : null;
		if (t && (n < t.first || n > t.last))
			say(_("Device %s of %s: address %s is outside %s's tunnel %s."), d.address, srv.name, srv.subnet);
		else if (t && n == t.first)
			say(_("Device %s of %s: address %s is the router's own address on %s."), d.address, srv.name);
		let key = `${p.server} ${d.address}`;
		let o = addrs[key];
		if (o)
			say(_('Device %s of %s: address %s is also used by device %s of %s.'), d.address, o.device, o.person);
		addrs[key] = { device: d.name, person: p.name };
	}
	for (let id, ci in m.circles)
		if (!m.servers[ci.server])
			push(errs, sprintf(_('Circle %s: server %s does not exist.'), ci.name, ci.server));
	return errs;
};

/**
 * Give every device on a server an address in `subnet` (the server's new
 * tunnel network), lowest first: used by server_update when the network
 * changes. Each device then needs its configuration again (the address is
 * in it). Fails when the subnet cannot hold them.
 */
export function renumber_server(c, m, srv, subnet) {
	srv.subnet = subnet;
	for (let pid, p in m.people)
		if (p.server == srv.id)
			for (let did in p.devices)
				m.devices[did].address = '';
	for (let pid, p in m.people)
		if (p.server == srv.id)
			for (let did in p.devices) {
				let addr = alloc_address(m, srv);
				if (!addr)
					fail(sprintf(_('%s has no room for every device on %s.'), subnet, srv.name));
				m.devices[did].address = addr;
				c.set(CONFIG, did, 'address', addr);
			}
	c.set(CONFIG, srv.id, 'subnet', subnet);
};

/**
 * The DNS labels of a person's devices, { device id: label }, unique within
 * the person: two devices whose names give one label ("iPhone" and
 * "iPhone!", or two Cyrillic names) get -2, -3 by age. Hostnames in
 * /tmp/hosts (dawnline.apply) and the ones the UI shows (dawnline.view) both
 * come from here, so what is shown resolves.
 */
export function device_labels(m, p) {
	let out = {}, used = {};
	let devs = sort(map(p.devices, (id) => m.devices[id]), (a, b) => (a.created - b.created) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	for (let d in devs) {
		let base = host_label(d.name), l = base;
		for (let n = 2; used[l]; n++)
			l = `${substr(base, 0, 37)}-${n}`;
		used[l] = true;
		out[d.id] = l;
	}
	return out;
};

/**
 * Port forwards from `zone` for `proto` that aren't Dawnline's: [{ from, to, name }].
 * A forwarded port never reaches the router itself, so nothing here can listen on it.
 */
export function wan_forwards(zone, proto) {
	let c = cursor();
	c.load('firewall');
	let out = [];
	c.foreach('firewall', 'redirect', (r) => {
		if (substr(r['.name'], 0, 9) == 'dawnline_' || r.enabled == '0' || (r.target ?? 'DNAT') != 'DNAT' || r.src != zone)
			return;
		// fw4's default is "tcp udp".
		let protos = split(type(r.proto) == 'array' ? join(' ', r.proto) : r.proto ?? 'tcp udp', /[ ,]+/);
		if (index(protos, proto) < 0 && index(protos, 'all') < 0 && index(protos, 'any') < 0)
			return;
		for (let p in split(`${r.src_dport ?? ''}`, /[ ,]+/)) {
			let m = match(p, /^(\d+)([-:](\d+))?$/);
			if (m)
				push(out, { from: +m[1], to: +(m[3] || m[1]), name: r.name ?? r['.name'] });
		}
	});
	return out;
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
	// An IPv6 address needs its brackets in a URL.
	let h = index(host, ':') >= 0 && !match(host, /^\[/) ? `[${host}]` : host;
	return `https://${h}${pp == 443 ? '' : `:${pp}`}/${p.code}`;
};

/** The main link (QR, invite card, Copy link). */
export function portal_url(m, p) {
	return portal_link(m, p, portal_hosts(m)[0]);
};

/** Every link to the same portal, the main one first. */
export function portal_urls(m, p) {
	return filter(map(portal_hosts(m), (h) => portal_link(m, p, h)), (x) => x != null);
};
