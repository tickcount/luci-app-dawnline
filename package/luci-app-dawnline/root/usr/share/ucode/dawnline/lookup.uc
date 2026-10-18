// Dawnline — where names point and the router's public address, for Health
// and the portal settings. Lookups are cached in RUN_DIR for a few minutes
// and made in parallel with a short timeout: rpcd answers one call at a
// time, so a slow DNS server must not hold up the whole admin UI.

import { readfile } from 'fs';
import { q, sh, ensure_dir, read_json, write_json, ip2int, is_ip6, rand_hex, RUN_DIR } from 'dawnline.util';
import * as live from 'dawnline.live';
import * as net from 'dawnline.net';

const CACHE = `${RUN_DIR}/resolve.json`;
// Answers are kept 5 minutes, failures 1 minute.
const TTL = 300;
const TTL_FAIL = 60;
const TIMEOUT = 2;
const MAX_NAMES = 16;
// Public resolvers first: local DNS often rewrites the router's own name to
// its LAN address (split horizon).
const SERVERS = [ '1.1.1.1', '8.8.8.8', '127.0.0.1' ];

function valid_name(h) {
	return type(h) == 'string' && length(h) <= 253 && match(h, /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/) != null;
}

/**
 * Addresses of each name, IPv4 and IPv6: { host: [ ip, … ] } (empty when it
 * does not resolve). IP addresses map to themselves. Every uncached name is
 * asked of every server at once, A and AAAA; the first server (in SERVERS
 * order) that answers wins.
 */
export function resolve_all(hosts) {
	let out = {}, now = time(), todo = [];
	let cache = read_json(CACHE, {});
	for (let h in hosts) {
		if (h == null || out[h] != null)
			continue;
		if (ip2int(h) != null || is_ip6(h)) {
			out[h] = [ h ];
			continue;
		}
		let c = cache[h];
		if (c && now - c.ts < (length(c.ips) ? TTL : TTL_FAIL))
			out[h] = c.ips;
		else if (valid_name(h) && length(todo) < MAX_NAMES) {
			out[h] = [];
			push(todo, h);
		}
		else
			out[h] = [];
	}
	if (!length(todo))
		return out;

	ensure_dir(RUN_DIR);
	let dir = `${RUN_DIR}/resolve.${rand_hex(4)}`;
	let cmds = [];
	for (let i = 0; i < length(todo); i++)
		for (let j = 0; j < length(SERVERS); j++)
			for (let t in [ 'a', 'aaaa' ])
				// nslookup's own timeout: some firmware builds BusyBox without `timeout`.
				push(cmds, `( nslookup -type=${t} -timeout=${TIMEOUT} -retry=1 ${q(todo[i])} ${SERVERS[j]} 2>/dev/null | awk '/^Address/ && NR>2 {print $NF}' > ${dir}/${i}.${j}.${t} ) &`);
	sh(`mkdir -p ${dir}; ${join(' ', cmds)} wait`);
	for (let i = 0; i < length(todo); i++) {
		let ips = [];
		for (let j = 0; j < length(SERVERS) && !length(ips); j++)
			for (let t in [ 'a', 'aaaa' ]) {
				let r = readfile(`${dir}/${i}.${j}.${t}`) ?? '';
				push(ips, ...filter(split(trim(r), '\n'), (x) => ip2int(x) != null || is_ip6(x)));
			}
		out[todo[i]] = ips;
		cache[todo[i]] = { ts: now, ips };
	}
	system(`rm -rf ${dir}`);
	// Only what is still fresh is kept.
	for (let h, c in cache)
		if (now - c.ts >= TTL)
			delete cache[h];
	write_json(CACHE, cache, 0o644);
	return out;
};

/** IPv4 addresses of one name (see resolve_all). */
export function resolve(host) {
	return resolve_all([ host ])[host] ?? [];
};

/** The IPv4 address of a netifd interface (a zone name for older configs). */
export function wan_ipv4(zone) {
	let st = live.iface_status(zone == 'wan' ? 'wan' : zone);
	return st?.['ipv4-address']?.[0]?.address;
};

/** The router's public IPv4 (the first server's WAN, else the wan interface). */
export function router_wan(m) {
	for (let id, srv in m.servers)
		if (srv.private_key) {
			let a = net.wan_address(srv) ?? wan_ipv4(srv.wan_zone);
			if (a)
				return a;
		}
	return wan_ipv4('wan');
};
