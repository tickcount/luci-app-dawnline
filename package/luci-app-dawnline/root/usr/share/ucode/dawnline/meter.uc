// Dawnline — the live meter (the Overview's Speed now): each server's
// throughput, one point a second over the last two minutes.
//
// The meter RPC (dawnline.rpc.status) calls want() and read(); the agent's
// watcher makes a point from every read it already does (sample(), point())
// and keeps the last two minutes in memory (keep()) whether anyone looks or
// not, so a look gets them all at once. It writes them to FILE (save()) only
// while WANT is younger than WANT_FOR seconds: the first second of a look,
// then with each new point. When WANT goes stale it removes FILE: with nobody
// looking the watcher pays a little arithmetic and one stat() a second, and
// writes nothing. FILE holds server ids and byte rates only, no keys, names
// or personal codes. Who is online and the per-minute rates are not here
// (dawnline.live, the agent's tick).
//
// Bytes are the peers' counters (dawnline.awg.dump): tx includes the
// disguise (S prefixes, padding, junk), rx the packets as they were
// received without their prefix, so both are close to what is on the wire.

import { writefile, stat, unlink } from 'fs';
import { read_json, write_file, ensure_dir, RUN_DIR } from 'dawnline.util';

/** Touched by every meter RPC: the watcher samples while it is fresh. */
export const WANT = `${RUN_DIR}/meter.want`;
/** The points, written by the watcher each second while WANT is fresh. */
export const FILE = `${RUN_DIR}/meter.json`;
/** Seconds after the last meter RPC the watcher keeps sampling. */
export const WANT_FOR = 10;
/** Points kept: two minutes, one a second. */
export const POINTS = 120;

/** Ask the watcher to sample for the next WANT_FOR seconds (the meter RPC). */
export function want() {
	ensure_dir(RUN_DIR);
	writefile(WANT, `${time()}`);
};

/** Someone asked for the meter within WANT_FOR seconds of `now`. */
export function wanted(now) {
	let st = stat(WANT);
	return st != null && now - st.mtime < WANT_FOR && st.mtime - now < WANT_FOR;
};

/**
 * What the watcher wrote, for the RPC: { now, want: WANT_FOR, keep: POINTS,
 * ts (newest point, 0 for none), points } with only the points newer than
 * `since` when it is given (a page that polls asks for what it lacks).
 * No points when nobody asked within WANT_FOR seconds or the agent is not
 * running: FILE is gone (the agent removes it as it stops and starts), or,
 * from one that died while someone looked, its newest point is over
 * WANT_FOR seconds old (ts then stops moving).
 */
export function read(since) {
	let f = read_json(FILE, null);
	let ts = +(f?.ts ?? 0);
	let pts = type(f?.points) == 'array' && time() - ts <= WANT_FOR ? f.points : [];
	if (since > 0)
		pts = filter(pts, (p) => p.ts > since);
	return { now: time(), want: WANT_FOR, keep: POINTS, ts: ts, points: pts };
};

/** Monotonic seconds, with the fraction: the gap between two samples. */
function mono() {
	let c = clock(true);
	return c[0] + c[1] / 1e9;
}

/**
 * One sample at `now` from the dump the watcher just read (`d`): { t, ts,
 * servers: [ server id ] (those whose tunnel was read), dev: { device id:
 * [ rx, tx, server id ] } (its peer's counters, on those servers) }. Nothing
 * but the dump is read.
 */
export function sample(m, d, now) {
	let s = { t: mono(), ts: now, servers: [], dev: {} };
	let read = {};
	for (let sid, srv in m.servers)
		if (d.reads[srv.ifname] == 'read') {
			read[sid] = true;
			push(s.servers, sid);
		}
	for (let id, dev in m.devices) {
		let peer = d.peers[dev.public_key];
		let sid = m.people[dev.person]?.server;
		if (peer && read[sid])
			s.dev[id] = [ peer.rx, peer.tx, sid ];
	}
	return s;
};

/** A counter's change, 0 when it went down (a tunnel set up again starts from zero). */
function delta(a, b) {
	return (b ?? 0) >= (a ?? 0) ? (b ?? 0) - (a ?? 0) : 0;
}

/**
 * The point between samples `a` and `b`, null when they are not a second or
 * so apart (the first sample, a stalled watcher): { ts, servers: { server
 * id: [ rx, tx ] } }, bytes per second of its devices together (rx what came
 * from them, tx what went to them, as a server's per-minute `rate`), for
 * every server whose tunnel `b` read ([ 0, 0 ] when nothing moved). A device
 * is counted from its second sample on, on the server it was on in both.
 */
export function point(a, b) {
	let dt = b.t - a.t;
	if (!(dt > 0.2 && dt < 5))
		return null;
	let sum = {};
	for (let sid in b.servers)
		sum[sid] = [ 0, 0 ];
	for (let id, v in b.dev) {
		let o = a.dev[id];
		if (!o || o[2] != v[2])
			continue;
		sum[v[2]][0] += delta(o[0], v[0]);
		sum[v[2]][1] += delta(o[1], v[1]);
	}
	let p = { ts: b.ts, servers: {} };
	for (let sid, v in sum)
		p.servers[sid] = [ int(v[0] / dt), int(v[1] / dt) ];
	return p;
};

/**
 * Keep point `p` in `ring` ([ [ ts, the point as JSON ] ], newest last; each
 * point is turned into text once, when it is made, not again every second for
 * as long as it is kept): at most POINTS of them, none older than POINTS
 * seconds before `p` (the watcher may have stalled in between) and none from
 * its second or later (the clock went back).
 */
export function keep(ring, p) {
	while (length(ring) && ring[length(ring) - 1][0] >= p.ts)
		pop(ring);
	push(ring, [ p.ts, sprintf('%J', p) ]);
	while (length(ring) > POINTS || ring[0][0] <= p.ts - POINTS)
		shift(ring);
};

/** Write the points kept in `ring` (keep()) to FILE. */
export function save(ring) {
	let ts = length(ring) ? ring[length(ring) - 1][0] : 0;
	ensure_dir(RUN_DIR);
	write_file(FILE, `{"ts":${ts},"points":[${join(',', map(ring, (r) => r[1]))}]}`, 0o644);
};

/** Nobody looks any more: FILE goes (the next look gets the points kept then). */
export function stop() {
	if (stat(FILE))
		unlink(FILE);
};
