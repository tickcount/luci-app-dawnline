// Dawnline rpcd methods: what people reach at home — services (home
// devices and ports), circles (who reaches whom), the devices found at home,
// and "Check access".

import { readfile } from 'fs';
import { cursor } from 'uci';
import { sh_out, ip2int, rand_int, rand_hex, admin_log, valid_name, ulength, NAME_RULE } from 'dawnline.util';
import * as core from 'dawnline.core';
import * as apply from 'dawnline.apply';
import * as net from 'dawnline.net';
import * as access from 'dawnline.access';
import * as store from 'dawnline.store';
import * as schema from 'dawnline.schema';
import { wrap, str } from 'dawnline.rpc.common';

/* ---------- services ---------- */

/** A new id from make() that no section has yet. */
function new_id(m, make) {
	for (let i = 0; i < 20; i++) {
		let id = make();
		if (!store.id_taken(m, id))
			return id;
	}
	die('Could not find a free id, try again.');
}

function service_set(a) {
	let name = str(a.name);
	if (!valid_name(name))
		die(`Service: ${NAME_RULE}`);
	let address = str(a.address);
	if (!schema.ipv4(address))
		die('Address must be an IPv4 address.');
	let ports = filter(map(type(a.ports) == 'array' ? a.ports : split(str(a.ports), /[ ,]+/), str), (x) => x != '');
	for (let pt in ports)
		if (!schema.valid_port(pt))
			die(`Invalid port ${pt}.`);
	let id = store.transact((c, m) => {
		let id = str(a.id);
		if (id == '')
			id = new_id(m, () => `svc_${rand_int(100000, 999999)}`);
		else if (!match(id, /^[A-Za-z0-9_]{1,32}$/))
			die('Invalid service id.');
		// Never turn a person, device, server, circle or the settings into a service.
		else if (!m.services[id] && store.id_taken(m, id))
			die('That id is taken.');
		c.set(core.CONFIG, id, 'service');
		c.set(core.CONFIG, id, 'name', name);
		c.set(core.CONFIG, id, 'address', address);
		if (length(ports))
			c.set(core.CONFIG, id, 'port', ports);
		else
			c.delete(core.CONFIG, id, 'port');
		return id;
	});
	let s = apply.sync();
	return { id, warning: s.warning };
}

function service_delete(a) {
	store.transact((c, m) => {
		if (!m.services[a.id])
			die('Unknown service.');
		c.delete(core.CONFIG, a.id);
		for (let pid, p in m.people)
			if (index(p.services, a.id) >= 0) {
				let rest = filter(p.services, (x) => x != a.id);
				if (length(rest))
					c.set(core.CONFIG, pid, 'service', rest);
				else
					c.delete(core.CONFIG, pid, 'service');
			}
	});
	let s = apply.sync();
	return { ok: true, warning: s.warning };
}

/* ---------- circles ---------- */

/** Create or edit a circle; `members` (person ids) replaces who is in it. */
function circle_set(a) {
	let name = str(a.name);
	if (!valid_name(name) || ulength(name) > 32)
		die('Enter a circle name: up to 32 characters, without < > " or \\.');
	let res = store.transact((c, m) => {
		let ci = a.id ? m.circles[a.id] : null;
		if (a.id && !ci)
			die('Unknown circle.');
		let server = ci?.server ?? a.server;
		if (!m.servers[server])
			die('Unknown server.');
		for (let id, o in m.circles)
			if (id != a.id && o.server == server && lc(o.name) == lc(name))
				die(`${name} already exists.`);
		let id = ci?.id ?? new_id(m, () => `c_${rand_hex(4)}`);
		let n = core.CIRCLE_COLORS;
		c.set(core.CONFIG, id, 'circle');
		c.set(core.CONFIG, id, 'server', server);
		c.set(core.CONFIG, id, 'name', name);
		c.set(core.CONFIG, id, 'color', `${((int(a.color) || 0) % n + n) % n}`);
		if (type(a.members) == 'array') {
			let want = {};
			for (let pid in a.members)
				if (m.people[pid]?.server == server)
					want[pid] = true;
			for (let pid, p in m.people)
				if (want[pid])
					c.set(core.CONFIG, pid, 'circle', id);
				else if (p.circle == id)
					c.delete(core.CONFIG, pid, 'circle');
		}
		return { id, edit: !!ci, server: m.servers[server].name };
	});
	let s = apply.sync();
	admin_log('awg', res.edit ? 'changed' : 'added', 'circle', name, res.server);
	return { id: res.id, circles: values(core.load().circles), warning: s.warning };
}

function circle_delete(a) {
	let res = store.transact((c, m) => {
		let ci = m.circles[a.id];
		if (!ci)
			die('Unknown circle.');
		c.delete(core.CONFIG, a.id);
		for (let pid, p in m.people)
			if (p.circle == a.id)
				c.delete(core.CONFIG, pid, 'circle');
		return { name: ci.name, server: m.servers[ci.server]?.name };
	});
	let s = apply.sync();
	admin_log('awg', 'removed', 'circle', res.name, res.server);
	return { circles: values(core.load().circles), warning: s.warning };
}

/* ---------- devices at home ---------- */

/** True while OpenWrt's mDNS daemon answers on ubus. */
function mdns_running() {
	return index(split(sh_out('ubus list umdns 2>/dev/null') ?? '', '\n'), 'umdns') >= 0;
}

/**
 * Services announced on the home networks (Bonjour), from umdns:
 * [{ type: '_airplay._tcp', name, host, address, port, txt }].
 */
function mdns_services() {
	if (!mdns_running())
		return [];
	let r = {};
	try {
		r = json(sh_out(`ubus call umdns browse '{"address":true,"array":true}' 2>/dev/null`) || '{}') ?? {};
	}
	catch (e) {
		r = {};
	}
	let out = [];
	for (let t, insts in r)
		for (let name, i in insts) {
			let addr = type(i.ipv4) == 'array' ? i.ipv4[0] : i.ipv4;
			if (addr)
				push(out, { type: t, name, host: replace(i.host ?? '', /\.local\.?$/, ''), address: addr, port: i.port ?? 0, txt: i.txt ?? [] });
		}
	return out;
}

/**
 * Devices at home for the Home services picker: DHCP leases and static hosts
 * in the server's home networks, with the services they announce (Bonjour,
 * when umdns runs).
 */
function home_hosts(a) {
	let m = core.load();
	let srv = m.servers[a.id] ?? values(m.servers)[0];
	if (!srv)
		die('No server yet.');
	let nets = [];
	for (let cidr in net.server_net(srv).nets) {
		let x = match(cidr, /^([0-9.]+)\/([0-9]+)$/);
		if (x && ip2int(x[1]) != null)
			push(nets, [ ip2int(x[1]), 1 << (32 - +x[2]) ]);
	}
	let inside = (ip) => {
		let n = ip2int(ip);
		return n != null && length(filter(nets, (r) => n >= r[0] && n < r[0] + r[1])) > 0;
	};
	let hosts = {};
	for (let line in split(readfile('/tmp/dhcp.leases') ?? '', '\n')) {
		let f = split(line, ' ');
		if (length(f) >= 4 && inside(f[2]))
			hosts[f[2]] = { address: f[2], name: f[3] == '*' ? '' : f[3], mac: f[1], services: [] };
	}
	let c = cursor();
	if (c.load('dhcp'))
		c.foreach('dhcp', 'host', (h) => {
			if (h.ip && inside(h.ip))
				hosts[h.ip] ??= { address: h.ip, name: h.name ?? '', mac: type(h.mac) == 'array' ? h.mac[0] : h.mac ?? '', services: [] };
		});
	for (let s in mdns_services())
		if (hosts[s.address])
			push(hosts[s.address].services, { type: s.type, name: s.name, port: s.port });
		else if (inside(s.address))
			hosts[s.address] = { address: s.address, name: s.host ?? '', mac: '', services: [ { type: s.type, name: s.name, port: s.port } ] };
	return { hosts: sort(values(hosts), (x, y) => ip2int(x.address) - ip2int(y.address)), mdns: mdns_running() };
}

export const methods = {
	service_set: { args: { id: '', name: '', address: '', ports: [] }, call: wrap(service_set) },
	service_delete: { args: { id: '' }, call: wrap(service_delete) },
	circle_set: { args: { id: '', server: '', name: '', color: 0, members: [] }, call: wrap(circle_set) },
	circle_delete: { args: { id: '' }, call: wrap(circle_delete) },
	home_hosts: { args: { id: '' }, call: wrap(home_hosts) },
	access_check: { args: { from: '', to: '' }, call: wrap((a) => access.check(core.load(), a.from, a.to)) },
};
