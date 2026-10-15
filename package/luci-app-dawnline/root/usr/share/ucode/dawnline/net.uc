// Dawnline — the router's network interfaces: what exists, which one is the
// WAN, and which ones make up a server's "home network".
//
// Per server (uci `server` section):
//   auto_wan     1 = use the interface of the default route (detected_wan
//                is kept as a fallback while the WAN is down)
//   wan_device   the WAN interface when auto_wan is off
//   auto_lan     1 = include the detected LAN (detected_lan as fallback)
//   lan_device   extra interfaces that count as the home network (list)
//
// Home access is enforced by destination: the networks routed out of the
// chosen interfaces form the nft `lan_nets` set, and the tunnel's firewall
// zone gets a forwarding to each of their zones.

import { readfile, readlink, lsdir, stat } from 'fs';
import { cursor } from 'uci';
import { sh_out, ip2int, int2ip, uniq } from 'dawnline.util';

const SYS = '/sys/class/net';
/** Links Dawnline creates itself (dawnline.loop); never offered as interfaces. */
export const INTERNAL = { transit: 'dlx0', lan: 'dll0' };
const VPN_PROTOS = [ 'amneziawg', 'wireguard', 'openvpn', 'openconnect', 'vpnc', 'pptp', 'l2tp', 'gre', 'gretap', 'vti', 'xfrm' ];
// Kernel placeholder devices that never carry a network on their own.
const NOISE = /^(ifb|teql|sit|ip6tnl|gre|gretap|erspan|ip6gre|ip6gretap|ip_vti|ip6_vti|tunl|bond)[0-9]*$/;
const PRIVATE = [ [ '10.0.0.0', 8 ], [ '172.16.0.0', 12 ], [ '192.168.0.0', 16 ], [ '100.64.0.0', 10 ] ];

function sysread(dev, f) {
	return trim(readfile(`${SYS}/${dev}/${f}`) ?? '');
}

function ip_json(args) {
	try {
		return json(sh_out(`ip -j ${args} 2>/dev/null`) || '[]') ?? [];
	}
	catch (e) {
		return [];
	}
}

function ubus_json(path, method) {
	try {
		return json(sh_out(`ubus call ${path} ${method} 2>/dev/null`) || 'null');
	}
	catch (e) {
		return null;
	}
}

/** "a.b.c.d[/len]" → { net, prefix, size } for any prefix 1-32; null for default or junk. */
function net_of(s) {
	let m = match(s ?? '', /^([0-9.]+)(\/([0-9]+))?$/);
	if (!m)
		return null;
	let ip = ip2int(m[1]), prefix = m[3] != null ? +m[3] : 32;
	if (ip == null || prefix < 1 || prefix > 32)
		return null;
	let size = 1 << (32 - prefix);
	if (prefix == 1)
		size = 2147483648;
	return { net: ip - ip % size, prefix, size };
}

function net_str(n) {
	return `${int2ip(n.net)}/${n.prefix}`;
}

/** Drop networks already covered by a wider one. */
export function collapse(list) {
	let nets = filter(map(uniq(list), net_of), (x) => x != null);
	nets = sort(nets, (a, b) => a.prefix - b.prefix || a.net - b.net);
	let keep = [];
	for (let n in nets) {
		let inside = false;
		for (let k in keep)
			if (n.net >= k.net && n.net < k.net + k.size) {
				inside = true;
				break;
			}
		if (!inside)
			push(keep, n);
	}
	return map(sort(keep, (a, b) => a.net - b.net), net_str);
};

function is_private(cidr) {
	let n = net_of(cidr);
	if (!n)
		return false;
	for (let p in PRIVATE) {
		let base = ip2int(p[0]), size = 1 << (32 - p[1]);
		if (n.net >= base && n.net < base + size)
			return true;
	}
	return false;
}

/* ---------- snapshot ---------- */

let cache = null;

/**
 * One consistent view of the router's interfaces, cached for a few seconds
 * (rpcd keeps this module loaded, so the cache must expire).
 */
export function snapshot(fresh) {
	if (!fresh && cache && time() - cache.ts < 5)
		return cache;

	// Networks reachable through each device (main table, IPv4).
	let routes = {}, wan_dev = null;
	for (let r in ip_json('-4 route show table main')) {
		if (!r.dev)
			continue;
		if (r.dst == 'default') {
			wan_dev ??= r.dev;
			continue;
		}
		push(routes[r.dev] ??= [], r.dst);
	}
	let addrs = {};
	for (let l in ip_json('-4 addr show'))
		for (let a in l.addr_info ?? [])
			if (a.family == 'inet')
				push(addrs[l.ifname] ??= [], `${a.local}/${a.prefixlen}`);

	// Logical (netifd) interfaces by device, and firewall zones by network.
	let logical = {};
	for (let i in ubus_json('network.interface', 'dump')?.interface ?? []) {
		let dev = i.l3_device ?? i.device;
		if (dev && !logical[dev])
			logical[dev] = { name: i.interface, proto: i.proto, up: i.up };
	}
	let zone_by_net = {}, zone_by_dev = {}, zones = [];
	let fc = cursor();
	fc.load('firewall');
	fc.foreach('firewall', 'zone', (z) => {
		if (!z.name)
			return;
		push(zones, z.name);
		for (let n in (type(z.network) == 'array' ? z.network : split(z.network ?? '', /\s+/)))
			if (n != '')
				zone_by_net[n] ??= z.name;
		for (let d in (type(z.device) == 'array' ? z.device : split(z.device ?? '', /\s+/)))
			if (d != '')
				zone_by_dev[d] ??= z.name;
	});

	let devices = {};
	for (let dev in sort(lsdir(SYS) ?? [])) {
		if (dev == 'lo' || dev == INTERNAL.transit || dev == INTERNAL.lan)
			continue;
		let lg = logical[dev];
		let flags = hex(sysread(dev, 'flags') || '0');
		let kind = +(sysread(dev, 'type') || '0');
		let master = readlink(`${SYS}/${dev}/master`);
		master = master ? replace(master, /^.*\//, '') : null;
		let bridge = stat(`${SYS}/${dev}/bridge`) != null;
		let wifi = stat(`${SYS}/${dev}/phy80211`) != null || stat(`${SYS}/${dev}/wireless`) != null;
		let nets = routes[dev] ? collapse(routes[dev]) : [];
		let up = (flags & 1) != 0;
		if (match(dev, NOISE) && !length(nets))
			continue;
		let cat;
		if (wifi)
			cat = 'wifi';
		else if ((lg && index(VPN_PROTOS, lg.proto) >= 0) || kind == 65534 || ((flags & 0x10) && kind != 1) || match(dev, /^(wg|awg|tun|tap|ovpn|ipsec|vti|xfrm)/))
			cat = 'vpn';
		else if (kind == 1 || bridge)
			cat = 'ethernet';
		else
			cat = 'other';
		devices[dev] = {
			name: dev,
			category: dev == wan_dev ? 'wan' : cat,
			kind: bridge ? 'bridge' : cat,
			up,
			master,
			members: [],
			nets,
			addrs: addrs[dev] ?? [],
			logical: lg?.name,
			proto: lg?.proto,
			zone: zone_by_dev[dev] ?? (lg ? zone_by_net[lg.name] : null),
		};
	}
	for (let dev, d in devices)
		if (d.master && devices[d.master])
			push(devices[d.master].members, dev);

	// The LAN: netifd's "lan" if present, otherwise the first bridge (then
	// ethernet device) carrying a private network.
	let lan_dev = null;
	for (let dev, lg in logical)
		if (lg.name == 'lan' && devices[dev])
			lan_dev = dev;
	if (!lan_dev)
		for (let pass in [ 'bridge', 'ethernet' ])
			for (let dev, d in devices)
				if (!lan_dev && dev != wan_dev && d.kind == pass && !d.master && length(filter(d.nets, is_private)))
					lan_dev = dev;

	cache = { ts: time(), devices, wan: wan_dev, lan: lan_dev, zones };
	return cache;
};

/* ---------- per server ---------- */

/**
 * What a server actually uses right now:
 *   wan:  { dev, zone, auto, missing }
 *   home: [{ dev, auto, nets, zone, missing }]
 *   nets: home networks (collapsed), zones: their firewall zones
 */
export function server_net(srv, snap) {
	snap ??= snapshot();
	let devs = snap.devices;

	let wan_dev = srv.auto_wan ? (snap.wan ?? srv.detected_wan) : srv.wan_device;
	let wan = {
		dev: wan_dev || null,
		auto: !!srv.auto_wan,
		zone: devs[wan_dev]?.zone ?? srv.wan_zone ?? 'wan',
		missing: !!wan_dev && !devs[wan_dev],
	};

	let picked = [];
	let auto_lan = srv.auto_lan ? (snap.lan ?? srv.detected_lan) : null;
	if (auto_lan)
		push(picked, [ auto_lan, true ]);
	for (let d in srv.lan_devices ?? [])
		if (d != auto_lan)
			push(picked, [ d, false ]);

	let home = [], nets = [], zones = [];
	for (let p in picked) {
		let dev = p[0];
		// Never the WAN, the tunnel itself, or a bridge port (routing only sees the bridge).
		if (dev == wan.dev || dev == srv.ifname || devs[dev]?.master)
			continue;
		let d = devs[dev];
		let h = { dev, auto: p[1], nets: d?.nets ?? [], zone: d?.zone ?? null, missing: !d };
		push(home, h);
		push(nets, ...h.nets);
		if (h.zone)
			push(zones, h.zone);
	}
	// Older configs and routers where nothing could be resolved: the zone set at setup.
	if (!length(home) && srv.auto_lan && srv.lan_zone)
		push(zones, srv.lan_zone);
	return { wan, home, nets: collapse(nets), zones: uniq(zones) };
};

/** Router address on the home network (DNS for tunnel clients). */
export function home_address(srv, snap) {
	snap ??= snapshot();
	let sn = server_net(srv, snap);
	for (let h in sn.home)
		for (let a in snap.devices[h.dev]?.addrs ?? [])
			return split(a, '/')[0];
	return null;
};

/** WAN IPv4 address of a server's WAN interface. */
export function wan_address(srv, snap) {
	snap ??= snapshot();
	let a = snap.devices[server_net(srv, snap).wan.dev]?.addrs?.[0];
	return a ? split(a, '/')[0] : null;
};
