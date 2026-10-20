// Dawnline — "like a home device": tunnel clients' internet traffic enters
// the router from the LAN, so whatever handles LAN traffic there (proxies,
// DPI bypass, DNS filters, fw4's lan zone, ...) handles it too, without
// Dawnline knowing about any of them.
//
//   dawn0 ──policy route──▶ dlx0 ═veth═ dlx1 ┐ netns "dawnline" ┌ dll1 ═veth═ dll0 ── br-lan
//                                              └── NAT to a LAN address ┘
//
// The netns is one more device on the LAN bridge with its own address (picked
// from the LAN subnet above the DHCP pool) and its own MAC (hashed from the
// bridge's), the same each time it is created: the router's neighbour table
// knows the address by that MAC, so a netns created again keeps its address
// instead of seeing it held by another device. Replies come back the same way.
// Home-network destinations keep their direct route; per-person access is
// still enforced on dawn0 before any of this (table inet dawnline).
//
// Clients also use the netns address as DNS: it forwards to the DNS the LAN
// gets from DHCP, from the LAN side, so DNS interception applies as well.
//
// The netns forwards and NATs every packet a second time (conntrack, the
// forward hook): about 40% more CPU per packet on an MT7981. A flowtable on
// its two links (dlx1, dll1) lets established TCP and UDP flows skip that
// work. The netns holds no access rules: who may reach what is judged on the
// tunnel interfaces in the root namespace, which no flowtable here touches.
// Without kernel flowtables (kmod-nft-offload) the loop runs as before,
// slower, and logs it once.
//
// Separately, people with Home-only access get a plain resolver
// (dawnline.resolver). While the netns exists it runs inside it and sends its
// upstream queries back out through the transit link as forwarded traffic —
// not as the router's own traffic and not from the LAN — so tools that
// capture either leave it alone. This module says where it runs.
//
// Everything is derived from the router at run time; nothing assumes a
// particular subnet or tool. If the LAN is not a bridge or setup fails, the
// direct path stays and status() says why (kept as a code in loop.json, which
// apply and the agent write with no language; error_text() makes the words).

import { readfile, writefile, readlink, stat, unlink } from 'fs';
import { cursor } from 'uci';
import {
	sh, sh_out, q, ip2int, int2ip, parse_cidr, cidr_any, ensure_dir, read_json, write_json, slog, RUN_DIR
} from 'dawnline.util';
import * as net from 'dawnline.net';
import * as core from 'dawnline.core';
import * as store from 'dawnline.store';
import * as resolver from 'dawnline.resolver';
import { _, L_ } from 'dawnline.i18n';

export const NS = 'dawnline';
const TX_ROOT = net.INTERNAL.transit, TX_NS = 'dlx1', LAN_ROOT = net.INTERNAL.lan, LAN_NS = 'dll1';
const PREF_LOOP_DNS = 5205, PREF_MAIN = 5210, PREF_LOOP = 5290;
export const RESOLVER_CONF = resolver.CONF;
const STATE = `${RUN_DIR}/loop.json`;
const NS_RULES = '/var/etc/dawnline-ns.nft';

const WHO = L_('Internet like a home device');

function log(msg, level, detail) {
	slog('dawnline', level ?? 'info', msg, detail, WHO);
}

function run(cmds) {
	let errs = [];
	for (let c in cmds) {
		let r = sh(c);
		if (r.code != 0)
			push(errs, `${c}: ${trim(r.out)}`);
	}
	return errs;
}

function exists(dev) {
	return stat(`/sys/class/net/${dev}`) != null;
}

/* ---------- facts about the LAN ---------- */

/** DHCP pool, static leases and the DNS handed to LAN clients, for one netifd interface. */
function dhcp_facts(logical, lan) {
	let c = cursor();
	c.load('dhcp');
	let pool = null, dns = null, statics = [];
	c.foreach('dhcp', 'dhcp', (s) => {
		if (s.interface != logical || s.ignore == '1')
			return;
		let start = +(s.start ?? 100), limit = +(s.limit ?? 150);
		pool = [ lan.net + start, lan.net + start + limit - 1 ];
		let opts = type(s.dhcp_option) == 'array' ? s.dhcp_option : (s.dhcp_option ? [ s.dhcp_option ] : []);
		for (let o in opts) {
			let m = match(o, /^(option:dns-server|6),([0-9.]+)/);
			if (m && !dns)
				dns = m[2];
		}
	});
	c.foreach('dhcp', 'host', (s) => {
		let ip = ip2int(s.ip ?? '');
		if (ip != null)
			push(statics, ip);
	});
	return { pool, dns, statics };
}

/** Addresses other devices are using right now (neighbour table + leases). */
function used_addresses(dev) {
	let used = {};
	try {
		for (let n in json(sh_out(`ip -j -4 neigh show dev ${q(dev)}`) || '[]') ?? [])
			if (n.dst && !(index(n.state ?? [], 'FAILED') >= 0 || index(n.state ?? [], 'INCOMPLETE') >= 0))
				used[n.dst] = n.lladdr ?? true;
	}
	catch (e) {}
	for (let l in split(readfile('/tmp/dhcp.leases') ?? '', '\n')) {
		let f = split(l, ' ');
		if (length(f) >= 3)
			used[f[2]] = f[1];
	}
	return used;
}

/** The MAC the netns's LAN link has now; null without the link. */
function our_mac() {
	return sh_out(`ip -n ${NS} -j link show ${LAN_NS} 2>/dev/null | jsonfilter -e '@[0].address'`);
}

/** 32-bit FNV-1a of a string, continuing from `h`. */
function fnv1a(s, h) {
	for (let i = 0; i < length(s); i++)
		h = ((h ^ ord(s, i)) * 16777619) & 0xffffffff;
	return h;
}

/**
 * The MAC for the netns's LAN link, from the bridge's MAC: a locally
 * administered unicast address hashed from it, so it is the same every time
 * and differs between routers. Not the bridge's MAC with a bit flipped: radios
 * and ports often get those.
 */
export function lan_mac(bridge) {
	let s = lc(trim(bridge ?? ''));
	let h1 = fnv1a(`dawnline lan ${s}`, 0x811c9dc5), h2 = fnv1a(s, h1);
	let b = [ ((h1 >> 24) & 0xfc) | 0x02, (h1 >> 16) & 0xff, (h1 >> 8) & 0xff, h1 & 0xff, (h2 >> 24) & 0xff, (h2 >> 16) & 0xff ];
	return join(':', map(b, (x) => sprintf('%02x', x)));
};

/**
 * True when the netns may use a LAN address (a number): a host of the
 * network, not the router's, not a static lease, outside the DHCP pool and
 * not held by another device in `used` (address → MAC, or true without one).
 * An entry with one of the MACs in `mine` is the netns itself, also from
 * before it was created again.
 */
export function address_free(ip, lan, facts, used, mine) {
	if (ip <= lan.net || ip >= lan.net + lan.size - 1 || ip == lan.ip || index(facts.statics, ip) >= 0)
		return false;
	if (facts.pool && ip >= facts.pool[0] && ip <= facts.pool[1])
		return false;
	let u = used[int2ip(ip)];
	return u == null || index(mine, u) >= 0;
};

/**
 * A LAN address for the netns: keep the saved one while it is free (see
 * address_free; `mine` are the netns's MACs), otherwise the highest free host
 * above the DHCP pool (then below it) that does not answer.
 */
function pick_address(lan, facts, saved, dev, mine) {
	let used = used_addresses(dev);
	let sv = ip2int(saved ?? '');
	if (sv != null && address_free(sv, lan, facts, used, mine))
		return int2ip(sv);
	for (let ip = lan.net + lan.size - 2; ip > lan.net; ip--) {
		if (!address_free(ip, lan, facts, used, mine))
			continue;
		// Last check: nobody answers on it.
		sh(`ping -c 1 -W 1 -I ${q(dev)} ${int2ip(ip)}`);
		if (address_free(ip, lan, facts, used_addresses(dev), mine))
			return int2ip(ip);
	}
	return null;
}

/** A /30 in 169.254.0.0/16 that no route or address on the router overlaps. */
function pick_transit(saved) {
	let busy = [];
	for (let dev, d in net.snapshot().devices)
		for (let n in [ ...d.nets, ...d.addrs ])
			push(busy, n);
	let free = (base) => {
		for (let b in busy) {
			let c = cidr_any(b);
			if (c && base < c.net + c.size && c.net < base + 4)
				return false;
		}
		return true;
	};
	let sv = ip2int(saved ?? '');
	if (sv != null && free(sv))
		return sv;
	for (let k = 77; k < 77 + 256; k++) {
		let base = ip2int(`169.254.${k % 256}.0`);
		if (free(base))
			return base;
	}
	return null;
}

/** A routing table nobody else uses (ours holds a single route via the transit link). */
function pick_table(saved) {
	let free = (t) => {
		let r = sh_out(`ip -4 route show table ${t}`) ?? '';
		return r == '' || (length(split(r, '\n')) == 1 && index(r, ` dev ${TX_ROOT}`) >= 0);
	};
	if (saved && free(saved))
		return saved;
	for (let t = 2077; t < 2177; t++)
		if (free(t))
			return t;
	return null;
}

/* ---------- why it is off ---------- */

/*
 * The reasons plan() and ensure() give, kept in loop.json:
 *   { code: 'no_lan' }                 no LAN detected
 *   { code: 'not_bridge', dev }        the LAN is not a bridge
 *   { code: 'no_ipv4', dev }           the LAN has no IPv4 address
 *   { code: 'no_address', net }        no free address on the LAN's network
 *   { code: 'no_transit' }             no free link-local range for the internal link
 *   { code: 'no_table' }               no free routing table
 *   { code: 'setup', detail }          a command failed (detail: it and what it said)
 */

/** A reason from plan() for the service log: English, like every log line. */
function error_note(e) {
	if (e.code == 'no_lan')
		return L_('No LAN detected.');
	if (e.code == 'not_bridge')
		return sprintf(L_('%s is not a bridge, so Dawnline cannot join the LAN as a device.'), e.dev);
	if (e.code == 'no_ipv4')
		return sprintf(L_('%s has no IPv4 address.'), e.dev);
	if (e.code == 'no_address')
		return sprintf(L_('No free address on %s.'), e.net);
	if (e.code == 'no_transit')
		return L_('No free link-local range for the internal link.');
	return L_('No free routing table.');
}

/**
 * Why "like a home device" is off (a reason above), as a sentence in the
 * reader's language. Null for none; the English of a loop.json written by an
 * older version as it is.
 */
export function error_text(e) {
	if (type(e) != 'object')
		return e ?? null;
	if (e.code == 'no_lan')
		return _('No LAN detected.');
	if (e.code == 'not_bridge')
		return sprintf(_('%s is not a bridge, so Dawnline cannot join the LAN as a device.'), e.dev);
	if (e.code == 'no_ipv4')
		return sprintf(_('%s has no IPv4 address.'), e.dev);
	if (e.code == 'no_address')
		return sprintf(_('No free address on %s.'), e.net);
	if (e.code == 'no_transit')
		return _('No free link-local range for the internal link.');
	if (e.code == 'no_table')
		return _('No free routing table.');
	return sprintf(_('Setup failed: %s'), e.detail);
};

/* ---------- plan ---------- */

function settings() {
	let c = cursor();
	c.load('dawnline');
	return c.get_all('dawnline', 'settings') ?? {};
}

/** Servers that want "like a home device" (default on) and run a core. */
function wanted(m) {
	return filter(values(m.servers), (s) => length(core.tunnels(s)) && s.enabled && s.lan_like);
}

/** Every server's interface, for rules. */
function all_ifnames(m) {
	return map(values(m.servers), (s) => s.ifname);
}

/**
 * What should exist, or { error } (a reason, see error_text) when it cannot.
 * Pure apart from reading router state (and one ping per candidate address).
 */
export function plan(m) {
	let srvs = wanted(m);
	if (!length(srvs))
		return { off: true };
	let snap = net.snapshot();
	let dev = snap.lan;
	let d = snap.devices[dev];
	if (!dev || !d)
		return { error: { code: 'no_lan' } };
	if (d.kind != 'bridge')
		return { error: { code: 'not_bridge', dev } };
	let lan = parse_cidr(d.addrs[0]);
	if (!lan)
		return { error: { code: 'no_ipv4', dev } };
	let facts = dhcp_facts(d.logical, lan);
	let st = settings();
	let mac = lan_mac(readfile(`/sys/class/net/${dev}/address`));
	// The netns's MACs: the one it gets, and the one it has (a random one from an older version).
	let addr = pick_address(lan, facts, st.lan_address, dev, [ mac, our_mac() ]);
	if (!addr)
		return { error: { code: 'no_address', net: `${int2ip(lan.net)}/${lan.prefix}` } };
	let last = read_json(STATE, {});
	let tx = pick_transit(last?.transit);
	if (tx == null)
		return { error: { code: 'no_transit' } };
	let table = pick_table(last?.plan?.table);
	if (table == null)
		return { error: { code: 'no_table' } };
	let servers = [];
	for (let srv in srvs) {
		let sn = net.server_net(srv, snap);
		for (let t in core.tunnels(srv))
			push(servers, { ifname: t.ifname, subnet: t.subnet, direct: net.collapse([ t.subnet, ...sn.nets ]) });
	}
	return {
		dev,
		gateway: int2ip(lan.ip),
		address: addr,
		mac,
		prefix: lan.prefix,
		dns: facts.dns ?? int2ip(lan.ip),
		transit: tx,
		tx_root: int2ip(tx + 1),
		tx_ns: int2ip(tx + 2),
		table,
		servers,
	};
};

/* ---------- apply ---------- */

/**
 * The netns's nft script as text (nothing is loaded). With `fast`, a
 * flowtable on the netns's own two links takes established TCP and UDP flows
 * past conntrack and the forward hook here. Only dlx1 and dll1: the root
 * namespace's links (dawn0, dlx0) stay out, the guard there sees every packet.
 */
export function ns_rules(p, fast) {
	return `table inet dawnline
delete table inet dawnline
table inet dawnline {${fast ? `
	flowtable ft {
		hook ingress priority 0;
		devices = { "${TX_NS}", "${LAN_NS}" };
	}` : ''}
	chain nat_pre {
		type nat hook prerouting priority dstnat; policy accept;
		iifname "${TX_NS}" ip daddr ${p.address} meta l4proto { tcp, udp } th dport 53 dnat ip to ${p.dns}:53
	}
	chain nat_post {
		type nat hook postrouting priority srcnat; policy accept;
		oifname "${LAN_NS}" masquerade
	}
	chain filter_forward {
		type filter hook forward priority filter; policy drop;${fast ? `
		ct state established meta l4proto { tcp, udp } flow add @ft` : ''}
		ct state established,related accept
		iifname "${TX_NS}" oifname "${LAN_NS}" accept
	}
	chain filter_input {
		type filter hook input priority filter; policy drop;
		ct state established,related accept
		iifname "lo" accept
		icmp type echo-request accept
		iifname "${TX_NS}" meta l4proto { tcp, udp } th dport 53 accept
	}
}
`;
};

/**
 * Load the netns's rules, with the flowtable when the kernel takes it, else
 * without (the loop works either way). { fast, slow, err }: slow is why the
 * flowtable failed, err why the rules without it failed too.
 */
function load_ns_rules(p) {
	ensure_dir('/var/etc');
	let load = (fast) => {
		writefile(NS_RULES, ns_rules(p, fast));
		return run([ `ip netns exec ${NS} nft -f ${NS_RULES}` ])[0];
	};
	let slow = load(true);
	return slow ? { fast: false, slow, err: load(false) } : { fast: true };
}

/** Our policy rules: in our priority band and bound to a Dawnline tunnel interface. */
function current_rules(ifnames) {
	let out = [];
	try {
		// Ours, plus ours left behind by a removed tunnel (its interface is gone).
		for (let r in json(sh_out('ip -j -4 rule show') || '[]') ?? [])
			if (r.priority >= 5200 && r.priority < 5300 && r.iif && (index(ifnames, r.iif) >= 0 || 'iif_detached' in r))
				push(out, r);
	}
	catch (e) {}
	return out;
}


function rule_key(pref, iif, to, table) {
	// `ip -j rule` shows a /32 destination without its length.
	if (to && index(to, '/') < 0)
		to += '/32';
	return `${pref} ${iif} ${to ?? 'all'} ${table}`;
}

function sync_rules(p, ifnames) {
	let want = [];
	for (let s in p?.servers ?? []) {
		push(want, [ PREF_LOOP_DNS, s.ifname, `${p.address}/32`, `${p.table}` ]);
		for (let n in s.direct)
			push(want, [ PREF_MAIN, s.ifname, n, 'main' ]);
		push(want, [ PREF_LOOP, s.ifname, null, `${p.table}` ]);
	}
	let have = map(current_rules(ifnames), (r) => rule_key(r.priority, r.iif, r.dst ? `${r.dst}${r.dstlen != null ? '/' + r.dstlen : ''}` : null, r.table));
	let wantk = map(want, (w) => rule_key(w[0], w[1], w[2] ?? null, w[3]));
	if (join('\n', sort(have)) == join('\n', sort(wantk)))
		return [];
	let cmds = [];
	for (let r in current_rules(ifnames))
		push(cmds, `ip -4 rule del priority ${r.priority} iif ${q(r.iif)}${r.dst ? ' to ' + r.dst + (r.dstlen != null ? '/' + r.dstlen : '') : ''} lookup ${r.table}`);
	for (let w in want)
		push(cmds, `ip -4 rule add priority ${w[0]} iif ${q(w[1])}${w[2] ? ' to ' + w[2] : ''} lookup ${w[3]}`);
	return cmds;
}

function tunnel_ifnames() {
	let c = cursor();
	c.load('dawnline');
	let out = [];
	c.foreach('dawnline', 'server', (s) => {
		push(out, s.ifname ?? s['.name']);
	});
	return out;
}

/** Remove the netns, links and rules, and the router's neighbour entry for the netns. */
export function remove(ifnames) {
	ifnames ??= tunnel_ifnames();
	let last = read_json(STATE, {})?.plan;
	// Read while the link is there: the entry is ours when it carries the netns's MAC.
	let held = last?.dev ? used_addresses(last.dev)[last.address] : null;
	let stale = type(held) == 'string' && index([ last.mac, our_mac() ], held) >= 0;
	let cmds = [];
	for (let r in current_rules(ifnames))
		push(cmds, `ip -4 rule del priority ${r.priority} iif ${q(r.iif)}${r.dst ? ' to ' + r.dst + (r.dstlen != null ? '/' + r.dstlen : '') : ''} lookup ${r.table}`);
	if (last?.table)
		push(cmds, `ip -4 route flush table ${last.table}`);
	if (exists(TX_ROOT))
		push(cmds, `ip link del ${TX_ROOT}`);
	if (exists(LAN_ROOT))
		push(cmds, `ip link del ${LAN_ROOT}`);
	if (stat(`/var/run/netns/${NS}`))
		push(cmds, `ip netns del ${NS}`);
	// Left there, it would hold the address for a MAC nobody has.
	if (stale)
		push(cmds, `ip -4 neigh del ${q(last.address)} dev ${q(last.dev)}`);
	run(cmds);
	unlink(STATE);
};

/**
 * Bring the loop to the plan. Cheap when nothing changed: compares with the
 * last applied plan and only checks that links, bridge port and rules exist.
 */
export function ensure(m, force) {
	let ifnames = all_ifnames(m);
	let p = plan(m);
	if (p.off || p.error) {
		// Read before remove(), which deletes it: the error is logged once, not every tick.
		let was = read_json(STATE, {});
		if (was.plan || exists(TX_ROOT) || exists(LAN_ROOT) || length(current_rules(ifnames)))
			remove(ifnames);
		ensure_dir(RUN_DIR);
		write_json(STATE, { error: p.error, off: !!p.off }, 0o644);
		if (p.error && sprintf('%J', p.error) != sprintf('%J', was.error))
			log(L_('is off'), 'error', error_note(p.error));
		return p;
	}
	let last = read_json(STATE, {});
	let same = !force && last.applied && sprintf('%J', last.plan) == sprintf('%J', p);
	let healthy = exists(TX_ROOT) && exists(LAN_ROOT) && stat(`/var/run/netns/${NS}`) &&
		replace(readlink(`/sys/class/net/${LAN_ROOT}/master`) ?? '', /^.*\//, '') == p.dev;
	let rules = sync_rules(p, ifnames);
	if (same && healthy && !length(rules))
		return p;

	// A link made by an older version has a random MAC (its plan had none, so
	// this runs once after an update): it gets the stable one.
	let remac = exists(LAN_ROOT) && our_mac() != p.mac;
	let cmds = [];
	if (!stat(`/var/run/netns/${NS}`))
		push(cmds, `ip netns add ${NS}`);
	if (!exists(TX_ROOT))
		push(cmds, `ip link add ${TX_ROOT} type veth peer name ${TX_NS} netns ${NS}`);
	if (!exists(LAN_ROOT))
		push(cmds, `ip link add ${LAN_ROOT} type veth peer name ${LAN_NS} address ${p.mac} netns ${NS}`);
	if (remac)
		push(cmds, `ip -n ${NS} link set ${LAN_NS} down`, `ip -n ${NS} link set ${LAN_NS} address ${p.mac}`);
	let errs = run(cmds);
	cmds = [
		`ip addr flush dev ${TX_ROOT}`,
		`ip addr add ${p.tx_root}/30 dev ${TX_ROOT}`,
		`ip link set ${TX_ROOT} up`,
		`ip link set ${LAN_ROOT} master ${q(p.dev)}`,
		`ip link set ${LAN_ROOT} up`,
		`ip -n ${NS} link set lo up`,
		`ip -n ${NS} addr flush dev ${TX_NS}`,
		`ip -n ${NS} addr add ${p.tx_ns}/30 dev ${TX_NS}`,
		`ip -n ${NS} link set ${TX_NS} up`,
		`ip -n ${NS} addr flush dev ${LAN_NS}`,
		`ip -n ${NS} addr add ${p.address}/${p.prefix} dev ${LAN_NS}`,
		`ip -n ${NS} link set ${LAN_NS} up`,
		`ip -n ${NS} route replace default via ${p.gateway} dev ${LAN_NS}`,
		// The resolver's own queries (from the transit address) go back out the transit link.
		`ip -n ${NS} route replace default via ${p.tx_root} dev ${TX_NS} table 100`,
		`ip -n ${NS} rule del from ${p.tx_ns} lookup 100 2>/dev/null; ip -n ${NS} rule add from ${p.tx_ns} lookup 100`,
		`ip netns exec ${NS} sh -c 'echo 1 > /proc/sys/net/ipv4/ip_forward; echo 0 > /proc/sys/net/ipv4/conf/all/rp_filter; echo 0 > /proc/sys/net/ipv4/conf/default/rp_filter'`,
		`ip -4 route replace default via ${p.tx_ns} dev ${TX_ROOT} table ${p.table}`,
	];
	for (let s in p.servers)
		push(cmds, `ip -n ${NS} route replace ${q(s.subnet)} via ${q(p.tx_root)} dev ${TX_NS}`);
	// The router knows the address by the old MAC: ask again now, not when the entry expires.
	if (remac)
		push(cmds, `ip -4 neigh flush to ${p.address} dev ${q(p.dev)}`);
	push(errs, ...run(cmds));
	let ft = load_ns_rules(p);
	if (ft.err)
		push(errs, ft.err);
	push(errs, ...run(sync_rules(p, ifnames)));

	if (length(errs)) {
		let why = { code: 'setup', detail: errs[0] };
		if (sprintf('%J', read_json(STATE, {}).error) != sprintf('%J', why))
			log(L_('failed - internet goes out directly for now'), 'error', errs[0]);
		remove(ifnames);
		write_json(STATE, { error: why }, 0o644);
		return { error: why };
	}
	ensure_dir(RUN_DIR);
	write_json(STATE, { applied: time(), plan: p, transit: p.transit, fast: ft.fast }, 0o644);
	if (!last.applied || last.plan?.dev != p.dev || last.plan?.address != p.address)
		log(sprintf(L_('is on · traffic enters %s as %s'), p.dev, p.address), 'up');
	else if (!healthy)
		log(sprintf(L_('was broken - set up again (%s as %s)'), p.dev, p.address), 'repair');
	// Once, not again on every apply while the module is still missing.
	if (!ft.fast && last.fast !== false)
		log(L_('runs without its fast path'), 'info', join('\n', [
			L_('Without kmod-nft-offload every packet on this path passes the firewall twice. Install it and restart Dawnline.'),
			ft.slow,
		]));
	return p;
};

/**
 * Keep the chosen LAN address stable across restarts (settings.lan_address).
 * Called by dawnline.apply once its own lock is released: the config lock is
 * never taken inside it.
 */
export function remember(p) {
	if (!p?.address || settings().lan_address == p.address)
		return;
	store.transact((c, m) => {
		c.set('dawnline', 'settings', 'settings');
		c.set('dawnline', 'settings', 'lan_address', p.address);
	});
};

/** Last applied state for views and health checks; `error` says why it is off (error_text). */
export function status() {
	let s = read_json(STATE, {});
	if (s.plan)
		return {
			active: exists(TX_ROOT) && exists(LAN_ROOT),
			dev: s.plan.dev, address: s.plan.address, dns: s.plan.dns, gateway: s.plan.gateway, transit: s.plan.tx_ns,
			bridged: replace(readlink(`/sys/class/net/${LAN_ROOT}/master`) ?? '', /^.*\//, '') == s.plan.dev,
		};
	return { active: false, off: !!s.off, error: error_text(s.error) };
};

/** The DNS address tunnel clients should use while the loop is up. */
export function client_dns() {
	let s = status();
	return s.active ? s.address : null;
};

/* ---------- plain resolver for Home-only clients ---------- */

/** The DNS your LAN gets from DHCP (option 6), else the router on the LAN. */
export function lan_dns() {
	let st = status();
	if (st.dns)
		return st.dns;
	let snap = net.snapshot();
	let d = snap.devices[snap.lan];
	let a = d?.addrs?.[0];
	if (!a)
		return null;
	let lan = parse_cidr(a);
	return (lan ? dhcp_facts(d.logical, lan).dns : null) ?? split(a, '/')[0];
};

/**
 * Where Home-only clients' DNS goes: inside the netns while it is up
 * (`ns`: transit address, port 53), otherwise on the tunnel address (`root`).
 */
export function resolver_target() {
	let st = status();
	return st.active && st.transit ? { mode: 'ns', address: st.transit, port: 53 } : { mode: 'root', port: resolver.PORT };
};

/** Write the resolver config where it should run now; true when it changed (see dawnline.resolver). */
export function sync_resolver(m) {
	return resolver.sync(m, resolver_target(), lan_dns());
};

/** True when the resolver process is alive. */
export function resolver_running() {
	return resolver.running();
};

export const RESOLVER = { port: resolver.PORT, conf: resolver.CONF };
