// Dawnline: "Check access" — walks the same rules the nft table and the
// client configuration apply, and says in words where a connection stops
// (in the admin's language: each step is a whole sentence).

'use strict';

import { ip2int, in_nets } from 'dawnline.util';
import * as core from 'dawnline.core';
import * as net from 'dawnline.net';
import * as live from 'dawnline.live';
import * as view from 'dawnline.view';
import * as awg from 'dawnline.awg';
import { _ } from 'dawnline.i18n';

/** "Bob can't connect: they are paused", by the person's state (core.person_state). */
function cant_connect(name, st) {
	if (st == 'no_server')
		return sprintf(_("%s can't connect: they have no server"), name);
	if (st == 'server_off')
		return sprintf(_("%s can't connect: their server is turned off"), name);
	if (st == 'paused')
		return sprintf(_("%s can't connect: they are paused"), name);
	if (st == 'expired')
		return sprintf(_("%s can't connect: their access has ended"), name);
	if (st == 'quota')
		return sprintf(_("%s can't connect: they used up their data"), name);
	if (st == 'hours')
		return sprintf(_("%s can't connect: it is outside their allowed hours"), name);
	return sprintf(_("%s can't connect: %s"), name, st);
}

/** "Bob · Phone can't be reached: it is turned off", by the device and its person's state. */
function cant_reach(who, disabled, st) {
	if (disabled)
		return sprintf(_("%s can't be reached: it is turned off"), who);
	if (st == 'no_server')
		return sprintf(_("%s can't be reached: they have no server"), who);
	if (st == 'server_off')
		return sprintf(_("%s can't be reached: their server is turned off"), who);
	if (st == 'paused')
		return sprintf(_("%s can't be reached: they are paused"), who);
	if (st == 'expired')
		return sprintf(_("%s can't be reached: their access has ended"), who);
	if (st == 'quota')
		return sprintf(_("%s can't be reached: they used up their data"), who);
	if (st == 'hours')
		return sprintf(_("%s can't be reached: it is outside their allowed hours"), who);
	return sprintf(_("%s can't be reached: %s"), who, st);
}

/** A person's access as the admin page names it. */
function access_text(a) {
	if (a == 'lan')
		return _('Home only');
	if (a == 'internet')
		return _('Internet only');
	if (a == 'both')
		return _('Home and Internet');
	return a;
}

/** "Bob has Internet only": the step where access stops a connection. */
function has_access(name, a) {
	if (a == 'lan')
		return sprintf(_('%s has Home only'), name);
	if (a == 'internet')
		return sprintf(_('%s has Internet only'), name);
	return sprintf(_('%s has Home and Internet'), name);
}

/** "Bob reaches lan, guest." (the person's home networks), or that there is none. */
function reaches(name, devs) {
	return length(devs) ? sprintf(_('%s reaches %s.'), name, join(', ', devs)) : sprintf(_('%s reaches no home network.'), name);
}

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

/** What the device sends to the router: its configuration's AllowedIPs (its own, with lan_bypass). */
function routed(m, srv, p, d) {
	return awg.allowed_ips(m, srv, p, d);
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
		return step(false, sprintf(_('%s is turned off'), d.name), _('Turn the device on again on its page.'));
	if (st != 'active')
		return step(false, cant_connect(p.name, st), '');
	return step(true, sprintf(_('%s is active'), p.name), access_text(p.access));
}

function connected(dmp, d, who) {
	let peer = peer_of(dmp, d);
	if (!peer || !(peer.handshake > 0))
		return step(false, sprintf(_('%s has never connected'), who), _('There is no session the router could reach.'));
	if (!live.online(dmp, d.id, peer))
		return step(false, sprintf(_("%s isn't connected right now"), who), _('The router reaches it only while its VPN is on.'));
	return step(true, sprintf(_('%s is connected'), who), '');
}

/** A device → somewhere: the router, home, another device or the internet. */
function from_device(m, d, t, states, dmp, snap) {
	let p = m.people[d.person];
	let srv = p ? m.servers[p.server] : null;
	if (!p || !srv)
		return [ step(false, sprintf(_('%s has no server'), d.name), '') ];
	let steps = [ person_ok(m, p, d, states) ];
	if (!steps[0].ok)
		return steps;
	let allowed = routed(m, srv, p, d);
	let via = (ip) => {
		let hit = in_nets(ip, allowed);
		// The configuration's own words: the option and its value.
		let what = `AllowedIPs ${join(', ', filter(allowed, (x) => index(x, ':') < 0))}`;
		return hit
			? step(true, _('Its configuration sends it to the router'), what)
			: step(false, _("Its configuration doesn't send it to the router"), sprintf(_("%s: the device's own network handles it."), what));
	};

	// Another device.
	if (t.dev) {
		let q = m.people[t.dev.person];
		let who = `${q?.name ?? '?'} · ${t.dev.name}`;
		if (t.dev.id == d.id)
			return [ step(false, _('That is the same device'), '') ];
		if (!q || q.server != p.server)
			return stop(steps, step(false, sprintf(_('%s is on another server'), who), _('Devices of different servers never reach each other.')));
		if (!home_access(p))
			return stop(steps, step(false, has_access(p.name, p.access), _('Only people with home access reach other devices.')));
		if (!home_access(q))
			return stop(steps, step(false, has_access(q.name, q.access), _('Only devices of people with home access can be reached.')));
		if (srv.mesh == 'off')
			return stop(steps, step(false, sprintf(_('"Devices reach each other" is off on %s'), srv.name), _('Server → Access → Home network.')));
		if (srv.mesh == 'circles' && q.id != p.id) {
			let a = core.person_circle(m, p), b = core.person_circle(m, q);
			if (!a || !b || a.id != b.id)
				return stop(steps, step(false, sprintf(_('%s and %s are not in one circle'), p.name, q.name),
					`${p.name}: ${a?.name ?? _('no circle')} · ${q.name}: ${b?.name ?? _('no circle')}`));
			push(steps, step(true, sprintf(_('Both are in %s'), a.name), _('Devices in one circle reach each other.')));
		}
		else
			push(steps, step(true, q.id == p.id ? sprintf(_("Both are %s's devices"), p.name) : _('Devices reach each other on this server'), ''));
		let st = states[q.id] ?? 'active';
		if (st != 'active' || t.dev.disabled)
			return stop(steps, step(false, cant_reach(who, t.dev.disabled, st), ''));
		push(steps, via(t.ip));
		push(steps, connected(dmp, t.dev, who));
		return steps;
	}

	// A device that keeps its own local network out of the tunnel (lan_bypass;
	// Home only is the same either way) sends a private address there, router
	// or home address alike: it never reaches this router's rules.
	if (d.lan_bypass && p.access != 'lan' && !in_nets(t.ip, allowed))
		return stop(steps, via(t.ip));

	// The router itself.
	if (index(router_addrs(snap), t.ip) >= 0) {
		let portal = m.settings.portal_enabled && (t.port == m.settings.portal_port || (core.portal_http(m) && t.port == core.portal_http_port(m)));
		if (t.port == 53)
			push(steps, step(true, sprintf(_('%s is this router: DNS is open to everyone'), t.ip), ''));
		else if (portal)
			push(steps, step(true, sprintf(_('%s is this router: the personal portal is open to everyone'), t.ip), ''));
		else if (!home_access(p))
			return stop(steps, step(false, sprintf(_('%s is this router'), t.ip), sprintf(p.access == 'lan'
				? _('%s has Home only: only DNS and the portal on the router.')
				: _('%s has Internet only: only DNS and the portal on the router.'), p.name)));
		else {
			// Like any home address: only on the networks the person reaches.
			let h = core.person_home(srv, p, snap);
			if (!h.all && !in_nets(t.ip, h.nets))
				return stop(steps, step(false, sprintf(_("%s is this router on a network %s doesn't reach"), t.ip, p.name), reaches(p.name, h.devs)));
			push(steps, step(true, sprintf(_('%s is this router'), t.ip),
				h.all ? _('Home access includes the router.') : sprintf(_('On one of the networks %s reaches.'), p.name)));
		}
		push(steps, via(t.ip));
		return steps;
	}

	// A tunnel address no device has.
	let tn = in_tunnels(m, t.ip);
	if (tn)
		return stop(steps, step(false, sprintf(_('No device uses %s'), t.ip), sprintf(_('It is in the tunnel network %s.'), tn)));

	// Home.
	let sn = net.server_net(srv, snap);
	let hdev = home_dev_of(srv, t.ip, snap);
	if (hdev) {
		if (p.access == 'internet')
			return stop(steps, step(false, sprintf(_('%s is at home (%s)'), t.ip, hdev), sprintf(_('%s has Internet only.'), p.name)));
		if (p.access == 'lan' && length(p.services)) {
			let hit = null;
			for (let sid in p.services) {
				let s = m.services[sid];
				if (s?.address == t.ip && (!length(s.ports) || t.port == null || index(s.ports, `${t.port}`) >= 0))
					hit = s;
			}
			let names = join(', ', map(filter(map(p.services, (x) => m.services[x]), (x) => x), (x) => x.name));
			if (!hit)
				return stop(steps, step(false, sprintf(_("%s is not one of %s's home services"), t.port ? `${t.ip}:${t.port}` : t.ip, p.name),
					sprintf(_('Allowed: %s'), names)));
			push(steps, step(true, sprintf(_("%s is %s, one of %s's home services"), t.ip, hit.name, p.name),
				length(hit.ports) ? sprintf(_('Ports %s'), join(', ', hit.ports)) : _('All ports')));
		}
		else {
			let h = core.person_home(srv, p, snap);
			if (!in_nets(t.ip, h.nets))
				return stop(steps, step(false, sprintf(_("%s is in %s, which %s doesn't reach"), t.ip, hdev, p.name), reaches(p.name, h.devs)));
			push(steps, step(true, sprintf(_('%s is in home network %s'), t.ip, hdev),
				h.all ? _('Home access reaches every home network.') : sprintf(_('One of the networks %s reaches.'), p.name)));
		}
		push(steps, via(t.ip));
		push(steps, step(true, _('The firewall lets it through'), `${srv.ifname} → ${join(', ', sn.zones) || _('home')}`));
		return steps;
	}

	// Another private address, or the internet.
	if (in_nets(t.ip, [ '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '169.254.0.0/16' ]))
		return stop(steps, step(false, sprintf(_("%s isn't in %s's home network"), t.ip, srv.name), _('Private addresses outside the home network are blocked.')));
	if (p.access == 'lan')
		return stop(steps, step(true, sprintf(_('%s is on the internet'), t.ip),
			sprintf(_("%s has Home only: their device's own internet reaches it, not the tunnel."), p.name)));
	push(steps, via(t.ip));
	push(steps, step(true, sprintf(_('%s is on the internet'), t.ip), srv.lan_like ? _('It leaves like a home device would.')
		: sn.wan.dev != null ? sprintf(_('It leaves through %s.'), sn.wan.dev) : _('It leaves through the WAN.')));
	return steps;
}

/** A home address → a device. */
function to_device(m, ip, d, states, dmp, snap) {
	let p = m.people[d.person];
	let srv = p ? m.servers[p.server] : null;
	if (!p || !srv)
		return [ step(false, sprintf(_('%s has no server'), d.name), '') ];
	let who = `${p.name} · ${d.name}`;
	let hdev = in_tunnels(m, ip) ? null : home_dev_of(srv, ip, snap);
	if (!hdev)
		return [ step(false, sprintf(_("%s isn't in %s's home network"), ip, srv.name), _("Only home devices reach people's devices.")) ];
	let steps = [ step(true, sprintf(_('%s is at home (%s)'), ip, hdev), '') ];
	if (!home_access(p))
		return stop(steps, step(false, p.access == 'lan' ? sprintf(_('%s has only some home services'), p.name) : has_access(p.name, p.access),
			_('Home devices reach only people with home access.')));
	let h = core.person_home(srv, p, snap);
	if (!in_nets(ip, h.nets))
		return stop(steps, step(false, sprintf(_("%s doesn't reach %s"), p.name, hdev), _('Networks a person does not reach cannot reach them either.')));
	push(steps, person_ok(m, p, d, states));
	if (!steps[length(steps) - 1].ok)
		return steps;
	push(steps, step(true, _('The firewall lets it through'), `${join(', ', net.server_net(srv, snap).zones) || _('home')} → ${srv.ifname}`));
	push(steps, connected(dmp, d, who));
	return steps;
}

/**
 * `from` and `to`: a device id, or an IPv4 address (optionally :port).
 * `ctx` = { states, dmp, snap } (a test's own); read from the router when not
 * given. Returns { ok, steps: [{ ok, title, detail }] }.
 */
export function check(m, from, to, ctx) {
	let a = parse_target(m, from), b = parse_target(m, to);
	if (!a)
		die(sprintf(_('"%s" is not a device or an IPv4 address.'), from));
	if (!b)
		die(sprintf(_('"%s" is not a device or an IPv4 address.'), to));
	let states = ctx?.states ?? view.states(m, core.load_usage());
	let dmp = ctx?.dmp ?? live.dump(m);
	let snap = ctx?.snap ?? net.snapshot(true);
	let steps;
	if (a.dev)
		steps = from_device(m, a.dev, b, states, dmp, snap);
	else if (b.dev)
		steps = to_device(m, a.ip, b.dev, states, dmp, snap);
	else
		die(_('Choose a device on at least one side.'));
	let ok = length(filter(steps, (s) => !s.ok)) == 0;
	return { ok, steps };
};
