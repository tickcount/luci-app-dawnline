// Dawnline — "like a home device": tunnel clients' internet traffic enters
// the router from the LAN, so whatever handles LAN traffic there (proxies,
// DPI bypass, DNS filters, fw4's lan zone, ...) handles it too, without
// Dawnline knowing about any of them.
//
//   dawn0 ──policy route──▶ dlx0 ═veth═ dlx1 ┐ netns "dawnline" ┌ dll1 ═veth═ dll0 ── br-lan
//                                              └── NAT to a LAN address ┘
//
// The netns is one more device on the LAN bridge with its own address (picked
// from the LAN subnet above the DHCP pool). Replies come back the same way.
// Home-network destinations keep their direct route; per-person access is
// still enforced on dawn0 before any of this (table inet dawnline).
//
// Clients also use the netns address as DNS: it forwards to the DNS the LAN
// gets from DHCP, from the LAN side, so DNS interception applies as well.
//
// Separately, people with Home-only access get a plain resolver (real
// addresses from the WAN's DNS, home names from the LAN DNS): their internet
// does not use the tunnel, so fake-IP answers would break it. While the netns
// exists the resolver runs inside it and sends its upstream queries back out
// through the transit link as forwarded traffic — not as the router's own
// traffic and not from the LAN — so tools that capture either leave it alone.
//
// Everything is derived from the router at run time; nothing assumes a
// particular subnet or tool. If the LAN is not a bridge or setup fails, the
// direct path stays and status() says why.

import { readfile, writefile, readlink, stat, unlink } from 'fs';
import { cursor } from 'uci';
import { sh, sh_out, q, ip2int, int2ip, ensure_dir, read_json, write_json, uniq, slog, RUN_DIR } from 'dawnline.util';
import * as net from 'dawnline.net';

export const NS = 'dawnline';
const TX_ROOT = net.INTERNAL.transit, TX_NS = 'dlx1', LAN_ROOT = net.INTERNAL.lan, LAN_NS = 'dll1';
const PREF_LOOP_DNS = 5205, PREF_MAIN = 5210, PREF_LOOP = 5290;
const RESOLVER_PORT = 5354;
export const RESOLVER_CONF = '/var/etc/dawnline-dns.conf';
const RESOLVER_RESOLV = '/var/etc/dawnline-dns.resolv';
const RESOLVER_PID = '/var/run/dawnline-dns.pid';
const STATE = `${RUN_DIR}/loop.json`;
const FALLBACK_DNS = [ '1.1.1.1', '8.8.8.8' ];

const WHO = 'Internet like a home device';

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

function cidr_of(a) {
	let m = match(a ?? '', /^([0-9.]+)\/([0-9]+)$/);
	if (!m)
		return null;
	let ip = ip2int(m[1]), prefix = +m[2];
	if (ip == null || prefix < 8 || prefix > 30)
		return null;
	let size = 1 << (32 - prefix);
	return { ip, prefix, size, net: ip - ip % size };
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

function our_mac() {
	return sh_out(`ip -n ${NS} -j link show ${LAN_NS} 2>/dev/null | jsonfilter -e '@[0].address'`);
}

/**
 * A LAN address for the netns: keep the saved one while it is valid and not
 * taken by someone else, otherwise the highest free host above the DHCP pool
 * (then below it), skipping static leases and anything that answers.
 */
function pick_address(lan, facts, saved, dev) {
	let used = used_addresses(dev);
	let mine = our_mac();
	let taken = (ip) => {
		let s = int2ip(ip);
		if (ip == lan.ip || index(facts.statics, ip) >= 0)
			return true;
		if (facts.pool && ip >= facts.pool[0] && ip <= facts.pool[1])
			return true;
		let u = used[s];
		return u != null && !(mine && u == mine);
	};
	let sv = ip2int(saved ?? '');
	if (sv != null && sv > lan.net && sv < lan.net + lan.size - 1 && !taken(sv))
		return int2ip(sv);
	for (let ip = lan.net + lan.size - 2; ip > lan.net; ip--) {
		if (taken(ip))
			continue;
		// Last check: nobody answers on it.
		sh(`ping -c 1 -W 1 -I ${q(dev)} ${int2ip(ip)}`);
		let again = used_addresses(dev)[int2ip(ip)];
		if (again != null && !(mine && again == mine))
			continue;
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
			let c = match(b, /^([0-9.]+)(\/([0-9]+))?$/);
			if (!c)
				continue;
			let ip = ip2int(c[1]), size = 1 << (32 - (c[3] != null ? +c[3] : 32));
			let bn = ip - ip % size;
			if (base < bn + size && bn < base + 4)
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

/* ---------- plan ---------- */

function settings() {
	let c = cursor();
	c.load('dawnline');
	return c.get_all('dawnline', 'settings') ?? {};
}

/** Servers that want "like a home device" (default on). */
function wanted(m) {
	return filter(values(m.servers), (s) => s.private_key && s.enabled && s.lan_like);
}

/**
 * What should exist, or { error } when it cannot. Pure apart from reading
 * router state (and one ping per candidate address).
 */
export function plan(m) {
	let srvs = wanted(m);
	if (!length(srvs))
		return { off: true };
	let snap = net.snapshot();
	let dev = snap.lan;
	let d = snap.devices[dev];
	if (!dev || !d)
		return { error: 'No LAN detected.' };
	if (d.kind != 'bridge')
		return { error: `${dev} is not a bridge, so Dawnline cannot join the LAN as a device.` };
	let lan = cidr_of(d.addrs[0]);
	if (!lan)
		return { error: `${dev} has no IPv4 address.` };
	let facts = dhcp_facts(d.logical, lan);
	let st = settings();
	let addr = pick_address(lan, facts, st.lan_address, dev);
	if (!addr)
		return { error: `No free address on ${int2ip(lan.net)}/${lan.prefix}.` };
	let last = read_json(STATE, {});
	let tx = pick_transit(last?.transit);
	if (tx == null)
		return { error: 'No free link-local range for the internal link.' };
	let table = pick_table(last?.plan?.table);
	if (table == null)
		return { error: 'No free routing table.' };
	let servers = [];
	for (let srv in srvs) {
		let sn = net.server_net(srv, snap);
		push(servers, { ifname: srv.ifname, subnet: srv.subnet, direct: net.collapse([ srv.subnet, ...sn.nets ]) });
	}
	return {
		dev,
		gateway: int2ip(lan.ip),
		address: addr,
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

function ns_rules(p) {
	return `table inet dawnline
delete table inet dawnline
table inet dawnline {
	chain nat_pre {
		type nat hook prerouting priority dstnat; policy accept;
		iifname "${TX_NS}" ip daddr ${p.address} meta l4proto { tcp, udp } th dport 53 dnat ip to ${p.dns}:53
	}
	chain nat_post {
		type nat hook postrouting priority srcnat; policy accept;
		oifname "${LAN_NS}" masquerade
	}
	chain filter_forward {
		type filter hook forward priority filter; policy drop;
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
	c.foreach('dawnline', 'server', (s) => push(out, s.ifname ?? s['.name']));
	return out;
}

/** Remove the netns, links and rules. */
export function remove(ifnames) {
	ifnames ??= tunnel_ifnames();
	let cmds = [];
	for (let r in current_rules(ifnames))
		push(cmds, `ip -4 rule del priority ${r.priority} iif ${q(r.iif)}${r.dst ? ' to ' + r.dst + (r.dstlen != null ? '/' + r.dstlen : '') : ''} lookup ${r.table}`);
	let t = read_json(STATE, {})?.plan?.table;
	if (t)
		push(cmds, `ip -4 route flush table ${t}`);
	if (exists(TX_ROOT))
		push(cmds, `ip link del ${TX_ROOT}`);
	if (exists(LAN_ROOT))
		push(cmds, `ip link del ${LAN_ROOT}`);
	if (stat(`/var/run/netns/${NS}`))
		push(cmds, `ip netns del ${NS}`);
	run(cmds);
	unlink(STATE);
};

/**
 * Bring the loop to the plan. Cheap when nothing changed: compares with the
 * last applied plan and only checks that links, bridge port and rules exist.
 */
export function ensure(m, force) {
	let ifnames = map(values(m.servers), (s) => s.ifname);
	let p = plan(m);
	if (p.off || p.error) {
		if (stat(STATE) || exists(TX_ROOT) || exists(LAN_ROOT) || length(current_rules(ifnames)))
			remove(ifnames);
		ensure_dir(RUN_DIR);
		let was = read_json(STATE, {});
		write_json(STATE, { error: p.error, off: !!p.off }, 0o644);
		if (p.error && p.error != was.error)
			log('is off', 'error', p.error);
		return p;
	}
	let last = read_json(STATE, {});
	let same = !force && last.applied && sprintf('%J', last.plan) == sprintf('%J', p);
	let healthy = exists(TX_ROOT) && exists(LAN_ROOT) && stat(`/var/run/netns/${NS}`) &&
		replace(readlink(`/sys/class/net/${LAN_ROOT}/master`) ?? '', /^.*\//, '') == p.dev;
	let rules = sync_rules(p, ifnames);
	if (same && healthy && !length(rules))
		return p;

	let cmds = [];
	if (!stat(`/var/run/netns/${NS}`))
		push(cmds, `ip netns add ${NS}`);
	if (!exists(TX_ROOT))
		push(cmds, `ip link add ${TX_ROOT} type veth peer name ${TX_NS} netns ${NS}`);
	if (!exists(LAN_ROOT))
		push(cmds, `ip link add ${LAN_ROOT} type veth peer name ${LAN_NS} netns ${NS}`);
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
	ensure_dir('/var/etc');
	writefile('/var/etc/dawnline-ns.nft', ns_rules(p));
	push(cmds, `ip netns exec ${NS} nft -f /var/etc/dawnline-ns.nft`);
	push(errs, ...run(cmds));
	push(errs, ...run(sync_rules(p, ifnames)));

	if (length(errs)) {
		if (read_json(STATE, {}).error != `Setup failed: ${errs[0]}`)
			log('failed — internet goes out directly for now', 'error', errs[0]);
		remove(ifnames);
		write_json(STATE, { error: `Setup failed: ${errs[0]}` }, 0o644);
		return { error: errs[0] };
	}
	// Keep the chosen LAN address stable across restarts.
	let c = cursor();
	c.load('dawnline');
	if (c.get('dawnline', 'settings', 'lan_address') != p.address) {
		c.set('dawnline', 'settings', 'settings');
		c.set('dawnline', 'settings', 'lan_address', p.address);
		c.commit('dawnline');
		system('chmod 600 /etc/config/dawnline');
	}
	ensure_dir(RUN_DIR);
	write_json(STATE, { applied: time(), plan: p, transit: p.transit }, 0o644);
	if (!last.applied || last.plan?.dev != p.dev || last.plan?.address != p.address)
		log(`is on · traffic enters ${p.dev} as ${p.address}`, 'up');
	else if (!healthy)
		log(`was broken — set up again (${p.dev} as ${p.address})`, 'repair');
	return p;
};

/** Last applied state for views and health checks. */
export function status() {
	let s = read_json(STATE, {});
	if (s.plan)
		return {
			active: exists(TX_ROOT) && exists(LAN_ROOT),
			dev: s.plan.dev, address: s.plan.address, dns: s.plan.dns, gateway: s.plan.gateway, transit: s.plan.tx_ns,
			bridged: replace(readlink(`/sys/class/net/${LAN_ROOT}/master`) ?? '', /^.*\//, '') == s.plan.dev,
		};
	return { active: false, off: !!s.off, error: s.error };
};

/** The DNS address tunnel clients should use while the loop is up. */
export function client_dns() {
	let s = status();
	return s.active ? s.address : null;
};

/* ---------- plain resolver for Home-only clients ---------- */

function wan_dns() {
	let out = [];
	let snap = net.snapshot();
	let wan = snap.devices[snap.wan]?.logical;
	for (let name in uniq([ wan, 'wan', 'wan6' ])) {
		if (!name)
			continue;
		try {
			let st = json(sh_out(`ubus call network.interface.${name} status 2>/dev/null`) || 'null');
			for (let a in st?.['dns-server'] ?? [])
				if (match(a, /^[0-9.]+$/))
					push(out, a);
		}
		catch (e) {}
	}
	return length(out) ? uniq(out) : FALLBACK_DNS;
}

/** Local domain of the LAN DNS (dnsmasq `domain`, else the Dawnline hostname domain). */
function lan_domain(m) {
	let c = cursor();
	c.load('dhcp');
	let d = null;
	c.foreach('dhcp', 'dnsmasq', (s) => { d ??= s.domain; });
	return uniq(filter([ d, m.settings.domain ], (x) => x));
}

/** The DNS your LAN gets from DHCP (option 6), else the router on the LAN. */
export function lan_dns() {
	let st = status();
	if (st.dns)
		return st.dns;
	let snap = net.snapshot();
	let d = snap.devices[snap.lan];
	let a = d?.addrs?.[0];
	return a ? (dhcp_facts(d.logical, cidr_of(a))?.dns ?? split(a, '/')[0]) : null;
};

/**
 * Where Home-only clients' DNS goes: inside the netns while it is up
 * (`ns`: transit address, port 53), otherwise on the tunnel address (`root`).
 */
export function resolver_target() {
	let st = status();
	return st.active && st.transit ? { mode: 'ns', address: st.transit, port: 53 } : { mode: 'root', port: RESOLVER_PORT };
};

/**
 * Write the resolver config; returns true when it changed (the running
 * instance is then restarted by procd's respawn after a kill). The first line
 * tells /usr/libexec/dawnline/resolver where to run it.
 */
export function sync_resolver(m) {
	ensure_dir('/var/etc');
	let ifs = map(filter(values(m.servers), (s) => s.private_key), (s) => s.ifname);
	let target = resolver_target();
	let lan = lan_dns();
	let lines = [
		`# mode=${target.mode}`,
		'# Generated by Dawnline: plain DNS for Home-only tunnel clients.',
		`port=${target.port}`,
		'no-hosts',
		'bogus-priv',
		'cache-size=1000',
		`pid-file=${RESOLVER_PID}`,
		'user=dnsmasq',
		'group=dnsmasq',
	];
	if (target.mode == 'ns') {
		push(lines, `listen-address=${target.address}`, 'bind-interfaces', 'no-resolv');
		// Upstream from the transit address: forwarded through the router to the WAN.
		for (let a in wan_dns())
			push(lines, `server=${a}@${target.address}`);
	}
	else {
		push(lines, 'bind-dynamic', ...map(ifs, (i) => `interface=${i}`), `resolv-file=${RESOLVER_RESOLV}`);
		let resolv = join('', map(wan_dns(), (a) => `nameserver ${a}\n`));
		if ((readfile(RESOLVER_RESOLV) ?? '') != resolv) {
			writefile(RESOLVER_RESOLV, resolv);
			system(`chmod 644 ${RESOLVER_RESOLV}`);
		}
	}
	if (lan)
		for (let d in lan_domain(m))
			push(lines, `server=/${d}/${lan}`);
	let conf = join('\n', lines) + '\n';
	if ((readfile(RESOLVER_CONF) ?? '') == conf)
		return false;
	writefile(RESOLVER_CONF, conf);
	system(`chmod 644 ${RESOLVER_CONF}`);
	let pid = trim(readfile(RESOLVER_PID) ?? '');
	if (match(pid, /^[0-9]+$/))
		system(`kill ${pid} 2>/dev/null`);
	return true;
};

/** True when the resolver process is alive. */
export function resolver_running() {
	let pid = trim(readfile(RESOLVER_PID) ?? '');
	return match(pid, /^[0-9]+$/) != null && stat(`/proc/${pid}`) != null;
};

export const RESOLVER = { port: RESOLVER_PORT, conf: RESOLVER_CONF };
