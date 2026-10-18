// Dawnline: "Check access" — walks the same rules the nft table and the
// client configuration apply, and says in words where a connection stops.

'use strict';

import { ip2int, in_nets } from 'dawnline.util';
import * as core from 'dawnline.core';
import * as net from 'dawnline.net';
import * as live from 'dawnline.live';
import * as view from 'dawnline.view';
import * as awg from 'dawnline.awg';

const STATE_TEXT = {
	no_server: 'they have no server',
	server_off: 'their server is turned off',
	paused: 'they are paused',
	expired: 'their access has ended',
	quota: 'they used up their data',
	hours: 'it is outside their allowed hours',
};

const ACCESS_TEXT = { lan: 'Home only', internet: 'Internet only', both: 'Home and Internet' };

function step(ok, title, detail) {
	return { ok: !!ok, title, detail: detail ?? '' };
}

/** Add the step where it stops and end the walk. */
function stop(steps, s) {
	push(steps, s);
	return steps;
}

/** The tunnel subnet (of any server) that holds `ip`: never home, whatever routes cover it. */
function in_tunnels(m, ip) {
	let nets = [];
	for (let id, s in m.servers)
		for (let t in core.tunnels(s))
			push(nets, t.subnet);
	return in_nets(ip, nets);
}

/** "10.0.1.20:445" → [ip, port]; a device id → its address. */
function parse_target(m, s) {
	s = trim(`${s ?? ''}`);
	if (m.devices[s])
		return { dev: m.devices[s], ip: m.devices[s].address, port: null };
	let mm = match(s, /^([0-9.]+)(:([0-9]{1,5}))?$/);
	if (!mm || ip2int(mm[1]) == null)
		return null;
	let ip = mm[1];
	for (let id, d in m.devices)
		if (d.address == ip)
			return { dev: d, ip, port: mm[3] ? +mm[3] : null };
	return { ip, port: mm[3] ? +mm[3] : null };
}

function home_access(p) {
	return p.access == 'both' || (p.access == 'lan' && !length(p.services));
}

function peer_of(dmp, d) {
	return dmp.peers[d.public_key];
}

/** What the device sends to the router: its configuration's AllowedIPs. */
function routed(m, srv, p, d) {
	return { nets: awg.allowed_ips(m, srv, p), what: 'Its configuration', list: null };
}

/** The home network (interface) of a server that holds an address. */
function home_dev_of(srv, ip, snap) {
	for (let h in net.server_net(srv, snap).home)
		if (in_nets(ip, h.nets))
			return h.dev;
	return null;
}

function router_addrs(snap) {
	let out = [];
	for (let dev, d in snap.devices)
		for (let a in d.addrs ?? [])
			push(out, split(a, '/')[0]);
	return out;
}

function person_ok(m, p, d, states) {
	let st = states[p.id] ?? 'active';
	if (d.disabled)
		return step(false, `${d.name} is turned off`, 'Turn the device on again on its page.');
	if (st != 'active')
		return step(false, `${p.name} can't connect: ${STATE_TEXT[st] ?? st}`, '');
	return step(true, `${p.name} is active`, ACCESS_TEXT[p.access]);
}

function connected(dmp, d, who) {
	let peer = peer_of(dmp, d);
	if (!peer || !(peer.handshake > 0))
		return step(false, `${who} has never connected`, 'There is no session the router could reach.');
	if (!live.online(dmp, d.id, peer))
		return step(false, `${who} isn't connected right now`, 'The router reaches it only while its VPN is on.');
	return step(true, `${who} is connected`, '');
}

/** A device → somewhere: the router, home, another device or the internet. */
function from_device(m, d, t, states, dmp, snap) {
	let p = m.people[d.person];
	let srv = p ? m.servers[p.server] : null;
	if (!p || !srv)
		return [ step(false, `${d.name} has no server`, '') ];
	let steps = [ person_ok(m, p, d, states) ];
	if (!steps[0].ok)
		return steps;
	let r = routed(m, srv, p, d);
	let allowed = r.nets;
	let via = (ip) => {
		let hit = in_nets(ip, allowed);
		let what = r.list ? `${r.what}: ${r.list}` : `AllowedIPs ${join(', ', filter(allowed, (x) => index(x, ':') < 0))}`;
		return hit
			? step(true, `${r.what} sends it to the router`, what)
			: step(false, `${r.what} doesn't send it to the router`, `${what}: the device's own network handles it.`);
	};

	// Another device.
	if (t.dev) {
		let q = m.people[t.dev.person];
		let who = `${q?.name ?? '?'} · ${t.dev.name}`;
		if (t.dev.id == d.id)
			return [ step(false, 'That is the same device', '') ];
		if (!q || q.server != p.server)
			return stop(steps, step(false, `${who} is on another server`, 'Devices of different servers never reach each other.'));
		if (!home_access(p))
			return stop(steps, step(false, `${p.name} has ${ACCESS_TEXT[p.access]}`, 'Only people with home access reach other devices.'));
		if (!home_access(q))
			return stop(steps, step(false, `${q.name} has ${ACCESS_TEXT[q.access]}`, 'Only devices of people with home access can be reached.'));
		if (srv.mesh == 'off')
			return stop(steps, step(false, `"Devices reach each other" is off on ${srv.name}`, 'Server → Access → Home network.'));
		if (srv.mesh == 'circles' && q.id != p.id) {
			let a = core.person_circle(m, p), b = core.person_circle(m, q);
			if (!a || !b || a.id != b.id)
				return stop(steps, step(false, `${p.name} and ${q.name} are not in one circle`,
					`${p.name}: ${a?.name ?? 'no circle'} · ${q.name}: ${b?.name ?? 'no circle'}`));
			push(steps, step(true, `Both are in ${a.name}`, 'Devices in one circle reach each other.'));
		}
		else
			push(steps, step(true, q.id == p.id ? `Both are ${p.name}'s devices` : 'Devices reach each other on this server', ''));
		let st = states[q.id] ?? 'active';
		if (st != 'active' || t.dev.disabled)
			return stop(steps, step(false, `${who} can't be reached: ${t.dev.disabled ? 'it is turned off' : STATE_TEXT[st] ?? st}`, ''));
		push(steps, via(t.ip));
		push(steps, connected(dmp, t.dev, who));
		return steps;
	}

	// The router itself.
	if (index(router_addrs(snap), t.ip) >= 0) {
		let portal = m.settings.portal_enabled && (t.port == m.settings.portal_port || (core.portal_http(m) && t.port == core.portal_http_port(m)));
		if (t.port == 53)
			push(steps, step(true, `${t.ip} is this router: DNS is open to everyone`, ''));
		else if (portal)
			push(steps, step(true, `${t.ip} is this router: the personal portal is open to everyone`, ''));
		else if (!home_access(p))
			return stop(steps, step(false, `${t.ip} is this router`, `${p.name} has ${ACCESS_TEXT[p.access]}: only DNS and the portal on the router.`));
		else {
			// Like any home address: only on the networks the person reaches.
			let h = core.person_home(srv, p, snap);
			if (!h.all && !in_nets(t.ip, h.nets))
				return stop(steps, step(false, `${t.ip} is this router on a network ${p.name} doesn't reach`, `${p.name} reaches ${join(', ', h.devs) || 'no home network'}.`));
			push(steps, step(true, `${t.ip} is this router`, h.all ? 'Home access includes the router.' : `On one of the networks ${p.name} reaches.`));
		}
		push(steps, via(t.ip));
		return steps;
	}

	// A tunnel address no device has.
	let tn = in_tunnels(m, t.ip);
	if (tn)
		return stop(steps, step(false, `No device uses ${t.ip}`, `It is in the tunnel network ${tn}.`));

	// Home.
	let sn = net.server_net(srv, snap);
	let hdev = home_dev_of(srv, t.ip, snap);
	if (hdev) {
		if (p.access == 'internet')
			return stop(steps, step(false, `${t.ip} is at home (${hdev})`, `${p.name} has Internet only.`));
		if (p.access == 'lan' && length(p.services)) {
			let hit = null;
			for (let sid in p.services) {
				let s = m.services[sid];
				if (s?.address == t.ip && (!length(s.ports) || t.port == null || index(s.ports, `${t.port}`) >= 0))
					hit = s;
			}
			let names = join(', ', map(filter(map(p.services, (x) => m.services[x]), (x) => x), (x) => x.name));
			if (!hit)
				return stop(steps, step(false, `${t.ip}${t.port ? `:${t.port}` : ''} is not one of ${p.name}'s home services`, `Allowed: ${names}`));
			push(steps, step(true, `${t.ip} is ${hit.name}, one of ${p.name}'s home services`,
				length(hit.ports) ? `Ports ${join(', ', hit.ports)}` : 'All ports'));
		}
		else {
			let h = core.person_home(srv, p, snap);
			if (!in_nets(t.ip, h.nets))
				return stop(steps, step(false, `${t.ip} is in ${hdev}, which ${p.name} doesn't reach`, `${p.name} reaches ${join(', ', h.devs) || 'no home network'}.`));
			push(steps, step(true, `${t.ip} is in ${hdev}`, h.all ? 'Home access reaches every home network.' : `One of the networks ${p.name} reaches.`));
		}
		push(steps, via(t.ip));
		push(steps, step(true, 'The firewall lets it through', `${srv.ifname} → ${join(', ', sn.zones) || 'home'}`));
		return steps;
	}

	// Another private address, or the internet.
	if (in_nets(t.ip, [ '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '169.254.0.0/16' ]))
		return stop(steps, step(false, `${t.ip} isn't in ${srv.name}'s home network`, 'Private addresses outside the home network are blocked.'));
	if (p.access == 'lan')
		return stop(steps, step(true, `${t.ip} is on the internet`, `${p.name} has Home only: their device's own internet reaches it, not the tunnel.`));
	push(steps, via(t.ip));
	push(steps, step(true, `${t.ip} is on the internet`, srv.lan_like ? 'It leaves like a home device would.' : `It leaves through ${sn.wan.dev ?? 'the WAN'}.`));
	return steps;
}

/** A home address → a device. */
function to_device(m, ip, d, states, dmp, snap) {
	let p = m.people[d.person];
	let srv = p ? m.servers[p.server] : null;
	if (!p || !srv)
		return [ step(false, `${d.name} has no server`, '') ];
	let who = `${p.name} · ${d.name}`;
	let hdev = in_tunnels(m, ip) ? null : home_dev_of(srv, ip, snap);
	if (!hdev)
		return [ step(false, `${ip} isn't in ${srv.name}'s home network`, 'Only home devices reach people\'s devices.') ];
	let steps = [ step(true, `${ip} is at home (${hdev})`, '') ];
	if (!home_access(p))
		return stop(steps, step(false, `${p.name} has ${p.access == 'lan' ? 'only some home services' : ACCESS_TEXT[p.access]}`,
			'Home devices reach only people with home access.'));
	let h = core.person_home(srv, p, snap);
	if (!in_nets(ip, h.nets))
		return stop(steps, step(false, `${p.name} doesn't reach ${hdev}`, 'Networks a person does not reach cannot reach them either.'));
	push(steps, person_ok(m, p, d, states));
	if (!steps[length(steps) - 1].ok)
		return steps;
	push(steps, step(true, 'The firewall lets it through', `${join(', ', net.server_net(srv, snap).zones) || 'home'} → ${srv.ifname}`));
	push(steps, connected(dmp, d, who));
	return steps;
}

/** `from` and `to`: a device id, or an IPv4 address (optionally :port). */
export function check(m, from, to) {
	let a = parse_target(m, from), b = parse_target(m, to);
	if (!a)
		die(`"${from}" is not a device or an IPv4 address.`);
	if (!b)
		die(`"${to}" is not a device or an IPv4 address.`);
	let usage = core.load_usage();
	let states = view.states(m, usage);
	let dmp = live.dump(m);
	let snap = net.snapshot(true);
	let steps;
	if (a.dev)
		steps = from_device(m, a.dev, b, states, dmp, snap);
	else if (b.dev)
		steps = to_device(m, a.ip, b.dev, states, dmp, snap);
	else
		die('Choose a device on at least one side.');
	let ok = length(filter(steps, (s) => !s.ok)) == 0;
	return { ok, steps };
};
