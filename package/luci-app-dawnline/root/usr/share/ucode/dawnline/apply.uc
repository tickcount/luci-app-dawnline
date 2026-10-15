// Dawnline — reconciliation. Turns /etc/config/dawnline into router state:
//   * network interfaces (proto amneziawg), peers applied live with `awg syncconf`
//   * firewall zones, forwardings and WAN rules (named sections dawnline_*)
//   * nft table `inet dawnline` enforcing each person's access
//   * hostnames in /tmp/hosts/dawnline
//   * the "like a home device" path and the Home-only resolver (dawnline.loop)
// Only objects created by Dawnline are ever modified.

import { cursor } from 'uci';
import { readfile, writefile, stat, unlink } from 'fs';
import {
	q, sh, sh_out, sh_bg, ensure_dir, write_file, write_json, read_json, parse_cidr, int2ip, uniq,
	lock, unlock, slog, iface_intent, RUN_DIR
} from 'dawnline.util';
import * as core from 'dawnline.core';
import * as net from 'dawnline.net';
import * as loop from 'dawnline.loop';

const HOSTS_FILE = '/tmp/hosts/dawnline';
/*
 * Our own answers leave by the main table: the portal's (TCP) and each
 * tunnel's (UDP). Proxies on the router (tproxy with an fwmark rule) may mark
 * the router's own traffic to internet addresses and divert it locally, which
 * swallows replies to outside clients. These rules sit before such fwmark
 * rules and only match our listening ports.
 */
const PREF_REPLY = 90;

function log(who, msg, level, detail) {
	slog('dawnline', level ?? 'info', msg, detail, who);
}

/* ---------- helpers ---------- */

/** Set an option only when it differs; returns true if something changed. */
function put(c, conf, sec, opt, val) {
	let cur = c.get(conf, sec, opt);
	if (val == null || val == '' || (type(val) == 'array' && !length(val))) {
		if (cur != null) {
			c.delete(conf, sec, opt);
			return true;
		}
		return false;
	}
	if (type(val) == 'array') {
		if (type(cur) == 'array' && join('\n', cur) == join('\n', val))
			return false;
	}
	else if (cur == `${val}`)
		return false;
	c.set(conf, sec, opt, type(val) == 'array' ? val : `${val}`);
	return true;
}

function ensure_section(c, conf, sec, stype) {
	if (c.get(conf, sec) == stype)
		return false;
	if (c.get(conf, sec) != null)
		c.delete(conf, sec);
	c.set(conf, sec, stype);
	return true;
}

/**
 * After committing a config ourselves (and applying it), record its new
 * checksum so a later `reload_config` does not treat it as changed and
 * restart unrelated services that reload on any network change.
 */
function ack_config(confs) {
	let md5f = '/var/run/config.md5';
	if (!stat(md5f))
		return;
	let lines = split(trim(readfile(md5f) ?? ''), '\n');
	for (let conf in confs) {
		let path = `/var/run/config.check/${conf}`;
		let sum = sh_out(`uci show ${q(conf)} | md5sum | cut -d' ' -f1`);
		if (!sum)
			continue;
		let found = false;
		for (let i = 0; i < length(lines); i++)
			if (substr(lines[i], -length(path) - 2) == `  ${path}`) {
				lines[i] = `${sum}  ${path}`;
				found = true;
			}
		if (!found)
			push(lines, `${sum}  ${path}`);
	}
	writefile(md5f, join('\n', lines) + '\n');
}

/* ---------- network ---------- */

function sync_network(m) {
	let c = cursor();
	c.load('network');
	let changed = false, touched = [];
	let want = {};

	for (let id, srv in m.servers) {
		if (!srv.private_key)
			continue;
		let ifn = srv.ifname;
		want[ifn] = true;
		let addr = core.server_address(srv);
		let pc = parse_cidr(srv.subnet);
		// Per server: with several, each changed one has to be brought up again.
		let mine = ensure_section(c, 'network', ifn, 'interface');
		let set = (opt, val) => {
			if (put(c, 'network', ifn, opt, val))
				mine = true;
		};
		set('proto', 'amneziawg');
		set('private_key', srv.private_key);
		set('listen_port', srv.port);
		set('addresses', [ `${addr}/${pc.prefix}` ]);
		set('mtu', srv.mtu);
		set('disabled', srv.enabled ? null : '1');
		set('auto', srv.enabled ? null : '0');
		set('_dawnline', id);
		// For the log once the server is gone.
		set('_dawnline_name', srv.name);
		for (let k in core.OBF_KEYS)
			set(`awg_${k}`, srv.obf[k]);
		if (mine) {
			changed = true;
			push(touched, ifn);
			// The hotplug log says why the tunnel goes down (not a failure).
			iface_intent(ifn, srv.enabled ? 'settings' : 'off', srv.name);
		}
	}

	// Remove interfaces Dawnline created for servers that no longer exist.
	let stale = [];
	c.foreach('network', 'interface', (s) => {
		if (s._dawnline && !want[s['.name']])
			push(stale, s['.name']);
	});
	for (let ifn in stale) {
		iface_intent(ifn, 'removed', c.get('network', ifn, '_dawnline_name') ?? ifn);
		system(`ifdown ${q(ifn)} 2>/dev/null`);
		c.delete('network', ifn);
		changed = true;
	}

	if (changed) {
		c.commit('network');
		ack_config([ 'network' ]);
		system('ubus call network reload');
		for (let ifn in touched)
			if (m.servers[c.get('network', ifn, '_dawnline')]?.enabled)
				system(`ifup ${q(ifn)}`);
		// Each tunnel's own line (restarting, turned off, removed) comes from hotplug.
		system(`logger -t dawnline ${q('network updated: ' + join(', ', [ ...touched, ...stale ]))}`);
	}
	return changed;
}

/* ---------- firewall ---------- */

const LOOP_ZONE = 'dl_loop';

/** With `dry`, only says whether the firewall config differs from what Dawnline wants. */
function sync_firewall(m, dry) {
	let c = cursor();
	c.load('firewall');
	let changed = false, want = {};

	let sec = (name, stype, opts) => {
		want[name] = true;
		changed = ensure_section(c, 'firewall', name, stype) || changed;
		for (let k, v in opts)
			changed = put(c, 'firewall', name, k, v) || changed;
	};

	let snap = net.snapshot(true);
	let portal_zone = null, want_loop = false;
	for (let id, srv in m.servers) {
		if (!srv.private_key)
			continue;
		let z = `dawnline_${id}`;
		let sn = net.server_net(srv, snap);
		portal_zone ??= sn.wan.zone;
		sec(`${z}_zone`, 'zone', {
			// Forward within the zone (device to device) is decided by the inet dawnline table.
			name: srv.ifname, network: [ srv.ifname ],
			input: 'ACCEPT', output: 'ACCEPT', forward: 'ACCEPT',
		});
		// Access per person is enforced by the inet dawnline table; the zone
		// only needs to be allowed to reach each home-network zone and WAN.
		// The home network may open connections to the devices too (a router
		// or a NAS on the tunnel); their answers pass the table as established.
		for (let i, zone in sn.zones)
			if (zone != sn.wan.zone && zone != srv.ifname) {
				let sfx = i == 0 ? '' : `_${replace(zone, /[^A-Za-z0-9_]/g, '_')}`;
				sec(`${z}_lan${sfx}`, 'forwarding', { src: srv.ifname, dest: zone });
				sec(`${z}_from_lan${sfx}`, 'forwarding', { src: zone, dest: srv.ifname });
			}
		sec(`${z}_wan`, 'forwarding', { src: srv.ifname, dest: sn.wan.zone });
		if (srv.lan_like) {
			sec(`${z}_loop`, 'forwarding', { src: srv.ifname, dest: LOOP_ZONE });
			want_loop = true;
		}
		sec(`${z}_port`, 'rule', {
			name: `Dawnline-${srv.ifname}`, src: sn.wan.zone, proto: 'udp',
			dest_port: srv.port, target: 'ACCEPT', enabled: srv.enabled ? null : '0',
		});
	}

	// The link into the netns that re-enters the router from the LAN.
	if (want_loop) {
		sec('dawnline_loop', 'zone', {
			name: LOOP_ZONE, device: [ net.INTERNAL.transit ],
			input: 'REJECT', output: 'ACCEPT', forward: 'REJECT',
		});
		// The Home-only resolver in the netns reaches its upstream DNS this way.
		sec('dawnline_loop_wan', 'forwarding', { src: LOOP_ZONE, dest: portal_zone ?? 'wan' });
	}

	if (m.settings.portal_enabled) {
		let wan = portal_zone ?? 'wan';
		sec('dawnline_portal', 'rule', {
			name: 'Dawnline-Portal', src: wan, proto: 'tcp',
			dest_port: m.settings.portal_port, target: 'ACCEPT',
		});
		// IP addresses in links: plain HTTP next to the HTTPS port, and 80 forwarded to it.
		if (core.portal_http(m)) {
			sec('dawnline_portal_http', 'rule', {
				name: 'Dawnline-Portal-HTTP', src: wan, proto: 'tcp',
				dest_port: core.portal_http_port(m), target: 'ACCEPT',
			});
			if (core.portal_http_public(m) == 80)
				sec('dawnline_portal_80', 'redirect', {
					name: 'Dawnline-Portal-80', src: wan, proto: 'tcp',
					src_dport: 80, dest_port: core.portal_http_port(m), target: 'DNAT',
				});
		}
		// Links use 443: from outside it lands on the portal (LuCI stays closed there).
		if (core.portal_public_port(m) == 443 && m.settings.portal_port != 443)
			sec('dawnline_portal_443', 'redirect', {
				name: 'Dawnline-Portal-443', src: wan, proto: 'tcp',
				src_dport: 443, dest_port: m.settings.portal_port, target: 'DNAT',
			});
	}

	let stale = [];
	c.foreach('firewall', null, (s) => {
		if (match(s['.name'], /^dawnline_/) && !want[s['.name']])
			push(stale, s['.name']);
	});
	for (let s in stale) {
		c.delete('firewall', s);
		changed = true;
	}
	if (dry)
		return changed;

	if (changed) {
		c.commit('firewall');
		ack_config([ 'firewall' ]);
		system('fw4 -q reload');
		system("logger -t dawnline 'firewall updated'");
	}
	return changed;
}

/* ---------- nft access table ---------- */

const PRIVATE4 = [ '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '169.254.0.0/16', '224.0.0.0/3' ];

/** Per-person runtime membership: which tunnel addresses may reach what. */
export function access_sets(m, usage, states) {
	let sets = { lan_ok: [], inet_ok: [], svc_ok: [], dns_real: [] };
	for (let id, d in m.devices) {
		let p = m.people[d.person];
		if (!p || d.disabled || !d.address || states[p.id] != 'active')
			continue;
		// Plain DNS for whoever's internet does not go through the router.
		// Home names: the plain resolver (their internet does not use the tunnel).
		if (p.access == 'lan' && p.dns_mode == 'home')
			push(sets.dns_real, d.address);
		if (p.access == 'internet' || p.access == 'both')
			push(sets.inet_ok, d.address);
		if (p.access == 'both' || (p.access == 'lan' && !length(p.services)))
			push(sets.lan_ok, d.address);
		else if (p.access == 'lan')
			for (let sid in p.services) {
				let s = m.services[sid];
				if (!s || !s.address)
					continue;
				for (let port in s.ports)
					if (match(port, /^[0-9]+$/))
						push(sets.svc_ok, `${d.address} . ${s.address} . ${port}`);
			}
	}
	return sets;
};

function set_elems(arr) {
	return length(arr) ? `elements = { ${join(', ', arr)} }` : '';
}

function nft_table(m, sets) {
	let ifs = [], lan = [];
	let dns_addr = loop.client_dns();
	let rt = loop.resolver_target();
	let snap = net.snapshot();
	for (let id, srv in m.servers)
		if (srv.private_key) {
			push(ifs, `"${srv.ifname}"`);
			push(lan, ...net.server_net(srv, snap).nets);
		}
	lan = net.collapse(lan);
	let t = [];
	push(t, 'table inet dawnline {');
	push(t, `	set lan_nets { type ipv4_addr; flags interval; auto-merge; ${set_elems(lan)} }`);
	push(t, `	set lan_ok { type ipv4_addr; ${set_elems(sets.lan_ok)} }`);
	push(t, `	set inet_ok { type ipv4_addr; ${set_elems(sets.inet_ok)} }`);
	push(t, `	set svc_ok { type ipv4_addr . ipv4_addr . inet_service; ${set_elems(sets.svc_ok)} }`);
	push(t, `	set dns_real { type ipv4_addr; ${set_elems(sets.dns_real)} }`);
	push(t, '	chain pre {');
	// Ahead of mangle-priority hooks (transparent proxies mark at -150).
	push(t, '		type filter hook prerouting priority -160; policy accept;');
	if (length(ifs))
		push(t, `		iifname { ${join(', ', ifs)} } jump guard`);
	push(t, '	}');
	push(t, '	chain guard {');
	push(t, '		meta nfproto ipv6 drop');
	push(t, '		ct state established,related accept');
	push(t, '		icmp type echo-request fib daddr type local accept');
	push(t, '		fib daddr type local meta l4proto { tcp, udp } th dport 53 accept');
	push(t, '		fib daddr type local ip saddr @lan_ok accept');
	push(t, '		fib daddr type local counter drop');
	if (dns_addr)
		// DNS through the netns (it forwards to the LAN's DNS), for everyone.
		push(t, `		ip daddr ${dns_addr} meta l4proto { tcp, udp } th dport 53 accept`);
	push(t, '		ip daddr @lan_nets ip saddr @lan_ok accept');
	// Devices with home access are part of home: they reach each other, where the
	// server allows it. Within one server: the firewall has no forwarding between
	// different servers' zones.
	for (let id, srv in m.servers)
		if (srv.private_key && srv.device_mesh)
			push(t, `		iifname "${srv.ifname}" ip saddr @lan_ok ip daddr @lan_ok accept`);
	push(t, '		meta l4proto { tcp, udp } ip saddr . ip daddr . th dport @svc_ok accept');
	push(t, `		ip daddr { ${join(', ', PRIVATE4)} } counter drop`);
	push(t, '		ip saddr @inet_ok accept');
	push(t, '		counter drop');
	push(t, '	}');
	// The other way: fw4 lets the server's home zones reach the tunnel; here
	// only connections from its home networks to people with home access pass
	// (paused, ended and internet-only people are not reachable). The admin's
	// own port forwards (DNAT) stay with fw4.
	push(t, '	chain inbound {');
	push(t, '		type filter hook forward priority filter - 5; policy accept;');
	if (length(ifs))
		push(t, `		oifname { ${join(', ', ifs)} } iifname != { ${join(', ', ifs)} } ct state new jump to_device`);
	push(t, '	}');
	push(t, '	chain to_device {');
	push(t, '		meta nfproto ipv6 drop');
	push(t, '		ct status dnat accept');
	push(t, '		ip saddr @lan_nets ip daddr @lan_ok accept');
	push(t, '		counter reject with icmpx admin-prohibited');
	push(t, '	}');
	// Devices ask the tunnel address; send each query where it belongs.
	let to_resolver = rt.mode == 'ns' ? `dnat ip to ${rt.address}:53` : `redirect to :${rt.port}`;
	let lan_dns = loop.lan_dns();
	push(t, '	chain dns {');
	push(t, '		type nat hook prerouting priority dstnat - 5; policy accept;');
	if (length(ifs))
		// Home names (and no LAN DNS at all): the plain resolver, whatever address was asked.
		push(t, `		iifname { ${join(', ', ifs)} } ip saddr @dns_real meta l4proto { tcp, udp } th dport 53 ${to_resolver}`);
	for (let id, srv in m.servers) {
		let a = srv.private_key ? core.server_address(srv) : null;
		if (!a)
			continue;
		// Everyone else: the LAN's DNS, through the netns (from the LAN side) when internet goes that way.
		let target = srv.lan_like && dns_addr ? `dnat ip to ${dns_addr}:53` : lan_dns ? `dnat ip to ${lan_dns}:53` : to_resolver;
		push(t, `		iifname "${srv.ifname}" ip daddr ${a} meta l4proto { tcp, udp } th dport 53 ${target}`);
	}
	push(t, '	}');
	push(t, '}');
	return join('\n', t) + '\n';
}

function nft_load(script) {
	ensure_dir(RUN_DIR);
	let f = `${RUN_DIR}/nft.rules`;
	writefile(f, script);
	let r = sh(`nft -f ${f}`);
	if (r.code != 0)
		log('Access rules', "couldn't load", 'error', trim(r.out));
	return r.code == 0;
}

/** Full table rebuild (structure changes: servers, LAN subnets). */
export function rebuild_nft(m, sets) {
	let s = 'table inet dawnline\ndelete table inet dawnline\n' + nft_table(m, sets);
	return nft_load(s);
};

/** Atomically replace set contents only. */
export function update_sets(sets) {
	let s = '';
	for (let name in [ 'lan_ok', 'inet_ok', 'svc_ok', 'dns_real' ]) {
		s += `flush set inet dawnline ${name}\n`;
		if (length(sets[name]))
			s += `add element inet dawnline ${name} { ${join(', ', sets[name])} }\n`;
	}
	return nft_load(s);
};

export function remove_nft() {
	system('nft delete table inet dawnline 2>/dev/null');
};

/* ---------- AmneziaWG peers ---------- */

/** Push the peer list of every server to the kernel without restarting it. */
export function sync_peers(m, states) {
	ensure_dir(RUN_DIR);
	let res = {};
	for (let id, srv in m.servers) {
		if (!srv.private_key || !srv.enabled)
			continue;
		if (system(`awg show ${q(srv.ifname)} public-key >/dev/null 2>&1`) != 0) {
			res[id] = 'down';
			continue;
		}
		let lines = [ '[Interface]', `PrivateKey = ${srv.private_key}`, `ListenPort = ${srv.port}`, '' ];
		for (let did, d in m.devices) {
			let p = m.people[d.person];
			if (!p || p.server != id || d.disabled || states[p.id] != 'active' || !d.public_key || !d.address)
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

/* ---------- hostnames ---------- */

function host_label(s) {
	let l = replace(lc(s), /[^a-z0-9]+/g, '-');
	l = replace(l, /^-+|-+$/g, '');
	return substr(l, 0, 40) || 'device';
}

export function sync_hosts(m) {
	let lines = [];
	if (m.settings.hostnames)
		for (let id, d in m.devices) {
			let p = m.people[d.person];
			if (p && d.address)
				push(lines, `${d.address} ${host_label(d.name)}.${p.id}.${m.settings.domain}`);
		}
	let ls = loop.status();
	if (ls.active)
		push(lines, `${ls.address} dawnline.${m.settings.domain}`);
	let body = length(lines) ? join('\n', lines) + '\n' : '';
	// dnsmasq runs as its own user; rpcd's umask would leave the file 0600.
	let readable = ((stat(HOSTS_FILE)?.perm?.other_read) ?? false);
	if ((readfile(HOSTS_FILE) ?? '') == body && (body == '' || readable))
		return false;
	ensure_dir('/tmp/hosts');
	if (body == '')
		unlink(HOSTS_FILE);
	else {
		writefile(HOSTS_FILE, body);
		system(`chmod 644 ${HOSTS_FILE}`);
	}
	system('killall -HUP dnsmasq 2>/dev/null');
	return true;
};

/* ---------- entry points ---------- */

export function states_for(m, usage) {
	let st = {};
	for (let id, p in m.people)
		st[id] = core.person_state(m, p, usage);
	return st;
};

/** Runtime sync: peers + access sets + hostnames. Cheap; safe to call often. */
export function sync(m, usage) {
	m ??= core.load();
	usage ??= core.load_usage();
	let states = states_for(m, usage);
	let l = lock('apply');
	let peers = sync_peers(m, states);
	let sets = access_sets(m, usage, states);
	if (!update_sets(sets))
		rebuild_nft(m, sets);
	sync_hosts(m);
	unlock(l);
	ensure_dir(RUN_DIR);
	write_json(`${RUN_DIR}/states.json`, states, 0o644);
	return { peers, states };
};

/**
 * Everything on the router that Dawnline's state is derived from: WAN and
 * LAN, the home networks and zones of each server, the netns address and the
 * LAN's DNS. The agent re-applies when it changes (LAN renumbered, interface
 * added, bridge recreated, DHCP DNS changed, ...).
 */
export function net_signature(m) {
	let snap = net.snapshot(true);
	let srvs = {};
	for (let id, srv in m.servers)
		srvs[id] = net.server_net(srv, snap);
	let lan = snap.devices[snap.lan];
	return sprintf('%J', { wan: snap.wan, lan: snap.lan, addrs: lan?.addrs, servers: srvs, dns: loop.lan_dns(), loop: loop.client_dns() });
};

const PORTAL_CGI = '/usr/share/dawnline/portal/www/cgi-bin/portal';
const LAN_CGI = '/www/cgi-bin/dawnline-portal';
const LAN_CGI_URL = '/cgi-bin/dawnline-portal';

/*
 * At home the portal's hostname usually points at the router itself, where
 * LuCI's web server owns 443. Paths it does not know (the portal's) go to the
 * portal CGI through its error page, so the same link works inside and out.
 */
function sync_uhttpd(m) {
	let want = m.settings.portal_enabled && core.portal_public_port(m) == 443 && m.settings.portal_port != 443;
	let c = cursor();
	c.load('uhttpd');
	let cur = c.get('uhttpd', 'main', 'error_page');
	let changed = false;
	if (want) {
		if (!stat(LAN_CGI))
			system(`ln -sf ${PORTAL_CGI} ${LAN_CGI}`);
		if (cur == null && c.get('uhttpd', 'main')) {
			c.set('uhttpd', 'main', 'error_page', LAN_CGI_URL);
			changed = true;
		}
	}
	else {
		if (cur == LAN_CGI_URL) {
			c.delete('uhttpd', 'main', 'error_page');
			changed = true;
		}
		if (stat(LAN_CGI))
			unlink(LAN_CGI);
	}
	if (changed) {
		c.commit('uhttpd');
		system('/etc/init.d/uhttpd reload >/dev/null 2>&1');
		system(`logger -t dawnline ${q(want ? 'portal answers through the LuCI web server' : 'portal removed from the LuCI web server')}`);
	}
}

/**
 * For the watchdog: what is wrong with Dawnline's firewall, or null.
 * 'off': fw4 is not running at all (not ours to start); 'changed': the config
 * lost or changed Dawnline's sections; 'not loaded': fw4 runs without them.
 */
export function firewall_drift(m) {
	let t = sh_out('nft -t list table inet fw4 2>/dev/null') ?? '';
	if (t == '')
		return 'off';
	if (sync_firewall(m, true))
		return 'changed';
	// Named rules show up in fw4's ruleset as comments.
	let names = [];
	for (let id, srv in m.servers)
		if (srv.private_key && srv.enabled)
			push(names, `Dawnline-${srv.ifname}`);
	if (m.settings.portal_enabled)
		push(names, 'Dawnline-Portal');
	for (let n in names)
		if (index(t, `${n}"`) < 0)
			return 'not loaded';
	return null;
};

/** For the watchdog: LuCI's web server should hand portal links to the portal, but does not. */
export function uhttpd_drift(m) {
	if (!(m.settings.portal_enabled && core.portal_public_port(m) == 443 && m.settings.portal_port != 443))
		return false;
	let c = cursor();
	c.load('uhttpd');
	let cur = c.get('uhttpd', 'main', 'error_page');
	// Someone else's error page is theirs: Health explains, nothing to repair.
	return cur == null || (cur == LAN_CGI_URL && !stat(LAN_CGI));
};

/** One `ipproto <p> sport <port> lookup main` rule per listening port and family. */
function sync_reply_routes(m) {
	let want = [];
	if (m.settings.portal_enabled) {
		push(want, `tcp ${+m.settings.portal_port}`);
		if (core.portal_http(m))
			push(want, `tcp ${core.portal_http_port(m)}`);
	}
	for (let id, srv in m.servers)
		if (srv.private_key && srv.enabled && +srv.port)
			push(want, `udp ${+srv.port}`);
	want = uniq(want);
	for (let fam in [ '-4', '-6' ]) {
		let have = [];
		for (let line in split(sh_out(`ip ${fam} rule show priority ${PREF_REPLY} 2>/dev/null`) ?? '', '\n')) {
			let mm = match(line, /ipproto (tcp|udp) sport (\d+) lookup main/);
			if (mm)
				push(have, `${mm[1]} ${mm[2]}`);
		}
		for (let h in have)
			if (index(want, h) < 0)
				sh(`ip ${fam} rule del priority ${PREF_REPLY} ipproto ${split(h, ' ')[0]} sport ${split(h, ' ')[1]} lookup main 2>/dev/null`);
		for (let w in want)
			if (index(have, w) < 0)
				sh(`ip ${fam} rule add priority ${PREF_REPLY} ipproto ${split(w, ' ')[0]} sport ${split(w, ' ')[1]} lookup main`);
	}
}

/**
 * Keep the "like a home device" path and the resolver in step (agent tick).
 * Cheap when nothing changed; rebuilds the access table when the netns
 * address appears, moves or goes away (the guard allows DNS to it).
 */
export function sync_loop(m, usage, force) {
	m ??= core.load();
	let before = `${loop.client_dns()} ${loop.resolver_target().mode}`;
	let p = loop.ensure(m, force);
	loop.sync_resolver(m);
	sync_reply_routes(m);
	if (`${loop.client_dns()} ${loop.resolver_target().mode}` != before) {
		usage ??= core.load_usage();
		rebuild_nft(m, access_sets(m, usage, states_for(m, usage)));
		sync_hosts(m);
	}
	return p;
};

/** Every personal code is a word code; older random ones are replaced (their links stop working). */
function ensure_word_codes() {
	let c = cursor();
	c.load('dawnline');
	let changed = false;
	c.foreach('dawnline', 'person', (s) => {
		if (s.code != null && !match(s.code, core.WORD_CODE)) {
			c.set('dawnline', s['.name'], 'code', core.new_code());
			c.delete('dawnline', s['.name'], 'words');
			changed = true;
		}
	});
	if (changed) {
		c.commit('dawnline');
		system('chmod 600 /etc/config/dawnline');
		log('Personal links', 'moved to word codes');
	}
}

/** Full reconcile: router configuration + runtime state. */
export function apply(opts) {
	opts ??= {};
	ensure_word_codes();
	let m = core.load();
	let usage = core.load_usage();
	let l = lock('reconcile');
	let net = sync_network(m);
	let fw = sync_firewall(m);
	sync_uhttpd(m);
	let lp = loop.ensure(m, true);
	loop.sync_resolver(m);
	sync_reply_routes(m);
	let states = states_for(m, usage);
	rebuild_nft(m, access_sets(m, usage, states));
	unlock(l);
	let r = sync(m, usage);
	return { network: net, firewall: fw, like_home: lp.error ? { error: lp.error } : !lp.off, peers: r.peers };
};

/** Remove everything Dawnline created (used by the uninstaller). */
export function teardown() {
	let m = core.load();
	loop.remove();
	unlink(loop.RESOLVER.conf);
	m.servers = {};
	m.settings.portal_enabled = false;
	sync_network(m);
	sync_firewall(m);
	sync_uhttpd(m);
	sync_reply_routes(m);
	remove_nft();
	unlink(HOSTS_FILE);
	system('killall -HUP dnsmasq 2>/dev/null');
	// The agent's heartbeat check.
	if (system('grep -qs /usr/libexec/dawnline/heartbeat /etc/crontabs/root') == 0)
		system("sed -i '\\#/usr/libexec/dawnline/heartbeat#d' /etc/crontabs/root; /etc/init.d/cron restart >/dev/null 2>&1");
};
