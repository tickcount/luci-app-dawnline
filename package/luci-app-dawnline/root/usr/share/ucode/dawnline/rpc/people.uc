// Dawnline rpcd methods: people (adding, editing, pausing, their personal
// links and traffic) and their devices.

import * as core from 'dawnline.core';
import * as live from 'dawnline.live';
import * as apply from 'dawnline.apply';
import * as view from 'dawnline.view';
import * as awg from 'dawnline.awg';
import * as store from 'dawnline.store';
import * as devices from 'dawnline.devices';
import { wrap, str, clamp_days } from 'dawnline.rpc.common';

const PERSON_FIELDS = [ 'name', 'access', 'device_limit', 'expires', 'expire_action', 'expire_warn', 'quota_gb', 'quota_period',
	'bonus_gb', 'hours', 'note', 'dns_mode' ];

/* ---------- people ---------- */

function person_create(a) {
	let id = store.transact((c, m) => core.create_person(c, m, {
		name: str(a.name), slug: str(a.slug) || null, server: str(a.server) || null, access: a.access,
		device_limit: str(a.device_limit), expires: str(a.expires), quota_gb: str(a.quota_gb), quota_period: a.quota_period,
	}));
	let m = core.load();
	live.add_event({ type: 'person_added', person: id, detail: m.people[id].name, by: 'admin' });
	return { id, link: core.portal_url(m, m.people[id]) };
}

/** Immediate edits from the person's page; returns the person as the page shows them. */
function person_update(a) {
	let fields = {};
	for (let k in PERSON_FIELDS)
		if (a[k] != null)
			fields[k] = a[k];
	if (a.paused != null)
		fields.paused = a.paused;
	if (type(a.services) == 'array')
		fields.services = a.services;
	if (a.circle != null)
		fields.circle = a.circle;
	if (type(a.home_nets) == 'array')
		fields.home_nets = a.home_nets;
	let before = store.transact((c, m) => {
		let p = m.people[a.id];
		core.update_person(c, m, a.id, fields);
		return p;
	});
	let changes = join(', ', filter(keys(fields), (k) => k != 'note'));
	if (changes)
		live.add_event_merged({ type: 'person_changed', person: a.id, detail: changes, by: 'admin' }, 120);
	// Access changes affect the nft sets and client AllowedIPs.
	apply.sync();
	let m = core.load();
	let u = core.load_usage();
	return { person: view.person_view(m, m.people[a.id], u, live.dump(m), view.states(m, u), { admin: true }), was: before?.access };
}

function person_pause(a) {
	store.transact((c, m) => {
		if (!m.people[a.id])
			die('Unknown person.');
		if (a.paused)
			c.set(core.CONFIG, a.id, 'paused', '1');
		else
			c.delete(core.CONFIG, a.id, 'paused');
	});
	live.add_event({ type: a.paused ? 'paused' : 'resumed', person: a.id, by: 'admin' });
	return apply.sync();
}

/** A new personal link: the old one stops working at once (every portal request carries the code). */
function person_regen(a) {
	store.transact((c, m) => {
		if (!m.people[a.id])
			die('Unknown person.');
		c.set(core.CONFIG, a.id, 'code', core.new_code());
	});
	live.add_event({ type: 'link_changed', person: a.id, by: 'admin' });
	let m = core.load();
	return { link: core.portal_url(m, m.people[a.id]) };
}

/** The personal code and links (Copy link, QR, invite): admins only, unlike status. */
function person_links(a) {
	let m = core.load();
	let p = m.people[a.id];
	if (!p)
		die('Unknown person.');
	return { code: p.code, link: core.portal_url(m, p), links: core.portal_urls(m, p) };
}

function person_delete(a) {
	let name = store.transact((c, m) => {
		let name = m.people[a.id]?.name;
		core.delete_person(c, m, a.id);
		return name;
	});
	live.add_event({ type: 'person_removed', person: a.id, detail: name, pname: name, by: 'admin' });
	return apply.sync();
}

function person_usage(a) {
	let usage = core.load_usage();
	let m = core.load();
	let p = m.people[a.id];
	if (!p)
		die('Unknown person.');
	let days = clamp_days(a.days);
	let devs = {};
	for (let d in p.devices)
		devs[d] = live.series([ usage.devices?.[d] ], days);
	return { person: live.series([ usage.people?.[a.id] ], days), devices: devs };
}

function pause_all(a) {
	store.transact((c, m) => {
		c.set(core.CONFIG, 'settings', 'settings');
		c.set(core.CONFIG, 'settings', 'paused_all', a.paused ? '1' : '0');
	});
	live.add_event({ type: a.paused ? 'paused_all' : 'resumed_all', by: 'admin' });
	return apply.sync();
}

/* ---------- devices ---------- */

function device_create(a) {
	devices.need_awg();
	return devices.add(a.person, a.name, a.kind, { by: 'admin' });
}

function device_config(a) {
	let m = core.load();
	let d = m.devices[a.id];
	if (!d)
		die('Unknown device.');
	awg.mark_issued(m, d.id);
	return awg.client_config(m, d);
}

function device_update(a) {
	return devices.update(a.id, { name: a.name, disabled: a.disabled }, { by: 'admin' });
}

export const methods = {
	person_create: {
		args: { name: '', slug: '', server: '', access: '', device_limit: '', expires: '', quota_gb: '', quota_period: '' },
		call: wrap(person_create),
	},
	person_update: {
		args: { id: '', name: '', access: '', device_limit: '', expires: '', expire_action: '', expire_warn: '', quota_gb: '',
			quota_period: '', bonus_gb: '', hours: '', note: '', dns_mode: '', paused: false, services: [], circle: '', home_nets: [] },
		call: wrap(person_update),
	},
	person_pause: { args: { id: '', paused: false }, call: wrap(person_pause) },
	person_regen: { args: { id: '' }, call: wrap(person_regen) },
	person_links: { args: { id: '' }, call: wrap(person_links) },
	person_delete: { args: { id: '' }, call: wrap(person_delete) },
	person_usage: { args: { id: '', days: 30 }, call: wrap(person_usage) },
	pause_all: { args: { paused: false }, call: wrap(pause_all) },
	device_create: { args: { person: '', name: '', kind: '' }, call: wrap(device_create) },
	device_config: { args: { id: '' }, call: wrap(device_config) },
	device_update: { args: { id: '', name: '', disabled: false }, call: wrap(device_update) },
	device_delete: { args: { id: '' }, call: wrap((a) => devices.remove(a.id, { by: 'admin' })) },
	device_rotate: { args: { id: '' }, call: wrap((a) => devices.rotate(a.id, { by: 'admin' })) },
};
