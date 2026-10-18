// Dawnline — the AmneziaWG core: keys, disguise (obfuscation), client
// configurations (.conf, AmneziaVPN key), the netifd options of a server's
// tunnel, its peers (`awg syncconf`, no restart), live counters and what the
// watchdog and Health check about it. Plain WireGuard is AmneziaWG with the
// disguise off.

import { readfile, stat, unlink } from 'fs';
import {
	q, sh, sh_out, rand_int, rand_bytes, valid_key, ip2int, ensure_dir, write_file, read_json, write_json, lock, unlock,
	slog, iface_status, DATA_DIR, RUN_DIR
} from 'dawnline.util';
import * as core from 'dawnline.core';
import * as net from 'dawnline.net';
import * as pkg from 'dawnline.pkg';
import * as builds from 'dawnline.awg_builds';

/** Names in .conf files (and AmneziaVPN keys); netifd uses `awg_<key>`. */
export const OBF_CONF = {
	jc: 'Jc', jmin: 'Jmin', jmax: 'Jmax', s1: 'S1', s2: 'S2', s3: 'S3', s4: 'S4',
	h1: 'H1', h2: 'H2', h3: 'H3', h4: 'H4', i1: 'I1', i2: 'I2', i3: 'I3', i4: 'I4', i5: 'I5',
	header_protection_key: 'HeaderProtectionKey', content_padding_addition: 'ContentPaddingAddition',
	rekey_after_time: 'RekeyAfterTime', rekey_timeout: 'RekeyTimeout', reject_after_time: 'RejectAfterTime',
	keepalive_timeout: 'KeepaliveTimeout', max_handshake_attempts: 'MaxHandshakeAttempts',
	random_trailers: 'RandomTrailers', disable_cookies: 'DisableCookies',
};

const TOOL = '/usr/bin/awg', PROTO = '/lib/netifd/proto/amneziawg.sh';
/** The packages AmneziaWG comes in (the Components tab installs them). */
const PACKAGES = [ 'kmod-amneziawg', 'amneziawg-tools' ];

/** netifd knows the amneziawg protocol (it reads the proto scripts when it starts). */
function proto_handler() {
	try {
		return 'amneziawg' in (json(sh_out('ubus call network get_proto_handlers 2>/dev/null') || '{}') ?? {});
	}
	catch (e) {
		return false;
	}
}

/**
 * What of AmneziaWG is on the router:
 *   tools    the awg tool and the netifd protocol script (amneziawg-tools)
 *   kmod     the kernel module, loaded or on disk for the running kernel
 *   loaded   the module is loaded
 *   handler  netifd lists the amneziawg protocol
 *   missing  packages that are not installed; ok: everything is in place
 */
export function state() {
	let tools = stat(TOOL) != null && stat(PROTO) != null;
	let loaded = stat('/sys/module/amneziawg') != null;
	let rel = trim(readfile('/proc/sys/kernel/osrelease') ?? '');
	let kmod = loaded || (rel != '' && stat(`/lib/modules/${rel}/amneziawg.ko`) != null);
	let handler = tools && proto_handler();
	let missing = filter(PACKAGES, (p) => p == 'kmod-amneziawg' ? !kmod : !tools);
	return { tools, kmod, loaded, handler, missing, ok: !length(missing) && loaded && handler };
};

/**
 * state(), after loading an installed module that isn't loaded yet: nothing loads
 * it before the first tunnel comes up, so "not loaded" alone is no fault.
 */
export function load() {
	let s = state();
	if (!s.kmod || s.loaded)
		return s;
	system('modprobe amneziawg >/dev/null 2>&1');
	return state();
};

/** The kernel module and the awg tool are on the router. */
export function installed() {
	let s = state();
	return s.tools && s.kmod;
};

/* ---------- keys ---------- */

export function genkey() {
	return sh_out('awg genkey');
};

export function pubkey(priv) {
	if (!valid_key(priv))
		return null;
	return sh_out(`printf %s ${q(priv)} | awg pubkey`);
};

/** A preshared key is 32 random bytes: no tool needed (`awg genpsk` does the same). */
export function genpsk() {
	return b64enc(rand_bytes(32));
};

/**
 * Keys for a new device. With `public_key` (made in the browser) the private
 * key never reaches the router. Never without a preshared key.
 */
export function new_keys(public_key) {
	let psk = genpsk();
	if (!valid_key(psk))
		die('Key generation failed (no random data).');
	if (public_key) {
		if (!valid_key(public_key))
			die('Invalid public key.');
		return { public_key, preshared_key: psk };
	}
	let priv = genkey(), pub = pubkey(priv);
	if (!pub)
		die('Key generation failed (is amneziawg-tools installed?).');
	return { private_key: priv, public_key: pub, preshared_key: psk };
};

/** A server's own key pair (set up once, on the server). */
export function server_keys() {
	let priv = genkey(), pub = pubkey(priv);
	if (!pub)
		die('Key generation failed (is amneziawg-tools installed?).');
	return { private_key: priv, public_key: pub };
};

/* ---------- obfuscation ---------- */

// Junk packets may be tiny (the 3.1 preset sends 10-50 bytes, as AmneziaVPN
// does); the ceiling keeps them under the path MTU.
const OBF_SPEC = { jc: [ 0, 10 ], jmin: [ 0, 1024 ], jmax: [ 0, 1024 ], s1: [ 0, 64 ], s2: [ 0, 64 ], s3: [ 0, 64 ], s4: [ 0, 32 ] };

function rand_h(used) {
	for (let i = 0; i < 50; i++) {
		let v = rand_int(5, 2147483647);
		if (!used[v]) {
			used[v] = true;
			return `${v}`;
		}
	}
}

// caps() answers from here while the tool, the protocol script and the module file are the same.
const CAPS = `${RUN_DIR}/awg-caps.json`;

/**
 * What the installed AmneziaWG can do: the netifd protocol script (the
 * options it passes on) and the `awg` tool (the keys it accepts) say what the
 * tools know, the kernel module's package version what the kernel runs, and
 * a feature counts only when both have it (tools 3.1 over a 2.0 module would
 * configure header protection that the kernel silently lacks):
 *   v2 — S3/S4, I1-I5, header ranges (AWG 1.5/2.0)
 *   v3 — header protection, trailers, padding, timing (AWG 3.1)
 *   tools / kmod — their generations ('1.0', '2.0', '3.1'; null unknown)
 *   mismatch — the two differ
 */
export function caps() {
	let rel = trim(readfile('/proc/sys/kernel/osrelease') ?? '');
	let key = `${stat(`/lib/modules/${rel}/amneziawg.ko`)?.mtime ?? 0}/${stat(TOOL)?.mtime ?? 0}/${stat(PROTO)?.mtime ?? 0}`;
	let cached = read_json(CAPS, null);
	if (cached?.key == key && cached.caps)
		return cached.caps;
	let script = readfile(PROTO) ?? '';
	let tool = sh_out("grep -a -o -m1 'HeaderProtectionKey' /usr/bin/awg 2>/dev/null") ?? '';
	let t2 = index(script, 'awg_s3') >= 0 && index(script, 'awg_i1') >= 0;
	let t3 = t2 && index(script, 'awg_header_protection_key') >= 0 && tool != '';
	let tools = !stat(TOOL) ? null : t3 ? '3.1' : t2 ? '2.0' : '1.0';
	// A module installed by hand has no package: then the tools are believed.
	let kmod = builds.gen(pkg.version('kmod-amneziawg'));
	let out = {
		v2: t2 && (kmod == null || kmod != '1.0'),
		v3: t3 && (kmod == null || kmod == '3.1'),
		tools, kmod, mismatch: tools != null && kmod != null && tools != kmod,
	};
	ensure_dir(RUN_DIR);
	write_json(CAPS, { key, caps: out }, 0o644);
	return out;
};

/**
 * Why this AmneziaWG cannot run a server's disguise values, or null: a 3.1
 * preset after a rollback to a 2.0 build would come up without the header
 * protection every device expects, so such a server is kept down instead
 * (dawnline.netifd).
 */
export function obf_unsupported(o) {
	let c = caps();
	let has = (keys) => length(filter(keys, (k) => o?.[k] != null && o[k] != '')) > 0;
	let v3 = [ 'header_protection_key', 'content_padding_addition', 'rekey_after_time', 'rekey_timeout', 'reject_after_time',
		'keepalive_timeout', 'max_handshake_attempts', 'random_trailers', 'disable_cookies' ];
	let v2 = [ 's3', 's4', 'i1', 'i2', 'i3', 'i4', 'i5' ];
	let ranged = length(filter([ 'h1', 'h2', 'h3', 'h4' ], (k) => match(`${o?.[k] ?? ''}`, /-/))) > 0;
	if (has(v3) && !c.v3)
		return `its disguise needs AmneziaWG 3.1 (installed: ${c.kmod ?? c.tools ?? 'none'})`;
	if ((has(v2) || ranged) && !c.v2)
		return `its disguise needs AmneziaWG 2.0 (installed: ${c.kmod ?? c.tools ?? 'none'})`;
	return null;
};

/**
 * Signature packets shaped like DNS, made fresh for each server: the same
 * fixed bytes on every router (AmneziaVPN's own 3.1 default is one constant
 * answer about icloud.com) would be one rule for a DPI to match. A query and
 * an answer about a name of this server's own, with its own TTL and address.
 *   <r N> random bytes, <rc N> random letters, <b 0x..> fixed bytes
 */
function dns_name_hex() {
	let hex = (s) => {
		let out = '';
		for (let i = 0; i < length(s); i++)
			out += sprintf('%02x', ord(s, i));
		return out;
	};
	let tld = [ 'com', 'net', 'org', 'io' ][rand_int(0, 3)];
	let n = rand_int(5, 9);
	return { labels: `<b 0x${sprintf('%02x', n)}><rc ${n}><b 0x${sprintf('%02x', length(tld))}${hex(tld)}00>`, len: n + length(tld) + 2 };
}

function dns_query() {
	let name = dns_name_hex();
	// id, flags (standard query, recursion desired), 1 question, name, type A, class IN
	return `<r 2><b 0x01000001000000000000>${name.labels}<b 0x00010001>`;
}

function dns_answer() {
	let name = dns_name_hex();
	let ttl = sprintf('%08x', rand_int(300, 86400));
	// id, flags (answer, authoritative, recursion), 1 question, 1 answer, name, A IN, pointer, A IN, ttl, 4 bytes
	return `<r 2><b 0x85800001000100000000>${name.labels}<b 0x00010001c00c00010001${ttl}0004><r 4>`;
}

/**
 * Generate obfuscation parameters for a method:
 *   off      plain WireGuard-compatible packets
 *   standard junk packets and random headers (any AmneziaWG client)
 *   strong   more and larger junk (any AmneziaWG client)
 *   max      AmneziaWG 3.1: protected headers, random trailers, padding,
 *            jittered timers and a DNS-like first packet — the values
 *            AmneziaVPN itself uses for 3.1 servers
 */
export function obf_preset(name) {
	if (name == 'max')
		return {
			jc: `${rand_int(4, 6)}`, jmin: '10', jmax: '50',
			s1: '12', s2: '12', s3: '12', s4: '12',
			h1: '1', h2: '2', h3: '3', h4: '4',
			i1: dns_query(), i2: dns_answer(),
			header_protection_key: sh_out('awg genkey'),
			content_padding_addition: '10-100',
			rekey_after_time: '100-120', rekey_timeout: '3-7', reject_after_time: '150-180',
			keepalive_timeout: '5-15', max_handshake_attempts: '15-20',
			random_trailers: 'on', disable_cookies: 'on',
		};
	if (name == 'off')
		return { jc: '0', jmin: '0', jmax: '0', s1: '0', s2: '0', h1: '1', h2: '2', h3: '3', h4: '4' };
	let strong = name == 'strong';
	let o = {};
	o.jc = `${strong ? rand_int(6, 10) : rand_int(3, 6)}`;
	let jmin = rand_int(64, strong ? 128 : 96);
	o.jmin = `${jmin}`;
	o.jmax = `${jmin + rand_int(strong ? 200 : 32, strong ? 600 : 160)}`;
	let s1 = rand_int(15, 64), s2 = rand_int(15, 64);
	while (s1 + 56 == s2)
		s2 = rand_int(15, 64);
	o.s1 = `${s1}`;
	o.s2 = `${s2}`;
	let used = {};
	for (let k in [ 'h1', 'h2', 'h3', 'h4' ])
		o[k] = rand_h(used);
	return o;
};

export function obf_errors(o) {
	let errs = [];
	for (let k, r in OBF_SPEC) {
		let v = o[k];
		if (v == null || v == '')
			continue;
		if (!match(v, /^[0-9]+$/) || +v < r[0] || +v > r[1])
			push(errs, `${k}=${v} (${r[0]}-${r[1]})`);
	}
	if (o.jmin != null && o.jmax != null && +o.jmin > +o.jmax)
		push(errs, 'jmin > jmax');
	if (o.s1 != null && o.s2 != null && +o.s1 + 56 == +o.s2)
		push(errs, 's1 + 56 = s2');
	let hs = {};
	for (let k in [ 'h1', 'h2', 'h3', 'h4' ]) {
		let v = o[k];
		if (v == null || v == '')
			continue;
		if (!match(v, /^[0-9]+(-[0-9]+)?$/))
			push(errs, `${k} must be a number or range`);
		else if (hs[v])
			push(errs, 'h1-h4 must be distinct');
		hs[v] = true;
	}
	return errs;
};



export function allowed_ips(m, srv, p) {
	if (p.access == 'lan') {
		let nets = core.person_home(srv, p).nets;
		// With devices reaching each other, the whole tunnel network (the router's
		// address is in it); otherwise only the router's own address.
		let a = core.server_address(srv);
		if (srv.device_mesh && srv.subnet)
			push(nets, srv.subnet);
		else if (a)
			push(nets, `${a}/32`);
		// The resolver address must be reachable through the tunnel too (not the fallback).
		let dns = core.client_dns(m, srv, p)[0];
		if (dns)
			push(nets, `${dns}/32`);
		return net.collapse(nets);
	}
	return [ '0.0.0.0/0', '::/0' ];
};


/** True when the obfuscation settings change nothing on the wire (plain WireGuard). */
export function obf_neutral(o) {
	for (let k in core.OBF_KEYS) {
		let v = o?.[k];
		if (v == null || v == '')
			continue;
		let want = { h1: '1', h2: '2', h3: '3', h4: '4' }[k] ?? '0';
		if (`${v}` != want)
			return false;
	}
	return true;
};

/*
 * The .conf file name doubles as the tunnel name in WireGuard apps (15
 * characters at most): the device first, so a person's devices stay apart,
 * and a number when the cut would still make two of them alike.
 */
function conf_filename(m, p, dev) {
	let label = (d) => trim(substr(trim(replace(lc(d.name + '-' + p.id), /[^a-z0-9]+/g, '-'), '-'), 0, 15), '-');
	let order = sort(map(p.devices, (id) => m.devices[id]),
		(a, b) => (a.created - b.created) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	let seen = {};
	for (let d in order) {
		let l = label(d);
		let n = seen[l] = (seen[l] ?? 0) + 1;
		if (d.id == dev.id)
			return (n > 1 ? trim(substr(l, 0, 15 - length(`-${n}`)), '-') + `-${n}` : l) + '.conf';
	}
	return label(dev) + '.conf';
}

export function client_config(m, dev) {
	let p = m.people[dev.person];
	let srv = p ? m.servers[p.server] : null;
	if (!srv)
		return null;
	let host = core.endpoint_host(m, srv);
	let ep = match(host, /:/) && !match(host, /^\[/) ? `[${host}]` : host;
	let allowed = allowed_ips(m, srv, p);
	let dns = core.client_dns(m, srv, p);
	let mtu = core.device_mtu(srv, dev);
	let lines = [ '[Interface]' ];
	push(lines, `PrivateKey = ${dev.private_key || '<private key stays on your device>'}`);
	push(lines, `Address = ${dev.address}/32`);
	if (length(dns))
		push(lines, `DNS = ${join(', ', dns)}`);
	push(lines, `MTU = ${mtu}`);
	// "Off" is plain WireGuard: neutral values (no junk, H1-H4 = 1-4) are left
	// out, so any WireGuard app accepts the file.
	if (!obf_neutral(srv.obf))
		for (let k in core.OBF_KEYS)
			if (srv.obf[k] != null && srv.obf[k] != '')
				push(lines, `${OBF_CONF[k]} = ${srv.obf[k]}`);
	push(lines, '', '[Peer]');
	push(lines, `PublicKey = ${srv.public_key}`);
	if (dev.preshared_key)
		push(lines, `PresharedKey = ${dev.preshared_key}`);
	push(lines, `AllowedIPs = ${join(', ', allowed)}`);
	push(lines, `Endpoint = ${ep}:${srv.port}`);
	// With 3.1 (its apps take ranges) the keep-alive is jittered like the
	// other timers; a fixed beat would be the one regular thing left.
	if (srv.keepalive > 0)
		push(lines, `PersistentKeepalive = ${srv.obf.header_protection_key ? `${srv.keepalive}-${srv.keepalive + 10}` : srv.keepalive}`);
	return {
		name: dev.name,
		person: p.name,
		server: srv.name,
		filename: conf_filename(m, p, dev),
		conf: join('\n', lines) + '\n',
		has_private_key: dev.private_key != '',
		amnezia: {
			host,
			port: srv.port,
			mtu: `${mtu}`,
			dns,
			allowed_ips: allowed,
			client_ip: dev.address,
			client_priv_key: dev.private_key,
			client_pub_key: dev.public_key,
			psk_key: dev.preshared_key,
			server_pub_key: srv.public_key,
			persistent_keep_alive: `${srv.keepalive}`,
			obfuscation: srv.obf,
		},
	};
};




/* ---------- the server's tunnel ---------- */

/** netifd options of the server's interface (proto amneziawg). */
export function netifd_options(srv) {
	let addr = core.server_address(srv);
	let prefix = split(srv.subnet, '/')[1];
	let o = {
		proto: 'amneziawg',
		private_key: srv.private_key,
		listen_port: srv.port,
		addresses: [ `${addr}/${prefix}` ],
		mtu: core.tunnel_mtu(srv),
	};
	for (let k in core.OBF_KEYS)
		o[`awg_${k}`] = srv.obf[k];
	return o;
};

/** Push the peer list of every server to the kernel without restarting it. */
export function sync_peers(m, states) {
	ensure_dir(RUN_DIR);
	let res = {};
	for (let id, srv in m.servers) {
		// Only Dawnline's own interfaces: never another tunnel of the same name (core.tunnels).
		if (!srv.enabled || !length(core.tunnels(srv)))
			continue;
		if (system(`awg show ${q(srv.ifname)} public-key >/dev/null 2>&1`) != 0) {
			res[id] = 'down';
			continue;
		}
		let lines = [ '[Interface]', `PrivateKey = ${srv.private_key}`, `ListenPort = ${srv.port}`, '' ];
		for (let did, d in m.devices) {
			let p = m.people[d.person];
			// One malformed line makes syncconf refuse the whole server: such a device
			// stays out (Health's Data check names it).
			if (!p || p.server != id || d.disabled || states[p.id] != 'active' || !valid_key(d.public_key) || ip2int(d.address) == null)
				continue;
			push(lines, '[Peer]', `PublicKey = ${d.public_key}`);
			if (d.preshared_key)
				push(lines, `PresharedKey = ${d.preshared_key}`);
			push(lines, `AllowedIPs = ${d.address}/32`, '');
		}
		let f = `${RUN_DIR}/${srv.ifname}.conf`;
		write_file(f, join('\n', lines));
		let r = sh(`awg syncconf ${q(srv.ifname)} ${f}`);
		unlink(f);
		res[id] = r.code == 0 ? 'ok' : trim(r.out);
		if (r.code != 0)
			slog('awg', 'error', "couldn't load devices into the tunnel", trim(r.out), srv.name);
	}
	return res;
};

/**
 * Parse `awg show all dump`. Returns { ok, ifaces: { ifname: {...} }, peers: { pubkey: {...} } }.
 * Lines are told apart by their shape, not their length (each AmneziaWG
 * generation adds fields to the interface line): an interface line carries
 * its private and public key and a port, a peer line the peer's key, a
 * preshared key or "(none)" and an endpoint. The tool fails when any one
 * interface can't be read, but still prints the others: with `wanted` (the
 * ifnames that matter) `ok` means those were all read, so another tunnel's
 * trouble is not ours.
 */
export function dump(wanted) {
	let r = sh('awg show all dump');
	let out = { ok: r.code == 0, ifaces: {}, peers: {} };
	for (let line in split(r.out, '\n')) {
		let f = split(line, '\t');
		if (length(f) < 5 || !valid_key(f[1]))
			continue;
		if (valid_key(f[2]) && match(f[3] ?? '', /^[0-9]+$/))
			out.ifaces[f[0]] = { public_key: f[2], port: +f[3] };
		else if (length(f) >= 9 && (f[2] == '(none)' || valid_key(f[2]))) {
			let ep = f[3] == '(none)' ? '' : f[3];
			out.peers[f[1]] = {
				ifname: f[0],
				endpoint: ep,
				handshake: +f[5],
				rx: +f[6],
				tx: +f[7],
			};
		}
	}
	if (!out.ok && type(wanted) == 'array')
		out.ok = length(filter(wanted, (n) => !out.ifaces[n])) == 0;
	return out;
};

/** Is the server's tunnel up and listening (for status and Overview). */
export function server_state(srv) {
	let st = iface_status(srv.ifname);
	return { up: !!st?.up, uptime: st?.uptime ?? 0 };
};

/* ---------- watchdog ---------- */

/** Why a tunnel is down, from netifd and the last related syslog lines. */
export function iface_errors(ifname) {
	let s = iface_status(ifname);
	let errs = map(s?.errors ?? [], (e) => e.code + (length(e.data ?? []) ? ` (${join(' ', e.data)})` : ''));
	// Only what explains a failure, not the ordinary "is now up/down" lines.
	let lines = sh_out(`logread -l 400 2>/dev/null | grep -E ${q(`${ifname}|amneziawg`)} | grep -iE 'error|fail|invalid|unrecogni|cannot|unable|not found|refused|denied' | tail -n 6`);
	return join('\n', filter([ length(errs) ? `netifd: ${join(', ', errs)}` : null, lines ], (x) => x));
};

/**
 * What the watchdog looks at for AmneziaWG (see dawnline.watchdog):
 * AmneziaWG itself, then every running server's tunnel. `ctx.udp_listening`,
 * `ctx.reapply` and `ctx.owner` (dawnline.netifd) come from the watchdog
 * (ops, apply and netifd import this module).
 */
export function probes(m, ctx) {
	let out = [];
	let srvs = filter(values(m.servers), (x) => x.enabled && x.private_key);
	if (!length(srvs))
		return out;
	// AmneziaWG itself first: without it no tunnel can run (they come back on the next pass).
	// Missing packages and an unknown protocol are reported once; only the module can be loaded here.
	let st = state();
	let base = { id: 'awg', src: 'awg', name: 'AmneziaWG', who: 'AmneziaWG', back: 'is ready again' };
	if (!st.tools || !st.kmod) {
		push(out, { ...base, ok: false, repair: null,
			problem: `${st.tools ? "kernel module isn't" : "isn't"} installed: no tunnel can run — install it in Dawnline → Components`,
			detail: () => `Missing: ${join(', ', st.missing)}.` });
		return out;
	}
	push(out, { ...base, ok: st.loaded && st.handler,
		problem: !st.loaded ? "kernel module isn't loaded" : "isn't known to the network service — restart the network or reboot",
		detail: !st.loaded
			? () => sh_out("modprobe amneziawg 2>&1; dmesg 2>/dev/null | grep -i amneziawg | grep -iE 'error|fail|invalid|unknown|disagrees|taint' | tail -n 4")
			: () => 'netifd reads its protocol handlers when it starts; it was running before AmneziaWG was installed.',
		repair: !st.loaded ? { what: 'loading it', run: () => system('modprobe amneziawg >/dev/null 2>&1') } : null,
	});
	// Without the protocol handler ifup cannot work: the tunnels are not probed (or restarted) one by one.
	if (st.loaded && !st.handler)
		return out;
	for (let srv in srvs) {
		// A tunnel Dawnline may not set up (dawnline.netifd) is reported, never restarted:
		// an interface of the same name that isn't Dawnline's may be your LAN.
		let own = core.valid_ifname(srv.ifname) ? ctx.owner?.(srv.ifname) : null;
		let why = srv.blocked ?? (!core.valid_ifname(srv.ifname) ? `has an invalid interface name "${srv.ifname}"`
			: own != null && own != srv.id ? `can't use the network interface ${srv.ifname}: it exists and isn't Dawnline's` : null);
		if (why) {
			push(out, {
				id: `up_${srv.id}`, src: 'awg', name: `${srv.name} · AmneziaWG`, who: srv.name, ok: false, repair: null,
				problem: why, back: 'AmneziaWG is running again',
				detail: () => 'Choose another interface name in the server settings.',
			});
			continue;
		}
		let s = iface_status(srv.ifname);
		let up = !!s?.up;
		push(out, {
			id: `up_${srv.id}`, src: 'awg', name: `${srv.name} · AmneziaWG`, who: srv.name, ok: up && ctx.udp_listening(srv.port),
			problem: !s ? 'AmneziaWG is missing from the router' : !up ? "AmneziaWG isn't running" : `AmneziaWG isn't accepting connections on port ${srv.port}`,
			back: `AmneziaWG is running again · accepting connections on port ${srv.port}`,
			detail: () => iface_errors(srv.ifname),
			repair: s ? { what: 'restarting it', run: () => system(`ifup ${q(srv.ifname)}`) } : { what: 'setting it up again', run: ctx.reapply },
		});
	}
	return out;
};

/* ---------- issued configurations ---------- */

const ISSUED = `${DATA_DIR}/issued.json`;

function fnv32(str) {
	let h = 2166136261;
	for (let i = 0; i < length(str); i++)
		h = ((h ^ ord(str, i)) * 16777619) & 0xffffffff;
	return sprintf('%08x', h);
}

/** What a device holds, minus its private key: changes when it must import again. */
export function config_fingerprint(m, dev) {
	let c = dev ? client_config(m, dev) : null;
	return c ? fnv32(join('\n', filter(split(c.conf, '\n'), (l) => !match(l, /^PrivateKey/)))) : null;
};

/** Device id → fingerprint of the configuration last shown or downloaded. */
export function issued() {
	return read_json(ISSUED, {});
};

/** Remember that a device was just given its current configuration. */
export function mark_issued(m, id) {
	let fp = config_fingerprint(m, m.devices[id]);
	if (!fp)
		return;
	let l = lock('issued');
	let all = issued();
	if (all[id] != fp) {
		all[id] = fp;
		for (let k in keys(all))
			if (!m.devices[k])
				delete all[k];
		ensure_dir(DATA_DIR, 0o700);
		write_json(ISSUED, all, 0o600);
	}
	unlock(l);
};

