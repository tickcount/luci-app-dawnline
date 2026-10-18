// Dawnline — changes to /etc/config/dawnline, the one way: under the config
// lock, against a model loaded inside that lock, committed with the file kept
// private. rpcd, the portal, the CLI and the agent all go through here, so
// no change is made on a stale model and none is lost to another writer.

import { lock, unlock } from 'dawnline.util';
import * as core from 'dawnline.core';

/** Section names that are never ids of people, devices, servers, services or circles. */
export const RESERVED_IDS = [ 'settings', 'main', 'global', 'defaults' ];

/**
 * Commit the dawnline config and keep it readable by root only. A commit
 * that did not reach flash (full or read-only overlay) is an error: the
 * caller's change never happened, and nothing downstream may act on it.
 */
export function commit(c) {
	if (!c.commit(core.CONFIG))
		die(`Couldn't save /etc/config/dawnline: ${c.error() ?? 'the write failed'}. Is the flash full?`);
	system('chmod 600 /etc/config/dawnline');
};

/**
 * Run fn(c, m) with the config lock held, on a fresh cursor and model; commit
 * when fn returns (the return value is passed on). Anything fn throws aborts
 * without committing and is rethrown with the same message.
 */
export function transact(fn) {
	let l = lock('config');
	try {
		let c = core.open_cursor();
		let m = core.load(c);
		let r = fn(c, m);
		commit(c);
		unlock(l);
		return r;
	}
	catch (e) {
		unlock(l);
		die(e.message ?? `${e}`);
	}
};

/** Is `id` used by anything in the model (any kind of section), or reserved? */
export function id_taken(m, id) {
	return index(RESERVED_IDS, id) >= 0 || m.servers?.[id] != null || m.people?.[id] != null || m.devices?.[id] != null ||
		m.services?.[id] != null || m.circles?.[id] != null;
};
