// Dawnline — Health: what the router has and lacks (packages, listeners,
// networks), the checks shown on Diagnostics → Health, and their fixes.

import { readfile, stat, lsdir } from 'fs';
import { cursor } from 'uci';
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

/** UDP ports an unconnected socket is bound to (IPv4 and IPv6): nothing else can listen there. */
export function udp_bound() {
	let out = {};
	for (let f in [ '/proc/net/udp', '/proc/net/udp6' ])
		for (let line in split(readfile(f) ?? '', '\n')) {
			// "  12: 00000000:1194 00000000:0000 07 …": local address, then the remote one (none).
			let m = match(line, /^ *[0-9]+: [0-9A-F]+:([0-9A-F]{4}) [0-9A-F]+:0000 /);
			if (m)
				out[hex(m[1])] = true;
		}
	return map(keys(out), (k) => +k);
};

/**
 * Programs on 'tcp' or 'udp' ports, our portal left out: { port: "dnsmasq" }.
 * Kernel sockets (a tunnel's) have no name.
 */
function port_programs(proto) {
	let out = {};
	for (let line in split(sh_out(`netstat -ln${proto == 'tcp' ? 't' : 'u'}p 2>/dev/null`) ?? '', '\n')) {
		let f = split(trim(line), /[ \t]+/);
		if (f[0] != proto && f[0] != `${proto}6`)
			continue;
		let m = match(f[3] ?? '', /:([0-9]+)$/);
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
 * gets the problem in words for notices ("Clock isn't set"). Longest names
 * first; a server's name after the check name is kept.
 */
const PROBLEM = [
	[ 'AmneziaWG answers reach devices', 'AmneziaWG answers may not reach devices' ],
	[ 'AmneziaWG devices loaded', 'Not every device is loaded into AmneziaWG' ],
	[ 'AmneziaWG subnet is unique', 'AmneziaWG subnet overlaps another network' ],
	[ 'AmneziaWG port is free', 'AmneziaWG port is taken' ],
	[ 'AmneziaWG installed', 'AmneziaWG isn’t ready' ],
	[ 'AmneziaWG firewall', 'AmneziaWG firewall rules are missing' ],
	[ 'AmneziaWG running', 'AmneziaWG is down' ],
	[ 'Portal answers reach visitors', 'Portal answers may not reach visitors' ],
	[ 'Portal address points here', 'Portal address doesn’t point here' ],
	[ 'Portal address', 'Portal address isn’t set' ],
	[ 'Portal certificate', 'Portal certificate needs attention' ],
	[ 'Personal portal', 'Personal portal isn’t working' ],
	[ 'Plain HTTP links', 'Portal links use plain HTTP' ],
	[ 'Internet like a home device', 'Internet like a home device isn’t working' ],
	[ 'DNS for Home-only devices', 'DNS for Home-only devices isn’t working' ],
	[ 'Background agent running', 'Background agent isn’t running' ],
	[ 'Access rules loaded', 'Access rules aren’t loaded' ],
	[ 'Server configured', 'No server yet' ],
	[ 'Public address', 'Public address needs attention' ],
	[ 'Clock is set', 'Clock isn’t set' ],
];

function problem_of(title) {
	for (let p in PROBLEM)
		if (substr(title, 0, length(p[0])) == p[0])
			return p[1] + substr(title, length(p[0]));
	return title;
}

/** problem: the failed check in words, when the table's wording does not fit the case. */
function check(id, title, status, detail, fix, problem) {
	let bad = status == 'warn' || status == 'error';
	return { id, title, status, detail: detail ?? '', fix: fix ?? null, problem: bad ? (problem ?? problem_of(title)) : null };
}

/**
 * Answers from our ports and the proxies that would swallow them (fw.sync_reply_routes):
 * { ok, diverts: ["pref 1000 fwmark 0x1 → table 100"] }.
 */
function replies(m) {
	let d = fw.proxy_diverts();
	return { ok: fw.reply_ok(m, d), diverts: map(d, fw.divert_str) };
}

function reply_check(id, title, proto, port, r) {
	let via = join(', ', r.diverts);
	return check(id, title, r.ok ? 'ok' : 'error',
		!r.ok ? `Answers from ${uc(proto)} ${port} are swallowed by a proxy on the router (${via}): clients get no reply.`
			: length(r.diverts) ? `Answers from ${uc(proto)} ${port} go straight out. A proxy on the router diverts its own traffic (${via}); these answers skip it.`
			: `Answers from ${uc(proto)} ${port} go straight out.`,
		r.ok ? null : 'apply');
}

const PRIVATE = map([ '100.64.0.0/10', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16' ], parse_cidr);

/** What a public address resolves to and whether that reaches this router (for a core's protocol). */
function endpoint_check(id, title, srv, host, proto_note) {
	if (!host)
		return check(id, title, 'error', 'No public address: devices will not know where to connect.');
	let ips = lookup.resolve(host);
	let wan = net.wan_address(srv) ?? lookup.wan_ipv4(srv.wan_zone);
	let wc = wan ? ip2int(wan) : null;
	let cgnat = wc != null && length(filter(PRIVATE, (c) => in_cidr(wc, c))) > 0;
	if (!length(ips))
		return check(id, title, 'error', `${host} does not resolve.`);
	if (cgnat)
		return check(id, title, 'warn', `WAN address ${wan} is private: forward ${proto_note} on the upstream router, or devices cannot connect.`);
	if (length(filter(ips, (a) => cloudflare_ip(a))))
		return check(id, title, 'error', `${host} → ${join(', ', ips)} (Cloudflare). ${proto_note} reaches the router only if this name is DNS-only there, or use the router's IP.`);
	if (wan && index(ips, wan) < 0)
		return check(id, title, 'warn', `${host} resolves to ${join(', ', ips)}, but the WAN address is ${wan}. Check your DNS / DDNS.`);
	return check(id, title, 'ok', `${host} → ${join(', ', ips)}`);
}

const NO_PROTO = "netifd doesn't know the amneziawg protocol (AmneziaWG missing, or the network wasn't restarted after installing it).";

/** Free space on the overlay in KB (null when unknown). */
function overlay_free_kb() {
	let out = sh('df -Pk /overlay 2>/dev/null || df -Pk / 2>/dev/null').out;
	let m = match(out ?? '', /\n\S+\s+[0-9]+\s+[0-9]+\s+([0-9]+)\s/);
	return m ? +m[1] : null;
}

/** Is AmneziaWG there and usable: packages, kernel module, netifd's protocol handler. */
function awg_check() {
	let st = awg.load();
	let title = 'AmneziaWG installed';
	if (length(st.missing ?? [])) {
		// The module was built for the kernel of the firmware it was installed on.
		let kc = builds.kernel_changed();
		if (kc && index(st.missing, 'kmod-amneziawg') >= 0)
			return check('awg', title, 'error',
				`The firmware changed (kernel ${kc.was} → ${kc.now}): the AmneziaWG build installed for it is gone. Install the build for this firmware.`,
				'install:awg', 'AmneziaWG needs a build for the new firmware');
		return check('awg', title, 'error', `${join(' and ', st.missing)} ${length(st.missing) == 1 ? 'is' : 'are'} missing.`, 'install:awg',
			'AmneziaWG isn’t installed');
	}
	if (!st.loaded) {
		// load() tried it: the second modprobe only repeats why.
		let why = trim(sh('modprobe amneziawg 2>&1; dmesg | grep -i amneziawg | tail -n 3').out);
		return check('awg', title, 'error',
			`The kernel module doesn't load${why ? `: ${why}` : '.'} Reinstall a build for this kernel in Components.`, 'updates',
			'AmneziaWG’s kernel module doesn’t load');
	}
	if (!st.handler)
		return check('awg', title, 'error', NO_PROTO, 'netrestart', 'The network doesn’t know AmneziaWG yet');
	return check('awg', title, 'ok', 'Kernel module, awg tool and the netifd protocol are present.');
}

/** Checks of a server's AmneziaWG tunnel. */
function awg_checks(m, id, srv, label, fwc, dmp, rep) {
	let out = [];
	let st = live.iface_status(srv.ifname);
	let up = !!st?.up;
	let codes = map(st?.errors ?? [], (e) => e.code);
	if (!up && index(codes, 'INVALID_PROTO') >= 0)
		push(out, check(`up_${id}`, `AmneziaWG running${label}`, 'error', NO_PROTO, 'netrestart'));
	else
		push(out, check(`up_${id}`, `AmneziaWG running${label}`, up ? 'ok' : 'error',
			up ? `${srv.ifname} is up, listening on UDP ${srv.port}.` :
			(st ? `${srv.ifname} is down${length(codes) ? ': ' + join(', ', codes) : ''}.` : `${srv.ifname} does not exist.`),
			up ? null : (st ? 'ifup:' + srv.ifname : 'apply')));
	if (up) {
		let expected = 0;
		let states = apply.states_for(m, core.load_usage());
		for (let did, d in m.devices) {
			let p = m.people[d.person];
			if (p?.server == id && !d.disabled && states[d.person] == 'active')
				expected++;
		}
		let actual = 0;
		for (let k, p in dmp.peers)
			if (p.ifname == srv.ifname)
				actual++;
		push(out, check(`peers_${id}`, `AmneziaWG devices loaded${label}`, expected == actual ? 'ok' : 'warn',
			`${actual} of ${expected} active devices are loaded in the tunnel.`, expected == actual ? null : 'sync'));
	}
	let rule = fwc.get('firewall', `dawnline_${id}_port`) == 'rule';
	let zone = fwc.get('firewall', `dawnline_${id}_zone`) == 'zone';
	push(out, check(`fw_${id}`, `AmneziaWG firewall${label}`, rule && zone ? 'ok' : 'error',
		rule && zone ? `Zone ${srv.ifname} and the WAN rule for UDP ${srv.port} exist.` : 'Firewall zone or WAN rule is missing.',
		rule && zone ? null : 'apply'));
	push(out, reply_check(`reply_${id}`, `AmneziaWG answers reach devices${label}`, 'udp', srv.port, rep));
	// Port collisions with other tunnels.
	let clash = [];
	let nc = cursor();
	nc.load('network');
	nc.foreach('network', 'interface', (s) => {
		if (s['.name'] != srv.ifname && (s.proto == 'amneziawg' || s.proto == 'wireguard') && +s.listen_port == srv.port)
			push(clash, s['.name']);
	});
	if (length(clash))
		push(out, check(`port_${id}`, `AmneziaWG port is free${label}`, 'error', `UDP ${srv.port} is also used by ${join(', ', clash)}.`));
	let overlaps = [];
	let sc = parse_cidr(srv.subnet);
	for (let o in other_subnets(id)) {
		let oc = parse_cidr(o.cidr);
		if (sc && oc && cidr_overlaps(sc, oc))
			push(overlaps, `${o.iface} (${o.cidr})`);
	}
	push(out, check(`subnet_${id}`, `AmneziaWG subnet is unique${label}`, length(overlaps) ? 'error' : 'ok',
		length(overlaps) ? `${srv.subnet} overlaps ${join(', ', overlaps)}.` : `${srv.subnet} does not overlap other networks.`));
	return out;
}

/** The portal's checks: listening, its address, answers, plain HTTP and the certificate. */
function portal_checks(m, need, rep) {
	let out = [];
	let s = m.settings;
	if (length(need.https))
		return [ check('portal', 'Personal portal', 'error', `HTTPS isn't available on this router: install ${join(' and ', need.https)}.`, 'install:https') ];
	let owners = tcp_port_owners(s.portal_port);
	let listening = tcp_listening(s.portal_port);
	if (length(owners))
		push(out, check('portal', 'Personal portal', 'error',
			`TCP ${s.portal_port} is already used by ${join(', ', owners)}. Choose another port in Settings.`));
	else
		push(out, check('portal', 'Personal portal', listening ? 'ok' : 'error',
			listening ? `Listening on TCP ${s.portal_port}.` : `Nothing listens on TCP ${s.portal_port}.`, listening ? null : 'restart'));
	if (!s.portal_host)
		push(out, check('portal_host', 'Portal address', 'error', 'Set the public hostname in Settings so links can be generated.'));
	else {
		let ips = lookup.resolve(s.portal_host), wan = lookup.router_wan(m);
		let cf = filter(ips, (x) => cloudflare_ip(x));
		push(out, check('portal_dns', 'Portal address points here', !length(ips) ? 'error' : length(cf) ? 'ok' : wan && index(ips, wan) < 0 ? 'warn' : 'ok',
			!length(ips) ? `${s.portal_host} does not resolve.` :
			length(cf) ? `${s.portal_host} goes through Cloudflare; in Russia such connections often stall after ~16 KB.` :
			wan && index(ips, wan) < 0 ? `${s.portal_host} points at ${join(', ', ips)}, not this router (${wan}).` :
			`${s.portal_host} → ${join(', ', ips)}${wan ? ' (this router)' : ''}.`));
	}
	push(out, reply_check('portal_reply', 'Portal answers reach visitors', 'tcp', s.portal_port, rep));
	if (core.portal_http(m)) {
		let ipl = filter(core.portal_hosts(m), (h) => ip2int(h) != null);
		push(out, check('portal_http', 'Plain HTTP links', 'warn',
			`Links on ${join(', ', ipl)} use plain HTTP: the link and the VPN keys in configurations travel unencrypted.`));
	}
	if (ip2int(s.portal_host) != null) {
		push(out, check('cert', 'Portal certificate', 'skip', 'The main address is an IP: its links use plain HTTP.'));
		return out;
	}
	let cert = pc.portal_cert(s);
	let ok = system(`openssl x509 -checkend 1209600 -noout -in ${q(cert.cert)} >/dev/null 2>&1`) == 0;
	let sans = cert.self_signed ? [] : pc.cert_names(cert.cert);
	let covers = !s.portal_host || cert.self_signed || length(filter(sans, (n) => pc.name_covers(n, s.portal_host))) > 0;
	push(out, check('cert', 'Portal certificate', cert.self_signed || !ok || !covers ? 'warn' : 'ok',
		cert.self_signed ? `Using a self-signed certificate: browsers will show a warning.${length(need.acme) ? ' ACME can get a free Let’s Encrypt one.' : ''}` :
		!covers ? `${cert.cert} does not cover ${s.portal_host} (it has ${join(', ', sans)}): browsers will warn.` :
		ok ? `${cert.cert} covers ${s.portal_host} and is valid for more than 14 days.` : `${cert.cert} expires within 14 days.`));
	return out;
}

/**
 * Run all checks. Each result: { id, title, status: ok|warn|error|skip, detail, fix }.
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
	push(out, check('clock', 'Clock is set', y >= 2025 ? 'ok' : 'error',
		y >= 2025 ? 'End dates and quotas use the router clock.' : 'The router clock looks wrong; end dates will misbehave. Check NTP.'));

	let agent = service_running('dawnline', 'agent');
	push(out, check('agent', 'Background agent running', agent ? 'ok' : 'error',
		'Counts traffic and enforces end dates and quotas.', agent ? null : 'restart'));

	// A full overlay fails every config write on the router, Dawnline's and
	// OpenWrt's own; backups and history are what Dawnline adds to it.
	let free = overlay_free_kb();
	if (free != null)
		push(out, check('flash', 'Free space on the router', free < 512 ? 'error' : free < 2048 ? 'warn' : 'ok',
			free < 2048 ? `${int(free / 1024 * 10) / 10} MB free: settings may stop saving. Remove old backups (Settings → Backups) or shorten the history.`
				: `${int(free / 1024)} MB free on the overlay.`,
			null, 'The router is running out of flash'));

	if (!length(m.servers)) {
		push(out, check('server', 'Server configured', 'warn', 'Run the setup wizard on the Server tab.'));
		return out;
	}

	let nft_ok = system('nft list table inet dawnline >/dev/null 2>&1') == 0;
	push(out, check('nft', 'Access rules loaded', nft_ok ? 'ok' : 'error',
		nft_ok ? 'Table inet dawnline enforces who may reach LAN and the internet.'
			: 'Table inet dawnline is missing: no device is loaded into the tunnels until it is back.',
		nft_ok ? null : 'apply'));

	// A device the sync has to leave out (a merged import, a hand-edited config).
	let data = core.model_errors(m);
	push(out, check('data', 'People and devices consistent', length(data) ? 'error' : 'ok',
		length(data) ? `${join(' ', slice(data, 0, 4))}${length(data) > 4 ? ` (${length(data) - 4} more)` : ''} Such devices are left out of the tunnels: fix or remove them.`
			: 'Every device has a key and an address of its own inside its server.'));

	let fwc = cursor();
	fwc.load('firewall');

	for (let id, srv in m.servers) {
		let label = length(m.servers) > 1 ? ` (${srv.name})` : '';
		if (!srv.enabled) {
			push(out, check(`srv_${id}`, `Server${label}`, 'skip', 'Server is disabled.'));
			continue;
		}
		push(out, ...awg_checks(m, id, srv, label, fwc, dmp, rep));
		push(out, endpoint_check(`ep_${id}`, `Public address${label}`, srv, core.endpoint_host(m, srv), `UDP ${srv.port}`));

		if (srv.lan_like) {
			let ls = loop.status();
			let nh = need.home;
			push(out, check(`home_${id}`, `Internet like a home device${label}`, ls.active && ls.bridged ? 'ok' : 'warn',
				ls.active && ls.bridged ? `Traffic enters ${ls.dev} as ${ls.address}, so it is handled like any device on your LAN.` :
				length(nh) ? `Needs ${join(' and ', nh)}. Internet traffic leaves through WAN directly until then.` :
				ls.active ? `The link is up but not attached to ${ls.dev}.` :
				`${ls.error ?? 'Not set up.'} Internet traffic leaves through WAN directly.`,
				ls.active && ls.bridged ? null : length(nh) ? 'install:home' : 'apply'));
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
		push(out, check('resolver', 'DNS for Home-only devices', ok ? 'ok' : 'warn',
			restarting ? 'Restarting with the new settings.' :
			ok ? (rt.mode == 'ns' ? `Plain resolver running next to the LAN (${rt.address}).` : `Plain resolver on port ${rt.port}.`)
				: 'The resolver is not running; Home-only devices cannot resolve names.', ok ? null : 'apply'));
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
			die(`${m[1]} is not one of Dawnline's tunnels.`);
		system(`ifup ${q(m[1])}`);
		return { ok: true };
	}
	die('Unknown fix.');
};
