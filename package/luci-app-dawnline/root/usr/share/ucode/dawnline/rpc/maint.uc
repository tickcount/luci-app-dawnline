// Dawnline rpcd methods: Diagnostics (Health, the service log), backups,
// export / import, and removing Dawnline.

import { slog_clear, admin_log } from 'dawnline.util';
import * as core from 'dawnline.core';
import * as apply from 'dawnline.apply';
import * as watchdog from 'dawnline.watchdog';
import * as upd from 'dawnline.updates';
import * as store from 'dawnline.store';
import * as health from 'dawnline.health';
import * as backup from 'dawnline.backup';
import { wrap } from 'dawnline.rpc.common';

function health_view(extra) {
	return { ...(extra ?? {}), checks: health.health(), ...watchdog.view(core.load()) };
}

function service_log_clear(a) {
	let removed = slog_clear(+a.older_days || 0);
	if (removed)
		admin_log('dawnline', 'cleared', null, 'the service log', `${removed} entr${removed == 1 ? 'y' : 'ies'}${+a.older_days ? ` older than ${a.older_days} days` : ''}`);
	return { removed };
}

function backup_restore(a) {
	let r = backup.backup_restore(a.name);
	admin_log('dawnline', 'restored', 'backup', a.name);
	return r;
}

function backup_upload(a) {
	let r = backup.backup_upload(a.data);
	admin_log('dawnline', 'restored', 'backup', 'from a file');
	return r;
}

function export_all(a) {
	let r = backup.export_json();
	admin_log('dawnline', 'exported', null, 'all settings', 'the file holds private keys');
	return r;
}

function import_all(a) {
	let r = backup.import_json(a.data);
	admin_log('dawnline', 'imported', null, 'settings from a file');
	return r;
}

/** Remove Dawnline's state from the router (the package is removed by the UI afterwards). */
function uninstall(a) {
	if (a.confirm != 'remove')
		die('Type "remove" to confirm.');
	// Not in the middle of an update (opkg/apk may be installing Dawnline itself).
	if (upd.busy())
		die('An update is running: wait for it to finish, then remove Dawnline.');
	backup.backup_create('pre-remove');
	// Stop first: the agent would put back what teardown removes, and could start an automatic update.
	system('/etc/init.d/dawnline stop >/dev/null 2>&1; /etc/init.d/dawnline disable >/dev/null 2>&1');
	apply.teardown();
	store.transact((c, m) => {
		let rm = [];
		c.foreach(core.CONFIG, null, (s) => {
			if (s['.type'] != 'settings')
				push(rm, s['.name']);
		});
		for (let n in rm)
			c.delete(core.CONFIG, n);
		c.set(core.CONFIG, 'settings', 'settings');
		c.set(core.CONFIG, 'settings', 'portal_enabled', '0');
	});
	return { ok: true };
}

export const methods = {
	apply: { call: wrap((a) => apply.apply()) },
	health: { call: wrap((a) => health_view()) },
	health_fix: { args: { id: '' }, call: wrap((a) => health_view({ result: health.fix(a.id) })) },
	service_log: { call: wrap((a) => watchdog.view(core.load())) },
	service_log_clear: { args: { older_days: '' }, call: wrap(service_log_clear) },
	backup_list: { call: wrap((a) => ({ backups: backup.backup_list() })) },
	backup_create: { call: wrap((a) => ({ name: backup.backup_create(null) })) },
	backup_restore: { args: { name: '' }, call: wrap(backup_restore) },
	backup_delete: { args: { name: '' }, call: wrap((a) => ({ ok: backup.backup_delete(a.name) })) },
	backup_read: { args: { name: '' }, call: wrap((a) => ({ data: backup.backup_read(a.name) })) },
	backup_upload: { args: { data: '' }, call: wrap(backup_upload) },
	'export': { call: wrap(export_all) },
	'import': { args: { data: {} }, call: wrap(import_all) },
	uninstall: { args: { confirm: '' }, call: wrap(uninstall) },
};
