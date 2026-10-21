// dawnline.live: event categories and the retention policy, from a settings
// object and from the fixture config (real libuci); which tunnels are read,
// the counters folded from a read, how long a device counts as online, and
// what of the agent's files a read takes (RUN_DIR, put back after).
import * as live from 'dawnline.live';
import { RUN_DIR } from 'dawnline.util';
import { readfile, writefile, unlink } from 'fs';

test('category_of', () => {
	eq(live.category_of('connect'), 'connections', 'connect');
	eq(live.category_of('roam'), 'connections', 'roam');
	eq(live.category_of('device_added'), 'people', 'device events are people events');
	eq(live.category_of('person_changed'), 'people', 'person');
	eq(live.category_of('server_down'), 'problems', 'server');
	eq(live.category_of('something_new'), 'problems', 'unknown types are problems');
});

test('policy defaults', () => {
	eq(live.policy({}), { keep_days: 30, max: 2000, categories: [ 'connections', 'people', 'problems' ],
		persist: 'hourly', usage_days: 62, usage_months: 24 }, 'empty settings');
});

test('policy categories', () => {
	eq(live.policy({ log_connections: '0' }).categories, [ 'people', 'problems' ], 'old switch');
	eq(live.policy({ log_category: 'devices, problems' }).categories, [ 'people', 'problems' ], 'string list, devices renamed');
	eq(live.policy({ log_category: [ 'connections', 'bogus', 'connections' ] }).categories, [ 'connections' ], 'list, unknown and repeats dropped');
	eq(live.policy({ log_category: [], log_connections: '0' }).categories, [], 'explicit empty list wins');
});

// Ranges come from dawnline.schema: a stored value outside them (an older
// version, a hand edit) reads as the default, as settings_update would have refused it.
test('policy ranges', () => {
	eq(live.policy({ log_max: '50' }).max, 2000, 'max below the floor: default');
	eq(live.policy({ log_max: '99999' }).max, 2000, 'max above the ceiling: default');
	eq(live.policy({ log_max: '150' }).max, 150, 'max in range');
	eq(live.policy({ log_max: 'abc' }).max, 2000, 'bad max');
	eq(live.policy({ log_keep_days: '0' }).keep_days, 0, 'keep forever');
	eq(live.policy({ log_keep_days: '-3' }).keep_days, 30, 'negative days');
	eq(live.policy({ log_persist: '10min' }).persist, '10min', 'persist');
	eq(live.policy({ log_persist: 'daily' }).persist, 'hourly', 'bad persist');
	eq(live.policy({ usage_keep_days: '1' }).usage_days, 62, 'usage days below the floor: default');
	eq(live.policy({ usage_keep_months: '500' }).usage_months, 24, 'usage months above the ceiling: default');
});

test('policy from the config', () => {
	eq(live.policy(null).categories, [ 'people', 'problems' ], 'fixture turns connections off');
	eq(live.policy(null).max, 2000, 'default where the fixture says nothing');
});

test('endpoint_ip', () => {
	eq(live.endpoint_ip('203.0.113.7:41821'), '203.0.113.7', 'v4');
	eq(live.endpoint_ip('[2001:db8::1]:41821'), '2001:db8::1', 'v6');
	eq(live.endpoint_ip(''), '', 'none');
});

// A connect is logged before its new address is located; the place comes later.
test('fill_places', () => {
	let ev = [
		{ type: 'connect', detail: '1.1.1.1', where: null, ts: 100 },
		{ type: 'connect', detail: '1.1.1.1', where: null, ts: 200 },
		{ type: 'disconnect', detail: null, ts: 210 },
		{ type: 'connect', detail: '8.8.8.8', where: 'Mountain View · Google', ts: 220 },
		{ type: 'connect', detail: '9.9.9.9', where: null, ts: 230 },
	];
	ok(live.fill_places(ev, { '1.1.1.1': 'Sydney · Cloudflare', '8.8.8.8': 'Elsewhere' }, 150), 'changed');
	eq(ev[1].where, 'Sydney · Cloudflare', 'the waiting connect gets its place');
	eq(ev[0].where, null, 'older than `since`: left alone');
	eq(ev[3].where, 'Mountain View · Google', 'a place already there stays');
	eq(ev[4].where, null, 'another address');
	ok(!live.fill_places(ev, { '7.7.7.7': 'X' }, 0), 'nothing to fill: unchanged');
	ok(!live.fill_places([], { '1.1.1.1': 'X' }, 0), 'empty log');
});

test('tunnel_ifnames: the servers that run, on interfaces of their own', () => {
	let srv = (ifname, more) => ({ enabled: true, private_key: 'k', ifname, subnet: '10.9.0.0/29', ...(more ?? {}) });
	let m = { servers: {
		a: srv('awga'), off: srv('awgoff', { enabled: false }), keyless: srv('awgk', { private_key: '' }),
		taken: srv('lan', { blocked: { code: 'taken', ifname: 'lan' } }), bad: srv('Bad Name'),
	} };
	eq(live.tunnel_ifnames(m), [ 'awga' ], 'not turned off, without keys, kept down or misnamed');
	eq(live.tunnel_ifnames({ servers: {} }), [], 'none');
	m.servers.b = srv('awgb');
	eq(live.tunnel_ifnames(m, 'b'), [ 'awgb' ], 'one server\'s (a person\'s page)');
	eq([ live.tunnel_ifnames(m, 'off'), live.tunnel_ifnames(m, ''), live.tunnel_ifnames(m, 'gone') ], [ [], [], [] ],
		'one that does not run, no server, an unknown one: nothing');
});

// What a read that failed, a tunnel that is down and a new link do to the counters.
test('collect: counters per tunnel read', () => {
	let m = {
		servers: { a: { ifname: 'awga' }, b: { ifname: 'awgb' } },
		people: { pa: { server: 'a' }, pb: { server: 'b' } },
		devices: { da: { person: 'pa', public_key: 'KA' }, db: { person: 'pb', public_key: 'KB' } },
		settings: { retention: {} },
	};
	let usage = { devices: { da: { raw: [ 40, 10 ], ifindex: 7 }, db: { raw: [ 500, 500 ] } }, people: {} };
	let peer = (rx, tx) => ({ KA: { ifname: 'awga', endpoint: '', handshake: 0, rx, tx } });
	live.collect(m, usage, { ok: false, reads: { awga: 'read', awgb: 'error' }, ifaces: { awga: { ifindex: 7 } }, peers: peer(100, 50) });
	eq(usage.devices.da.total, [ 60, 40 ], 'the difference since the last read');
	eq(usage.people.pa.total, [ 60, 40 ], 'their person');
	eq(usage.devices.db.raw, [ 500, 500 ], 'a tunnel that could not be read keeps its counters');
	live.collect(m, usage, { ok: true, reads: { awga: 'read', awgb: 'down' }, ifaces: { awga: { ifindex: 7 } }, peers: peer(100, 50) });
	eq(usage.devices.db.raw, [ 0, 0 ], 'a tunnel that is down starts again from zero');
	eq(usage.devices.da.total, [ 60, 40 ], 'nothing new');
	// Set up again: a new link whose counters already passed the old ones.
	live.collect(m, usage, { ok: true, reads: { awga: 'read' }, ifaces: { awga: { ifindex: 8 } }, peers: peer(150, 80) });
	eq(usage.devices.da.total, [ 210, 120 ], 'a new link counts from zero');
	eq(usage.devices.da.ifindex, 8, 'the record follows its link');
	// A link whose index is unknown changes nothing about the epoch.
	live.collect(m, usage, { ok: true, reads: { awga: 'read' }, ifaces: { awga: { ifindex: null } }, peers: peer(160, 90) });
	eq([ usage.devices.da.total, usage.devices.da.ifindex ], [ [ 220, 130 ], 8 ], 'counted on');
});

// The window follows the keep-alive the device's configuration carries
// (awg.idle_handshake): 190 s for every default, longer only where the
// handshakes of an idle device are further apart.
test('online_window', () => {
	let srv = { keepalive: 25, obf: {} };
	eq(live.online_window(srv, {}), 190, 'the default keep-alive');
	eq(live.online_window({ keepalive: 25, obf: { header_protection_key: 'k', rekey_after_time: '100-120' } }, {}), 190, 'Maximum');
	eq(live.online_window(srv, { keepalive: 0 }), 190, 'keep-alive off: the session alone');
	eq(live.online_window(srv, { keepalive: 100 }), 250, 'a handshake every second keep-alive');
	eq(live.online_window(srv, { keepalive: 300 }), 330, 'one every keep-alive');
	eq(live.online_window({ keepalive: 300, obf: {} }, {}), 330, 'the server\'s keep-alive');
	eq(live.online_window(null, {}), 190, 'no server');
	let m = { servers: { a: srv }, people: { p: { server: 'a' } }, devices: { d: { person: 'p', keepalive: 300 }, e: { person: 'x' } } };
	eq(live.online_windows(m), { d: 330, e: 190 }, 'per device');
	eq(live.online_windows(m, 'a'), { d: 330 }, 'one server\'s devices');
});

test('online: without the agent, by the device\'s window', () => {
	let peer = { handshake: time() - 300 };
	eq(live.online({ presence: null, windows: { d: 330 } }, 'd', peer), true, 'within its window');
	eq(live.online({ presence: null }, 'd', peer), false, 'the shortest window');
	eq(live.online({ presence: { online: { d: false } }, windows: { d: 330 } }, 'd', peer), false, 'the agent\'s word first');
});

test('collect: online by the device\'s window', () => {
	let m = {
		servers: { a: { ifname: 'awga', keepalive: 300, obf: {} } },
		people: { pa: { server: 'a' } },
		devices: { da: { person: 'pa', public_key: 'KA' }, db: { person: 'pa', public_key: 'KB', keepalive: 25 } },
		settings: { retention: {} },
	};
	let hs = time() - 300;
	let peers = { KA: { ifname: 'awga', endpoint: '', handshake: hs, rx: 0, tx: 0 }, KB: { ifname: 'awga', endpoint: '', handshake: hs, rx: 0, tx: 0 } };
	let v = live.collect(m, { devices: {}, people: {} }, { ok: true, reads: { awga: 'read' }, ifaces: { awga: { ifindex: 1 } }, peers });
	eq([ v.da.online, v.db.online ], [ true, false ], 'the server\'s keep-alive of 300 s, and a device\'s own of 25 s');
});

// What the agent's watcher shows of each link (dawnline.link) reaches the
// read models through dump(), only while the agent runs.
test('dump: link and set-up states while the agent runs', () => {
	let beat = `${RUN_DIR}/agent.beat`;
	let had_beat = readfile(beat), had_link = readfile(live.LINK), had_setup = readfile(live.SETUP);
	let shown = { d_1: { state: 'trying', since: 1800000000 } }, setups = { d_1: { state: 'trying', since: 1800000000 } };
	writefile(live.LINK, sprintf('%J', shown));
	writefile(live.SETUP, sprintf('%J', setups));
	writefile(beat, `${time()}`);
	let m = { servers: {}, people: {}, devices: {} };
	eq(live.dump(m).link, shown, 'the watcher\'s states');
	eq(live.dump(m).setup, setups, 'and its set-up states');
	writefile(beat, `${time() - 600}`);
	eq(live.dump(m).link, {}, 'a stopped agent\'s states are stale');
	eq(live.dump(m).setup, null, 'and nobody tells the set-up states');
	for (let f in [ [ beat, had_beat ], [ live.LINK, had_link ], [ live.SETUP, had_setup ] ])
		f[1] == null ? unlink(f[0]) : writefile(f[0], f[1]);
});

// A link that keeps failing is one line per device (add_event_merged), not one per device and person.
test('add_event_merged: per device', () => {
	let path = `${RUN_DIR}/events.json`, had = readfile(path);
	writefile(path, '[]');
	live.add_event_merged({ type: 'device_failing', person: 'p_x', device: 'd_x1', detail: 'trying' }, 3600);
	live.add_event_merged({ type: 'device_failing', person: 'p_x', device: 'd_x1', detail: 'unstable' }, 3600);
	live.add_event_merged({ type: 'device_failing', person: 'p_x', device: 'd_x2', detail: 'shared' }, 3600);
	let ev = live.load_events();
	eq(map(ev, (e) => [ e.device, e.detail ]), [ [ 'd_x1', 'trying, unstable' ], [ 'd_x2', 'shared' ] ], 'merged per device');
	eq(live.category_of('device_failing'), 'problems', 'a problem');
	eq(live.category_of('device_recovered'), 'problems', 'and so is its end');
	had == null ? unlink(path) : writefile(path, had);
});
