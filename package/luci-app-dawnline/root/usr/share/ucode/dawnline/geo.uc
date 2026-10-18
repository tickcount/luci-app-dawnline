// Dawnline — city-level locations for the admin map.
//
// Client addresses are looked up once with a third-party service (ipwho.is,
// ipapi.co as fallback) and cached: the live copy in RUN_DIR (tmpfs), put on
// flash (DATA_DIR/geo.json) by flush() about hourly, like the usage
// counters. Only the agent performs lookups, in a child process (the network
// may take seconds; neither its watcher nor its tick waits for them) and
// merges them into the cache itself; the UI reads the cache.

import { stat } from 'fs';
import { read_json, write_json, sh_out, q, ensure_dir, ip2int, DATA_DIR, RUN_DIR } from 'dawnline.util';

const CACHE = `${RUN_DIR}/geo.json`;
const SAVED = `${DATA_DIR}/geo.json`;
const TTL = 30 * 86400;
const RETRY = 86400;
// Entries kept at least; addresses still shown are never pushed out (merge).
const CAP = 500;

// [base, prefix] of ranges with no meaningful location (private, CGNAT, multicast, …).
const PRIVATE4 = map([ [ '0.0.0.0', 8 ], [ '10.0.0.0', 8 ], [ '100.64.0.0', 10 ], [ '127.0.0.0', 8 ], [ '169.254.0.0', 16 ],
	[ '172.16.0.0', 12 ], [ '192.168.0.0', 16 ], [ '198.18.0.0', 15 ], [ '224.0.0.0', 3 ] ], (r) => [ ip2int(r[0]), 1 << (32 - r[1]) ]);

/** True for addresses a geolocation service can say something about. */
export function is_public(ip) {
	if (type(ip) != 'string' || ip == '')
		return false;
	let n = ip2int(ip);
	if (n != null) {
		for (let r in PRIVATE4)
			if (n >= r[0] && n < r[0] + r[1])
				return false;
		return true;
	}
	let l = lc(ip);
	return match(l, /^[0-9a-f:]+$/) != null && !match(l, /^(fe[89ab]|f[cd]|::1$|::$)/);
};

export function load() {
	return read_json(CACHE, null) ?? read_json(SAVED, null) ?? { ips: {}, home: null };
};

/** The live copy (tmpfs); flush() puts it on flash. */
export function save(cache) {
	ensure_dir(RUN_DIR);
	write_json(CACHE, cache, 0o600);
};

/** Copy the live cache to flash when it is newer (the agent, about hourly and on a clean stop). */
export function flush() {
	let live = stat(CACHE);
	if (!live || live.mtime <= (stat(SAVED)?.mtime ?? 0))
		return false;
	let c = read_json(CACHE, null);
	if (!c)
		return false;
	ensure_dir(DATA_DIR, 0o700);
	write_json(SAVED, c, 0o600);
	return true;
};

function fetch_json(url) {
	let out = sh_out(`uclient-fetch -q -T 5 -O - ${q(url)}`);
	if (!out)
		return null;
	try {
		return json(out);
	}
	catch (e) {
		return null;
	}
}

function lookup_ipwho(ip) {
	let j = fetch_json(`https://ipwho.is/${ip}?fields=success,ip,latitude,longitude,city,country,country_code,connection`);
	if (!j || j.success !== true || j.latitude == null)
		return null;
	let cn = j.connection ?? {};
	return { lat: +j.latitude, lon: +j.longitude, city: j.city ?? '', country: j.country ?? '', cc: j.country_code ?? '', ip: j.ip,
		asn: cn.asn ? +cn.asn : 0, org: cn.isp || cn.org || '' };
}

function lookup_ipapi(ip) {
	let j = fetch_json(ip ? `https://ipapi.co/${ip}/json/` : 'https://ipapi.co/json/');
	if (!j || j.error || j.latitude == null)
		return null;
	return { lat: +j.latitude, lon: +j.longitude, city: j.city ?? '', country: j.country_name ?? '', cc: j.country_code ?? '', ip: j.ip,
		asn: +replace(`${j.asn ?? ''}`, /^AS/i, '') || 0, org: j.org ?? '' };
}

/** One lookup with the configured provider and the other as fallback. */
export function lookup(provider, ip) {
	let order = provider == 'ipapi.co' ? [ lookup_ipapi, lookup_ipwho ] : [ lookup_ipwho, lookup_ipapi ];
	for (let fn in order) {
		let r = fn(ip ?? '');
		if (r)
			return r;
	}
	return null;
};

/**
 * The public addresses of `ips` the cache does not know or knows from too
 * long ago (a failed lookup is retried after a day), once each and in order.
 * Returns an empty array when there is nothing to look up.
 */
export function stale(cache, ips, ts) {
	let now = ts ?? time(), out = [], seen = {};
	for (let ip in ips) {
		if (seen[ip] || !is_public(ip))
			continue;
		seen[ip] = true;
		let c = cache.ips[ip];
		if (c && ((c.fail && now - c.fail < RETRY) || (!c.fail && c.asn != null && now - c.ts < TTL)))
			continue;
		push(out, ip);
	}
	return out;
};

/**
 * Look up at most `max` of `ips`, within `budget` seconds (each lookup may
 * wait on the network). Returns { ip: place, or false when the services had
 * nothing } for the ones tried. Network only, no cache: the agent runs it in
 * a child process and merges the result itself.
 */
export function lookup_all(provider, ips, max, budget) {
	let started = time(), out = {}, done = 0;
	for (let ip in ips) {
		if (done >= max || (budget != null && time() - started >= budget))
			break;
		let r = lookup(provider, ip);
		done++;
		if (r)
			delete r.ip;
		out[ip] = r ?? false;
	}
	return out;
};

/**
 * Put lookup_all() results into the cache. Returns true when the cache
 * changed (the caller saves it). `shown` is what is still on the map: the
 * cache is kept bounded by dropping other entries only, oldest first, so a
 * lookup is never repeated for an address that is still on the map.
 */
export function merge(cache, found, shown, ts) {
	let now = ts ?? time(), changed = false;
	for (let ip, r in found) {
		if (!is_public(ip))
			continue;
		cache.ips[ip] = r ? { ...r, ts: now } : { fail: now };
		changed = true;
	}
	let keep = {};
	for (let ip in shown)
		keep[ip] = true;
	let all = keys(cache.ips);
	if (length(all) > CAP) {
		let other = sort(filter(all, (ip) => !keep[ip]),
			(a, b) => (cache.ips[a].ts ?? cache.ips[a].fail ?? 0) - (cache.ips[b].ts ?? cache.ips[b].fail ?? 0));
		for (let i = 0; i < length(all) - CAP && i < length(other); i++) {
			delete cache.ips[other[i]];
			changed = true;
		}
	}
	return changed;
};

/** Locate the router itself (the arcs' origin), at most every 6 hours. */
export function resolve_home(settings, cache, wan_ip) {
	let h = cache.home;
	let now = time();
	if (h && h.asn != null && now - (h.ts ?? 0) < 6 * 3600 && (!wan_ip || !is_public(wan_ip) || h.wan == wan_ip))
		return false;
	// Behind NAT, ask the service for our public address instead.
	let r = lookup(settings.geo_provider, is_public(wan_ip) ? wan_ip : '');
	cache.home = r ? { ...r, wan: wan_ip, ts: now } : { ...(h ?? {}), ts: now };
	return true;
};

export function place(cache, ip) {
	let c = cache.ips[ip];
	return (c && !c.fail) ? c : null;
};

/** "City · ISP" for the activity log; null for no place. */
export function label(pl) {
	return pl ? join(' · ', filter([ pl.city, pl.org ], (x) => x)) : null;
};

export function clear() {
	save({ ips: {}, home: null });
	ensure_dir(DATA_DIR, 0o700);
	write_json(SAVED, { ips: {}, home: null }, 0o600);
};
