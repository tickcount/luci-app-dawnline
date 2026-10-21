// dawnline.core: the model read from the fixture config (real libuci), access
// hours, quotas and the derived person state at an explicit time, address
// allocation, the automatic MTU, a device's own MTU, keep-alive and local
// network, and other packages' port forwards.
import { readfile, writefile, unlink } from 'fs';
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
	let d = m.devices.alice_phone;
	eq([ d.mtu, d.keepalive, d.lan_bypass ], [ 0, null, false ], 'a device without link values of its own');
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
	eq(core.device_mtu({ mtu: 0, obf: {} }, { kind: 'phone', mtu: 1420 }), 1420, 'the device\'s own, also above 1280 on a phone');
	eq(core.device_mtu({ mtu: 1420 }, { kind: 'computer', mtu: 1280 }), 1280, 'the device\'s own below the tunnel\'s');
	eq(core.device_mtu({ mtu: 0, obf: {} }, { kind: 'computer', mtu: 9000 }), 1380, 'out of range (a hand edit): the automatic one');
	eq(core.device_mtu({ mtu: 0, obf: {} }, { kind: 'phone', mtu: 0 }), 1280, '0: as before');
});

test('device_keepalive', () => {
	let srv = { keepalive: 25 };
	eq(core.device_keepalive(srv, { keepalive: null }), 25, 'the server\'s');
	eq(core.device_keepalive(srv, {}), 25, 'none read');
	eq(core.device_keepalive(srv, { keepalive: 0 }), 0, 'off for this device');
	eq(core.device_keepalive(srv, { keepalive: 120 }), 120, 'its own');
	eq(core.device_keepalive(srv, { keepalive: 700 }), 25, 'out of range: the server\'s');
	eq(core.device_keepalive({ keepalive: 0 }, { keepalive: 15 }), 15, 'its own on a server without keep-alive');
});

/** A uci cursor that records what is written: { 'section.option': value or null (deleted) }. */
function recorder() {
	let w = {};
	return { w, c: { set: (cfg, s, k, v) => { w[`${s}.${k}`] = v; }, delete: (cfg, s, k) => { w[`${s}.${k}`] = null; } } };
}

test('set_device_link', () => {
	let mm = { devices: { d: { id: 'd', mtu: 0, keepalive: null, lan_bypass: false } } };
	let r = recorder();
	eq(core.set_device_link(r.c, mm, 'd', { mtu: '1400', keepalive: '0', lan_bypass: true }), [ 'mtu', 'keepalive', 'lan_bypass' ], 'what changed');
	eq(r.w, { 'd.mtu': '1400', 'd.keepalive': '0', 'd.lan_bypass': '1' }, 'written');
	r = recorder();
	mm.devices.d = { id: 'd', mtu: 1400, keepalive: 0, lan_bypass: true };
	eq(core.set_device_link(r.c, mm, 'd', { mtu: '', keepalive: '', lan_bypass: false }), [ 'mtu', 'keepalive', 'lan_bypass' ], 'back');
	eq(r.w, { 'd.mtu': null, 'd.keepalive': null, 'd.lan_bypass': null }, 'removed: the server\'s again');
	r = recorder();
	eq(core.set_device_link(r.c, mm, 'd', { mtu: '1400', keepalive: ' 0 ' }), [], 'the same values change nothing');
	eq(r.w, {}, 'nothing written');
	eq(core.set_device_link(r.c, mm, 'd', {}), [], 'nothing asked');
	throws(() => core.set_device_link(r.c, mm, 'd', { mtu: '1279' }), /^MTU must be 1280-1500\.$/, 'MTU too small');
	throws(() => core.set_device_link(r.c, mm, 'd', { mtu: '1501' }), /^MTU must be 1280-1500\.$/, 'MTU too large');
	throws(() => core.set_device_link(r.c, mm, 'd', { mtu: '1400.5' }), /^MTU/, 'not a whole number');
	throws(() => core.set_device_link(r.c, mm, 'd', { keepalive: '601' }), /^Keep-alive must be 0-600 seconds\.$/, 'keep-alive too long');
	throws(() => core.set_device_link(r.c, mm, 'd', { keepalive: '-1' }), /^Keep-alive/, 'negative');
	throws(() => core.set_device_link(r.c, mm, 'x', { mtu: '' }), /^Unknown device\.$/, 'unknown device');
});

test('create_device: the local network outside the tunnel', () => {
	let mm = core.load();
	let r = recorder();
	let keys = { public_key: 'a8Z2wq0b8rQx3mN6kYyQ2G3bQm2kq5tY5m7Q0yq3m3c=', preshared_key: '' };
	let id = core.create_device(r.c, mm, 'bob', 'Laptop', 'computer', { keys, lan_bypass: true });
	eq([ r.w[`${id}.lan_bypass`], mm.devices[id].lan_bypass, mm.devices[id].mtu, mm.devices[id].keepalive ], [ '1', true, 0, null ], 'set');
	r = recorder();
	id = core.create_device(r.c, mm, 'bob', 'Tablet', 'tablet', { keys: { ...keys, public_key: 'b8Z2wq0b8rQx3mN6kYyQ2G3bQm2kq5tY5m7Q0yq3m3c=' } });
	ok(!(`${id}.lan_bypass` in r.w) && !mm.devices[id].lan_bypass, 'off unless asked');
});

test('create_device: not with the server\'s own key', () => {
	let mm = core.load();
	let keys = { public_key: mm.servers.main.public_key, preshared_key: '' };
	throws(() => core.create_device(recorder().c, mm, 'bob', 'Laptop', 'computer', { keys }), /^This key is already in use\.$/,
		'it is in every configuration of the server');
	mm.devices.alice_phone.public_key = mm.servers.main.public_key;
	eq(core.model_errors(mm), [ "Device Phone of Alice: the public key is the server's own." ], 'one set by hand is named');
});

test('model_errors: a device\'s own MTU and keep-alive', () => {
	let mm = core.load();
	eq(core.model_errors(mm), [], 'the fixture is consistent');
	let d = mm.devices.alice_phone;
	d.mtu = 1400;
	d.keepalive = 0;
	eq(core.model_errors(mm), [], 'values of its own in range');
	d.mtu = 9000;
	d.keepalive = 601;
	eq(core.model_errors(mm), [
		'Device Phone of Alice: MTU 9000 is not between 1280 and 1500.',
		'Device Phone of Alice: keep-alive 601 is not between 0 and 600 seconds.',
	], 'named');
});

test('names and codes', () => {
	ok(core.valid_ifname('awgmain') && core.valid_ifname('a') && core.valid_ifname('awg_1'), 'interface names');
	ok(!core.valid_ifname('Awg') && !core.valid_ifname('1awg') && !core.valid_ifname('awg-main') && !core.valid_ifname('awgmain123456'), 'bad interface names');
	for (let i = 0; i < 20; i++)
		ok(match(core.new_code(), core.WORD_CODE), 'new_code is a word code');
});

test('renumber_server', () => {
	let srv = { id: 'main', name: 'Main', subnet: '10.9.0.0/29' };
	let mm = {
		servers: { main: srv, other: { id: 'other', subnet: '10.9.1.0/29' } },
		people: { a: { server: 'main', devices: [ 'a1', 'a2' ] }, o: { server: 'other', devices: [ 'o1' ] } },
		devices: { a1: { person: 'a', address: '10.9.0.5' }, a2: { person: 'a', address: '10.9.0.3' }, o1: { person: 'o', address: '10.9.1.2' } },
	};
	let set = {};
	let c = { set: (cfg, s, k, v) => { set[`${s}.${k}`] = v; }, delete: () => {} };
	core.renumber_server(c, mm, srv, '10.77.0.0/24');
	eq(srv.subnet, '10.77.0.0/24', 'the server moves');
	eq([ mm.devices.a1.address, mm.devices.a2.address ], [ '10.77.0.2', '10.77.0.3' ], 'devices renumbered lowest first');
	eq(mm.devices.o1.address, '10.9.1.2', 'another server untouched');
	eq(set, { 'a1.address': '10.77.0.2', 'a2.address': '10.77.0.3', 'main.subnet': '10.77.0.0/24' }, 'written to uci');
	let err = null;
	try { core.renumber_server(c, mm, srv, '10.9.2.0/30'); } catch (e) { err = e; }
	ok(err != null, 'refuses a subnet too small for the devices');
});

test('device_labels', () => {
	let mm = { devices: {
		a: { id: 'a', name: 'iPhone', created: 1 }, b: { id: 'b', name: 'iPhone!', created: 2 },
		c: { id: 'c', name: 'Телефон', created: 3 }, d: { id: 'd', name: 'телефон', created: 4 },
	} };
	let p = { id: 'p', devices: [ 'd', 'c', 'b', 'a' ] };
	eq(core.device_labels(mm, p), { a: 'iphone', b: 'iphone-2', c: 'telefon', d: 'telefon-2' }, 'unique by age');
});

test('wan_forwards leaves out Dawnline\'s own, without a regex', () => {
	// A firewall config for this case only (the container's own is put back).
	let path = '/etc/config/firewall', saved = readfile(path);
	let names = [ 'dawnline_portal', 'dawnline_', 'dawnline', 'Dawnline_x', 'xdawnline_y', 'dawnlinex_1', 'web' ];
	let conf = '';
	for (let i = 0; i < length(names); i++)
		conf += sprintf("config redirect '%s'\n\toption src 'wan'\n\toption proto 'udp'\n\toption src_dport '%d'\n\n", names[i], 6000 + i);
	writefile(path, conf);
	let got = null, err = null;
	try {
		got = core.wan_forwards('wan', 'udp');
	}
	catch (e) {
		err = e;
	}
	if (saved != null)
		writefile(path, saved);
	else
		unlink(path);
	if (err)
		die(err.message);
	// The names the pattern it stands for let through.
	eq(map(got, (f) => f.name), filter(names, (n) => !match(n, /^dawnline_/)), 'names');
	eq(got[0], { from: 6002, to: 6002, name: 'dawnline' }, 'a forward');
});
