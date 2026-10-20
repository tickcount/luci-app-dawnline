// Dawnline — read models shared by the admin RPC and the portal: people and
// devices merged with live peer state and usage.

import * as core from 'dawnline.core';
import * as live from 'dawnline.live';
import * as awg from 'dawnline.awg';
import { day_key_ago, month_key } from 'dawnline.util';

/** Each day's [rx, tx] for the last `n` days, oldest first: the charts draw what came and what went apart. */
export function spark(rec, n) {
	let out = [];
	for (let i = n - 1; i >= 0; i--) {
		let v = rec?.days?.[day_key_ago(i)];
		push(out, v ? [ v[0], v[1] ] : [ 0, 0 ]);
	}
	return out;
};

/** Each day's [rx, tx] from the 1st of this month to today, oldest first (the portal's month chart). */
export function month_days(rec) {
	return spark(rec, +substr(day_key_ago(0), 8, 2));
};

/** The device holds an older configuration than the one it would get now. */
function config_stale(m, d) {
	m._issued ??= awg.issued();
	let was = m._issued[d.id];
	return was != null && was != awg.config_fingerprint(m, d);
}

/**
 * The device a page request came from (`devs`: one person's device views):
 * through the tunnel, by its tunnel address; outside it, the one online device
 * whose tunnel comes from the request's address. The apps route the VPN's own
 * address around their tunnel, and the portal shares it, so a device on the VPN
 * opens the page from where its tunnel comes from. Two such devices behind one
 * address (one NAT): neither.
 */
export function device_here(devs, peer) {
	peer = replace(peer ?? '', /^::ffff:/, '');
	if (!peer)
		return null;
	let near = [];
	for (let d in devs) {
		if (d.address == peer)
			return d.id;
		if (d.online && d.endpoint == peer)
			push(near, d.id);
	}
	return length(near) == 1 ? near[0] : null;
};

export function device_view(m, d, usage, dmp) {
	let u = usage.devices?.[d.id];
	let peer = dmp.peers[d.public_key];
	let ts = time();
	// Set up again (Reconnect): a handshake from before it does not count.
	m._reconnect ??= awg.reconnects();
	let hs = awg.handshake_since(peer?.handshake || u?.handshake || 0, m._reconnect[d.id]);
	let p = m.people[d.person];
	// The same label /tmp/hosts carries (core.device_labels), so what is shown resolves.
	let label = '';
	if (m.settings.hostnames && p) {
		m._labels ??= {};
		m._labels[p.id] ??= core.device_labels(m, p);
		label = m._labels[p.id][d.id] ?? 'device';
	}
	let v = {
		id: d.id,
		name: d.name,
		kind: d.kind,
		address: d.address,
		disabled: d.disabled,
		created: d.created,
		created_by: d.created_by,
		online: hs > 0 && live.online(dmp, d.id, peer),
		handshake: hs,
		endpoint: live.endpoint_ip(peer?.endpoint) || u?.endpoint || '',
		active: !!peer,
		month: live.month(u),
		total: u?.total ?? [ 0, 0 ],
		spark: spark(u, 7),
		hostname: label ? `${label}.${p.id}.${m.settings.domain}` : '',
		browser_key: d.private_key == '',
		// Its configuration changed since it was last shown or downloaded.
		config_stale: config_stale(m, d),
	};
	return v;
};

export function person_view(m, p, usage, dmp, states, opts) {
	opts ??= {};
	let u = usage.people?.[p.id];
	let devs = [];
	for (let id in p.devices)
		push(devs, device_view(m, m.devices[id], usage, dmp));
	devs = sort(devs, (a, b) => a.created - b.created);
	let used = core.person_usage(p, usage);
	let v = {
		id: p.id,
		name: p.name,
		server: p.server,
		access: p.access,
		device_limit: p.device_limit,
		expires: p.expires,
		quota_gb: p.quota_gb,
		quota_period: p.quota_period,
		quota_used: used,
		quota_limit: core.person_quota(p),
		bonus_gb: (p.bonus_gb > 0 && p.bonus_month == month_key()) ? p.bonus_gb : 0,
		expire_action: p.expire_action,
		dns_mode: p.dns_mode,
		expire_warn: p.expire_warn,
		paused: p.paused,
		hours: p.hours,
		state: states[p.id] ?? core.person_state(m, p, usage),
		month: live.month(u),
		total: u?.total ?? [ 0, 0 ],
		online: length(filter(devs, (d) => d.online)),
		last_seen: 0,
		devices: devs,
	};
	for (let d in devs)
		if (d.handshake > v.last_seen)
			v.last_seen = d.handshake;
	if (opts.admin) {
		// The code and links themselves are person_links' (admins only): the
		// code opens the person's portal and their devices' configurations.
		v.has_link = core.portal_url(m, p) != null;
		v.note = p.note;
		v.services = p.services;
		v.home_nets = p.home_nets;
		v.circle = p.circle;
		v.created = p.created;
		v.code_set = p.code_set;
	}
	return v;
};

export function states(m, usage) {
	let out = {};
	for (let id, p in m.people)
		out[id] = core.person_state(m, p, usage);
	return out;
};
