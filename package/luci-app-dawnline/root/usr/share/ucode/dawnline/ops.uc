// Dawnline — operations: health checks (with fixes), backups, export/import.

import { readfile, writefile, stat, unlink, lsdir } from 'fs';
import { cursor } from 'uci';
import {
	q, sh, sh_out, ensure_dir, read_json, write_json, write_file, parse_cidr, cidr_overlaps, cidr_str,
	ip2int, in_cidr, file_exists, valid_host, cloudflare_ip, DATA_DIR, RUN_DIR, VERSION
} from 'dawnline.util';
import * as core from 'dawnline.core';
import * as live from 'dawnline.live';
import * as apply from 'dawnline.apply';
import * as loop from 'dawnline.loop';
import * as net from 'dawnline.net';

const BACKUP_DIR = `${DATA_DIR}/backups`;
const KEEP_BACKUPS = 10;

/**
 * Packages a feature needs that are missing, by feature: https (the portal: openssl-util and any
 * TLS module for uhttpd), acme (Let's Encrypt certificates), home (the home-like link). Checked by
 * files, so it is cheap enough for every page load.
 */
export function needs() {
	let tls = false;
	for (let d in [ '/lib', '/usr/lib' ])
		for (let f in lsdir(d) ?? [])
			if (substr(f, 0, 16) == 'libustream-ssl.s')
				tls = true;
	let kver = trim(readfile('/proc/sys/kernel/osrelease') ?? '');
	let veth = stat('/sys/module/veth') != null || file_exists(`/lib/modules/${kver}/veth.ko`);
	let miss = (list) => map(filter(list, (x) => !x[0]), (x) => x[1]);
	return {
		https: miss([ [ file_exists('/usr/bin/openssl'), 'openssl-util' ], [ tls, 'libustream-openssl' ] ]),
		acme: miss([ [ file_exists('/usr/lib/acme/client/acme.sh'), 'acme' ], [ file_exists('/usr/lib/acme/client/dnsapi/dns_cf.sh'), 'acme-acmesh-dnsapi' ],
			[ file_exists('/www/luci-static/resources/view/acme.js'), 'luci-app-acme' ] ]),
		home: miss([ [ file_exists('/usr/libexec/ip-full'), 'ip-full' ], [ veth, 'kmod-veth' ] ]),
	};
};

/** ACME certificates on the router and the names each covers. */
function acme_certs() {
	let out = [];
	for (let f in sort(lsdir('/etc/ssl/acme') ?? [])) {
		let m = match(f, /^(.+)\.fullchain\.crt$/);
		if (!m)
			continue;
		let c = `/etc/ssl/acme/${f}`, k = `/etc/ssl/acme/${m[1]}.key`;
		if (!file_exists(k))
			continue;
		let sans = sh_out(`openssl x509 -in ${q(c)} -noout -text 2>/dev/null | grep -o 'DNS:[^,]*'`) ?? '';
		push(out, { cert: c, key: k, names: filter(split(replace(sans, /DNS:/g, ''), /[ \t\r\n]+/), (x) => x != '') });
	}
	return out;
}

/** The ACME certificate that covers host (exact name or a wildcard), if any. */
function acme_cert_for(host) {
	for (let a in acme_certs())
		for (let n in a.names)
			if (n == host || (substr(n, 0, 2) == '*.' && index(host, '.') > 0 && substr(host, index(host, '.')) == substr(n, 1)))
				return a;
	return null;
}

/** Certificate the portal should use: configured, ACME for the host, or self-signed. */
export function portal_cert(s) {
	if (s.portal_cert && s.portal_key && file_exists(s.portal_cert) && file_exists(s.portal_key))
		return { cert: s.portal_cert, key: s.portal_key, self_signed: false };
	if (s.portal_host) {
		for (let base in [ `/etc/ssl/acme/${s.portal_host}`, `/etc/acme/${s.portal_host}_ecc/${s.portal_host}` ]) {
			let c = `${base}.fullchain.crt`, k = `${base}.key`;
			if (file_exists(c) && file_exists(k))
				return { cert: c, key: k, self_signed: false };
		}
		// An ACME certificate issued for several names, the portal's among them.
		let a = acme_cert_for(s.portal_host);
		if (a)
			return { cert: a.cert, key: a.key, self_signed: false };
	}
	let c = `${DATA_DIR}/portal.crt`, k = `${DATA_DIR}/portal.key`;
	if (!file_exists(c) || !file_exists(k)) {
		ensure_dir(DATA_DIR, 0o700);
		let cn = s.portal_host || 'dawnline';
		sh(`openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 3650 -subj ${q('/CN=' + cn)} -keyout ${k} -out ${c}`);
		system(`chmod 600 ${k}`);
	}
	return { cert: c, key: k, self_signed: true };
};

/* ---------- health ---------- */

function check(id, title, status, detail, fix) {
	return { id, title, status, detail: detail ?? '', fix: fix ?? null };
}

function udp_listening(port) {
	let hex = sprintf(':%04X ', port);
	for (let f in [ '/proc/net/udp', '/proc/net/udp6' ])
		if (index(readfile(f) ?? '', hex) >= 0)
			return true;
	return false;
}

function tcp_listening(port) {
	let hex = sprintf(':%04X ', port);
	for (let f in [ '/proc/net/tcp', '/proc/net/tcp6' ])
		for (let line in split(readfile(f) ?? '', '\n'))
			// state 0A = LISTEN
			if (index(line, hex) > 0 && match(line, / 0A /))
				return true;
	return false;
}

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

function resolve(host) {
	if (ip2int(host) != null)
		return [ host ];
	// Public resolvers first: local DNS often rewrites the router's own name
	// to its LAN address (split horizon).
	for (let srv in [ '1.1.1.1', '8.8.8.8', '127.0.0.1' ]) {
		let out = sh_out(`timeout 5 nslookup ${q(host)} ${srv} 2>/dev/null | awk '/^Address/ && NR>2 {print $NF}'`);
		let ips = out ? filter(split(out, '\n'), (x) => ip2int(x) != null) : [];
		if (length(ips))
			return ips;
	}
	return [];
}

function wan_ipv4(zone) {
	let st = live.iface_status(zone == 'wan' ? 'wan' : zone);
	return st?.['ipv4-address']?.[0]?.address;
}

/** The router's public IPv4 (the first server's WAN, else the wan interface). */
function router_wan(m) {
	for (let id, srv in m.servers)
		if (srv.private_key) {
			let a = net.wan_address(srv) ?? wan_ipv4(srv.wan_zone);
			if (a)
				return a;
		}
	return wan_ipv4('wan');
}

/*
 * Addresses the portal could use in links, found on the router: names in ACME
 * certificates, server endpoints, DDNS names, the current one, and the WAN IP.
 * Each says where it points and whether a certificate covers it.
 */
export function portal_candidates(m) {
	let wan = router_wan(m);
	let names = [];
	let add = (h) => {
		if (h && valid_host(h) && ip2int(h) == null && substr(h, 0, 2) != '*.' && index(names, h) < 0)
			push(names, h);
	};
	for (let a in acme_certs())
		for (let n in a.names)
			add(n);
	for (let id, srv in m.servers)
		add(srv.endpoint);
	let dc = cursor();
	if (dc.load('ddns'))
		dc.foreach('ddns', 'service', (sv) => {
			if (sv.enabled != '0') {
				add(sv.lookup_host);
				add(sv.domain);
			}
		});
	for (let h in core.portal_hosts(m))
		add(h);
	let out = [];
	for (let h in names) {
		let ips = resolve(h);
		push(out, { host: h, kind: 'name', ips, here: wan != null && index(ips, wan) >= 0,
			cloudflare: length(filter(ips, (x) => cloudflare_ip(x))) > 0, cert: acme_cert_for(h) != null });
	}
	if (wan)
		push(out, { host: wan, kind: 'ip', ips: [ wan ], here: true, cloudflare: false, cert: false });
	for (let ph in core.portal_hosts(m))
		if (ip2int(ph) != null && ph != wan)
			push(out, { host: ph, kind: 'ip', ips: [ ph ], here: false, cloudflare: false, cert: false });
	// Best first: here with a certificate, then here, then the rest.
	let score = (c) => (c.here ? 4 : 0) + (c.cert ? 2 : 0) + (c.kind == 'name' ? 1 : 0) - (c.cloudflare ? 8 : 0);
	return sort(out, (a, b) => score(b) - score(a));
};

function service_running(name, instance) {
	let s = sh_out(`ubus call service list '{"name":"${name}"}' 2>/dev/null`);
	if (!s)
		return false;
	try {
		let j = json(s);
		let inst = j?.[name]?.instances?.[instance];
		return !!inst?.running;
	}
	catch (e) {
		return false;
	}
}

function other_subnets(srv_id) {
	let out = [];
	let st = sh_out('ubus call network.interface dump 2>/dev/null');
	let d = st ? json(st) : null;
	let ours = {};
	let m = core.load();
	for (let id, s in m.servers)
		ours[s.ifname] = id;
	for (let i in d?.interface ?? []) {
		if (srv_id != null && ours[i.interface] == srv_id)
			continue;
		for (let a in i['ipv4-address'] ?? [])
			push(out, { iface: i.interface, cidr: `${a.address}/${a.mask}` });
	}
	return out;
}

export function used_subnets(except_srv) {
	return map(other_subnets(except_srv), (x) => x.cidr);
};

/**
 * Run all checks. Each result: { id, title, status: ok|warn|error|skip, detail, fix }.
 * `fix` names an action accepted by fix().
 */
/*
 * Policy rules that send the router's own (marked) traffic into a local table,
 * the way transparent proxies capture it: "pref 1000 fwmark 0x1 → table 100".
 */
function proxy_diverts() {
	let out = [];
	for (let line in split(sh_out('ip -4 rule show 2>/dev/null') ?? '', '\n')) {
		let mm = match(line, /^(\d+):.*fwmark (\S+).* lookup (\S+)/);
		if (!mm || +mm[1] >= 32766)
			continue;
		if (match(sh_out(`ip -4 route show table ${mm[3]} 2>/dev/null`) ?? '', /(^|\n)local default/))
			push(out, `pref ${mm[1]} fwmark ${mm[2]} → table ${mm[3]}`);
	}
	return out;
}

/** Our "answers leave by main" rule for this port (see apply.sync_reply_routes). */
function reply_rule(proto, port) {
	return index(sh_out('ip -4 rule show priority 90 2>/dev/null') ?? '', `ipproto ${proto} sport ${+port} lookup main`) >= 0;
}

function reply_check(id, title, proto, port, diverts) {
	let ok = reply_rule(proto, port);
	let via = length(diverts) ? ` A proxy on the router diverts its own traffic (${join(', ', diverts)}); these answers skip it.` : '';
	return check(id, title, ok ? 'ok' : (length(diverts) ? 'error' : 'warn'),
		ok ? `Answers from ${uc(proto)} ${port} go straight out.${via}`
			: length(diverts) ? `Answers from ${uc(proto)} ${port} can be swallowed by a proxy on the router (${join(', ', diverts)}): clients get no reply.`
			: `The rule that keeps answers from ${uc(proto)} ${port} out of proxies is missing.`,
		ok ? null : 'apply');
}

export function health(m) {
	let diverts = proxy_diverts();
	m ??= core.load();
	let out = [];
	let dmp = live.dump();

	let kmod = file_exists('/sys/module/amneziawg');
	let tools = file_exists('/usr/bin/awg');
	push(out, check('awg', 'AmneziaWG installed', kmod && tools ? 'ok' : 'error',
		kmod && tools ? 'Kernel module and awg tool present.' :
		(!tools ? 'amneziawg-tools is missing.' : 'The kmod-amneziawg module is not loaded.'), kmod && tools ? null : 'updates'));

	let y = localtime().year;
	push(out, check('clock', 'Clock is set', y >= 2025 ? 'ok' : 'error',
		y >= 2025 ? 'End dates and quotas use the router clock.' : 'The router clock looks wrong; end dates will misbehave. Check NTP.'));

	push(out, check('agent', 'Background agent running', service_running('dawnline', 'agent') ? 'ok' : 'error',
		'Counts traffic and enforces end dates and quotas.', service_running('dawnline', 'agent') ? null : 'restart'));

	if (!length(m.servers)) {
		push(out, check('server', 'Server configured', 'warn', 'Run the setup wizard on the Server tab.'));
		return out;
	}

	let nft_ok = system('nft list table inet dawnline >/dev/null 2>&1') == 0;
	push(out, check('nft', 'Access rules loaded', nft_ok ? 'ok' : 'error',
		nft_ok ? 'Table inet dawnline enforces who may reach LAN and the internet.' : 'Table inet dawnline is missing: access is not enforced.',
		nft_ok ? null : 'apply'));

	let fwc = cursor();
	fwc.load('firewall');

	for (let id, srv in m.servers) {
		let label = length(m.servers) > 1 ? ` (${srv.name})` : '';
		if (!srv.enabled) {
			push(out, check(`srv_${id}`, `Server${label}`, 'skip', 'Server is disabled.'));
			continue;
		}
		let st = live.iface_status(srv.ifname);
		let up = !!st?.up;
		push(out, check(`up_${id}`, `Tunnel interface up${label}`, up ? 'ok' : 'error',
			up ? `${srv.ifname} is up, listening on UDP ${srv.port}.` :
			(st ? `${srv.ifname} is down${st.errors ? ': ' + join(', ', map(st.errors, (e) => e.code)) : ''}.` : `${srv.ifname} does not exist.`),
			up ? null : (st ? 'ifup:' + srv.ifname : 'apply')));

		if (up) {
			let expected = 0;
			let states = apply.states_for(m, core.load_usage());
			for (let did, d in m.devices)
				if (m.people[d.person]?.server == id && !d.disabled && states[d.person] == 'active')
					expected++;
			let actual = 0;
			for (let k, p in dmp.peers)
				if (p.ifname == srv.ifname)
					actual++;
			push(out, check(`peers_${id}`, `Devices loaded${label}`, expected == actual ? 'ok' : 'warn',
				`${actual} of ${expected} active devices are loaded in the tunnel.`, expected == actual ? null : 'sync'));
		}

		let rule = fwc.get('firewall', `dawnline_${id}_port`) == 'rule';
		let zone = fwc.get('firewall', `dawnline_${id}_zone`) == 'zone';
		push(out, check(`fw_${id}`, `Firewall${label}`, rule && zone ? 'ok' : 'error',
			rule && zone ? `Zone ${srv.ifname} and the WAN rule for UDP ${srv.port} exist.` : 'Firewall zone or WAN rule is missing.',
			rule && zone ? null : 'apply'));
		push(out, reply_check(`reply_${id}`, `Answers reach clients${label}`, 'udp', srv.port, diverts));

		// Port collisions with other tunnels.
		let clash = [];
		let nc = cursor();
		nc.load('network');
		nc.foreach('network', 'interface', (s) => {
			if (s['.name'] != srv.ifname && (s.proto == 'amneziawg' || s.proto == 'wireguard') && +s.listen_port == srv.port)
				push(clash, s['.name']);
		});
		if (length(clash))
			push(out, check(`port_${id}`, `Port is free${label}`, 'error', `UDP ${srv.port} is also used by ${join(', ', clash)}.`));

		let overlaps = [];
		let sc = parse_cidr(srv.subnet);
		for (let o in other_subnets(id)) {
			let oc = parse_cidr(o.cidr);
			if (sc && oc && cidr_overlaps(sc, oc))
				push(overlaps, `${o.iface} (${o.cidr})`);
		}
		push(out, check(`subnet_${id}`, `Subnet is unique${label}`, length(overlaps) ? 'error' : 'ok',
			length(overlaps) ? `${srv.subnet} overlaps ${join(', ', overlaps)}.` : `${srv.subnet} does not overlap other networks.`));

		let host = core.endpoint_host(m, srv);
		if (!host)
			push(out, check(`ep_${id}`, `Public address${label}`, 'error', 'No endpoint hostname: clients will not know where to connect.'));
		else {
			let ips = resolve(host);
			let wan = net.wan_address(srv) ?? wan_ipv4(srv.wan_zone);
			let wc = wan ? ip2int(wan) : null;
			let cgnat = wc != null && (in_cidr(wc, parse_cidr('100.64.0.0/10')) || in_cidr(wc, parse_cidr('10.0.0.0/8')) ||
				in_cidr(wc, parse_cidr('172.16.0.0/12')) || in_cidr(wc, parse_cidr('192.168.0.0/16')));
			let stv = 'ok', det;
			if (!length(ips)) {
				stv = 'error';
				det = `${host} does not resolve.`;
			}
			else if (cgnat) {
				stv = 'warn';
				det = `WAN address ${wan} is private: forward UDP ${srv.port} on the upstream router, or clients cannot connect.`;
			}
			else if (length(filter(ips, (a) => cloudflare_ip(a))))
				det = `${host} → ${join(', ', ips)} (Cloudflare). The tunnel is UDP: it reaches the router only if this name is DNS-only there.`;
			else if (wan && index(ips, wan) < 0) {
				stv = 'warn';
				det = `${host} resolves to ${join(', ', ips)}, but the WAN address is ${wan}. Check your DNS / DDNS.`;
			}
			else
				det = `${host} → ${join(', ', ips)}`;
			push(out, check(`ep_${id}`, `Public address${label}`, stv, det));
		}

		if (srv.lan_like) {
			let ls = loop.status();
			let nh = needs().home;
			push(out, check(`home_${id}`, `Internet like a home device${label}`, ls.active && ls.bridged ? 'ok' : 'warn',
				ls.active && ls.bridged ? `Traffic enters ${ls.dev} as ${ls.address}, so it is handled like any device on your LAN.` :
				length(nh) ? `Needs ${join(' and ', nh)}. Internet traffic leaves through WAN directly until then.` :
				ls.active ? `The link is up but not attached to ${ls.dev}.` :
				`${ls.error ?? 'Not set up.'} Internet traffic leaves through WAN directly.`,
				ls.active && ls.bridged ? null : length(nh) ? 'install:home' : 'apply'));
		}
	}

	if (length(filter(values(m.servers), (x) => x.private_key))) {
		let rt = loop.resolver_target();
		let ok = stat(loop.RESOLVER.conf) != null && loop.resolver_running();
		push(out, check('resolver', 'DNS for Home-only devices', ok ? 'ok' : 'warn',
			ok ? (rt.mode == 'ns' ? `Plain resolver running next to the LAN (${rt.address}).` : `Plain resolver on port ${rt.port}.`)
				: 'The resolver is not running; Home-only devices cannot resolve names.', ok ? null : 'apply'));
	}

	let s = m.settings;
	let need = needs();
	if (s.portal_enabled && length(need.https))
		push(out, check('portal', 'Personal portal', 'error',
			`HTTPS isn't available on this router: install ${join(' and ', need.https)}.`, 'install:https'));
	else if (s.portal_enabled) {
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
			let ips = resolve(s.portal_host), wan = router_wan(m);
			let cf = filter(ips, (x) => cloudflare_ip(x));
			push(out, check('portal_dns', 'Portal address points here', !length(ips) ? 'error' : length(cf) ? 'ok' : wan && index(ips, wan) < 0 ? 'warn' : 'ok',
				!length(ips) ? `${s.portal_host} does not resolve.` :
				length(cf) ? `${s.portal_host} goes through Cloudflare; in Russia such connections often stall after ~16 KB.` :
				wan && index(ips, wan) < 0 ? `${s.portal_host} points at ${join(', ', ips)}, not this router (${wan}).` :
				`${s.portal_host} → ${join(', ', ips)}${wan ? ' (this router)' : ''}.`));
		}
		push(out, reply_check('portal_reply', 'Portal answers reach visitors', 'tcp', s.portal_port, diverts));
		if (core.portal_http(m)) {
			let ipl = filter(core.portal_hosts(m), (h) => ip2int(h) != null);
			push(out, check('portal_http', 'Plain HTTP links', 'warn',
				`Links on ${join(', ', ipl)} use plain HTTP: the link and the VPN keys in configurations travel unencrypted.`));
		}

		// Links on 443: forwarded from outside, and the same link at home through LuCI's web server.
		let pub = core.portal_public_port(m);
		if (s.portal_port != 443) {
			if (!s.portal_443)
				push(out, check('portal_443', 'Links without a port', 'skip',
					`Off: links use port ${s.portal_port}. Mobile networks often drop HTTPS on ports other than 443.`));
			else if (pub != 443)
				push(out, check('portal_443', 'Links without a port', 'warn',
					`TCP 443 is already forwarded to another device, so links use port ${s.portal_port}.`));
			else {
				let fw = system(`nft list ruleset 2>/dev/null | grep -q 'Dawnline-Portal-443'`) == 0;
				push(out, check('portal_443', 'Links without a port', fw ? 'ok' : 'error',
					fw ? `From the internet TCP 443 reaches the portal only (LuCI stays closed there).` : 'The 443 forward to the portal is missing.',
					fw ? null : 'apply'));
				let uc_ = cursor();
				uc_.load('uhttpd');
				let ep = uc_.get('uhttpd', 'main', 'error_page');
				let mine = ep == '/cgi-bin/dawnline-portal' && stat('/www/cgi-bin/dawnline-portal') != null;
				push(out, check('portal_lan', 'Same link at home', mine ? 'ok' : ep ? 'warn' : 'error',
					mine ? 'At home the link opens through LuCI\'s web server, which hands unknown paths to the portal.'
						: ep ? `LuCI's web server already uses ${ep} for unknown paths, so at home links need :${s.portal_port}.`
						: 'LuCI\'s web server does not hand portal links to the portal: at home they show Not found.',
					mine || ep ? null : 'apply'));
			}
		}

		let cert = portal_cert(s);
		if (ip2int(s.portal_host) != null)
			push(out, check('cert', 'Portal certificate', 'skip', 'The main address is an IP: its links use plain HTTP.'));
		else {
		let ok = system(`openssl x509 -checkend 1209600 -noout -in ${q(cert.cert)} >/dev/null 2>&1`) == 0;
		let sans = cert.self_signed ? [] : split(replace(sh_out(`openssl x509 -in ${q(cert.cert)} -noout -text 2>/dev/null | grep -o 'DNS:[^,]*'`) ?? '', /DNS:/g, ''), /[ \t\r\n]+/);
		let covers = !s.portal_host || cert.self_signed || index(sans, s.portal_host) >= 0 ||
			length(filter(sans, (n) => substr(n, 0, 2) == '*.' && substr(s.portal_host, index(s.portal_host, '.')) == substr(n, 1)));
		push(out, check('cert', 'Portal certificate', cert.self_signed || !ok || !covers ? 'warn' : 'ok',
			cert.self_signed ? `Using a self-signed certificate: browsers will show a warning.${length(need.acme) ? ' ACME can get a free Let’s Encrypt one.' : ''}` :
			!covers ? `${cert.cert} does not cover ${s.portal_host} (it has ${join(', ', sans)}): browsers will warn.` :
			ok ? `${cert.cert} covers ${s.portal_host} and is valid for more than 14 days.` : `${cert.cert} expires within 14 days.`));
		}
	}

	return out;
};

export function fix(id) {
	if (id == 'apply')
		return apply.apply();
	if (id == 'sync')
		return apply.sync();
	if (id == 'restart')
		return { code: system('/etc/init.d/dawnline restart >/dev/null 2>&1') };
	let m = match(id ?? '', /^ifup:([a-z][a-z0-9_]{0,11})$/);
	if (m) {
		system(`ifup ${q(m[1])}`);
		return { ok: true };
	}
	die('Unknown fix.');
};

/* ---------- backups ---------- */

function backup_files() {
	let out = [ '/etc/config/dawnline' ];
	for (let f in [ 'usage.json', 'events.json' ])
		if (file_exists(`${DATA_DIR}/${f}`))
			push(out, `${DATA_DIR}/${f}`);
	return out;
}

export function backup_list() {
	let out = [];
	for (let f in lsdir(BACKUP_DIR) ?? []) {
		let mm = match(f, /^dawnline-([0-9]{8}-[0-9]{6})(-([a-z0-9-]+))?\.tar\.gz$/);
		if (!mm)
			continue;
		let st = stat(`${BACKUP_DIR}/${f}`);
		push(out, { name: f, created: st?.mtime ?? 0, size: st?.size ?? 0, reason: mm[3] ?? 'manual' });
	}
	return sort(out, (a, b) => b.created - a.created);
};

export function backup_create(reason) {
	// Flush live counters first so the backup has current usage.
	let u = read_json(`${RUN_DIR}/usage.json`, null);
	if (u)
		write_json(`${DATA_DIR}/usage.json`, u, 0o600);
	live.persist_events();
	ensure_dir(BACKUP_DIR, 0o700);
	let t = localtime();
	let tag = reason && match(reason, /^[a-z0-9-]{1,24}$/) ? `-${reason}` : '';
	let name = sprintf('dawnline-%04d%02d%02d-%02d%02d%02d%s.tar.gz', t.year, t.mon, t.mday, t.hour, t.min, t.sec, tag);
	let files = join(' ', map(backup_files(), (f) => q(substr(f, 1))));
	let r = sh(`tar -czf ${q(BACKUP_DIR + '/' + name)} -C / ${files}`);
	if (r.code != 0)
		die(`Backup failed: ${trim(r.out)}`);
	system(`chmod 600 ${q(BACKUP_DIR + '/' + name)}`);
	let all = backup_list();
	for (let i = KEEP_BACKUPS; i < length(all); i++)
		unlink(`${BACKUP_DIR}/${all[i].name}`);
	return name;
};

function backup_path(name) {
	if (!match(name ?? '', /^dawnline-[0-9]{8}-[0-9]{6}(-[a-z0-9-]+)?\.tar\.gz$/))
		die('Invalid backup name.');
	let p = `${BACKUP_DIR}/${name}`;
	if (!file_exists(p))
		die('Backup not found.');
	return p;
}

/** Validate an archive: only Dawnline's own files may be inside. */
function check_archive(path) {
	let r = sh(`tar -tzf ${q(path)}`);
	if (r.code != 0)
		die('Not a valid backup archive.');
	let allowed = { 'etc/config/dawnline': true };
	let has_config = false;
	for (let f in split(trim(r.out), '\n')) {
		f = replace(f, /^\.?\//, '');
		// The config plus Dawnline's own data files (older versions had more of them).
		if (!allowed[f] && !match(f, /^etc\/dawnline\/[a-z0-9_-]+\.json$/))
			die(`Unexpected file in backup: ${f}`);
		if (f == 'etc/config/dawnline')
			has_config = true;
	}
	if (!has_config)
		die('Backup does not contain /etc/config/dawnline.');
}

export function backup_restore(name, path) {
	path ??= backup_path(name);
	check_archive(path);
	backup_create('pre-restore');
	let r = sh(`tar -xzf ${q(path)} -C /`);
	if (r.code != 0)
		die(`Restore failed: ${trim(r.out)}`);
	system('chmod 600 /etc/config/dawnline');
	// Live counters must follow the restored file.
	unlink(`${RUN_DIR}/usage.json`);
	unlink(`${RUN_DIR}/events.json`);
	return apply.apply();
};

export function backup_delete(name) {
	unlink(backup_path(name));
	return true;
};

export function backup_read(name) {
	return b64enc(readfile(backup_path(name)));
};

export function backup_upload(data_b64) {
	let data = b64dec(data_b64 ?? '');
	if (!data || length(data) > 4 * 1024 * 1024)
		die('Upload is empty or too large.');
	ensure_dir(RUN_DIR);
	let tmp = `${RUN_DIR}/upload.tar.gz`;
	write_file(tmp, data);
	let res;
	try {
		res = backup_restore(null, tmp);
	}
	catch (e) {
		unlink(tmp);
		die(e.message);
	}
	unlink(tmp);
	return res;
};

/* ---------- export / import (JSON) ---------- */

export function export_json() {
	let c = cursor();
	c.load('dawnline');
	let sections = [];
	c.foreach('dawnline', null, (s) => {
		let o = { '.type': s['.type'], '.name': s['.name'] };
		for (let k, v in s)
			if (substr(k, 0, 1) != '.')
				o[k] = v;
		push(sections, o);
	});
	return { format: 'dawnline', version: VERSION, exported: time(), sections };
};

export function import_json(data) {
	if (type(data) != 'object' || data.format != 'dawnline' || type(data.sections) != 'array')
		die('Not a Dawnline export.');
	let types = { settings: true, server: true, person: true, device: true, service: true };
	for (let s in data.sections) {
		if (!types[s['.type']] || !match(s['.name'] ?? '', /^[A-Za-z0-9_]{1,64}$/))
			die(`Invalid section ${s['.name']}.`);
		for (let k, v in s)
			if (substr(k, 0, 1) != '.' && (!match(k, /^[a-z0-9_]{1,32}$/) || (type(v) != 'string' && type(v) != 'array')))
				die(`Invalid option ${k}.`);
	}
	backup_create('pre-import');
	let lines = [];
	for (let s in data.sections) {
		push(lines, `config ${s['.type']} '${s['.name']}'`);
		for (let k, v in s) {
			if (substr(k, 0, 1) == '.')
				continue;
			let esc = (x) => replace(`${x}`, "'", "'\\''");
			if (type(v) == 'array')
				for (let x in v)
					push(lines, `\tlist ${k} '${esc(x)}'`);
			else
				push(lines, `\toption ${k} '${esc(v)}'`);
		}
		push(lines, '');
	}
	write_file('/etc/config/dawnline', join('\n', lines), 0o600);
	return apply.apply();
};
