// Dawnline — what the Components tab, the updater and the agent share: the
// update policy (Settings → Updates), when an automatic run is due, the one
// update job at a time (a kernel lock), the history for Activity, and the
// versions kept for rollback. GitHub and the package manager live in
// dawnline.github and dawnline.pkg.

import { open, stat } from 'fs';
import { q, read_json, write_json, ensure_dir, RUN_DIR, DATA_DIR } from 'dawnline.util';
import { _ } from 'dawnline.i18n';

export const JOB_FILE = `${RUN_DIR}/update-job.json`;
export const CHECK_FILE = `${RUN_DIR}/update-check.json`;
/** Held (flock) by the updater for the whole job: busy() and stale jobs come from it, not from pids. */
export const LOCK_FILE = `${RUN_DIR}/update.lock`;
/** Automatic runs: when the last check and the last scheduled install happened. */
export const AUTO_FILE = `${DATA_DIR}/update-auto.json`;
/** What happened: updates (by hand or automatic), failures, checks that found something. */
export const HISTORY_FILE = `${DATA_DIR}/update-history.json`;
/** The version each component had before its last update (Keep the previous version). */
export const KEEP_DIR = `${DATA_DIR}/keep`;

export const INTERVALS = { '6h': 6 * 3600, '12h': 12 * 3600, '1d': 86400, '7d': 7 * 86400 };
export const TARGETS = [ 'app', 'amneziawg', 'packages' ];

function on(v, dflt) {
	if (v == null || v == '')
		return dflt;
	return v == '1' || v == 'true' || v == 'on' || v == 'yes';
}

/** The update policy from raw UCI settings (core.load puts it in m.settings.updates). */
export function policy(s) {
	s ??= {};
	let t = type(s.update_targets) == 'array' ? s.update_targets : s.update_targets ? [ s.update_targets ] : null;
	let time_ok = match(s.update_time ?? '', /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/);
	return {
		check: on(s.update_check, true),
		interval: INTERVALS[s.update_interval] ? s.update_interval : '1d',
		auto: on(s.update_auto, true),
		mode: s.update_mode == 'immediate' ? 'immediate' : 'scheduled',
		time: time_ok ? s.update_time : '04:00',
		// AmneziaWG is left out by default: a new kernel module restarts every tunnel.
		targets: t ? filter(t, (x) => index(TARGETS, x) >= 0) : [ 'app', 'packages' ],
		keep: on(s.update_keep, false),
		mirrors: on(s.update_mirrors, true),
	};
};

/* ---------- schedule ---------- */

/** The scheduled time on the day of `ts` (router local time), in seconds since the epoch. */
function scheduled_on(pol, ts) {
	let t = localtime(ts);
	let hm = split(pol.time, ':');
	return ts - (t.hour * 3600 + t.min * 60 + t.sec) + int(hm[0]) * 3600 + int(hm[1]) * 60;
}

function day_of(ts) {
	let t = localtime(ts);
	return sprintf('%04d-%02d-%02d', t.year, t.mon, t.mday);
}

/** The scheduled slot `now` is in (up to an hour after the set time, also across midnight), or null. */
function slot(pol, now) {
	for (let at in [ scheduled_on(pol, now), scheduled_on(pol, now - 86400) ])
		if (now >= at && now - at < 3600)
			return at;
	return null;
}

/**
 * What an automatic run should do now: 'install' (the scheduled window, at
 * most an hour after the set time, once per slot), 'check' (the interval has
 * passed), or null.
 */
export function due(pol, st, now) {
	now ??= time();
	st ??= {};
	if (pol.auto && pol.mode == 'scheduled' && length(pol.targets)) {
		let at = slot(pol, now);
		if (at != null && st.install_day != day_of(at))
			return 'install';
	}
	if (pol.check && now - (st.check ?? 0) >= INTERVALS[pol.interval])
		return 'check';
	return null;
};

export function auto_state() {
	return read_json(AUTO_FILE, {});
};

export function auto_save(st) {
	ensure_dir(DATA_DIR);
	write_json(AUTO_FILE, st, 0o600);
};

/** Record that the scheduled slot `now` is in has run (the slot's own day, not today's after midnight). */
export function mark_day(pol, st, now) {
	now ??= time();
	st.install_day = day_of(slot(pol, now) ?? now);
	return st;
};

/* ---------- one job at a time ---------- */

/**
 * Take the update lock without waiting: the open file (keep it for the whole
 * job; the kernel releases it when the process ends), or null when another
 * job holds it.
 */
export function try_lock() {
	ensure_dir(RUN_DIR);
	let f = open(LOCK_FILE, 'a');
	if (f && f.lock('xn'))
		return f;
	f?.close();
	return null;
};

/** A job is running: someone holds the update lock. */
export function busy() {
	let f = try_lock();
	if (!f)
		return true;
	f.close();
	return false;
};

/**
 * The last job; a "running" one whose worker is gone (the lock is free) reads
 * as failed. Its phases, log and error are in the language of whoever started
 * it (English for automatic runs); only the stopped-job error is made here.
 */
export function job() {
	let j = read_json(JOB_FILE, null);
	if (j?.state == 'running' && !busy()) {
		j.state = 'failed';
		j.error = _('The update stopped unexpectedly.');
		j.finished = j.finished ?? time();
	}
	return j;
};

/* ---------- history (Components → Activity) ---------- */

export function history() {
	let h = read_json(HISTORY_FILE, []);
	return type(h) == 'array' ? h : [];
};

/** Newest first, the last 30 kept on flash. */
export function history_add(e) {
	let h = history();
	unshift(h, { ts: time(), ...e });
	ensure_dir(DATA_DIR);
	write_json(HISTORY_FILE, slice(h, 0, 30), 0o600);
};

/* ---------- Dawnline versions ---------- */

/**
 * Compare Dawnline release versions (0.3.2, v0.4.0-rc1): -1, 0 or 1. Numbers
 * compare as numbers; a pre-release (-rc1, -beta) comes before its release.
 */
export function version_cmp(a, b) {
	let parse = (v) => {
		let m = match(replace(`${v}`, /^v/, ''), /^([0-9.]+)([-~]([0-9A-Za-z.]+))?/);
		return m ? { nums: map(split(m[1], '.'), (x) => int(x)), pre: m[3] } : { nums: [ 0 ], pre: `${v}` };
	};
	let x = parse(a), y = parse(b);
	for (let i = 0; i < length(x.nums) || i < length(y.nums); i++) {
		let p = x.nums[i] ?? 0, r = y.nums[i] ?? 0;
		if (p != r)
			return p < r ? -1 : 1;
	}
	if (x.pre == y.pre)
		return 0;
	if (x.pre == null)
		return 1;
	if (y.pre == null)
		return -1;
	// rc1 < rc2 < rc10: compare the number runs as numbers.
	let px = match(x.pre, /^([^0-9]*)([0-9]*)/), py = match(y.pre, /^([^0-9]*)([0-9]*)/);
	if (px[1] != py[1])
		return px[1] < py[1] ? -1 : 1;
	return int(px[2] || 0) < int(py[2] || 0) ? -1 : int(px[2] || 0) > int(py[2] || 0) ? 1 : 0;
};

/* ---------- kept previous versions ---------- */

/** { version, build?, firmware?, files: [paths], saved } of the kept version, or null. */
export function kept(component) {
	let k = read_json(`${KEEP_DIR}/${component}/meta.json`, null);
	if (!k?.version || !length(k.files ?? []))
		return null;
	for (let f in k.files)
		if (!stat(f))
			return null;
	return k;
};

/** What the Components tab shows; firmware: the current one (a kept AmneziaWG build is for one firmware only). */
export function kept_all(firmware) {
	let out = {};
	for (let c in [ 'app', 'amneziawg' ]) {
		let k = kept(c);
		if (k && c == 'amneziawg' && k.firmware && firmware && k.firmware != firmware)
			k = null;
		out[c] = k ? { version: k.version, build: k.build ?? null, saved: k.saved ?? null } : null;
	}
	return out;
};

/** Replace the kept version of a component with these files (copied in). */
export function keep(component, version, files, build, firmware) {
	let dir = `${KEEP_DIR}/${component}`;
	system(`rm -rf ${q(dir)}; mkdir -p ${q(dir)}; chmod 700 ${q(KEEP_DIR)} ${q(dir)}`);
	let saved = [];
	for (let f in files) {
		let to = `${dir}/${replace(f, /^.*\//, '')}`;
		if (system(`cp ${q(f)} ${q(to)}`) == 0)
			push(saved, to);
	}
	if (length(saved) == length(files))
		write_json(`${dir}/meta.json`, { version, build, firmware, files: saved, saved: time() }, 0o600);
	else
		system(`rm -rf ${q(dir)}`);
};

export function forget(component) {
	system(`rm -rf ${q(KEEP_DIR + '/' + component)}`);
};
