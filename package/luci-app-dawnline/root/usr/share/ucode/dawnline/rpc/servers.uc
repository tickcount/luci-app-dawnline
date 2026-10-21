// Dawnline rpcd methods: setting up a server, its General / Network /
// Interfaces settings, its disguise, and removing it.

import { cursor } from 'uci';
import { sh_out, sh_bg, parse_cidr, cidr_str, cidr_overlaps, valid_host, valid_name, rand_int, uniq, admin_log } from 'dawnline.util';
import * as core from 'dawnline.core';
import * as live from 'dawnline.live';
import * as apply from 'dawnline.apply';
import * as net from 'dawnline.net';
import * as loop from 'dawnline.loop';
import * as awg from 'dawnline.awg';
import * as store from 'dawnline.store';
import * as schema from 'dawnline.schema';
import * as health from 'dawnline.health';
import * as backup from 'dawnline.backup';
import * as devices from 'dawnline.devices';
import { wrap, str, check_method, default_method, check_portal, tcp_taken } from 'dawnline.rpc.common';
import { _ } from 'dawnline.i18n';

/** Server ids that would shadow a portal path. */
const PORTAL_PATHS = [ 'api', 'assets', 'cgi-bin' ];

const MESH_WORDS = { off: 'devices kept apart', all: 'devices reach each other', circles: 'devices reach each other in circles' };

/* ---------- free names, ports and subnets ---------- */

/**
 * UDP ports a server can't listen on, and who holds them: [{ from, to, who }].
 * Other servers, tunnel interfaces, programs on the router and port forwards
 * from its WAN zone. `srv` is the server being edited: its own port isn't counted.
 * `who` is shown in the admin's language ("Used by %s.").
 */
function udp_taken(m, srv, wan_zone) {
	let out = [];
	let held = {};
	let hold = (p, who) => {
		if (p > 0 && !held[p]) {
			held[p] = true;
			push(out, { from: p, to: p, who });
		}
	};
	for (let id, o in m.servers)
		if (id != srv?.id)
			hold(o.port, sprintf(_('server “%s”'), o.name));
	let nc = cursor();
	nc.load('network');
	nc.foreach('network', 'interface', (s) => {
		if (s.listen_port && s['.name'] != srv?.ifname)
			hold(+s.listen_port, sprintf(_('interface %s'), s['.name']));
	});
	let progs = health.udp_port_programs();
	for (let p in health.udp_bound())
		if (p != srv?.port)
			hold(p, progs[`${p}`] ? sprintf(_('%s on this router'), progs[`${p}`]) : _('another program on this router'));
	for (let f in core.wan_forwards(wan_zone, 'udp'))
		push(out, { from: f.from, to: f.to, who: sprintf(_('port forward “%s”'), f.name) });
	return out;
}

function check_udp_port(port, taken) {
	for (let t in taken)
		if (t.from <= port && port <= t.to)
			die(sprintf(_('UDP %d is used by %s. Choose another port.'), port, t.who));
}

/** The usual AmneziaWG port when free, otherwise a random high one. */
const DEFAULT_PORT = 4500;

function free_port(taken) {
	let used = (p) => length(filter(taken, (t) => t.from <= p && p <= t.to)) > 0;
	if (!used(DEFAULT_PORT))
		return DEFAULT_PORT;
	for (let i = 0; i < 50; i++) {
		let p = rand_int(40000, 60000);
		if (!used(p))
			return p;
	}
	return 51830;
}

function free_subnet(taken) {
	for (let i = 0; i < 300; i++) {
		// 10.x first; past 200 tries (a 10/8 LAN) the 172.16-31 range.
		let cand = parse_cidr(i < 200 ? sprintf('10.%d.%d.0/24', rand_int(60, 250), rand_int(0, 250)) : sprintf('172.%d.%d.0/24', rand_int(16, 31), rand_int(0, 250)));
		let bad = false;
		for (let t in taken) {
			let tc = parse_cidr(t);
			if (tc && cidr_overlaps(cand, tc)) {
				bad = true;
				break;
			}
		}
		if (!bad)
			return cidr_str(cand);
	}
	return '10.77.0.0/24';
}

/**
 * A portal port free together with the next one (plain HTTP for IP links):
 * `first` (the server's UDP number, TCP is another port) before the usual ones.
 */
function free_portal_port(first, cur, taken) {
	let used = (p) => length(filter(taken, (t) => t.from <= p && p <= t.to)) > 0;
	for (let p in uniq([ first, cur || 8443, 8443, 9443, 10443, 7443, 4443 ]))
		if (!used(p) && !used(p + 1))
			return p;
	return 9443;
}

/** A network section name nothing uses: not the router's, not Dawnline's own links, not another server's. */
function ifname_free(m, nc, n) {
	if (nc.get('network', n) != null || index(values(net.INTERNAL), n) >= 0)
		return false;
	for (let id, s in m.servers)
		if (s.ifname == n)
			return false;
	return true;
}

function free_ifname(m) {
	let nc = cursor();
	nc.load('network');
	for (let i = 0; i < 10; i++)
		if (ifname_free(m, nc, `dawn${i}`))
			return `dawn${i}`;
	return 'dawnx';
}

function id_free(m, id) {
	return !store.id_taken(m, id) && index(PORTAL_PATHS, id) < 0;
}

/** A free server id: home, then server2, server3, … (never an id anything else has). */
function free_server_id(m) {
	if (id_free(m, 'home'))
		return 'home';
	for (let n = 2; ; n++)
		if (id_free(m, `server${n}`))
			return `server${n}`;
}

/** Networks a new server must not overlap, by name: the router's and the other servers'. */
function taken_networks(m) {
	let out = [];
	let seen = {};
	let add = (name, cidr) => {
		let c = parse_cidr(cidr);
		if (c && !seen[cidr_str(c)]) {
			seen[cidr_str(c)] = true;
			push(out, { name, cidr: cidr_str(c) });
		}
	};
	for (let n in health.networks())
		add(n.iface, n.cidr);
	for (let id, s in m.servers)
		add(s.name, s.subnet);
	return out;
}

/* ---------- setup ---------- */

function setup_defaults(a) {
	let m = core.load();
	let networks = taken_networks(m);
	let zones = [];
	let fc = cursor();
	fc.load('firewall');
	fc.foreach('firewall', 'zone', (z) => push(zones, z.name));
	let snap = net.snapshot(true);
	let wan_ip = snap.wan ? split(snap.devices[snap.wan]?.addrs?.[0] ?? '', '/')[0] : '';
	let kind = health.wan_kind(wan_ip || null);
	let host = m.settings.portal_host, from = host ? 'portal' : '';
	if (!host) {
		// Prefer a DDNS name, then an ACME certificate's, then the WAN address —
		// but never a private or CGNAT one: nobody on the internet reaches it.
		let dc = cursor();
		if (dc.load('ddns'))
			dc.foreach('ddns', 'service', (s) => {
				if (!host && s.lookup_host && s.enabled == '1') {
					host = s.lookup_host;
					from = 'ddns';
				}
			});
		if (!host) {
			host = sh_out("ls /etc/ssl/acme/ 2>/dev/null | sed -n 's/\\.fullchain\\.crt$//p' | head -n1") || '';
			from = host ? 'cert' : '';
		}
		if (!host && kind == 'public') {
			host = wan_ip;
			from = 'wan';
		}
	}
	// The zones the WAN and LAN devices are in, whatever they are called.
	let wan_zone = snap.devices[snap.wan]?.zone ?? (index(zones, 'wan') >= 0 ? 'wan' : zones[1]);
	let lan_zone = snap.devices[snap.lan]?.zone ?? (index(zones, 'lan') >= 0 ? 'lan' : zones[0]);
	let udp = udp_taken(m, null, wan_zone);
	let tcp = tcp_taken(m);
	let port = free_port(udp);
	return {
		id: free_server_id(m),
		// A name to start from, in the admin's language (it is theirs once saved).
		name: length(m.servers) ? sprintf(_('Server %d'), length(m.servers) + 1) : _('Home'),
		ifname: free_ifname(m),
		port,
		subnet: free_subnet(map(networks, (n) => n.cidr)),
		endpoint: host,
		// Where the address came from (ddns, cert, wan, portal) and what the WAN is (public, private, cgnat, none).
		endpoint_from: from,
		wan_kind: kind,
		wan_ip: wan_ip || null,
		// Automatic.
		mtu: 0,
		zones,
		lan_zone,
		wan_zone,
		// A portal already on keeps its port; a new one takes the server's number when it can.
		portal_port: m.settings.portal_enabled ? m.settings.portal_port : free_portal_port(port, m.settings.portal_port, tcp),
		awg: awg.caps(),
		awg_state: awg.load(),
		networks,
		udp_taken: udp,
		tcp_taken: tcp,
	};
}

/**
 * Where a public address points, as the admin types it (debounced in the
 * UI): the same facts Health uses, in words. `id` names the server whose WAN
 * to compare with (a new one: the default WAN).
 */
function endpoint_probe(a) {
	let host = str(a.host);
	if (host != '' && !valid_host(host))
		die(_('Public address must be a hostname or IP address.'));
	let m = core.load();
	let srv = m.servers[str(a.id)] ?? null;
	let f = health.endpoint_facts(srv, host);
	let w = health.endpoint_words(f, `UDP ${srv?.port ?? +a.port || 4500}`);
	return { ...f, status: w.status, text: w.text };
}

/** AmneziaWG can run a server: installed, and its kernel module loads. */
function need_awg_loaded() {
	devices.need_awg();
	if (!awg.load().loaded)
		die(_("AmneziaWG's kernel module doesn't load on this firmware: reinstall a build for this kernel in Components."));
}

/** An MTU as typed: '' (automatic) or 1280-1500. */
function check_mtu(v) {
	let s = str(v);
	if (s != '' && (!match(s, /^[0-9]{1,4}$/) || +s < 1280 || +s > 1500))
		die(_('MTU must be 1280-1500.'));
	return s;
}

function server_create(a) {
	need_awg_loaded();
	let snap = net.snapshot(true);
	let router_subnets = health.used_subnets(null);
	let id = store.transact((c, m) => {
		let id = str(a.id) || 'home';
		// A UCI section name: a dash would make uci drop it silently.
		if (!match(id, /^[a-z][a-z0-9_]{0,23}$/))
			die(_('Server ID may use lowercase letters, digits and underscores.'));
		if (!id_free(m, id))
			die(sprintf(_('"%s" is already taken.'), id));
		let nc = cursor();
		nc.load('network');
		let ifname = str(a.ifname) || free_ifname(m);
		if (!ifname_free(m, nc, ifname))
			die(sprintf(_('Network interface %s already exists.'), ifname));
		let udp = udp_taken(m, null, str(a.wan_zone) || 'wan');
		let port = free_port(udp);
		if (a.port != null && str(a.port) != '' && str(a.port) != '0') {
			if (!schema.valid_port(a.port))
				die(_('UDP port must be 1-65535.'));
			port = +str(a.port);
		}
		check_udp_port(port, udp);
		let mtu = check_mtu(a.mtu == 0 ? '' : a.mtu);
		let preset = str(a.preset) || default_method();
		let srv = { id, ifname, port, subnet: str(a.subnet), endpoint: str(a.endpoint), obf: awg.obf_preset(check_method(preset)) };
		let pc = parse_cidr(srv.subnet);
		if (pc)
			srv.subnet = cidr_str(pc);
		// Public addresses inside the tunnel would hide the real hosts behind them.
		// New servers only: a restored backup keeps what it had.
		if (pc && !core.private_cidr(pc))
			die(_('Use a private range: 10.x.x.x, 172.16–31.x.x or 192.168.x.x.'));
		let taken = [ ...router_subnets ];
		for (let sid, o in m.servers)
			push(taken, o.subnet);
		let errs = core.server_errors(m, srv, taken);
		push(errs, ...awg.obf_errors(srv.obf));
		if (length(errs))
			die(join(' ', errs));

		let set = (k, v) => c.set(core.CONFIG, id, k, v);
		c.set(core.CONFIG, 'settings', 'settings');
		c.set(core.CONFIG, id, 'server');
		if (!valid_name(str(a.name) || 'Home'))
			die(_('Server: Enter a name: up to 48 characters, without < > " or \\.'));
		set('name', str(a.name) || 'Home');
		set('ifname', ifname);
		set('port', `${port}`);
		set('subnet', srv.subnet);
		if (srv.endpoint)
			set('endpoint', srv.endpoint);
		if (mtu)
			set('mtu', mtu);
		set('keepalive', '25');
		let kp = awg.server_keys();
		set('private_key', kp.private_key);
		set('public_key', kp.public_key);
		set('preset', preset);
		for (let ok, ov in srv.obf)
			set(ok, ov);
		set('lan_zone', str(a.lan_zone) || 'lan');
		set('wan_zone', str(a.wan_zone) || 'wan');
		set('auto_wan', '1');
		set('auto_lan', '1');
		if (snap.wan)
			set('detected_wan', snap.wan);
		if (snap.lan)
			set('detected_lan', snap.lan);
		// Off unless asked for: the loop through the LAN costs speed (the wizard says how much).
		set('lan_like', a.lan_like === true || a.lan_like === 1 || a.lan_like === '1' ? '1' : '0');
		set('enabled', '1');
		if (a.portal_enabled != null) {
			let on = a.portal_enabled === true || a.portal_enabled === 1 || a.portal_enabled === '1';
			c.set(core.CONFIG, 'settings', 'portal_enabled', on ? '1' : '0');
			if (a.portal_port != null && str(a.portal_port) != '' && str(a.portal_port) != '0') {
				if (!schema.valid_port(a.portal_port))
					die(_('Portal port must be 1-65535.'));
				c.set(core.CONFIG, 'settings', 'portal_port', `${+str(a.portal_port)}`);
			}
		}
		if (srv.endpoint && !c.get(core.CONFIG, 'settings', 'portal_host') && valid_host(srv.endpoint))
			c.set(core.CONFIG, 'settings', 'portal_host', srv.endpoint);
		// The portal as it will be, whatever this call changed.
		check_portal(core.load(c), m);
		return id;
	});
	let r = apply.apply();
	system('/etc/init.d/dawnline enabled || /etc/init.d/dawnline enable');
	let made = core.load().servers[id];
	admin_log('dawnline', 'created', 'server', made?.name ?? id, made ? `UDP ${made.port}` : null);
	// netifd reads its protocol handlers when it starts: AmneziaWG installed
	// after that (by hand, or by an older installer) needs a network restart.
	let network_restart = !awg.state().handler;
	sh_bg(network_restart ? '/etc/init.d/network restart; /etc/init.d/dawnline restart' : '/etc/init.d/dawnline restart');
	return { id, applied: r, network_restart, warning: r.warning };
}

/* ---------- interfaces ---------- */

/** Interfaces card on the Server page: what exists, what is detected, what the server uses. */
function interfaces_view(m, srv, snap) {
	let sn = net.server_net(srv, snap);
	let home = {};
	for (let h in sn.home)
		home[h.dev] = h;
	let devs = [];
	for (let dev, d in snap.devices)
		push(devs, {
			...d,
			own: dev == srv.ifname,
			home: !!home[dev],
			auto: !!home[dev]?.auto,
		});
	// Saved names that no longer exist still show, so they can be removed.
	for (let h in sn.home)
		if (h.missing)
			push(devs, { name: h.dev, category: 'other', kind: 'other', missing: true, nets: [], addrs: [], members: [], home: true, auto: h.auto });
	let lan_only = 0;
	for (let id, p in m.people)
		if (p.server == srv.id && p.access == 'lan')
			lan_only++;
	return {
		server: srv.id,
		ifname: srv.ifname,
		detected: { wan: snap.wan, lan: snap.lan },
		saved: { wan: srv.detected_wan, lan: srv.detected_lan },
		config: { auto_wan: srv.auto_wan, wan_device: srv.wan_device, auto_lan: srv.auto_lan, lan_devices: srv.lan_devices, lan_like: srv.lan_like,
			device_mesh: srv.device_mesh, mesh: srv.mesh },
		like_home: loop.status(),
		needs: health.needs().home,
		effective: sn,
		zones: snap.zones,
		devices: devs,
		lan_only,
	};
}

function interfaces_get(a) {
	let m = core.load();
	let srv = m.servers[a.id] ?? values(m.servers)[0];
	if (!srv)
		die(_('No server yet.'));
	return interfaces_view(m, srv, net.snapshot(true));
}

function server_interfaces(a) {
	let snap = net.snapshot(true);
	let auto_wan = a.auto_wan != false && a.auto_wan != '0';
	let auto_lan = a.auto_lan != false && a.auto_lan != '0';
	let wan_dev = str(a.wan_device);
	let res = store.transact((c, m) => {
		let srv = m.servers[a.id];
		if (!srv)
			die(_('Unknown server.'));
		if (!auto_wan) {
			if (!snap.devices[wan_dev])
				die(_('Choose the interface that leads to the internet.'));
			if (!snap.devices[wan_dev].zone)
				die(sprintf(_('%s is not in a firewall zone, so the server port cannot be opened on it.'), wan_dev));
		}
		let lans = [];
		for (let d in (type(a.lan_devices) == 'array' ? a.lan_devices : [])) {
			d = str(d);
			// Unknown names are kept only if they were saved before (interface down right now).
			if (d == '' || d == srv.ifname || (!snap.devices[d] && index(srv.lan_devices, d) < 0))
				continue;
			if (snap.devices[d]?.master)
				die(sprintf(_('%s is part of %s; choose %s instead.'), d, snap.devices[d].master, snap.devices[d].master));
			if (d == (auto_wan ? snap.wan : wan_dev))
				die(sprintf(_('%s is the WAN.'), d));
			push(lans, d);
		}
		lans = uniq(lans);
		let id = srv.id;
		if (a.lan_like != null)
			c.set(core.CONFIG, id, 'lan_like', a.lan_like === false || a.lan_like === '0' ? '0' : '1');
		let mesh = index(core.MESH, a.mesh) >= 0 ? a.mesh
			: a.device_mesh == null ? srv.mesh : (a.device_mesh === false || a.device_mesh === '0' ? 'off' : 'all');
		c.set(core.CONFIG, id, 'mesh', mesh);
		c.delete(core.CONFIG, id, 'device_mesh');
		c.set(core.CONFIG, id, 'auto_wan', auto_wan ? '1' : '0');
		c.set(core.CONFIG, id, 'auto_lan', auto_lan ? '1' : '0');
		if (auto_wan || wan_dev == '')
			c.delete(core.CONFIG, id, 'wan_device');
		else
			c.set(core.CONFIG, id, 'wan_device', wan_dev);
		if (length(lans))
			c.set(core.CONFIG, id, 'lan_device', lans);
		else
			c.delete(core.CONFIG, id, 'lan_device');
		// Remember what was detected, as the fallback while an interface is down.
		if (snap.wan)
			c.set(core.CONFIG, id, 'detected_wan', snap.wan);
		if (snap.lan)
			c.set(core.CONFIG, id, 'detected_lan', snap.lan);
		// Keep the legacy zone options in step (older code paths, health checks).
		let now = core.load(c).servers[id];
		let sn = net.server_net(now, snap);
		if (sn.wan.zone)
			c.set(core.CONFIG, id, 'wan_zone', sn.wan.zone);
		if (length(sn.zones))
			c.set(core.CONFIG, id, 'lan_zone', sn.zones[0]);
		return { was: srv, now: core.load(c).servers[id], mesh };
	});
	let srv = res.was;
	// What the admin changed here: the networks, and/or whether devices reach each other.
	let sig = (x) => {
		let sn = net.server_net(x, snap);
		return `${join(',', sn.nets)}|${sn.wan.dev}|${x.lan_like}`;
	};
	let what = [];
	if (sig(res.now) != sig(srv))
		push(what, 'home network and internet path');
	if (res.mesh != srv.mesh)
		push(what, MESH_WORDS[res.mesh]);
	if (length(what))
		admin_log('awg', 'changed', 'server', srv.name, join(', ', what));
	let before = join(',', net.server_net(srv, snap).nets);
	apply.apply();
	let m = core.load();
	let v = interfaces_view(m, m.servers[srv.id], net.snapshot(true));
	v.nets_changed = before != join(',', v.effective.nets);
	return v;
}

/* ---------- settings ---------- */

/** A list of DNS servers as typed (array or "a, b"): each an IPv4 or IPv6 address. */
function dns_list(v) {
	let list = filter(map(type(v) == 'array' ? v : split(str(v), /[ ,]+/), str), (x) => x != '');
	for (let d in list)
		if (!schema.ip(d))
			die(sprintf(_('%s is not an IP address.'), d));
	return list;
}

/** Server settings from the General and Network tabs; applied at once. */
function server_update(a) {
	let v = a.values ?? {};
	if (v.device_mesh != null && v.mesh == null)
		v.mesh = v.device_mesh === true || v.device_mesh == '1' ? 'all' : 'off';
	let srv = store.transact((c, m) => {
		let srv = m.servers[a.id];
		if (!srv)
			die(_('Unknown server.'));
		let set = (k, val) => (val == null || val == '') ? c.delete(core.CONFIG, srv.id, k) : c.set(core.CONFIG, srv.id, k, val);
		if (v.name != null) {
			if (!valid_name(str(v.name)))
				die(_('Server: Enter a name: up to 48 characters, without < > " or \\.'));
			set('name', str(v.name));
		}
		// Empty = the portal's address (core.endpoint_host), as at creation.
		if (v.endpoint != null) {
			if (str(v.endpoint) != '' && !valid_host(str(v.endpoint)))
				die(_('Public address must be a hostname or IP address.'));
			set('endpoint', str(v.endpoint));
		}
		if (v.port != null) {
			if (!schema.valid_port(v.port))
				die(_('UDP port must be 1-65535.'));
			let n = +str(v.port);
			if (n != srv.port)
				check_udp_port(n, udp_taken(m, srv, srv.wan_zone));
			set('port', `${n}`);
		}
		if (v.enabled != null)
			set('enabled', v.enabled === true || v.enabled == '1' ? '1' : '0');
		if (v.mesh != null) {
			if (index(core.MESH, v.mesh) < 0)
				die(_('Unknown choice for devices reaching each other.'));
			set('mesh', v.mesh);
			set('device_mesh', null);
		}
		if (v.mtu != null)
			set('mtu', check_mtu(v.mtu));
		if (v.keepalive != null) {
			if (str(v.keepalive) != '' && (!match(str(v.keepalive), /^[0-9]{1,3}$/) || +v.keepalive > 600))
				die(_('Keep-alive must be 0-600 seconds.'));
			set('keepalive', str(v.keepalive));
		}
		if (v.dns != null) {
			let list = dns_list(v.dns);
			if (length(list))
				c.set(core.CONFIG, srv.id, 'dns', list);
			else
				c.delete(core.CONFIG, srv.id, 'dns');
		}
		// A new tunnel network: private, free, and every device renumbered into it.
		if (v.subnet != null && str(v.subnet) != '' && str(v.subnet) != srv.subnet) {
			let pc = parse_cidr(str(v.subnet));
			if (!pc)
				die(_('Subnet must look like 10.77.0.0/24.'));
			if (!core.private_cidr(pc))
				die(_('Use a private range: 10.x.x.x, 172.16–31.x.x or 192.168.x.x.'));
			let taken = map(filter(taken_networks(m), (n) => n.cidr != srv.subnet && n.name != srv.name), (n) => n.cidr);
			for (let t in taken)
				if (cidr_overlaps(pc, parse_cidr(t)))
					die(sprintf(_('Subnet overlaps %s.'), t));
			core.renumber_server(c, m, srv, cidr_str(pc));
		}
		return srv;
	});
	// For the log: what changed, in words. Turning on or off is its own line.
	let labels = { name: 'name', endpoint: 'public address', port: 'AmneziaWG port', mtu: 'MTU', keepalive: 'keep-alive', dns: 'DNS', subnet: 'tunnel network' };
	let what = [];
	for (let k, label in labels) {
		if (v[k] == null)
			continue;
		let was = k == 'dns' ? join(' ', srv.dns ?? []) : k == 'mtu' && !srv.mtu ? '' : `${srv[k] ?? ''}`;
		let now = k == 'dns' ? join(' ', dns_list(v.dns)) : str(v[k]);
		if (trim(was) != trim(now))
			push(what, label);
	}
	let turned = v.enabled == null ? null : (v.enabled === true || v.enabled == '1');
	let name = v.name != null ? str(v.name) : srv.name;
	let r = apply.apply();
	if (turned != null && turned != srv.enabled)
		admin_log('dawnline', turned ? 'turned on' : 'turned off', 'server', name);
	if (length(what))
		admin_log('dawnline', 'changed', 'server', name, join(', ', what));
	if (v.mesh != null && v.mesh != srv.mesh)
		admin_log('dawnline', 'changed', 'server', name, MESH_WORDS[v.mesh]);
	return r;
}

/** What the ports of an existing server must avoid (the AmneziaWG card checks as you type). */
function server_ports(a) {
	let m = core.load();
	let srv = m.servers[a.id];
	if (!srv)
		die(_('Unknown server.'));
	// `networks`: what a new tunnel network must not overlap (everything but this server's own).
	return { udp_taken: udp_taken(m, srv, srv.wan_zone), tcp_taken: tcp_taken(m),
		networks: filter(taken_networks(m), (n) => n.cidr != srv.subnet) };
}

function server_obfuscation(a) {
	let preset = str(a.preset) || default_method();
	let o = awg.obf_preset(check_method(preset));
	// A cheap self-check: new values pass what a restore would be held to.
	let errs = awg.obf_errors(o);
	if (length(errs))
		die(join(' ', errs));
	let srv = store.transact((c, m) => {
		let srv = m.servers[a.id];
		if (!srv)
			die(_('Unknown server.'));
		for (let k in core.OBF_KEYS)
			c.delete(core.CONFIG, srv.id, k);
		for (let k, v in o)
			c.set(core.CONFIG, srv.id, k, v);
		c.set(core.CONFIG, srv.id, 'preset', preset);
		return srv;
	});
	let r = apply.apply();
	admin_log('awg', 'changed', 'server', srv.name, `disguise: ${preset}`);
	return r;
}

/** Remove a server with its people, their devices and its circles (a backup is made first). */
function server_delete(a) {
	if (!core.load().servers[a.id])
		die(_('Unknown server.'));
	backup.backup_create('pre-delete');
	let res = store.transact((c, m) => {
		let srv = m.servers[a.id];
		if (!srv)
			die(_('Unknown server.'));
		let gone = 0;
		for (let pid, p in m.people)
			if (p.server == srv.id) {
				core.delete_person(c, m, pid);
				gone++;
			}
		for (let cid, ci in m.circles)
			if (ci.server == srv.id)
				c.delete(core.CONFIG, cid);
		c.delete(core.CONFIG, srv.id);
		return { name: srv.name, gone };
	});
	let r = apply.apply();
	admin_log('awg', 'removed', 'server', res.name, res.gone ? `with ${res.gone} ${res.gone == 1 ? 'person' : 'people'}` : null);
	return r;
}

export const methods = {
	setup_defaults: { call: wrap(setup_defaults) },
	server_create: {
		args: { id: '', name: '', ifname: '', port: 0, subnet: '', endpoint: '', mtu: 0, preset: '', lan_zone: '', wan_zone: '',
			lan_like: true, portal_enabled: false, portal_port: 0 },
		call: wrap(server_create),
	},
	server_ports: { args: { id: '' }, call: wrap(server_ports) },
	endpoint_probe: { args: { host: '', id: '', port: 0 }, call: wrap(endpoint_probe) },
	server_obfuscation: { args: { id: '', preset: '' }, call: wrap(server_obfuscation) },
	server_update: { args: { id: '', values: {} }, call: wrap(server_update) },
	interfaces: { args: { id: '' }, call: wrap(interfaces_get) },
	server_interfaces: {
		args: { id: '', auto_wan: false, wan_device: '', auto_lan: false, lan_devices: [], lan_like: false, device_mesh: true, mesh: '' },
		call: wrap(server_interfaces),
	},
	server_delete: { args: { id: '' }, call: wrap(server_delete) },
};
