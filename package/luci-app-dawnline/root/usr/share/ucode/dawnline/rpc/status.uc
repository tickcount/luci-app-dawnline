// Dawnline rpcd methods: the live revision, the Overview status (servers,
// people, totals, map, recent activity), the activity log and traffic history.

import { readfile } from 'fs';
import { read_json, write_json, ensure_dir, lock, unlock, admin_log, VERSION, RUN_DIR } from 'dawnline.util';
import * as core from 'dawnline.core';
import * as live from 'dawnline.live';
import * as view from 'dawnline.view';
import * as geo from 'dawnline.geo';
import * as net from 'dawnline.net';
import * as loop from 'dawnline.loop';
import * as awg from 'dawnline.awg';
import * as lookup from 'dawnline.lookup';
import * as health from 'dawnline.health';
import { wrap, str, clamp_days } from 'dawnline.rpc.common';

/** The router's public IPv4 (null when none or private). */
function wan_public(m) {
	let w = lookup.router_wan(m);
	return w && health.wan_kind(w) == 'public' ? w : null;
}

/** The router's own public addresses: a device at home that reaches the server through the WAN address (NAT loopback) is not "outside". */
function own_addresses(m) {
	let own = {};
	for (let id, srv in m.servers) {
		let a = net.wan_address(srv) ?? lookup.wan_ipv4(srv.wan_zone);
		if (a)
			own[a] = true;
	}
	let wan = lookup.wan_ipv4('wan');
	if (wan)
		own[wan] = true;
	return own;
}

/** Router location plus one point per (device, recent client address). */
function geo_view(m, usage, dmp) {
	if (!m.settings.geo_enabled)
		return { enabled: false, home: null, points: [] };
	let cache = geo.load();
	let points = [];
	let now = time();
	// The router's own public addresses: a device at home that reaches the server through the
	// WAN address (NAT loopback) shows up from there. Home is not a place people connect from.
	let own = {};
	for (let id, srv in m.servers) {
		let a = net.wan_address(srv) ?? lookup.wan_ipv4(srv.wan_zone);
		if (a)
			own[a] = true;
	}
	let wan = lookup.wan_ipv4('wan');
	if (wan)
		own[wan] = true;
	for (let id, d in m.devices) {
		let rec = usage.devices?.[id];
		let peer = dmp.peers[d.public_key];
		let cur = live.endpoint_ip(peer?.endpoint);
		let online = live.online(dmp, id, peer);
		for (let ip, ts in rec?.ips ?? {}) {
			// Local (LAN / CGNAT) client addresses and the router's own are not shown on the map.
			let pl = geo.is_public(ip) && !own[ip] ? geo.place(cache, ip) : null;
			if (!pl)
				continue;
			push(points, {
				person: d.person, device: id, ip, ts,
				online: online && ip == cur,
				lat: pl.lat, lon: pl.lon, city: pl.city, country: pl.country, cc: pl.cc,
				asn: pl.asn ?? 0, org: pl.org ?? '',
			});
		}
	}
	let h = cache.home;
	return {
		enabled: true,
		provider: m.settings.geo_provider,
		cached: length(keys(cache.ips)),
		home: (h && h.lat != null) ? { lat: h.lat, lon: h.lon, city: h.city, country: h.country, cc: h.cc, asn: h.asn ?? 0, org: h.org ?? '' } : null,
		points,
	};
}

/** Older connections from home get the DHCP name their address has now. */
function with_hosts(ev) {
	let names = null;
	for (let e in ev)
		if ((e.type == 'connect' || e.type == 'roam') && !e.hosts) {
			let h = net.event_hosts(e, names ??= net.lan_names());
			if (h)
				e.hosts = h;
		}
	return ev;
}

function server_view(m, srv, usage, dmp, rates, days) {
	let online = 0, peers = 0;
	let links = map(core.tunnels(srv), (t) => t.ifname);
	let ids = {};
	for (let id, d in m.devices)
		ids[d.public_key] = id;
	for (let k, p in dmp.peers)
		if (index(links, p.ifname) >= 0) {
			peers++;
			if (live.online(dmp, ids[k], p))
				online++;
		}
	let st = srv.private_key ? awg.server_state(srv) : { up: false, uptime: 0 };
	// The newest handshake from a public address that is not the router's own:
	// proof that the port is reachable from the internet.
	let own = own_addresses(m);
	let reached = 0;
	for (let id, d in m.devices)
		if (m.people[d.person]?.server == srv.id)
			for (let ip, ts in usage.devices?.[id]?.ips ?? {})
				if (geo.is_public(ip) && !own[ip] && ts > reached)
					reached = ts;
	return {
		id: srv.id, name: srv.name, ifname: srv.ifname, port: srv.port, subnet: srv.subnet, reached,
		endpoint: core.endpoint_host(m, srv), public_key: srv.public_key, enabled: srv.enabled,
		lan_like: srv.lan_like, device_mesh: srv.device_mesh, mesh: srv.mesh, preset: srv.preset, mtu: srv.mtu, keepalive: srv.keepalive, dns: srv.dns,
		// What devices get now, by kind (mtu 0 = automatic).
		mtus: { computer: core.device_mtu(srv, { kind: 'computer' }), phone: core.device_mtu(srv, { kind: 'phone' }) },
		address: core.server_address(srv), up: !!st.up, uptime: st.uptime ?? 0,
		// Why the tunnel cannot run (its interface name belongs to another network section), or null.
		blocked: srv.blocked ?? null,
		// Home networks (interfaces) for the per-person picker.
		home: map(net.server_net(srv).home, (h) => ({ dev: h.dev, nets: h.nets })),
		peers, online, obf: srv.obf,
		// Bytes per second, one point a minute: [ts, rx, tx] (rx = from devices).
		rate: rates[srv.id] ?? [],
		// Daily traffic of the people on this server (its Overview chart).
		series: live.series(map(filter(keys(m.people), (pid) => m.people[pid].server == srv.id), (pid) => usage.people?.[pid]), days),
	};
}

/*
 * Everything the pages show at once. Readable by read-only users: no personal
 * codes or links here (person_links has them).
 */
function status(a) {
	let m = core.load();
	let usage = core.load_usage();
	let dmp = live.dump(m);
	let states = view.states(m, usage);
	let days = clamp_days(a.days);

	let servers = [];
	let rates = read_json(`${RUN_DIR}/rate.json`, {});
	let prates = read_json(`${RUN_DIR}/rate_people.json`, {});
	for (let id, srv in m.servers)
		push(servers, server_view(m, srv, usage, dmp, rates, days));

	let people = [];
	for (let id, p in m.people) {
		let pv = view.person_view(m, p, usage, dmp, states, { admin: true });
		pv.rate = type(prates[p.id]?.[0]) == 'array' ? prates[p.id] : [];
		push(people, pv);
	}
	people = sort(people, (a, b) => (b.online - a.online) || (b.last_seen - a.last_seen) || (a.name < b.name ? -1 : 1));

	let totals = { people: length(people), devices: 0, online: 0, active: 0 };
	for (let p in people) {
		totals.devices += length(p.devices);
		totals.online += p.online;
		if (p.state == 'active')
			totals.active++;
	}
	let recs = values(usage.people ?? {});
	let day = live.series(recs, 1)[0];
	totals.today = [ day.rx, day.tx ];
	let mon = [ 0, 0 ];
	for (let r in recs) {
		let v = live.month(r);
		mon[0] += v[0];
		mon[1] += v[1];
	}
	totals.month = mon;

	let events = live.load_events();
	let s = m.settings;
	return {
		geo: geo_view(m, usage, dmp),
		version: VERSION,
		now: time(),
		hostname: trim(readfile('/proc/sys/kernel/hostname') ?? ''),
		settings: {
			portal_enabled: s.portal_enabled, portal_port: s.portal_port, portal_host: s.portal_host,
			portal_public_port: core.portal_public_port(m),
			default_device_limit: s.default_device_limit, domain: s.domain,
			hostnames: s.hostnames, geo_enabled: s.geo_enabled, home_dns_fallback: s.home_dns_fallback,
		},
		servers,
		people,
		services: values(m.services),
		circles: values(m.circles),
		totals,
		series: live.series(recs, days),
		events: with_hosts(slice(events, length(events) > 60 ? length(events) - 60 : 0)),
		like_home: loop.status(),
		awg: awg.caps(),
		awg_state: awg.state(),
		// The router's public IPv4 (null when none or private): a server whose public address is an old one is told so.
		wan: wan_public(m),
	};
}


/** The newest `limit` events; `person` keeps one person's only, `since` only those after a time. */
function events_list(a) {
	// Tunnel down/up events of older versions: the service log tells it better (names, reasons).
	let person = str(a.person), since = +a.since || 0;
	let ev = filter(live.load_events(), (e) => e.type != 'server_down' && e.type != 'server_up' &&
		(!person || e.person == person) && (!since || (e.ts ?? 0) > since));
	let n = +a.limit || 300;
	return { events: with_hosts(slice(ev, length(ev) > n ? length(ev) - n : 0)), total: length(ev), policy: live.policy() };
}

/** Remove activity by person, device, category and/or age; nothing given clears it all. */
function logs_clear(a) {
	let m = core.load();
	let f = {};
	if (a.person) {
		if (!m.people[a.person])
			die('Unknown person.');
		f.person = a.person;
	}
	if (a.device)
		f.device = a.device;
	if (a.category) {
		if (index(live.CATEGORIES, a.category) < 0)
			die('Unknown category.');
		f.category = a.category;
	}
	if (a.older_days) {
		if (!match(a.older_days, /^[1-9][0-9]{0,3}$/))
			die('Older than must be a number of days.');
		f.before = time() - +a.older_days * 86400;
	}
	let removed = live.clear_events(f);
	if (removed)
		admin_log('dawnline', 'cleared', null, 'the activity log',
			join(' · ', filter([ `${removed} event${removed == 1 ? '' : 's'}`, f.category, f.person ? m.people[f.person].name : null,
				a.older_days ? `older than ${a.older_days} days` : null ], (x) => x)));
	return { ok: true, removed };
}

/**
 * Reset traffic history (all | person | device). The agent owns the live
 * counters, so it gets a marker; the tmpfs copy is edited too so the UI
 * shows the result straight away.
 */
function usage_clear(a) {
	let m = core.load();
	if (index([ 'all', 'person', 'device' ], a.scope) < 0)
		die('Unknown scope.');
	if (a.scope == 'person' && !m.people[a.id])
		die('Unknown person.');
	if (a.scope == 'device' && !m.devices[a.id])
		die('Unknown device.');
	let req = { scope: a.scope, id: a.id, ts: time() };
	ensure_dir(RUN_DIR);
	let l = lock('usage-reset');
	let pending = read_json(`${RUN_DIR}/usage.reset`, []);
	push(pending, req);
	write_json(`${RUN_DIR}/usage.reset`, pending, 0o600);
	unlock(l);
	let usage = core.load_usage();
	if (usage) {
		live.reset_usage(usage, m, a.scope, a.id);
		write_json(`${RUN_DIR}/usage.json`, usage, 0o600);
	}
	admin_log('dawnline', 'reset traffic history', null,
		a.scope == 'all' ? 'for everyone' : a.scope == 'person' ? `for ${m.people[a.id].name}` : `for ${m.devices[a.id].name} (${m.people[m.devices[a.id].person]?.name})`);
	return { ok: true };
}

/** The live revision (dawnline.live.PRESENCE): pages refresh when it moves; 0 without the agent. */
/** The live revision, and the version answering (a page notices an update under it). */
function rev() {
	return { rev: +(live.presence()?.rev ?? 0), version: VERSION };
}

export const methods = {
	rev: { call: wrap(rev) },
	status: { args: { days: 30 }, call: wrap(status) },
	events: { args: { limit: 300, person: '', since: 0 }, call: wrap(events_list) },
	logs_clear: { args: { person: '', device: '', category: '', older_days: '' }, call: wrap(logs_clear) },
	usage_clear: { args: { scope: '', id: '' }, call: wrap(usage_clear) },
	geo_clear: { call: wrap((a) => { geo.clear(); return { ok: true }; }) },
};
