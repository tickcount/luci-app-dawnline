// Dawnline — read models shared by the admin RPC and the portal: people and
// devices merged with live peer state and usage.

import * as core from 'dawnline.core';
import * as live from 'dawnline.live';
import { day_key, month_key } from 'dawnline.util';

/** Daily totals (rx+tx) for the last `n` days, oldest first. */
export function spark(rec, n) {
	let out = [], ts = time();
	for (let i = n - 1; i >= 0; i--) {
		let v = rec?.days?.[day_key(ts - i * 86400)];
		push(out, v ? v[0] + v[1] : 0);
	}
	return out;
};

function config_stale(m, d) {
	m._issued ??= core.issued();
	let was = m._issued[d.id];
	return was != null && was != core.config_fingerprint(m, d);
}

export function device_view(m, d, usage, dmp) {
	let u = usage.devices?.[d.id];
	let peer = dmp.peers[d.public_key];
	let ts = time();
	let hs = peer?.handshake || u?.handshake || 0;
	let p = m.people[d.person];
	return {
		id: d.id,
		name: d.name,
		kind: d.kind,
		address: d.address,
		disabled: d.disabled,
		created: d.created,
		created_by: d.created_by,
		online: !!(peer && peer.handshake > 0 && ts - peer.handshake < live.ONLINE_WINDOW),
		handshake: hs,
		endpoint: live.endpoint_ip(peer?.endpoint) || u?.endpoint || '',
		active: !!peer,
		month: live.month(u),
		total: u?.total ?? [ 0, 0 ],
		spark: spark(u, 7),
		hostname: m.settings.hostnames && p ? `${replace(replace(lc(d.name), /[^a-z0-9]+/g, '-'), /^-+|-+$/g, '') || 'device'}.${p.id}.${m.settings.domain}` : '',
		browser_key: d.private_key == '',
		// Its configuration changed since it was last shown or downloaded.
		config_stale: config_stale(m, d),
	};
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
		v.code = p.code;
		v.link = core.portal_url(m, p);
		v.links = core.portal_urls(m, p);
		v.note = p.note;
		v.services = p.services;
		v.home_nets = p.home_nets;
		v.circle = p.circle;
		v.created = p.created;
	}
	return v;
};

export function states(m, usage) {
	let out = {};
	for (let id, p in m.people)
		out[id] = core.person_state(m, p, usage);
	return out;
};
