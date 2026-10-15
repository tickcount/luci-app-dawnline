// Dawnline rpcd methods: setting up a server, its General / Network /
// Interfaces settings, its disguise, and removing it.

import { cursor } from 'uci';
import { sh_out, sh_bg, parse_cidr, cidr_str, cidr_overlaps, valid_host, rand_int, uniq, admin_log } from 'dawnline.util';
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
import { wrap, str, check_method, check_portal } from 'dawnline.rpc.common';

/** Server ids that would shadow a portal path. */
const PORTAL_PATHS = [ 'api', 'assets', 'cgi-bin' ];

const MESH_WORDS = { off: 'devices kept apart', all: 'devices reach each other', circles: 'devices reach each other in circles' };

/* ---------- free names, ports and subnets ---------- */

function free_port(m) {
	let used = {};
	let nc = cursor();
	nc.load('network');
	nc.foreach('network', 'interface', (s) => {
		if (s.listen_port)
			used[+s.listen_port] = true;
	});
	for (let id, srv in m.servers)
		used[srv.port] = true;
	for (let i = 0; i < 50; i++) {
		let p = rand_int(40000, 60000);
		if (!used[p])
			return p;
	}
	return 51830;
}

function free_subnet(taken) {
	for (let i = 0; i < 200; i++) {
		let cand = parse_cidr(sprintf('10.%d.%d.0/24', rand_int(60, 250), rand_int(0, 250)));
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

function free_portal_port(cur) {
	for (let p in uniq([ cur || 8443, 8443, 9443, 10443, 7443, 4443 ]))
		if (!length(health.tcp_port_owners(p)) && !length(health.tcp_port_owners(p + 1)))
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

/** Subnets a new server must not overlap: the router's networks and the other servers. */
function taken_subnets(m) {
	let taken = health.used_subnets(null);
	for (let id, s in m.servers)
		push(taken, s.subnet);
	return taken;
}

/* ---------- setup ---------- */

function setup_defaults(a) {
	let m = core.load();
	let taken = taken_subnets(m);
	let zones = [];
	let fc = cursor();
	fc.load('firewall');
	fc.foreach('firewall', 'zone', (z) => push(zones, z.name));
	let host = m.settings.portal_host;
	if (!host) {
		// Prefer a DDNS name, then an ACME certificate's, then the WAN address.
		let dc = cursor();
		if (dc.load('ddns'))
			dc.foreach('ddns', 'service', (s) => {
				if (!host && s.lookup_host && s.enabled == '1')
					host = s.lookup_host;
			});
		if (!host)
			host = sh_out("ls /etc/ssl/acme/ 2>/dev/null | sed -n 's/\\.fullchain\\.crt$//p' | head -n1") || '';
		if (!host)
			host = live.iface_status('wan')?.['ipv4-address']?.[0]?.address ?? '';
	}
	return {
		id: free_server_id(m),
		name: length(m.servers) ? `Server ${length(m.servers) + 1}` : 'Home',
		ifname: free_ifname(m),
		port: free_port(m),
		subnet: free_subnet(taken),
		endpoint: host,
		mtu: 1380,
		zones,
		lan_zone: index(zones, 'lan') >= 0 ? 'lan' : zones[0],
		wan_zone: index(zones, 'wan') >= 0 ? 'wan' : zones[1],
		portal_port: free_portal_port(m.settings.portal_port),
		awg: awg.caps(),
		awg_state: awg.state(),
		taken,
	};
}

/** AmneziaWG can run a server: installed, and its kernel module loads. */
function need_awg_loaded() {
	devices.need_awg();
	if (awg.state().loaded)
		return;
	system('modprobe amneziawg >/dev/null 2>&1');
	if (!awg.state().loaded)
		die("AmneziaWG's kernel module doesn't load on this firmware: reinstall a build for this kernel in Components.");
}

/** An MTU as typed: '' (the default) or 1280-1500. */
function check_mtu(v) {
	let s = str(v);
	if (s != '' && (!match(s, /^[0-9]{1,4}$/) || +s < 1280 || +s > 1500))
		die('MTU must be 1280-1500.');
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
			die('Server ID may use lowercase letters, digits and underscores.');
		if (!id_free(m, id))
			die(`"${id}" is already taken.`);
		let nc = cursor();
		nc.load('network');
		let ifname = str(a.ifname) || free_ifname(m);
		if (!ifname_free(m, nc, ifname))
			die(`Network interface ${ifname} already exists.`);
		let port = free_port(m);
		if (a.port != null && str(a.port) != '' && str(a.port) != '0') {
			if (!schema.valid_port(a.port))
				die('UDP port must be 1-65535.');
			port = +str(a.port);
		}
		for (let sid, o in m.servers)
			if (o.port == port)
				die(`UDP ${port} is used by ${o.name}.`);
		let mtu = check_mtu(a.mtu == 0 ? '' : a.mtu) || '1380';
		let preset = str(a.preset) || 'standard';
		let srv = { id, ifname, port, subnet: str(a.subnet), endpoint: str(a.endpoint), obf: awg.obf_preset(check_method(preset)) };
		let pc = parse_cidr(srv.subnet);
		if (pc)
			srv.subnet = cidr_str(pc);
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
		set('name', str(a.name) || 'Home');
		set('ifname', ifname);
		set('port', `${port}`);
		set('subnet', srv.subnet);
		if (srv.endpoint)
			set('endpoint', srv.endpoint);
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
		set('lan_like', a.lan_like === false || a.lan_like === '0' ? '0' : '1');
		set('enabled', '1');
		if (a.portal_enabled != null) {
			let on = a.portal_enabled === true || a.portal_enabled === 1 || a.portal_enabled === '1';
			c.set(core.CONFIG, 'settings', 'portal_enabled', on ? '1' : '0');
			if (a.portal_port != null && str(a.portal_port) != '' && str(a.portal_port) != '0') {
				if (!schema.valid_port(a.portal_port))
					die('Portal port must be 1-65535.');
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
	sh_bg('/etc/init.d/dawnline restart');
	return { id, applied: r };
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
		die('No server yet.');
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
			die('Unknown server.');
		if (!auto_wan) {
			if (!snap.devices[wan_dev])
				die('Choose the interface that leads to the internet.');
			if (!snap.devices[wan_dev].zone)
				die(`${wan_dev} is not in a firewall zone, so the server port cannot be opened on it.`);
		}
		let lans = [];
		for (let d in (type(a.lan_devices) == 'array' ? a.lan_devices : [])) {
			d = str(d);
			// Unknown names are kept only if they were saved before (interface down right now).
			if (d == '' || d == srv.ifname || (!snap.devices[d] && index(srv.lan_devices, d) < 0))
				continue;
			if (snap.devices[d]?.master)
				die(`${d} is part of ${snap.devices[d].master}; choose ${snap.devices[d].master} instead.`);
			if (d == (auto_wan ? snap.wan : wan_dev))
				die(`${d} is the WAN.`);
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
			die(`${d} is not an IP address.`);
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
			die('Unknown server.');
		let set = (k, val) => (val == null || val == '') ? c.delete(core.CONFIG, srv.id, k) : c.set(core.CONFIG, srv.id, k, val);
		if (v.name != null) {
			if (str(v.name) == '')
				die('Name cannot be empty.');
			set('name', str(v.name));
		}
		if (v.endpoint != null) {
			if (str(v.endpoint) == '' || !valid_host(str(v.endpoint)))
				die('Public address must be a hostname or IP address.');
			set('endpoint', str(v.endpoint));
		}
		if (v.port != null) {
			if (!schema.valid_port(v.port))
				die('UDP port must be 1-65535.');
			let n = +str(v.port);
			for (let id, o in m.servers)
				if (id != srv.id && o.port == n)
					die(`UDP ${n} is used by ${o.name}.`);
			set('port', `${n}`);
		}
		if (v.enabled != null)
			set('enabled', v.enabled === true || v.enabled == '1' ? '1' : '0');
		if (v.mesh != null) {
			if (index(core.MESH, v.mesh) < 0)
				die('Unknown choice for devices reaching each other.');
			set('mesh', v.mesh);
			set('device_mesh', null);
		}
		if (v.mtu != null)
			set('mtu', check_mtu(v.mtu));
		if (v.keepalive != null) {
			if (str(v.keepalive) != '' && (!match(str(v.keepalive), /^[0-9]{1,3}$/) || +v.keepalive > 600))
				die('Keep-alive must be 0-600 seconds.');
			set('keepalive', str(v.keepalive));
		}
		if (v.dns != null) {
			let list = dns_list(v.dns);
			if (length(list))
				c.set(core.CONFIG, srv.id, 'dns', list);
			else
				c.delete(core.CONFIG, srv.id, 'dns');
		}
		return srv;
	});
	// For the log: what changed, in words. Turning on or off is its own line.
	let labels = { name: 'name', endpoint: 'public address', port: 'AmneziaWG port', mtu: 'MTU', keepalive: 'keep-alive', dns: 'DNS' };
	let what = [];
	for (let k, label in labels) {
		if (v[k] == null)
			continue;
		let was = k == 'dns' ? join(' ', srv.dns ?? []) : `${srv[k] ?? ''}`;
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

function server_obfuscation(a) {
	let preset = str(a.preset) || 'standard';
	let o = awg.obf_preset(check_method(preset));
	let srv = store.transact((c, m) => {
		let srv = m.servers[a.id];
		if (!srv)
			die('Unknown server.');
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
		die('Unknown server.');
	backup.backup_create('pre-delete');
	let res = store.transact((c, m) => {
		let srv = m.servers[a.id];
		if (!srv)
			die('Unknown server.');
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
	server_obfuscation: { args: { id: '', preset: '' }, call: wrap(server_obfuscation) },
	server_update: { args: { id: '', values: {} }, call: wrap(server_update) },
	interfaces: { args: { id: '' }, call: wrap(interfaces_get) },
	server_interfaces: {
		args: { id: '', auto_wan: false, wan_device: '', auto_lan: false, lan_devices: [], lan_like: false, device_mesh: true, mesh: '' },
		call: wrap(server_interfaces),
	},
	server_delete: { args: { id: '' }, call: wrap(server_delete) },
};
