// Dawnline — live data: peer status from the tunnels (dawnline.awg), traffic
// accounting and the connection/event log.
//
// Counters live in RUN_DIR (tmpfs) and are flushed to DATA_DIR at most once
// an hour, so flash is not worn by the 60-second agent loop.

import { readfile, stat, unlink } from 'fs';
import { cursor } from 'uci';
import {
	ensure_dir, read_json, write_json, lock, unlock, month_key, day_key, day_key_ago, uniq,
	iface_status as util_iface_status, RUN_DIR, DATA_DIR
} from 'dawnline.util';
import * as awg from 'dawnline.awg';
import * as schema from 'dawnline.schema';

// Online while the WireGuard session lives: it is dropped 180 s after its
// handshake, and a device that is there renews it every 2 min (a little slack
// for a renewal that needs a retry). One that left goes offline 1-3 min later.
export const ONLINE_WINDOW = 190;
/** A restore put other counters on flash: the agent reloads from there (dawnline.backup writes it). */
export const USAGE_RELOAD = `${RUN_DIR}/usage.reload`;

/* ---------- retention policy ---------- */

/** Event type → log category (what Settings lets you switch off or clear). */
export const CATEGORY = {
	connect: 'connections', disconnect: 'connections', roam: 'connections',
	// People and their devices: one category (devices used to have their own).
	device_added: 'people', device_removed: 'people', devices_removed: 'people',
	device_changed: 'people', device_keys: 'people', link_changed: 'people',
	person_added: 'people', person_removed: 'people', person_changed: 'people',
	paused: 'people', resumed: 'people', expiring: 'people', expired_kept: 'people',
	server_down: 'problems', server_up: 'problems', portal_blocked: 'problems',
};
export const CATEGORIES = [ 'connections', 'people', 'problems' ];

export function category_of(type) {
	return CATEGORY[type] ?? 'problems';
};


/**
 * Log and history retention from /etc/config/dawnline (read fresh, the
 * portal and rpcd call add_event without a loaded model).
 *   log_keep_days  days of activity to keep, 0 = until log_max
 *   log_max        newest N events kept
 *   log_category   categories that are recorded
 *   log_persist    how often the log is saved to flash: 10min | hourly | off
 *   usage_keep_days / usage_keep_months  daily / monthly traffic buckets
 */
export function policy(s) {
	if (s == null) {
		let c = cursor();
		s = c.get_all('dawnline', 'settings') ?? {};
	}
	let cats = s.log_category;
	if (cats == null)
		cats = (s.log_connections == '0') ? filter(CATEGORIES, (x) => x != 'connections') : CATEGORIES;
	else if (type(cats) != 'array')
		cats = split(cats, /[ ,]+/);
	cats = uniq(filter(map(cats, (x) => x == 'devices' ? 'people' : x), (x) => index(CATEGORIES, x) >= 0));
	// Defaults and ranges come from dawnline.schema, like every other setting.
	return {
		keep_days: schema.get(s, 'log_keep_days'),
		max: schema.get(s, 'log_max'),
		categories: cats,
		persist: schema.get(s, 'log_persist'),
		usage_days: schema.get(s, 'usage_keep_days'),
		usage_months: schema.get(s, 'usage_keep_months'),
	};
};

/** Drop events older than keep_days and beyond max. */
function trim_events(ev, pol) {
	if (pol.keep_days > 0) {
		let cut = time() - pol.keep_days * 86400;
		ev = filter(ev, (e) => (e.ts ?? 0) >= cut);
	}
	if (length(ev) > pol.max)
		ev = slice(ev, length(ev) - pol.max);
	return ev;
}

/* ---------- live peers ---------- */

/* ---------- presence (the agent's watcher) ---------- */

/**
 * Written by the agent's watcher on every change: { online: { device id: bool },
 * endpoint: { device id: ip }, rev, people: { person id: rev } }. `rev` moves on
 * any connect, disconnect, roam or logged change; `people` per person (the portal).
 */
export const PRESENCE = `${RUN_DIR}/presence.json`;
// The agent's heartbeat (dawnline.watchdog.BEAT): its presence counts while it runs.
const BEAT = `${RUN_DIR}/agent.beat`;
const BEAT_STALE = 180;

/** What the watcher sees, or null when the agent isn't running. */
export function presence() {
	let beat = +(read_json(BEAT, 0) ?? 0);
	if (!beat || time() - beat > BEAT_STALE)
		return null;
	return read_json(PRESENCE, null);
};

/**
 * Peers of every tunnel: { ok, ifaces, peers: { public key: { ifname, endpoint,
 * handshake, rx, tx } }, presence }. See dawnline.awg.
 */
export function dump(m) {
	// Only Dawnline's own tunnels decide `ok`: another AmneziaWG interface on
	// the router that cannot be read is not our trouble.
	let mine = m ? map(filter(values(m.servers), (s) => s.private_key && s.enabled), (s) => s.ifname) : null;
	let d = awg.dump(mine);
	d.presence = presence();
	return d;
};

/** A device is online: as the agent's watcher says, or (without the agent) by a recent handshake. */
export function online(dmp, id, peer) {
	let p = dmp?.presence?.online;
	if (p)
		return !!(peer && p[id]);
	return !!(peer && peer.handshake > 0 && time() - peer.handshake < ONLINE_WINDOW);
};

export function endpoint_ip(ep) {
	let m = match(ep ?? '', /^\[?([^\]]+)\]?:[0-9]+$/);
	return m ? m[1] : ep;
};

/* ---------- usage ---------- */

function empty_usage() {
	return { devices: {}, people: {}, updated: 0, flushed: 0 };
}

/**
 * The usage counters: the live copy in RUN_DIR, else what flash holds. With
 * `from_flash` only flash counts (a restore put new counters there, and the
 * watcher may have written the old live ones again since).
 */
export function load_usage(from_flash) {
	let u = (from_flash ? null : read_json(`${RUN_DIR}/usage.json`, null)) ?? read_json(`${DATA_DIR}/usage.json`, null) ?? empty_usage();
	// Per-app counters of earlier test builds are not kept.
	delete u.clients;
	return u;
};

function add(bucket, key, rx, tx) {
	let v = bucket[key] ?? [ 0, 0 ];
	bucket[key] = [ v[0] + rx, v[1] + tx ];
}

function prune(obj, keep) {
	let ks = sort(keys(obj));
	for (let i = 0; i < length(ks) - keep; i++)
		delete obj[ks[i]];
}

function account(rec, rx, tx, ts) {
	rec.total = [ (rec.total?.[0] ?? 0) + rx, (rec.total?.[1] ?? 0) + tx ];
	rec.months ??= {};
	rec.days ??= {};
	add(rec.months, month_key(ts), rx, tx);
	add(rec.days, day_key(ts), rx, tx);
}

/** Apply the traffic history retention to every record. */
export function prune_usage(usage, pol) {
	pol ??= policy();
	for (let grp in [ usage.devices, usage.people ])
		for (let id, rec in grp) {
			if (rec.months)
				prune(rec.months, pol.usage_months);
			if (rec.days)
				prune(rec.days, pol.usage_days);
		}
};

/** Forget a record's traffic history; kernel counters (raw) and the last handshake stay. */
function wipe(rec) {
	if (!rec)
		return;
	delete rec.total;
	delete rec.months;
	delete rec.days;
}

/**
 * Reset traffic history. scope: all | person | device. A person reset also
 * clears their devices and restarts their data limit; a device reset leaves
 * the person's totals (and so their limit) alone.
 */
export function reset_usage(usage, m, scope, id) {
	if (scope == 'all') {
		for (let k, rec in usage.devices)
			wipe(rec);
		for (let k, rec in usage.people)
			wipe(rec);
	}
	else if (scope == 'person') {
		wipe(usage.people[id]);
		for (let did in m.people[id]?.devices ?? [])
			wipe(usage.devices[did]);
	}
	else if (scope == 'device')
		wipe(usage.devices[id]);
};

function offline(rec) {
	return { online: false, handshake: rec?.handshake ?? 0, endpoint: rec?.endpoint ?? '', present: false };
}

/**
 * Fold the current kernel counters into `usage`. Counters restart from zero
 * when a peer is re-added or the interface restarts; a drop is treated as a
 * reset. Returns the per-device live view keyed by device id.
 *
 * A device missing from the dump had its counters reset only when its tunnel
 * was actually read: an interface the tool couldn't read says nothing, and
 * forgetting the last counters there would count them again on the next good
 * read. A failed read with nothing in it changes nothing at all.
 */
export function collect(m, usage, d) {
	d ??= dump(m);
	let ts = time();
	let live = {};
	if (d.ok === false && !length(d.peers)) {
		for (let id in keys(m.devices))
			live[id] = offline(usage.devices[id]);
		return live;
	}
	for (let id, dev in m.devices) {
		let rec = usage.devices[id] ??= { raw: [ 0, 0 ] };
		let peer = d.peers[dev.public_key];
		if (!peer) {
			let ifname = m.servers[m.people[dev.person]?.server]?.ifname;
			if (d.ok !== false || d.ifaces[ifname] != null)
				rec.raw = [ 0, 0 ];
			live[id] = offline(rec);
			continue;
		}
		let raw = rec.raw ?? [ 0, 0 ];
		let drx = peer.rx >= raw[0] ? peer.rx - raw[0] : peer.rx;
		let dtx = peer.tx >= raw[1] ? peer.tx - raw[1] : peer.tx;
		rec.raw = [ peer.rx, peer.tx ];
		if (drx > 0 || dtx > 0) {
			account(rec, drx, dtx, ts);
			let p = usage.people[dev.person] ??= {};
			account(p, drx, dtx, ts);
		}
		if (peer.handshake > 0) {
			rec.handshake = peer.handshake;
			rec.endpoint = endpoint_ip(peer.endpoint);
			// Recent client addresses (for the map): ip → last seen, newest 8.
			rec.ips ??= {};
			if (rec.endpoint)
				rec.ips[rec.endpoint] = peer.handshake;
			let ips = sort(keys(rec.ips), (x, y) => rec.ips[y] - rec.ips[x]);
			for (let i = 8; i < length(ips); i++)
				delete rec.ips[ips[i]];
		}
		live[id] = {
			online: peer.handshake > 0 && ts - peer.handshake < ONLINE_WINDOW,
			handshake: peer.handshake || rec.handshake || 0,
			endpoint: endpoint_ip(peer.endpoint) || rec.endpoint || '',
			present: true,
		};
	}

	// Forget counters of devices that no longer exist (their bytes stay in
	// the person's totals).
	for (let id in keys(usage.devices))
		if (!m.devices[id])
			delete usage.devices[id];

	prune_usage(usage, policy(m.settings.retention));
	usage.updated = ts;
	return live;
};

export function save_usage(usage, persist) {
	ensure_dir(RUN_DIR);
	write_json(`${RUN_DIR}/usage.json`, usage, 0o600);
	if (persist) {
		usage.flushed = time();
		ensure_dir(DATA_DIR, 0o700);
		write_json(`${DATA_DIR}/usage.json`, usage, 0o600);
	}
};

/** Sum of [rx, tx] over the last `days` days for a usage record. */
export function recent(rec, days) {
	let out = [ 0, 0 ];
	for (let i = 0; i < days; i++) {
		let v = rec?.days?.[day_key_ago(i)];
		if (v) {
			out[0] += v[0];
			out[1] += v[1];
		}
	}
	return out;
};

export function month(rec) {
	return rec?.months?.[month_key()] ?? [ 0, 0 ];
};

/** Daily series for the last `days` days: [{ day, rx, tx }]. */
export function series(recs, days) {
	let out = [];
	for (let i = days - 1; i >= 0; i--) {
		let k = day_key_ago(i);
		let rx = 0, tx = 0;
		for (let r in recs) {
			let v = r?.days?.[k];
			if (v) {
				rx += v[0];
				tx += v[1];
			}
		}
		push(out, { day: k, rx, tx });
	}
	return out;
};

/* ---------- events ---------- */

export function load_events() {
	return read_json(`${RUN_DIR}/events.json`, null) ?? read_json(`${DATA_DIR}/events.json`, []);
};

/*
 * Names as they are now (pname, dname, dkind), so the log still reads well
 * once the person or device is gone. Callers that delete first pass them.
 */
function with_names(e, c) {
	if (e.person && !e.pname)
		e.pname = c.get('dawnline', e.person, 'name');
	if (e.device && !e.dname)
		e.dname = c.get('dawnline', e.device, 'name');
	if (e.device && !e.dkind)
		e.dkind = c.get('dawnline', e.device, 'kind');
	return e;
}

export function add_events(list, pol) {
	pol ??= policy();
	list = filter(list ?? [], (e) => index(pol.categories, category_of(e.type)) >= 0);
	if (!length(list))
		return;
	let c = cursor();
	c.load('dawnline');
	let l = lock('events');
	let ev = load_events();
	let ts = time();
	for (let e in list) {
		e.ts ??= ts;
		push(ev, with_names(e, c));
	}
	ev = trim_events(ev, pol);
	ensure_dir(RUN_DIR);
	write_json(`${RUN_DIR}/events.json`, ev, 0o600);
	unlock(l);
};

export function add_event(e) {
	add_events([ e ]);
};

/** Like add_event, but folds into the previous event of the same kind and person within `window` s. */
export function add_event_merged(e, window) {
	let pol = policy();
	if (index(pol.categories, category_of(e.type)) < 0)
		return;
	let l = lock('events');
	let ev = load_events();
	let last = ev[length(ev) - 1];
	let ts = time();
	if (last && last.type == e.type && last.person == e.person && ts - last.ts < (window ?? 120)) {
		let parts = uniq([ ...split(last.detail ?? '', ', '), ...split(e.detail ?? '', ', ') ]);
		last.detail = join(', ', filter(parts, (x) => x != ''));
		last.ts = ts;
	}
	else {
		let c = cursor();
		c.load('dawnline');
		e.ts = ts;
		push(ev, with_names(e, c));
	}
	ev = trim_events(ev, pol);
	ensure_dir(RUN_DIR);
	write_json(`${RUN_DIR}/events.json`, ev, 0o600);
	unlock(l);
};

/**
 * Places for connections logged before their address was located (the
 * lookup finishes after the event): connect events since `since` from an
 * address in `where` ({ ip: "City · ISP" }) that have no place yet get it.
 * Returns true when `ev` changed.
 */
export function fill_places(ev, where, since) {
	let changed = false;
	for (let i = length(ev) - 1; i >= 0 && ev[i].ts >= since; i--) {
		let e = ev[i];
		if (e.type == 'connect' && !e.where && where[e.detail]) {
			e.where = where[e.detail];
			changed = true;
		}
	}
	return changed;
};

/** fill_places() on the live log, written only when something changed. */
export function set_places(where, since) {
	let l = lock('events');
	let ev = load_events();
	if (fill_places(ev, where, since)) {
		ensure_dir(RUN_DIR);
		write_json(`${RUN_DIR}/events.json`, ev, 0o600);
	}
	unlock(l);
};

/** Save the log to flash, or drop the flash copy when it is kept in RAM only. */
export function persist_events(pol) {
	pol ??= policy();
	if (pol.persist == 'off') {
		if (stat(`${DATA_DIR}/events.json`))
			unlink(`${DATA_DIR}/events.json`);
		return;
	}
	// Only when something was logged since the last copy: flash is written rarely.
	let live_st = stat(`${RUN_DIR}/events.json`);
	if (!live_st || live_st.mtime <= (stat(`${DATA_DIR}/events.json`)?.mtime ?? 0))
		return;
	let ev = read_json(`${RUN_DIR}/events.json`, null);
	if (ev != null) {
		ensure_dir(DATA_DIR, 0o700);
		write_json(`${DATA_DIR}/events.json`, trim_events(ev, pol), 0o600);
	}
};

/**
 * Remove events matching every given filter (person, device, category,
 * older than `before` ts); no filters clears the whole log. Edits both the
 * live copy and the one on flash. Returns how many were removed.
 */
export function clear_events(f) {
	f ??= {};
	let hit = (e) =>
		(!f.person || e.person == f.person) &&
		(!f.device || e.device == f.device) &&
		(!f.category || category_of(e.type) == f.category) &&
		(!f.before || (e.ts ?? 0) < f.before);
	let l = lock('events');
	let removed = 0;
	for (let path in [ `${RUN_DIR}/events.json`, `${DATA_DIR}/events.json` ]) {
		let ev = read_json(path, null);
		if (ev == null)
			continue;
		let keep = filter(ev, (e) => !hit(e));
		if (path == `${RUN_DIR}/events.json` || removed == 0)
			removed = max(removed, length(ev) - length(keep));
		write_json(path, keep, 0o600);
	}
	unlock(l);
	return removed;
};

/* ---------- health ---------- */

export function iface_status(ifname) {
	return util_iface_status(ifname);
};

export function uptime() {
	let s = readfile('/proc/uptime');
	return s ? int(+split(s, ' ')[0]) : 0;
};
