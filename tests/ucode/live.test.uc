// dawnline.live: event categories and the retention policy, from a settings
// object and from the fixture config (real libuci).
import * as live from 'dawnline.live';

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
