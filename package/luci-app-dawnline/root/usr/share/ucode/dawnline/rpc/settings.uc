// Dawnline rpcd methods: the Settings page (the portal, defaults, logs and
// history, updates). What may be saved is dawnline.schema's.

import { stat } from 'fs';
import { q, sh_out, admin_log, RUN_DIR, DATA_DIR } from 'dawnline.util';
import * as core from 'dawnline.core';
import * as live from 'dawnline.live';
import * as apply from 'dawnline.apply';
import * as geo from 'dawnline.geo';
import * as store from 'dawnline.store';
import * as schema from 'dawnline.schema';
import * as health from 'dawnline.health';
import * as pc from 'dawnline.portalcert';
import { wrap, check_portal, tcp_taken } from 'dawnline.rpc.common';
import { _ } from 'dawnline.i18n';

/** The portal's own checks from Health, shown next to its settings. */
const PORTAL_CHECKS = [ 'portal', 'portal_dns', 'portal_reply', 'portal_http', 'cert' ];

function file_size(path) {
	return stat(path)?.size ?? 0;
}

/** What the log and traffic history hold right now (Settings → Logs & history). */
function logs_info(m) {
	let ev = live.load_events();
	let by = {};
	for (let cat in live.CATEGORIES)
		by[cat] = 0;
	for (let e in ev)
		by[live.category_of(e.type)]++;
	let usage = core.load_usage();
	let days = {};
	for (let grp in [ usage?.devices ?? {}, usage?.people ?? {} ])
		for (let id, rec in grp)
			for (let k in keys(rec.days ?? {}))
				days[k] = true;
	let dk = sort(keys(days));
	return {
		policy: live.policy(m.settings.retention),
		events: length(ev),
		oldest: length(ev) ? ev[0].ts : 0,
		by_category: by,
		log_ram: file_size(`${RUN_DIR}/events.json`),
		log_flash: file_size(`${DATA_DIR}/events.json`),
		usage_flash: file_size(`${DATA_DIR}/usage.json`),
		usage_since: length(dk) ? dk[0] : '',
		usage_days: length(dk),
		geo_flash: file_size(`${DATA_DIR}/geo.json`),
	};
}

function settings_get(a) {
	let c = core.open_cursor();
	let raw = c.get_all(core.CONFIG, 'settings') ?? {};
	let m = core.load(c);
	let out = {};
	for (let k in keys(schema.SETTINGS))
		out[k] = raw[k] ?? '';
	out.log_category = live.policy(m.settings.retention).categories;
	let cert = m.settings.portal_enabled ? pc.portal_cert(m.settings) : null;
	return {
		settings: out,
		needs: health.needs(),
		effective: m.settings,
		services: values(m.services),
		cert: cert ? { path: cert.cert, self_signed: cert.self_signed,
			expires: sh_out(`openssl x509 -enddate -noout -in ${q(cert.cert)} 2>/dev/null | cut -d= -f2`) } : null,
		tcp_taken: tcp_taken(m),
		portal_public_port: core.portal_public_port(m),
		geo_cached: length(keys(geo.load().ips)),
		logs: logs_info(m),
	};
}

/*
 * The slow part of the portal settings (DNS lookups and the Health checks),
 * fetched after the page shows.
 */
function portal_info(a) {
	let m = core.load();
	return {
		candidates: pc.portal_candidates(m),
		checks: filter(health.health(m), (x) => index(PORTAL_CHECKS, x.id) >= 0),
	};
}

function same(a, b) {
	return (type(a) == 'array' ? join('\n', a) : a ?? '') == (type(b) == 'array' ? join('\n', b) : b ?? '');
}

/** Save settings (`values`: key → value, '' back to the default); the portal is checked as it will be. */
function settings_update(a) {
	let v = a.values ?? {};
	if (type(v) != 'object')
		die(_('Nothing to save.'));
	let res = store.transact((c, m) => {
		let restart = false;
		c.set(core.CONFIG, 'settings', 'settings');
		for (let k, val in v) {
			if (k == 'log_category') {
				let lst = filter(type(val) == 'array' ? val : [], (x) => index(live.CATEGORIES, x) >= 0);
				c.set(core.CONFIG, 'settings', 'log_category', length(lst) ? lst : [ '' ]);
				// Superseded by the category list.
				c.delete(core.CONFIG, 'settings', 'log_connections');
				continue;
			}
			let nv = schema.validate(k, val);
			if (schema.SETTINGS[k].restart && !same(nv, c.get(core.CONFIG, 'settings', k)))
				restart = true;
			if (nv == null)
				c.delete(core.CONFIG, 'settings', k);
			else
				c.set(core.CONFIG, 'settings', k, nv);
		}
		check_portal(core.load(c), m);
		return { restart, was: m.settings };
	});
	let s = null;
	if (res.restart)
		system('/etc/init.d/dawnline reload >/dev/null 2>&1');
	else
		s = apply.sync();
	// The changes worth a line: the portal and the watchdog (other settings are housekeeping).
	let now = core.load().settings, was = res.was;
	if (now.portal_enabled != was.portal_enabled)
		admin_log('portal', now.portal_enabled ? 'turned on' : 'turned off', null, 'the personal portal', now.portal_enabled ? `port ${now.portal_port}` : null);
	else if (now.portal_enabled) {
		let what = [];
		if (now.portal_port != was.portal_port)
			push(what, `port ${now.portal_port}`);
		if (now.portal_host != was.portal_host)
			push(what, `address ${now.portal_host}`);
		if (join(' ', now.portal_alt) != join(' ', was.portal_alt))
			push(what, 'other addresses');
		if (now.portal_cert != was.portal_cert || now.portal_key != was.portal_key)
			push(what, 'certificate');
		if (now.portal_redirect != was.portal_redirect)
			push(what, 'redirect');
		if (length(what))
			admin_log('portal', 'changed', null, 'the personal portal', join(', ', what));
	}
	if (now.watchdog != was.watchdog)
		admin_log('dawnline', now.watchdog ? 'turned on' : 'turned off', null, 'the watchdog', now.watchdog ? null : 'problems are only logged, nothing is repaired');
	let out = settings_get({});
	if (s?.warning)
		out.warning = s.warning;
	return out;
}

export const methods = {
	settings_get: { call: wrap(settings_get) },
	portal_info: { call: wrap(portal_info) },
	settings_update: { args: { values: {} }, call: wrap(settings_update) },
};
