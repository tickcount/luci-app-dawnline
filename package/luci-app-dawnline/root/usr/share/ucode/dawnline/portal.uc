// Dawnline — the personal portal.
//
//   GET  /<code>                          the app shell
//   GET  /<code>/assets/<file>            its script, styles and fonts
//   GET  /<code>/api/state
//   POST /<code>/api/devices              { name, kind, public_key? }
//   GET  /<code>/api/devices/<id>/config
//   POST /<code>/api/devices/<id>         { action: rename|rotate|delete, name? }
//
// The personal link is the key: every request carries its code, there are
// no sessions. Without a valid code every path answers the same bare 404 —
// the root, a person's link, the API and the assets alike — so nothing tells
// a scanner there is a portal here. Wrong codes are rate-limited per client
// (blocked clients get the same 404 even with the right code): per IPv4
// address or IPv6 /64; behind Cloudflare per visitor (CF-Connecting-IP), with
// a higher ceiling for all Cloudflare visitors together.
// Regenerating the code in LuCI locks the old link out at once. POST bodies
// must be JSON from the same origin; Referrer-Policy keeps the code out of
// other sites' logs. The portal can only manage the person's own devices
// within their limits, and not those the admin turned off (dawnline.devices).
//
// handle() serves one request: `io` = { env, headers, read(n), write(s) }; the
// CGI script (www/cgi-bin/portal) is its wrapper.

import { stat, readfile } from 'fs';
import { read_json, write_json, ensure_dir, lock, unlock, cloudflare_ip, ip2int, today, VERSION, RUN_DIR } from 'dawnline.util';
import * as core from 'dawnline.core';
import * as awg from 'dawnline.awg';
import * as live from 'dawnline.live';
import * as view from 'dawnline.view';
import * as schema from 'dawnline.schema';
import * as devices from 'dawnline.devices';

const RATE = `${RUN_DIR}/portal-rate.json`;
const ASSETS = '/usr/share/dawnline/portal/assets';
const TYPES = { js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', woff2: 'font/woff2', png: 'image/png' };
const FAIL_LIMIT = 8;
const FAIL_WINDOW = 900;
// All Cloudflare visitors together (three-word codes can't be guessed anyway).
const SHARED_LIMIT = FAIL_LIMIT * 25;
const SHARED_KEY = 'cloudflare';
// Clients remembered at most (the oldest go first).
const RATE_MAX = 2000;
const BODY_MAX = 8192;
// The early end of a request (a response was written).
const DONE = '__dawnline_done__';

const SECURITY_HEADERS = {
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'no-referrer',
	'X-Frame-Options': 'DENY',
	'Cache-Control': 'no-store',
};

const NOT_READY = "Adding devices isn't available right now: the VPN server isn't ready. Ask whoever sent you this link.";

function html_escape(s) {
	return replace(`${s}`, /[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/* ---------- answering ---------- */

function headers(r, status, extra) {
	let h = `Status: ${status}\r\n`;
	let all = { ...SECURITY_HEADERS, ...(extra ?? {}) };
	// HSTS pins the whole name: only when the visitor is on the standard port.
	if (r.hsts)
		all['Strict-Transport-Security'] = 'max-age=31536000';
	for (let k, v in all)
		h += `${k}: ${v}\r\n`;
	r.io.write(h + '\r\n');
}

function finish() {
	die(DONE);
}

function send_json(r, status, obj) {
	headers(r, status, { 'Content-Type': 'application/json' });
	r.io.write(sprintf('%J', obj));
	finish();
}

function fail(r, status, msg) {
	send_json(r, status, { error: msg });
}

/**
 * The one answer for anything without a valid code: a bare 404, or the redirect from Settings.
 * Files always get the 404: a missing asset must not turn into someone's website.
 */
function not_found(r) {
	let redirect = r.m.settings.portal_redirect;
	let parts = split(r.path, '/');
	let file = match(r.path, /^\/(luci-static|cgi-bin|ubus)(\/|$)/) || match(parts[length(parts) - 1], /\./);
	if (redirect && !file) {
		headers(r, '302 Found', { 'Location': redirect, 'Cache-Control': 'no-store', 'Content-Type': 'text/plain' });
		r.io.write('Moved\n');
	}
	else {
		headers(r, '404 Not Found', { 'Content-Type': 'text/plain' });
		r.io.write('Not found\n');
	}
	finish();
}

/** The JSON object a POST carries ({} without a body). */
function body(r) {
	let len = +(r.env.CONTENT_LENGTH ?? 0);
	if (len <= 0)
		return {};
	if (len > BODY_MAX)
		fail(r, '413 Payload Too Large', 'Request too large.');
	let raw = '';
	while (length(raw) < len) {
		let chunk = r.io.read(len - length(raw));
		if (chunk == null || chunk == '')
			break;
		raw += chunk;
	}
	try {
		let j = json(raw);
		return type(j) == 'object' ? j : {};
	}
	catch (e) {
		fail(r, '400 Bad Request', 'Invalid JSON.');
	}
}

/** Run a change; what it refuses becomes a 400 with its message. */
function guard(r, fn) {
	try {
		return fn();
	}
	catch (e) {
		if (e.message == DONE)
			die(DONE);
		fail(r, '400 Bad Request', e.message);
	}
}

/* ---------- rate limiting ---------- */

/** The rate-limit key of an address: an IPv4 address, or the /64 of an IPv6 one. */
function addr_key(a) {
	if (schema.ipv4(a))
		return a;
	let g = schema.ipv6_groups(a);
	if (!g)
		return null;
	// An IPv4 address seen through an IPv6 socket.
	if (g[0] == 0 && g[1] == 0 && g[2] == 0 && g[3] == 0 && g[4] == 0 && g[5] == 0xffff)
		return sprintf('%d.%d.%d.%d', g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255);
	return sprintf('%x:%x:%x:%x::/64', g[0], g[1], g[2], g[3]);
}

/**
 * The buckets a request counts against, [{ key, limit }]: its client, and
 * behind Cloudflare (the only proxy whose CF-Connecting-IP is believed) also
 * the bucket all Cloudflare visitors share.
 */
function buckets(env) {
	let peer = env.REMOTE_ADDR ?? '';
	if (!cloudflare_ip(peer))
		return [ { key: addr_key(peer) ?? peer, limit: FAIL_LIMIT } ];
	let out = [ { key: SHARED_KEY, limit: SHARED_LIMIT } ];
	let visitor = addr_key(trim(env.HTTP_CF_CONNECTING_IP ?? ''));
	if (visitor && !cloudflare_ip(visitor))
		unshift(out, { key: visitor, limit: FAIL_LIMIT });
	return out;
}

function rate_state() {
	let st = read_json(RATE, {});
	let now = time();
	for (let k, v in st)
		if (type(v) != 'object' || now - v.first > FAIL_WINDOW)
			delete st[k];
	return st;
}

function rate_blocked(r) {
	let st = rate_state();
	return length(filter(r.buckets, (b) => (st[b.key]?.count ?? 0) >= b.limit)) > 0;
}

function rate_fail(r) {
	let l = lock('portal-rate');
	let st = rate_state();
	let now = time();
	let hit = [];
	for (let b in r.buckets) {
		let v = st[b.key] ?? { first: now, count: 0 };
		v.count++;
		st[b.key] = v;
		if (v.count == b.limit)
			push(hit, b.key);
	}
	// Bounded: an attacker with many addresses cannot grow the file without end.
	let all = keys(st);
	if (length(all) > RATE_MAX) {
		all = sort(all, (a, b) => st[a].first - st[b].first);
		for (let i = 0; i < length(all) - RATE_MAX; i++)
			delete st[all[i]];
	}
	ensure_dir(RUN_DIR);
	write_json(RATE, st, 0o600);
	unlock(l);
	for (let k in hit)
		live.add_event({ type: 'portal_blocked', detail: k == SHARED_KEY ? 'all Cloudflare visitors' : k });
}

/* ---------- pages ---------- */

/** The app shell; it reads the code from its own URL and sends it along. */
function shell(r) {
	// The build's time joins the version so every update busts the hour-long asset cache.
	let v = `?v=${VERSION}.${stat(`${ASSETS}/portal.js`)?.mtime ?? 0}`;
	let base = r.base, title = r.title;
	headers(r, '200 OK', {
		'Content-Type': 'text/html; charset=utf-8',
		'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; " +
			"connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
	});
	r.io.write(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex, nofollow">
<title>${html_escape(title)}</title>
<link rel="icon" href="${base}/assets/icon.svg${v}" type="image/svg+xml">
<link rel="stylesheet" href="${base}/assets/portal.css${v}">
</head>
<body>
<div id="app" data-base="${html_escape(base)}" data-title="${html_escape(title)}"></div>
<script src="${base}/assets/portal.js${v}" defer></script>
</body>
</html>
`);
	finish();
}

/** Script, styles, icon and fonts (kept outside the web root). */
function asset(r, name) {
	let ext = match(name, /^[a-z0-9-]+\.(js|css|svg|woff2|png)$/)?.[1];
	let data = ext ? readfile(`${ASSETS}/${name}`) : null;
	if (data == null)
		not_found(r);
	headers(r, '200 OK', { 'Content-Type': TYPES[ext], 'Cache-Control': 'private, max-age=3600' });
	r.io.write(data);
	finish();
}

/* ---------- the API ---------- */

/** The model again after a change. */
function reload(r) {
	r.m = core.load();
	r.person = r.m.people[r.person.id];
	if (!r.person)
		not_found(r);
}

/** Everything the page shows. */
function state(r) {
	let m = r.m, person = r.person;
	let usage = core.load_usage();
	let v = view.person_view(m, person, usage, live.dump(m), view.states(m, usage));
	let srv = m.servers[person.server];
	// The device this page was opened from, when it came through the tunnel.
	let here = null;
	for (let id, d in m.devices)
		if (d.person == person.id && d.address == r.peer)
			here = id;
	return {
		title: r.title,
		person: v,
		here,
		server: {
			name: srv?.name, endpoint: srv ? core.endpoint_host(m, srv) : '', device_mesh: !!srv?.device_mesh,
			// AmneziaWG with the disguise off is plain WireGuard (any WireGuard app).
			awg_disguise: srv ? !awg.obf_neutral(srv.obf) : false,
		},
		can_add: length(person.devices) < person.device_limit,
		kinds: core.KINDS,
		// The router's day: access ends and usage days follow its clock, not the browser's.
		today: today(),
		version: VERSION,
	};
}

/** One of the person's own devices, or a 404. */
function own_device(r, id) {
	let d = r.m.devices[id];
	if (!d || d.person != r.person.id)
		fail(r, '404 Not Found', 'Device not found.');
	return d;
}

function api_state(r) {
	send_json(r, '200 OK', state(r));
}

function api_add(r) {
	let b = body(r);
	if (!devices.ready())
		fail(r, '503 Service Unavailable', NOT_READY);
	let res = guard(r, () => devices.add(r.person.id, b.name, b.kind, { by: 'portal', public_key: b.public_key }));
	reload(r);
	send_json(r, '200 OK', { id: res.id, config: res.config, state: state(r) });
}

function api_config(r, id) {
	let d = own_device(r, id);
	awg.mark_issued(r.m, d.id);
	send_json(r, '200 OK', awg.client_config(r.m, d));
}

/** POST /devices/<id> { action }: what each action does; the answer carries the new state. */
const ACTIONS = {
	rename: (r, d, b) => {
		guard(r, () => devices.update(d.id, { name: b.name }, { by: 'portal', person: r.person.id }));
		return {};
	},
	rotate: (r, d, b) => {
		if (!devices.ready())
			fail(r, '503 Service Unavailable', NOT_READY);
		let config = guard(r, () => devices.rotate(d.id, { by: 'portal', person: r.person.id, defer: d.address == r.peer }));
		return { config };
	},
	'delete': (r, d, b) => {
		guard(r, () => devices.remove(d.id, { by: 'portal', person: r.person.id }));
		return {};
	},
};

function api_device(r, id) {
	let d = own_device(r, id);
	let b = body(r);
	let act = ACTIONS[b.action];
	if (!act)
		fail(r, '400 Bad Request', 'Unknown action.');
	let res = act(r, d, b);
	reload(r);
	send_json(r, '200 OK', { ok: true, ...res, state: state(r) });
}

/** API routes: method, path under /<code>/api ('*' matches one segment, passed to run). */
const API = [
	{ method: 'GET', path: [ 'state' ], run: api_state },
	{ method: 'POST', path: [ 'devices' ], run: api_add },
	{ method: 'GET', path: [ 'devices', '*', 'config' ], run: api_config },
	{ method: 'POST', path: [ 'devices', '*' ], run: api_device },
];

/** The route for a request: { run, args } or null (routes take at most one '*'). */
function route(table, method, segs) {
	for (let rt in table) {
		if (rt.method != method || length(rt.path) != length(segs))
			continue;
		let args = [], ok = true;
		for (let i = 0; i < length(segs) && ok; i++)
			if (rt.path[i] == '*')
				push(args, segs[i]);
			else if (rt.path[i] != segs[i])
				ok = false;
		if (ok)
			return { run: rt.run, args };
	}
	return null;
}

/* ---------- one request ---------- */

export function handle(io) {
	let env = io.env ?? {};
	// Header names arrive lower-case from uhttpd; CGI has only HTTP_* variables.
	let hdr = {};
	for (let k, v in io.headers ?? {})
		hdr[lc(k)] = v;
	let header = (name) => hdr[name] ?? env[`HTTP_${uc(replace(name, /-/g, '_'))}`];
	let uri = env.REQUEST_URI ?? '/';
	let qpos = index(uri, '?');
	let path = qpos >= 0 ? substr(uri, 0, qpos) : uri;
	let https = env.HTTPS == 'on';
	let host = header('host') ?? '';
	let m = core.load();
	let r = {
		io, env, m, path, https,
		method: env.REQUEST_METHOD ?? 'GET',
		peer: env.REMOTE_ADDR ?? '',
		buckets: buckets(env),
		title: m.settings.portal_title || 'Dawnline',
		// The port in the visitor's address bar ([v6]:port, name:port, or the default).
		hsts: https && (match(host, /:([0-9]+)$/)?.[1] ?? '443') == '443',
		person: null,
		base: '',
	};
	let segs = filter(split(path, '/'), (s) => s != '');

	// Plain HTTP only for an IP address chosen in Settings (no certificate exists
	// for it); names stay HTTPS-only.
	if (!https) {
		let h = match(host, /^\[/) ? host : split(host, ':')[0];
		if (ip2int(h) == null || index(core.portal_hosts(m), h) < 0)
			not_found(r);
	}
	// The link is /<word-code>[/assets/…|/api/…]: the code is the address.
	if (length(segs) < 1 || !match(segs[0], core.WORD_CODE))
		not_found(r);
	let code = segs[0];
	for (let id, p in m.people)
		if (p.code == code)
			r.person = p;

	// A wrong code or a blocked client: indistinguishable from a path that does
	// not exist. Only well-formed guesses count towards the limit.
	if (rate_blocked(r))
		not_found(r);
	if (r.person == null) {
		rate_fail(r);
		not_found(r);
	}
	r.base = `/${code}`;
	let rest = slice(segs, 1);

	if (length(rest) == 0 && r.method == 'GET')
		shell(r);
	if (rest[0] == 'assets' && length(rest) == 2 && r.method == 'GET')
		asset(r, rest[1]);
	if (rest[0] != 'api')
		not_found(r);

	// CSRF: only same-origin JSON requests (a cross-site page cannot send
	// application/json without CORS, and it would need the code anyway).
	if (r.method == 'POST') {
		let origin = header('origin');
		if (!match(env.CONTENT_TYPE ?? '', /^application\/json/) ||
		    (origin != null && origin != `${https ? 'https' : 'http'}://${host}`))
			fail(r, '403 Forbidden', 'Cross-site request refused.');
	}
	else if (r.method != 'GET')
		fail(r, '405 Method Not Allowed', 'Method not allowed.');

	let rt = route(API, r.method, slice(rest, 1));
	if (!rt)
		fail(r, '404 Not Found', 'Not found.');
	rt.run(r, rt.args[0]);
	fail(r, '404 Not Found', 'Not found.');
};

/** Run handle() and swallow its early end. */
export function serve(io) {
	try {
		handle(io);
	}
	catch (e) {
		if (e.message != DONE)
			io.write(`Status: 500 Internal Server Error\r\nContent-Type: text/plain\r\n\r\nError\n`);
	}
};
