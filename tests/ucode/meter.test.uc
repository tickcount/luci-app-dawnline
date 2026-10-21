// dawnline.meter: the point between two samples (each server's bytes per
// second), the sample taken from a dump, the two minutes kept, and the file
// the watcher writes and the RPC reads (in RUN_DIR, removed after).
import * as meter from 'dawnline.meter';
import { stat, unlink } from 'fs';

test('point', () => {
	let a = {
		t: 100.0, ts: 5000, servers: [ 's_1', 's_2' ],
		dev: { d_1: [ 1000, 2000, 's_1' ], d_2: [ 500, 500, 's_1' ], d_3: [ 9000, 9000, 's_1' ], d_5: [ 0, 0, 's_2' ] },
	};
	let b = {
		t: 101.0, ts: 5001, servers: [ 's_1', 's_2' ],
		// d_2 sent nothing; d_3's peer was added again (counters from zero); d_4 is new; d_5 moved to s_1.
		dev: { d_1: [ 3000, 12000, 's_1' ], d_2: [ 500, 500, 's_1' ], d_3: [ 100, 300, 's_1' ], d_4: [ 10, 10, 's_1' ], d_5: [ 50, 50, 's_1' ] },
	};
	eq(meter.point(a, b), { ts: 5001, servers: { s_1: [ 2000, 10000 ], s_2: [ 0, 0 ] } },
		'bytes per second of each server\'s devices together; a server read with nothing moving is 0');
	eq(meter.point(a, { ...b, t: 102.0 }).servers.s_1, [ 1000, 5000 ], 'over two seconds');
	eq(meter.point(a, { ...b, t: 100.0 }), null, 'no time passed');
	eq(meter.point(a, { ...b, t: 110.0 }), null, 'the watcher stalled');
	eq(meter.point(a, { ...b, servers: [ 's_2' ], dev: { d_5: [ 50, 50, 's_2' ] } }).servers, { s_2: [ 50, 50 ] }, 'only servers read in the newer sample');
	eq(meter.point({ ...a, dev: {} }, b).servers, { s_1: [ 0, 0 ], s_2: [ 0, 0 ] }, 'a first look at every device: nothing yet');
});

test('sample', () => {
	let m = {
		servers: { s_1: { ifname: 'dawn0' }, s_2: { ifname: 'dawn9' } },
		people: { p: { server: 's_1' }, q: { server: 's_2' } },
		devices: { d_1: { person: 'p', public_key: 'K1' }, d_2: { person: 'p', public_key: 'K2' }, d_3: { person: 'q', public_key: 'K3' } },
	};
	let d = { reads: { dawn0: 'read', dawn9: 'error' }, peers: { K1: { rx: 10, tx: 20 }, K3: { rx: 1, tx: 1 } } };
	let s = meter.sample(m, d, 5000);
	eq([ s.ts, s.servers, s.dev ], [ 5000, [ 's_1' ], { d_1: [ 10, 20, 's_1' ] } ],
		'the servers read and their devices in the tunnel; not a tunnel that could not be read');
	ok(s.t > 0, 'monotonic time');
});

test('keep', () => {
	let pt = (ts) => ({ ts: ts, servers: { s_1: [ ts, 0 ] } });
	let ring = [];
	for (let ts = 1000; ts < 1000 + meter.POINTS + 5; ts++)
		meter.keep(ring, pt(ts));
	eq([ length(ring), ring[0][0], ring[length(ring) - 1][0] ], [ meter.POINTS, 1005, 1000 + meter.POINTS + 4 ],
		'the last POINTS seconds, newest last');
	eq(json(ring[0][1]), pt(1005), 'each point kept as its JSON');
	meter.keep(ring, pt(5000));
	eq(map(ring, (r) => r[0]), [ 5000 ], 'after a stalled watcher: nothing older than two minutes');
	meter.keep(ring, pt(5001));
	meter.keep(ring, pt(5002));
	meter.keep(ring, pt(5001));
	eq(map(ring, (r) => r[0]), [ 5000, 5001 ], 'a clock that went back: its points replace the later ones');
});

test('want, save and read', () => {
	let had = stat(meter.WANT) != null;
	meter.want();
	ok(meter.wanted(time()), 'just asked');
	ok(!meter.wanted(time() + meter.WANT_FOR), 'stale after WANT_FOR');
	ok(!meter.wanted(time() - meter.WANT_FOR - 1), 'a clock that went back does not keep it');
	let t = time();
	meter.save([ [ t - 2, `{"ts":${t - 2},"servers":{}}` ], [ t - 1, `{"ts":${t - 1},"servers":{}}` ], [ t, `{"ts":${t},"servers":{"s_1":[1,2]}}` ] ]);
	let r = meter.read(0);
	eq([ r.ts, length(r.points), r.want, r.keep ], [ t, 3, meter.WANT_FOR, meter.POINTS ], 'everything');
	eq(meter.read(t - 1).points, [ { ts: t, servers: { s_1: [ 1, 2 ] } } ], 'only what is newer');
	let old = t - meter.WANT_FOR - 1;
	meter.save([ [ old, `{"ts":${old},"servers":{}}` ] ]);
	eq([ meter.read(0).ts, meter.read(0).points ], [ old, [] ], 'left by an agent that died while someone looked: no points');
	meter.stop();
	eq([ meter.read(0).ts, meter.read(0).points ], [ 0, [] ], 'nobody looks: nothing');
	if (!had)
		unlink(meter.WANT);
});
