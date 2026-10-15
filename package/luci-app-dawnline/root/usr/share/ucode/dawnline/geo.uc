// Dawnline — city-level locations for the admin map.
//
// Client addresses are looked up once with a third-party service (ipwho.is,
// ipapi.co as fallback) and cached in DATA_DIR/geo.json. Only the agent
// performs lookups, a few per minute at most; the UI reads the cache.

import { read_json, write_json, sh_out, q, ensure_dir, ip2int, DATA_DIR } from 'dawnline.util';

const CACHE = `${DATA_DIR}/geo.json`;
const TTL = 30 * 86400;
const RETRY = 86400;

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
	return read_json(CACHE, null) ?? { ips: {}, home: null };
};

export function save(cache) {
	ensure_dir(DATA_DIR, 0o700);
	write_json(CACHE, cache, 0o600);
};

function fetch_json(url) {
	let out = sh_out(`uclient-fetch -q -T 8 -O - ${q(url)}`);
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
 * Resolve up to `max` addresses that are missing or stale. Returns true when
 * the cache changed (the caller saves it).
 */
export function resolve(settings, cache, ips, max) {
	let now = time(), changed = false, done = 0;
	for (let ip in ips) {
		if (done >= max)
			break;
		if (!is_public(ip))
			continue;
		let c = cache.ips[ip];
		if (c && ((c.fail && now - c.fail < RETRY) || (!c.fail && c.asn != null && now - c.ts < TTL)))
			continue;
		let r = lookup(settings.geo_provider, ip);
		done++;
		changed = true;
		if (r) {
			delete r.ip;
			r.ts = now;
			cache.ips[ip] = r;
		}
		else
			cache.ips[ip] = { fail: now };
	}
	// Keep the cache bounded: drop the oldest entries beyond 500.
	let all = keys(cache.ips);
	if (length(all) > 500) {
		all = sort(all, (a, b) => (cache.ips[a].ts ?? cache.ips[a].fail ?? 0) - (cache.ips[b].ts ?? cache.ips[b].fail ?? 0));
		for (let i = 0; i < length(all) - 500; i++)
			delete cache.ips[all[i]];
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

export function clear() {
	save({ ips: {}, home: null });
};
