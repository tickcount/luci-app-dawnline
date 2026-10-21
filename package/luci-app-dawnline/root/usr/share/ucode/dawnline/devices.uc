// Dawnline — adding, changing, rotating and removing a person's devices: one
// code path for the admin UI (rpcd) and the portal, with the config lock,
// the runtime sync, the activity log and the "configuration issued" mark.
//
// opts = { by: 'admin' | 'portal', person?: the only person whose devices may
// be touched (the portal), defer?: load new keys a moment later (the portal
// page came through the device being rotated) }. The portal is held to the
// device limit (dawnline.core) and cannot touch a device the admin turned off.

import { sh_bg } from 'dawnline.util';
import * as core from 'dawnline.core';
import * as awg from 'dawnline.awg';
import * as apply from 'dawnline.apply';
import * as live from 'dawnline.live';
import * as store from 'dawnline.store';
import { _ } from 'dawnline.i18n';

/** AmneziaWG is on the router, so device keys can be made and loaded. */
export function ready() {
	return awg.installed();
};

/** Dies with the admin's wording when AmneziaWG is missing. */
export function need_awg() {
	if (!awg.installed()) {
		let miss = awg.state().missing ?? [];
		die(length(miss) ? sprintf(_('AmneziaWG is not installed (%s): install it in Dawnline → Components.'), join(', ', miss))
			: _('AmneziaWG is not installed: install it in Dawnline → Components.'));
	}
};

/** The device `id` as `opts` may touch it (inside a transaction's model). */
function own(m, id, opts) {
	let d = m.devices[id];
	if (!d || (opts.person != null && d.person != opts.person))
		die(opts.person != null ? _('Device not found.') : _('Unknown device.'));
	if (opts.by == 'portal' && d.disabled)
		die(_('The admin has turned this device off.'));
	return d;
}

/**
 * New device with fresh keys (or the browser's public key): { id, config }.
 * `opts.lan_bypass` true keeps its own local network outside the tunnel.
 */
export function add(person, name, kind, opts) {
	opts ??= {};
	let by = opts.by ?? 'admin';
	let id = store.transact((c, m) => core.create_device(c, m, person, name, kind,
		{ by, keys: awg.new_keys(opts.public_key || null), lan_bypass: opts.lan_bypass === true }));
	let s = apply.sync();
	let m = core.load();
	live.add_event({ type: 'device_added', person, device: id, detail: m.devices[id].name, by });
	awg.mark_issued(m, id);
	return { id, config: awg.client_config(m, m.devices[id]), warning: s.warning };
};

/**
 * Rename and/or turn a device off or on, or change how it connects (`ch` =
 * { name?, disabled?, mtu?, keepalive?, lan_bypass? }, see
 * core.set_device_link); only the admin turns devices off or changes the
 * rest. Returns the runtime sync ({} after a change of the link values alone:
 * they are in the device's configuration, nothing on the router changes).
 */
export function update(id, ch, opts) {
	opts ??= {};
	let by = opts.by ?? 'admin';
	if (ch.disabled != null && by != 'admin')
		die(_('Only the admin can turn devices off.'));
	let link = ch.mtu != null || ch.keepalive != null || ch.lan_bypass != null;
	if (link && by != 'admin')
		die(_('Only the admin can change how a device connects.'));
	let linked = [];
	let d0 = store.transact((c, m) => {
		let d = own(m, id, opts);
		let was = { ...d };
		if (ch.name != null && ch.name != d.name)
			core.rename_device(c, m, id, ch.name);
		if (ch.disabled != null) {
			if (ch.disabled)
				c.set(core.CONFIG, id, 'disabled', '1');
			else
				c.delete(core.CONFIG, id, 'disabled');
		}
		if (link)
			linked = core.set_device_link(c, m, id, ch);
		return was;
	});
	let r = ch.name != null || ch.disabled != null ? apply.sync() : {};
	if (ch.disabled != null && !!ch.disabled != !!d0.disabled)
		live.add_event({ type: 'device_changed', person: d0.person, device: id, detail: ch.disabled ? 'turned off' : 'turned on', by });
	else if (ch.name != null && ch.name != d0.name)
		live.add_event({ type: 'device_changed', person: d0.person, device: id, detail: `renamed from ${d0.name}`, by });
	// The option names, as person_changed lists a person's.
	if (length(linked))
		live.add_event({ type: 'device_changed', person: d0.person, device: id, detail: join(', ', linked), by });
	return r;
};

/*
 * New keys for a device: returns its new configuration, marked as issued (it
 * goes to the set-up sheet; the device then waits for it as "Not set up yet",
 * not as "settings changed"). Only through reconnect: new keys always mean
 * setting the device up again.
 */
function rotate(id, opts) {
	opts ??= {};
	let by = opts.by ?? 'admin';
	store.transact((c, m) => {
		own(m, id, opts);
		core.rotate_device(c, m, id, awg.new_keys());
	});
	// The device a portal page came through would lose its tunnel before the
	// answer gets out: load the new key a moment after answering.
	let s = null;
	if (opts.defer)
		sh_bg('sleep 3; /usr/bin/dawnline sync');
	else
		s = apply.sync();
	let m = core.load();
	let d = m.devices[id];
	live.add_event({ type: 'device_keys', person: d.person, device: id, detail: d.name, by });
	awg.mark_issued(m, id);
	let cfg = awg.client_config(m, d);
	if (s?.warning)
		cfg.warning = s.warning;
	return cfg;
}

/**
 * Set a device up from scratch (a new phone, the app reinstalled, settings
 * the admin changed; the portal's Reconnect and the admin's New keys): new
 * keys, so the configuration it holds stops working with the sync, and it
 * counts as not set up until it connects with the new one. The usage keeps
 * the old keys' last handshake: awg.handshake_since hides it. Returns the new
 * configuration (with `warning` when the sync did not fully take).
 */
export function reconnect(id, opts) {
	opts ??= {};
	let cfg = rotate(id, opts);
	// A deferred sync (the page came through this device) lets the old keys live a few seconds more.
	awg.mark_reconnect(core.load(), id, time() + (opts.defer ? 5 : 0));
	return cfg;
};

/** Remove a device. Returns the runtime sync. */
export function remove(id, opts) {
	opts ??= {};
	let by = opts.by ?? 'admin';
	let d = store.transact((c, m) => {
		let d = own(m, id, opts);
		core.delete_device(c, m, id);
		return d;
	});
	let r = apply.sync();
	live.add_event({ type: 'device_removed', person: d.person, device: id, detail: d.name, dname: d.name, dkind: d.kind, by });
	return r;
};
