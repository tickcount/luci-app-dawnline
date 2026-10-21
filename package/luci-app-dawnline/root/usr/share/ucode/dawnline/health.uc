// Dawnline — Health: what the router has and lacks (packages, listeners,
// networks), the checks shown on Diagnostics → Health, and their fixes.
// The checks' texts are in the language of the call (dawnline.i18n).

import { readfile, stat, lsdir } from 'fs';
import { cursor } from 'uci';
import { _, N_ } from 'dawnline.i18n';
import { q, sh, sh_out, parse_cidr, cidr_overlaps, ip2int, in_cidr, file_exists, cloudflare_ip } from 'dawnline.util';
import * as core from 'dawnline.core';
import * as live from 'dawnline.live';
import * as apply from 'dawnline.apply';
import * as fw from 'dawnline.fw';
import * as loop from 'dawnline.loop';
import * as net from 'dawnline.net';
import * as awg from 'dawnline.awg';
import * as builds from 'dawnline.awg_builds';
import * as lookup from 'dawnline.lookup';
import * as pc from 'dawnline.portalcert';

/* ---------- what the router has ---------- */

/**
 * Packages a feature needs that are missing, by feature: https (the portal: openssl-util and any
 * TLS module for uhttpd), acme (Let's Encrypt certificates), home (the home-like link), awg
 * (AmneziaWG: the tools with netifd's protocol script, and the kernel module). Checked by
 * files, so it is cheap enough for every page load.
 */
export function needs() {
	let tls = false;
	for (let d in [ '/lib', '/usr/lib' ])
		for (let f in lsdir(d) ?? [])
			if (substr(f, 0, 16) == 'libustream-ssl.s')
				tls = true;
	let kver = trim(readfile('/proc/sys/kernel/osrelease') ?? '');
	let kmod = (name) => stat(`/sys/module/${name}`) != null || file_exists(`/lib/modules/${kver}/${name}.ko`);
	let miss = (list) => map(filter(list, (x) => !x[0]), (x) => x[1]);
	return {
		https: miss([ [ file_exists('/usr/bin/openssl'), 'openssl-util' ], [ tls, 'libustream-openssl' ] ]),
		acme: miss([ [ file_exists('/usr/lib/acme/client/acme.sh'), 'acme' ], [ file_exists('/usr/lib/acme/client/dnsapi/dns_cf.sh'), 'acme-acmesh-dnsapi' ],
			[ file_exists('/www/luci-static/resources/view/acme.js'), 'luci-app-acme' ] ]),
		home: miss([ [ file_exists('/usr/libexec/ip-full'), 'ip-full' ], [ kmod('veth'), 'kmod-veth' ] ]),
		// amneziawg-tools ships both the awg tool and netifd's protocol script.
		awg: miss([ [ file_exists('/usr/bin/awg') && file_exists('/lib/netifd/proto/amneziawg.sh'), 'amneziawg-tools' ],
			[ kmod('amneziawg'), 'kmod-amneziawg' ] ]),
	};
};

// "  12: 00000000:1194 00000000:0000 07 …": local address, then the remote one (none).
// A module constant, compiled once: a literal in the loop would be compiled
// again for every socket (0.12 ms each on the WR3000P, some 90 sockets a call).
const UDP_UNCONNECTED = /^ *[0-9]+: [0-9A-F]+:([0-9A-F]{4}) [0-9A-F]+:0000 /;

/** UDP ports an unconnected socket is bound to (IPv4 and IPv6): nothing else can listen there. */
export function udp_bound() {
	let out = {};
	for (let f in [ '/proc/net/udp', '/proc/net/udp6' ])
		for (let line in split(readfile(f) ?? '', '\n')) {
			let m = match(line, UDP_UNCONNECTED);
			if (m)
				out[hex(m[1])] = true;
		}
	return map(keys(out), (k) => +k);
};

// netstat's columns and the port of "0.0.0.0:53" / ":::53". Module constants,
// compiled once, not for each socket.
const BLANKS = /[ \t]+/, PORT_SUFFIX = /:([0-9]+)$/;

/**
 * Programs on 'tcp' or 'udp' ports, our portal left out: { port: "dnsmasq" }.
 * Kernel sockets (a tunnel's) have no name.
 */
function port_programs(proto) {
	let out = {};
	for (let line in split(sh_out(`netstat -ln${proto == 'tcp' ? 't' : 'u'}p 2>/dev/null`) ?? '', '\n')) {
		let f = split(trim(line), BLANKS);
		if (f[0] != proto && f[0] != `${proto}6`)
			continue;
		let m = match(f[3] ?? '', PORT_SUFFIX);
		let owner = split(f[length(f) - 1], '/');
		if (!m || !owner[1] || out[m[1]])
			continue;
		// Our own portal runs as a dedicated uhttpd instance.
		if (index(readfile(`/proc/${+owner[0]}/cmdline`) ?? '', '/usr/share/dawnline/portal') >= 0)
			continue;
		out[m[1]] = owner[1];
	}
	return out;
}

export function udp_port_programs() {
	return port_programs('udp');
};

export function tcp_port_programs() {
	return port_programs('tcp');
};

export function udp_listening(port) {
	return index(udp_bound(), +port) >= 0;
};

export function tcp_listening(port) {
	let hex = sprintf(':%04X ', port);
	for (let f in [ '/proc/net/tcp', '/proc/net/tcp6' ])
		for (let line in split(readfile(f) ?? '', '\n'))
			// state 0A = LISTEN
			if (index(line, hex) > 0 && match(line, / 0A /))
				return true;
	return false;
};

/** Processes other than our portal listening on a TCP port: [ "name" ]. */
export function tcp_port_owners(port) {
	let out = sh_out(`netstat -lntp 2>/dev/null | awk '$4 ~ /:${+port}$/ {print $7}'`) ?? '';
	let owners = [];
	for (let o in split(out, '\n')) {
		let name = split(o, '/')[1];
		if (!name || index(owners, name) >= 0)
			continue;
		// Our own portal runs as a dedicated uhttpd instance.
		let pid = +split(o, '/')[0];
		let cmd = readfile(`/proc/${pid}/cmdline`) ?? '';
		if (index(cmd, '/usr/share/dawnline/portal') >= 0)
			continue;
		push(owners, name);
	}
	return owners;
};

export function service_running(name, instance) {
	let s = sh_out(`ubus call service list '{"name":"${name}"}' 2>/dev/null`);
	if (!s)
		return false;
	try {
		return !!json(s)?.[name]?.instances?.[instance]?.running;
	}
	catch (e) {
		return false;
	}
};

/** IPv4 networks of netifd interfaces: [{ iface, cidr }], without the given server's tunnel. */
function other_subnets(srv_id) {
	let out = [];
	let st = sh_out('ubus call network.interface dump 2>/dev/null');
	let d = null;
	try {
		d = st ? json(st) : null;
	}
	catch (e) {
		d = null;
	}
	let ours = {};
	for (let id, s in core.load().servers)
		ours[s.ifname] = id;
	for (let i in d?.interface ?? []) {
		if (srv_id != null && ours[i.interface] == srv_id)
			continue;
		if (srv_id === false && ours[i.interface] != null)
			continue;
		for (let a in i['ipv4-address'] ?? [])
			push(out, { iface: i.interface, cidr: `${a.address}/${a.mask}` });
	}
	return out;
};

/** Subnets in use on the router except the given server's (null: all of them). */
/** The router's IPv4 networks, Dawnline's tunnels included: [{ iface, cidr }]. */
export function networks() {
	return other_subnets(null);
};

export function used_subnets(except_srv) {
	return map(other_subnets(except_srv), (x) => x.cidr);
};

/** Subnets of interfaces that are not Dawnline tunnels (an imported config is checked against these). */
export function foreign_subnets() {
	return used_subnets(false);
};

/* ---------- checks ---------- */

/*
 * Checks are named for the healthy state ("Clock is set"); a failed one also
 * gets the problem in words for notices ("Clock isn't set"), passed with it.
 * A server's checks carry its name after both (` (Home)`, with several servers).
 */
function check(id, title, status, detail, fix, problem) {
	let bad = status == 'warn' || status == 'error';
	return { id, title, status, detail: detail ?? '', fix: fix ?? null, problem: bad ? (problem ?? title) : null };
}

/**
 * Answers from our ports and the proxies that would swallow them (fw.sync_reply_routes):
 * { ok, diverts: ["pref 1000 fwmark 0x1 → table 100"] }.
 */
function replies(m) {
	let d = fw.proxy_diverts();
	return { ok: fw.reply_ok(m, d), diverts: map(d, fw.divert_str) };
}

function reply_check(id, title, problem, proto, port, r) {
	let via = join(', ', r.diverts);
	let from = `${uc(proto)} ${port}`;
	return check(id, title, r.ok ? 'ok' : 'error',
		!r.ok ? sprintf(_('Answers from %s are swallowed by a proxy on the router (%s): clients get no reply.'), from, via)
			: length(r.diverts) ? sprintf(_('Answers from %s go straight out. A proxy on the router diverts its own traffic (%s); these answers skip it.'), from, via)
			: sprintf(_('Answers from %s go straight out.'), from),
		r.ok ? null : 'apply', problem);
}

const PRIVATE = map([ '100.64.0.0/10', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16' ], parse_cidr);

/** What kind of IPv4 the WAN has: public, cgnat (100.64/10), private (behind another router), or none. */
export function wan_kind(wan) {
	let wc = wan ? ip2int(wan) : null;
	if (wc == null)
		return 'none';
	if (in_cidr(wc, PRIVATE[0]))
		return 'cgnat';
	return length(filter(PRIVATE, (c) => in_cidr(wc, c))) ? 'private' : 'public';
};

const HEX = '0123456789abcdef';

// An IPv6 address as its 32 hex digits, so two spellings of one address
// compare equal (2001:DB8::1, 2001:db8:0::1, as typed or as a tool prints
// it); null when it is none. No regex: the router's addresses and a name's
// AAAA records go through it on every look.
function ip6_full(s) {
	if (type(s) != 'string')
		return null;
	let halves = split(lc(s), '::');
	if (length(halves) > 2)
		return null;
	let head = halves[0] != '' ? split(halves[0], ':') : [];
	let tail = length(halves) == 2 && halves[1] != '' ? split(halves[1], ':') : [];
	let gap = 8 - length(head) - length(tail);
	if (length(halves) == 2 ? gap < 1 : gap != 0)
		return null;
	let groups = [ ...head ];
	for (let i = 0; i < gap; i++)
		push(groups, '0');
	push(groups, ...tail);
	let out = '';
	for (let g in groups) {
		if (length(g) < 1 || length(g) > 4 || ltrim(g, HEX) != '')
			return null;
		out += substr(`0000${g}`, length(g));
	}
	return out;
}

/**
 * The router's public IPv6 addresses in `ip -6 -j addr show scope global`
 * output (`links`), on any interface: a DDNS client may publish the LAN's
 * address from the delegated prefix, which reaches the router too. Unique
 * local addresses (fc00::/7: OpenWrt gives the LAN one even without IPv6
 * from the ISP) and failed duplicates do not count: nothing reaches them from
 * outside. [] when there is none.
 */
export function own_ipv6(links) {
	let out = [];
	for (let l in (type(links) == 'array' ? links : []))
		for (let a in l?.addr_info ?? []) {
			let k = ip6_full(a?.local);
			if (k && a.family == 'inet6' && !a.dadfailed && substr(k, 0, 2) != 'fc' && substr(k, 0, 2) != 'fd')
				push(out, a.local);
		}
	return out;
};

// The router's public IPv6 addresses (own_ipv6), or null when `ip` could not tell.
function router_ipv6() {
	let out = sh_out('ip -6 -j addr show scope global');
	if (out == null)
		return null;
	try {
		let links = json(out || '[]');
		return type(links) == 'array' ? own_ipv6(links) : null;
	}
	catch (e) {
		// No JSON (an `ip` without -j): unknown, so the AAAA records get no verdict.
		return null;
	}
}

// What the facts are made from, read on the router.
function endpoint_reads(srv, host) {
	let ips = host ? lookup.resolve(host) : [];
	// The router's IPv6 only when the name has some to compare with.
	return {
		ips, wan: srv ? (net.wan_address(srv) ?? lookup.wan_ipv4(srv.wan_zone)) : lookup.wan_ipv4('wan'),
		router6: length(filter(ips, (a) => ip2int(a) == null)) ? router_ipv6() : null,
	};
}

/**
 * What a public address points at, for Health and the "as you type" check on
 * the server page: { host, ips, ips4, ips6, wan, kind (wan_kind), cloudflare,
 * here (an IPv4 of it is this router's WAN), v6_only, router6 (the router's
 * public IPv6 addresses, own_ipv6; null when unknown, or not read because the
 * name has no IPv6), foreign6 (its IPv6 addresses that are none of those, all
 * of them when the router has none; null while router6 is), here6 (it has
 * IPv6 addresses and each is one of the router's) }. `reads` (a test's)
 * stands for what is read on the router: { ips, wan, router6 }.
 */
export function endpoint_facts(srv, host, reads) {
	let r = reads ?? endpoint_reads(srv, host);
	let ips = r.ips ?? [], wan = r.wan ?? null;
	let ips4 = filter(ips, (a) => ip2int(a) != null), ips6 = filter(ips, (a) => ip2int(a) == null);
	let own = r.router6 != null ? map(r.router6, ip6_full) : null;
	let foreign6 = own != null ? filter(ips6, (a) => index(own, ip6_full(a)) < 0) : null;
	return {
		host, ips, ips4, ips6, wan, kind: wan_kind(wan),
		cloudflare: length(filter(ips, (a) => cloudflare_ip(a))) > 0,
		here: wan != null && index(ips4, wan) >= 0,
		v6_only: !length(ips4) && length(ips6) > 0,
		router6: r.router6 ?? null, foreign6,
		here6: foreign6 != null && length(ips6) > 0 && !length(foreign6),
	};
};

/*
 * The name's IPv6 addresses that do not reach this router from outside, in
 * words, or null (each is a public one of the router, or those are unknown).
 * A name with IPv4 too: devices that prefer IPv6 take these and fail, the
 * others connect.
 */
function aaaa_words(f) {
	let bad = f.foreign6 ?? [], n = length(bad);
	if (!n)
		return null;
	if (!length(f.router6))
		return sprintf(N_(n, '%s AAAA → %s, but this router has no public IPv6 address: devices that prefer IPv6 will fail to connect. Remove this AAAA record or set up IPv6 on the router.',
			'%s AAAA → %s, but this router has no public IPv6 address: devices that prefer IPv6 will fail to connect. Remove these AAAA records or set up IPv6 on the router.'),
			f.host, join(', ', bad));
	return sprintf(N_(n, '%s AAAA → %s is not a public address of this router: devices that prefer IPv6 will fail to connect. Fix or remove this AAAA record.',
		'%s AAAA → %s are not public addresses of this router: devices that prefer IPv6 will fail to connect. Fix or remove these AAAA records.'),
		f.host, join(', ', bad));
}

// An IPv6-only name none of whose addresses is a public one of the router: no device connects. Null otherwise.
function v6_only_unreached(f) {
	let n = length(f.foreign6 ?? []);
	if (!n || n < length(f.ips6))
		return null;
	if (!length(f.router6))
		return sprintf(_('%s → %s: IPv6 only, but this router has no public IPv6 address: no device can connect. Check your DNS / DDNS, or set up IPv6 on the router.'),
			f.host, join(', ', f.ips6));
	return sprintf(N_(n, '%s → %s: IPv6 only, and not a public address of this router: no device can connect. Check your DNS / DDNS.',
		'%s → %s: IPv6 only, and not public addresses of this router: no device can connect. Check your DNS / DDNS.'),
		f.host, join(', ', f.ips6));
}

/**
 * The facts in words, in the language of the call: { status: ok|warn|error, text }
 * (text a whole sentence). `proto_note` names what must get through ("UDP 4500").
 */
export function endpoint_words(f, proto_note) {
	if (!f.host)
		return { status: 'error', text: _('No public address: devices will not know where to connect.') };
	if (!length(f.ips))
		return { status: 'error', text: sprintf(_('%s does not resolve.'), f.host) };
	if (f.cloudflare)
		return { status: 'error', text: sprintf(_("%s → %s (Cloudflare). %s reaches the router only if this name is DNS-only there, or use the router's IP."),
			f.host, join(', ', f.ips), proto_note) };
	let v6 = aaaa_words(f);
	if (f.v6_only) {
		let none = v6_only_unreached(f);
		if (none != null || v6 != null)
			return { status: 'warn', text: none ?? v6 };
		return { status: f.kind == 'public' ? 'warn' : 'ok', text: f.kind == 'public'
			? sprintf(_("%s → %s: IPv6 only, so only devices with IPv6 connect (the router's IPv4 %s has no name)."), f.host, join(', ', f.ips6), f.wan)
			: sprintf(_('%s → %s: IPv6 only, so only devices with IPv6 connect.'), f.host, join(', ', f.ips6)) };
	}
	let v4 = null;
	if (f.kind == 'cgnat' || f.kind == 'private')
		v4 = f.kind == 'cgnat'
			? sprintf(_('The WAN address %s is CGNAT (shared by the ISP): %s cannot be forwarded to this router from outside unless the ISP gives a public address or IPv6.'), f.wan, proto_note)
			: sprintf(_('The WAN address %s is private: this router is behind another one. Forward %s on it, or devices cannot connect.'), f.wan, proto_note);
	else if (f.wan && !f.here)
		v4 = sprintf(_('%s points at %s, not this router (WAN %s). Check your DNS / DDNS.'), f.host, join(', ', f.ips4), f.wan);
	// Two separate facts, each a sentence of its own: the IPv4 one first.
	if (v4 != null || v6 != null)
		return { status: 'warn', text: join(' ', filter([ v4, v6 ], (x) => x != null)) };
	// Without the router's WAN address only the facts: names and addresses, no words.
	return { status: 'ok', text: f.here ? sprintf(_('%s points at this router (%s).'), f.host, join(', ', [ f.wan, ...(f.here6 ? f.ips6 : []) ]))
		: `${f.host} → ${join(', ', f.ips)}` };
};

/** What a public address resolves to and whether that reaches this router (for a core's protocol). */
function endpoint_check(id, title, problem, srv, host, proto_note) {
	let w = endpoint_words(endpoint_facts(srv, host), proto_note);
	return check(id, title, w.status, w.text, null, problem);
}

// "1000:	from all fwmark 0x1 lookup 100". A module constant, compiled once, not for each rule.
const MARK_RULE = /^(\d+):.*fwmark 0x([0-9a-f]+)(\/0x[0-9a-f]+)?.* lookup (\S+)/;

/**
 * Policy routing by another package (mwan3, pbr): an fwmark rule ahead of
 * Dawnline's (pref < 5205) whose table has a default route of its own sends
 * marked tunnel traffic straight out, past "like a home device". Reported,
 * since those marks belong to that package. [] when none.
 */
function policy_routing() {
	let out = [];
	for (let line in split(sh_out('ip -4 rule show 2>/dev/null') ?? '', '\n')) {
		let mm = match(line, MARK_RULE);
		if (!mm || +mm[1] >= 5205)
			continue;
		let routes = sh_out(`ip -4 route show table ${q(mm[4])} 2>/dev/null`) ?? '';
		let def = match(routes, /(^|\n)default [^\n]*/)?.[0] ?? '';
		if (def == '' || match(def, /local default/) || index(def, `dev ${net.INTERNAL.transit}`) >= 0)
			continue;
		push(out, `pref ${mm[1]} fwmark 0x${mm[2]} → table ${mm[4]}`);
	}
	return out;
}

function no_proto() {
	return _("netifd doesn't know the amneziawg protocol (AmneziaWG missing, or the network wasn't restarted after installing it).");
}

/** Free space on the overlay in KB (null when unknown). */
function overlay_free_kb() {
	let out = sh('df -Pk /overlay 2>/dev/null || df -Pk / 2>/dev/null').out;
	let m = match(out ?? '', /\n\S+\s+[0-9]+\s+[0-9]+\s+([0-9]+)\s/);
	return m ? +m[1] : null;
}

/** Is AmneziaWG there and usable: packages, kernel module, netifd's protocol handler. */
function awg_check() {
	let st = awg.load();
	let title = _('AmneziaWG installed');
	let missing = st.missing ?? [];
	if (length(missing)) {
		// The module was built for the kernel of the firmware it was installed on.
		let kc = builds.kernel_changed();
		if (kc && index(missing, 'kmod-amneziawg') >= 0)
			return check('awg', title, 'error',
				sprintf(_('The firmware changed (kernel %s → %s): the AmneziaWG build installed for it is gone. Install the build for this firmware.'), kc.was, kc.now),
				'install:awg', _('AmneziaWG needs a build for the new firmware'));
		return check('awg', title, 'error', sprintf(N_(length(missing), '%s is missing.', '%s are missing.'), join(', ', missing)), 'install:awg',
			_('AmneziaWG isn’t installed'));
	}
	if (!st.loaded) {
		// load() tried it: the second modprobe only repeats why.
		let why = trim(sh('modprobe amneziawg 2>&1; dmesg | grep -i amneziawg | tail -n 3').out);
		return check('awg', title, 'error',
			why ? sprintf(_("The kernel module doesn't load: %s Reinstall a build for this kernel in Components."), why)
				: _("The kernel module doesn't load. Reinstall a build for this kernel in Components."),
			'updates', _('AmneziaWG’s kernel module doesn’t load'));
	}
	if (!st.handler)
		return check('awg', title, 'error', no_proto(), 'netrestart', _('The network doesn’t know AmneziaWG yet'));
	// The install could not swap the loaded module: the old one runs until the next boot (dawnline.awg_builds).
	if (builds.waits_for_reboot())
		return check('awg', title, 'warn', _('The AmneziaWG update is installed and starts after a reboot.'), null,
			_('The AmneziaWG update waits for a reboot'));
	return check('awg', title, 'ok', _('Kernel module, awg tool and the netifd protocol are present.'));
}

/**
 * The /24s home routers come with out of the box. A home network on one of
 * them is very likely the same as the network a person connects from, and
 * home access then takes those addresses into the tunnel: their own printer or
 * TV is out of reach while connected, LAN Bypass or not.
 */
const COMMON_HOME = [
	'192.168.0.0/24', '192.168.1.0/24', '192.168.2.0/24', '192.168.3.0/24', '192.168.8.0/24', '192.168.10.0/24',
	'192.168.31.0/24', '192.168.50.0/24', '192.168.88.0/24', '192.168.100.0/24', '192.168.178.0/24',
	'10.0.0.0/24', '10.1.1.0/24',
];

/** The home networks in `nets` that overlap a common out-of-the-box subnet. */
export function common_home(nets) {
	return filter(nets ?? [], (n) => {
		let a = parse_cidr(n);
		return a && length(filter(COMMON_HOME, (c) => cidr_overlaps(a, parse_cidr(c))));
	});
};

/**
 * Whether the server's home networks are on a common subnet, while anyone on
 * it has home access (otherwise nothing of home goes into the tunnel). A
 * warning on Health only: advice, not a fault, so no notice elsewhere.
 */
function home_check(m, id, srv, label) {
	let reach = filter(values(m.people), (p) => p.server == id && (p.access == 'lan' || p.access == 'both'));
	let nets = net.server_net(srv).nets;
	if (!length(reach) || !length(nets))
		return null;
	let bad = common_home(nets);
	let c = check(`homenet_${id}`, _('Home network addresses') + label, length(bad) ? 'warn' : 'ok',
		length(bad)
			? sprintf(_('%s is one of the most common home subnets. On a network with the same addresses, people with home access reach your home instead of their own: their printer or TV there is out of reach while connected, with LAN Bypass too. A rarer subnet for your home network avoids it, for example 10.37.12.0/24.'), join(', ', bad))
			: sprintf(_('%s is not a common home subnet: the networks people connect from rarely use the same addresses.'), join(', ', nets)),
		null);
	c.problem = null;
	return c;
}

/** Checks of a server's AmneziaWG tunnel. */
function awg_checks(m, id, srv, label, fwc, dmp, rep) {
	let out = [];
	let st = live.iface_status(srv.ifname);
	let up = !!st?.up;
	let codes = map(st?.errors ?? [], (e) => e.code);
	let running = _('AmneziaWG running') + label, down = _('AmneziaWG is down') + label;
	if (!up && index(codes, 'INVALID_PROTO') >= 0)
		push(out, check(`up_${id}`, running, 'error', no_proto(), 'netrestart', down));
	else
		push(out, check(`up_${id}`, running, up ? 'ok' : 'error',
			up ? sprintf(_('%s is up, listening on UDP %d.'), srv.ifname, srv.port) :
			!st ? sprintf(_('%s does not exist.'), srv.ifname) :
			length(codes) ? sprintf(_('%s is down: %s.'), srv.ifname, join(', ', codes)) : sprintf(_('%s is down.'), srv.ifname),
			up ? null : (st ? 'ifup:' + srv.ifname : 'apply'), down));
	// The devices the sync loads, by the same choice the agent compares with every minute.
	if (up && dmp.reads[srv.ifname] == 'error')
		push(out, check(`peers_${id}`, _('AmneziaWG devices loaded') + label, 'warn',
			_('The tunnel could not be read, so its devices could not be checked.'), null,
			_('The devices in AmneziaWG could not be checked') + label));
	else if (up) {
		let devs = awg.tunnel_devices(m, id, apply.states_for(m, core.load_usage()));
		let diff = awg.peer_diff(devs, dmp, srv.ifname);
		let expected = length(devs), missing = diff.missing, extra = diff.extra, actual = diff.loaded;
		let same = !missing && !extra;
		push(out, check(`peers_${id}`, _('AmneziaWG devices loaded') + label, same ? 'ok' : 'warn',
			same ? sprintf(N_(actual, '%d device is loaded in the tunnel.', '%d devices are loaded in the tunnel.'), actual) :
			extra ? sprintf(N_(expected, '%d of %d device missing, %d loaded that should not be.', '%d of %d devices missing, %d loaded that should not be.'),
				missing, expected, extra)
			: sprintf(N_(expected, '%d of %d device missing.', '%d of %d devices missing.'), missing, expected),
			same ? null : 'sync', _('Not every device is loaded into AmneziaWG') + label));
	}
	let rule = fwc.get('firewall', `dawnline_${id}_port`) == 'rule';
	let zone = fwc.get('firewall', `dawnline_${id}_zone`) == 'zone';
	push(out, check(`fw_${id}`, _('AmneziaWG firewall') + label, rule && zone ? 'ok' : 'error',
		rule && zone ? sprintf(_('Zone %s and the WAN rule for UDP %d exist.'), srv.ifname, srv.port) : _('Firewall zone or WAN rule is missing.'),
		rule && zone ? null : 'apply', _('AmneziaWG firewall rules are missing') + label));
	push(out, reply_check(`reply_${id}`, _('AmneziaWG answers reach devices') + label, _('AmneziaWG answers may not reach devices') + label,
		'udp', srv.port, rep));
	// Port collisions with other tunnels.
	let clash = [];
	let nc = cursor();
	nc.load('network');
	nc.foreach('network', 'interface', (s) => {
		if (s['.name'] != srv.ifname && (s.proto == 'amneziawg' || s.proto == 'wireguard') && +s.listen_port == srv.port)
			push(clash, s['.name']);
	});
	if (length(clash))
		push(out, check(`port_${id}`, _('AmneziaWG port is free') + label, 'error', sprintf(_('UDP %d is also used by %s.'), srv.port, join(', ', clash)),
			null, _('AmneziaWG port is taken') + label));
	let overlaps = [];
	let sc = parse_cidr(srv.subnet);
	for (let o in other_subnets(id)) {
		let oc = parse_cidr(o.cidr);
		if (sc && oc && cidr_overlaps(sc, oc))
			push(overlaps, `${o.iface} (${o.cidr})`);
	}
	push(out, check(`subnet_${id}`, _('AmneziaWG subnet is unique') + label, length(overlaps) ? 'error' : 'ok',
		length(overlaps) ? sprintf(_('%s overlaps %s.'), srv.subnet, join(', ', overlaps)) : sprintf(_('%s does not overlap other networks.'), srv.subnet),
		null, _('AmneziaWG subnet overlaps another network') + label));
	let home = home_check(m, id, srv, label);
	if (home)
		push(out, home);
	return out;
}

/** The portal's checks: listening, its address, answers, plain HTTP and the certificate. */
function portal_checks(m, need, rep) {
	let out = [];
	let s = m.settings;
	let portal = _('Personal portal'), portal_bad = _('Personal portal isn’t working');
	if (length(need.https))
		return [ check('portal', portal, 'error', sprintf(_("HTTPS isn't available on this router: install %s."), join(', ', need.https)), 'install:https', portal_bad) ];
	let owners = tcp_port_owners(s.portal_port);
	let listening = tcp_listening(s.portal_port);
	if (length(owners))
		push(out, check('portal', portal, 'error',
			sprintf(_('TCP %d is already used by %s. Choose another port in Settings.'), s.portal_port, join(', ', owners)), null, portal_bad));
	else
		push(out, check('portal', portal, listening ? 'ok' : 'error',
			listening ? sprintf(_('Listening on TCP %d.'), s.portal_port) : sprintf(_('Nothing listens on TCP %d.'), s.portal_port),
			listening ? null : 'restart', portal_bad));
	if (!s.portal_host)
		push(out, check('portal_host', _('Portal address'), 'error', _('Set the public hostname in Settings so links can be generated.'),
			null, _('Portal address isn’t set')));
	else {
		let ips = lookup.resolve(s.portal_host), wan = lookup.router_wan(m);
		let cf = filter(ips, (x) => cloudflare_ip(x));
		let h = s.portal_host;
		push(out, check('portal_dns', _('Portal address points here'), !length(ips) ? 'error' : length(cf) ? 'ok' : wan && index(ips, wan) < 0 ? 'warn' : 'ok',
			!length(ips) ? sprintf(_('%s does not resolve.'), h) :
			length(cf) ? sprintf(_('%s goes through Cloudflare; in Russia such connections often stall after ~16 KB.'), h) :
			wan && index(ips, wan) < 0 ? sprintf(_('%s points at %s, not this router (%s).'), h, join(', ', ips), wan) :
			wan ? sprintf(_('%s → %s (this router).'), h, join(', ', ips)) : `${h} → ${join(', ', ips)}.`,
			null, _('Portal address doesn’t point here')));
	}
	push(out, reply_check('portal_reply', _('Portal answers reach visitors'), _('Portal answers may not reach visitors'), 'tcp', s.portal_port, rep));
	if (core.portal_http(m)) {
		let ipl = filter(core.portal_hosts(m), (h) => ip2int(h) != null);
		push(out, check('portal_http', _('Plain HTTP links'), 'warn',
			sprintf(_('Links on %s use plain HTTP: the link and the VPN keys in configurations travel unencrypted.'), join(', ', ipl)),
			null, _('Portal links use plain HTTP')));
	}
	if (ip2int(s.portal_host) != null) {
		push(out, check('cert', _('Portal certificate'), 'skip', _('The main address is an IP: its links use plain HTTP.')));
		return out;
	}
	let cert = pc.portal_cert(s);
	let ok = system(`openssl x509 -checkend 1209600 -noout -in ${q(cert.cert)} >/dev/null 2>&1`) == 0;
	let sans = cert.self_signed ? [] : pc.cert_names(cert.cert);
	let covers = !s.portal_host || cert.self_signed || length(filter(sans, (n) => pc.name_covers(n, s.portal_host))) > 0;
	push(out, check('cert', _('Portal certificate'), cert.self_signed || !ok || !covers ? 'warn' : 'ok',
		cert.self_signed ? (length(need.acme) ? _('Using a self-signed certificate: browsers will show a warning. ACME can get a free Let’s Encrypt one.')
			: _('Using a self-signed certificate: browsers will show a warning.')) :
		!covers ? sprintf(_('%s does not cover %s (it has %s): browsers will warn.'), cert.cert, s.portal_host, join(', ', sans)) :
		ok ? sprintf(_('%s covers %s and is valid for more than 14 days.'), cert.cert, s.portal_host) : sprintf(_('%s expires within 14 days.'), cert.cert),
		null, _('Portal certificate needs attention')));
	return out;
}

/**
 * Run all checks. Each result: { id, title, status: ok|warn|error|skip, detail, fix,
 * problem (a failed check in words, else null) }, the texts in the language of the call.
 * `fix` names an action accepted by fix(), or one the UI handles itself
 * (install:<feature>, updates).
 */
export function health(m) {
	m ??= core.load();
	let rep = replies(m);
	let out = [];
	let dmp = live.dump(m);
	let need = needs();

	if (length(m.servers))
		push(out, awg_check());
	let y = localtime().year;
	push(out, check('clock', _('Clock is set'), y >= 2025 ? 'ok' : 'error',
		y >= 2025 ? _('End dates and quotas use the router clock.') : _('The router clock looks wrong; end dates will misbehave. Check NTP.'),
		null, _('Clock isn’t set')));

	let agent = service_running('dawnline', 'agent');
	push(out, check('agent', _('Background agent running'), agent ? 'ok' : 'error',
		_('Counts traffic and enforces end dates and quotas.'), agent ? null : 'restart', _('Background agent isn’t running')));

	// A full overlay fails every config write on the router, Dawnline's and
	// OpenWrt's own; backups and history are what Dawnline adds to it.
	let free = overlay_free_kb();
	if (free != null)
		push(out, check('flash', _('Free space on the router'), free < 512 ? 'error' : free < 2048 ? 'warn' : 'ok',
			free < 2048 ? sprintf(_('%s MB free: settings may stop saving. Remove old backups (Settings → Backups) or shorten the history.'), int(free / 1024 * 10) / 10)
				: sprintf(_('%d MB free on the overlay.'), int(free / 1024)),
			null, _('The router is running out of flash')));

	if (!length(m.servers)) {
		push(out, check('server', _('Server configured'), 'warn', _('Run the setup wizard on the Server tab.'), null, _('No server yet')));
		return out;
	}

	let nft_ok = system('nft list table inet dawnline >/dev/null 2>&1') == 0;
	push(out, check('nft', _('Access rules loaded'), nft_ok ? 'ok' : 'error',
		nft_ok ? _('Table inet dawnline enforces who may reach LAN and the internet.')
			: _('Table inet dawnline is missing: no device is loaded into the tunnels until it is back.'),
		nft_ok ? null : 'apply', _('Access rules aren’t loaded')));

	if (length(filter(values(m.servers), (s) => s.lan_like && s.enabled))) {
		let pr = policy_routing();
		push(out, check('policy', _('Internet like a home device not bypassed'), length(pr) ? 'warn' : 'ok',
			length(pr) ? sprintf(_("Policy routing on the router (%s) sends marked traffic straight out, past the home-device path: tunnel traffic it matches skips your LAN's proxies and filters."), join('; ', pr))
				: _('No other policy routing ahead of the tunnel rules.'),
			null, _('Other policy routing bypasses the home-device path')));
	}

	// A device the sync has to leave out (a merged import, a hand-edited config).
	// Its sentences (core.model_errors), how many more, then what it means.
	let data = core.model_errors(m);
	push(out, check('data', _('People and devices consistent'), length(data) ? 'error' : 'ok',
		length(data) ? join(' ', filter([ join(' ', slice(data, 0, 4)), length(data) > 4 ? sprintf(_('(%d more)'), length(data) - 4) : null,
			_('Such devices are left out of the tunnels: fix or remove them.') ], (x) => x))
			: _('Every device has a key and an address of its own inside its server.'),
		null, _('People and devices are inconsistent')));

	let fwc = cursor();
	fwc.load('firewall');

	for (let id, srv in m.servers) {
		let label = length(m.servers) > 1 ? ` (${srv.name})` : '';
		if (!srv.enabled) {
			push(out, check(`srv_${id}`, _('Server') + label, 'skip', _('Server is disabled.')));
			continue;
		}
		push(out, ...awg_checks(m, id, srv, label, fwc, dmp, rep));
		push(out, endpoint_check(`ep_${id}`, _('Public address') + label, _('Public address needs attention') + label,
			srv, core.endpoint_host(m, srv), `UDP ${srv.port}`));

		if (srv.lan_like) {
			let ls = loop.status();
			let nh = need.home;
			push(out, check(`home_${id}`, _('Internet like a home device') + label, ls.active && ls.bridged ? 'ok' : 'warn',
				ls.active && ls.bridged ? sprintf(_('Traffic enters %s as %s, so it is handled like any device on your LAN.'), ls.dev, ls.address) :
				length(nh) ? sprintf(_('Needs %s. Internet traffic leaves through WAN directly until then.'), join(', ', nh)) :
				ls.active ? sprintf(_('The link is up but not attached to %s.'), ls.dev) :
				// loop.status()'s own sentence, then what it means.
				`${ls.error ?? _('Not set up.')} ${_('Internet traffic leaves through WAN directly.')}`,
				ls.active && ls.bridged ? null : length(nh) ? 'install:home' : 'apply', _('Internet like a home device isn’t working') + label));
		}
	}

	// While every server is off the resolver only idles on loopback: nothing to check.
	if (length(filter(values(m.servers), (x) => x.enabled && x.private_key))) {
		let rt = loop.resolver_target();
		let conf = stat(loop.RESOLVER.conf);
		let running = conf != null && loop.resolver_running();
		// A new config (a server turned on, the home link up) restarts it: give it a few seconds.
		let restarting = !running && conf != null && time() - conf.mtime < 10;
		let ok = running || restarting;
		push(out, check('resolver', _('DNS for Home-only devices'), ok ? 'ok' : 'warn',
			restarting ? _('Restarting with the new settings.') :
			ok ? (rt.mode == 'ns' ? sprintf(_('Plain resolver running next to the LAN (%s).'), rt.address) : sprintf(_('Plain resolver on port %d.'), rt.port))
				: _('The resolver is not running; Home-only devices cannot resolve names.'),
			ok ? null : 'apply', _('DNS for Home-only devices isn’t working')));
	}

	if (m.settings.portal_enabled)
		push(out, ...portal_checks(m, need, rep));
	return out;
};

/** Run a fix named by a check. */
export function fix(id) {
	if (id == 'apply')
		return apply.apply();
	if (id == 'sync')
		return apply.sync();
	if (id == 'restart')
		return { code: system('/etc/init.d/dawnline restart >/dev/null 2>&1') };
	// netifd learns protocol handlers (amneziawg) only when it starts. In the
	// background: the answer goes out before the network blinks.
	if (id == 'netrestart') {
		system('( sleep 1; /etc/init.d/network restart ) >/dev/null 2>&1 </dev/null &');
		return { ok: true, background: true };
	}
	let m = match(id ?? '', /^ifup:([a-z][a-z0-9_]{0,11})$/);
	if (m) {
		// Only Dawnline's own tunnels: never another interface of the router.
		let mine = filter(values(core.load().servers), (s) => s.ifname == m[1] && s.private_key);
		if (!length(mine))
			die(sprintf(_("%s is not one of Dawnline's tunnels."), m[1]));
		system(`ifup ${q(m[1])}`);
		return { ok: true };
	}
	die(_('Unknown fix.'));
};
