// dawnline.core: the model read from the fixture config (real libuci), access
// hours, quotas and the derived person state at an explicit time, address
// allocation and the automatic MTU.
import * as core from 'dawnline.core';

// A local time that no time zone turns into another day.
function at(y, mo, d, h, mi) {
	return timelocal({ year: y, mon: mo, mday: d, hour: h, min: mi, sec: 0 });
}

let m = core.load();

test('load reads the fixture', () => {
	eq(keys(m.servers), [ 'main' ], 'servers');
	eq(sort(keys(m.people)), [ 'alice', 'bob' ], 'people');
	eq(m.servers.main.subnet, '10.9.0.0/29', 'subnet');
	eq(m.servers.main.mtu, 1380, 'stored MTU');
	eq(m.servers.main.obf, { jc: '4', jmin: '64', jmax: '128', s4: '12' }, 'disguise values as strings');
	eq(m.servers.main.mesh, 'all', 'mesh default');
	eq(m.people.alice.devices, [ 'alice_phone' ], 'devices attached to their person');
	eq(m.people.alice.access, 'both', 'access');
	eq(m.people.bob.access, 'internet', 'access default');
	eq(m.people.bob.quota_gb, 2, 'quota as a number');
	eq(m.people.bob.device_limit, 3, 'device limit from the settings default');
	eq(m.devices.alice_phone.kind, 'phone', 'kind');
	eq(m.settings.portal_enabled, true, 'bool setting');
	eq(m.settings.updates.interval, '7d', 'update policy from the same section');
	eq(m.settings.updates.targets, [ 'app' ], 'update targets list');
	eq(m.settings.retention.log_connections, '0', 'raw retention values');
});

test('parse_hours', () => {
	eq(core.parse_hours('07:00-23:00'), [ 420, 1380 ], 'day window');
	eq(core.parse_hours('23:00-07:00'), [ 1380, 420 ], 'overnight window');
	eq(core.parse_hours('7:00-23:00'), [ 420, 1380 ], 'one-digit hour');
	eq(core.parse_hours('00:00-24:00'), [ 0, 1440 ], 'whole day');
	eq(core.parse_hours('24:00-01:00'), null, 'start at 24:00');
	eq(core.parse_hours('10:00-10:00'), null, 'empty window');
	eq(core.parse_hours('always'), null, 'words');
	eq(core.parse_hours(''), null, 'empty');
	eq(core.parse_hours(null), null, 'null');
});

test('person_quota', () => {
	let march = at(2026, 3, 10, 12, 0);
	eq(core.person_quota({ quota_gb: 0 }, march), 0, 'unlimited');
	eq(core.person_quota({ quota_gb: 2 }, march), 2147483648, '2 GiB');
	eq(core.person_quota({ quota_gb: 2, bonus_gb: 1, bonus_month: '2026-03' }, march), 3221225472, 'bonus this month');
	eq(core.person_quota({ quota_gb: 2, bonus_gb: 1, bonus_month: '2026-02' }, march), 2147483648, 'bonus of another month');
	eq(core.person_quota({ quota_gb: -1 }, march), 0, 'negative is unlimited');
});

test('person_usage', () => {
	let march = at(2026, 3, 10, 12, 0);
	let usage = { people: { bob: { total: [ 100, 50 ], months: { '2026-03': [ 10, 5 ], '2026-02': [ 1000, 1000 ] } } } };
	eq(core.person_usage({ id: 'bob', quota_period: 'month' }, usage, march), 15, 'this month');
	eq(core.person_usage({ id: 'bob', quota_period: 'month' }, usage, at(2026, 4, 1, 0, 0)), 0, 'a month without traffic');
	eq(core.person_usage({ id: 'bob', quota_period: 'total' }, usage, march), 150, 'total');
	eq(core.person_usage({ id: 'nobody', quota_period: 'month' }, usage, march), 0, 'unknown person');
	eq(core.person_usage({ id: 'bob' }, null, march), 0, 'no usage data');
});

test('own_state', () => {
	let base = { id: 'p', paused: false, expires: '', expire_action: 'pause', quota_gb: 0, hours: '' };
	let noon = at(2026, 3, 10, 12, 0);
	eq(core.own_state(m, base, null, noon), 'active', 'nothing set');
	eq(core.own_state(m, { ...base, paused: true }, null, noon), 'paused', 'paused');
	eq(core.own_state(m, { ...base, expires: '2026-03-09' }, null, noon), 'expired', 'expired yesterday');
	eq(core.own_state(m, { ...base, expires: '2026-03-10' }, null, noon), 'active', 'expires at the end of today');
	eq(core.own_state(m, { ...base, expires: '2026-03-09', expire_action: 'notify' }, null, noon), 'active', 'notify keeps access');
	let usage = { people: { p: { months: { '2026-03': [ 600000000, 600000000 ] } } } };
	eq(core.own_state(m, { ...base, quota_gb: 1 }, usage, noon), 'quota', 'over quota');
	eq(core.own_state(m, { ...base, quota_gb: 1, bonus_gb: 1, bonus_month: '2026-03' }, usage, noon), 'active', 'bonus lifts the quota');
	eq(core.own_state(m, { ...base, quota_gb: 1 }, usage, at(2026, 4, 1, 0, 0)), 'active', 'a new month resets the usage');
	eq(core.own_state(m, { ...base, hours: '09:00-17:00' }, null, noon), 'active', 'inside the hours');
	eq(core.own_state(m, { ...base, hours: '09:00-17:00' }, null, at(2026, 3, 10, 20, 0)), 'hours', 'outside the hours');
	eq(core.own_state(m, { ...base, hours: '22:00-06:00' }, null, at(2026, 3, 10, 23, 0)), 'active', 'overnight, before midnight');
	eq(core.own_state(m, { ...base, hours: '22:00-06:00' }, null, at(2026, 3, 10, 5, 59)), 'active', 'overnight, after midnight');
	eq(core.own_state(m, { ...base, hours: '22:00-06:00' }, null, noon), 'hours', 'overnight, daytime');
	eq(core.own_state(m, { ...base, paused: true, expires: '2000-01-01' }, null, noon), 'paused', 'paused wins over expired');
	eq(core.own_state(m, { ...base, expires: '2000-01-01', quota_gb: 1 }, usage, noon), 'expired', 'expired wins over quota');
});

test('person_state', () => {
	let noon = at(2026, 3, 10, 12, 0);
	let p = { id: 'p', server: 'main', paused: false, expires: '', expire_action: 'pause', quota_gb: 0, hours: '' };
	eq(core.person_state(m, p, null, noon), 'active', 'server on');
	eq(core.person_state(m, { ...p, server: 'gone' }, null, noon), 'no_server', 'no server');
	let off = { servers: { main: { ...m.servers.main, enabled: false } } };
	eq(core.person_state(off, p, null, noon), 'server_off', 'server off');
	eq(core.person_state(off, { ...p, paused: true }, null, noon), 'server_off', 'server off is about the server');
	ok(core.person_expired({ expires: '2000-01-01' }, noon), 'person_expired');
	ok(!core.person_expired({ expires: '' }, noon), 'no end date');
	ok(!core.person_expired({ expires: 'garbage' }, noon), 'bad date is not expired');
});

test('alloc_address', () => {
	let srv = { id: 'main', subnet: '10.9.0.0/29' };
	let other = { id: 'other', subnet: '10.9.1.0/29' };
	let model = (addrs) => {
		let mm = { servers: { main: srv, other }, people: { a: { server: 'main' }, o: { server: 'other' } }, devices: {} };
		for (let i, a in addrs)
			mm.devices[`d${i}`] = { person: 'a', address: a };
		return mm;
	};
	eq(core.alloc_address(model([]), srv), '10.9.0.2', 'router has the first host');
	eq(core.alloc_address(model([ '10.9.0.2', '10.9.0.3' ]), srv), '10.9.0.4', 'next free');
	eq(core.alloc_address(model([ '10.9.0.2', '10.9.0.4' ]), srv), '10.9.0.3', 'lowest gap');
	eq(core.alloc_address(model([ '10.9.0.2', '10.9.0.3', '10.9.0.4', '10.9.0.5', '10.9.0.6' ]), srv), null, 'exhausted (.7 is broadcast)');
	eq(core.alloc_address(model([ '10.9.0.2', 'garbage' ]), srv), '10.9.0.3', 'a broken address is ignored');
	let mm = model([]);
	mm.devices.x = { person: 'o', address: '10.9.0.2' };
	eq(core.alloc_address(mm, srv), '10.9.0.2', 'another server\'s devices do not count');
	eq(core.alloc_address(model([]), { id: 'main', subnet: 'nonsense' }), null, 'no subnet');
	eq(core.server_address(srv), '10.9.0.1', 'server_address');
	eq(core.tunnels({ ...srv, ifname: 'awgmain', private_key: 'k' }), [ { ifname: 'awgmain', subnet: '10.9.0.0/29', address: '10.9.0.1' } ], 'tunnels');
	eq(core.tunnels({ ...srv, ifname: 'awgmain' }), [], 'no key, no tunnel');
	eq(core.tunnels({ ...srv, ifname: 'awgmain', private_key: 'k', blocked: 'taken' }), [], 'blocked interface');
	eq(core.tunnels({ ...srv, ifname: 'awg-main', private_key: 'k' }), [], 'bad interface name');
});

test('tunnel_mtu / device_mtu', () => {
	eq(core.tunnel_mtu({ mtu: 1420 }), 1420, 'set by hand');
	eq(core.tunnel_mtu({ mtu: 0, obf: {} }), 1380, 'automatic');
	eq(core.tunnel_mtu({ mtu: 0 }), 1380, 'automatic without disguise');
	eq(core.tunnel_mtu({ mtu: 0, obf: { s4: '12' } }), 1368, 'S4 taken off');
	eq(core.tunnel_mtu({ mtu: 0, obf: { s4: '100' } }), 1280, 'never below 1280');
	eq(core.device_mtu({ mtu: 0, obf: {} }, { kind: 'phone' }), 1280, 'phone');
	eq(core.device_mtu({ mtu: 0, obf: {} }, { kind: 'computer' }), 1380, 'computer');
	eq(core.device_mtu({ mtu: 1200 }, { kind: 'tablet' }), 1200, 'a smaller tunnel MTU stays');
});

test('names and codes', () => {
	ok(core.valid_ifname('awgmain') && core.valid_ifname('a') && core.valid_ifname('awg_1'), 'interface names');
	ok(!core.valid_ifname('Awg') && !core.valid_ifname('1awg') && !core.valid_ifname('awg-main') && !core.valid_ifname('awgmain123456'), 'bad interface names');
	for (let i = 0; i < 20; i++)
		ok(match(core.new_code(), core.WORD_CODE), 'new_code is a word code');
});
