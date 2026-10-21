// dawnline.view: which device a portal page was opened from, and the usage series it draws.
import * as view from 'dawnline.view';
import { day_key_ago } from 'dawnline.util';

const devs = [
	{ id: 'd_1', address: '10.0.0.2', online: true, endpoint: '203.0.113.7' },
	{ id: 'd_2', address: '10.0.0.3', online: false, endpoint: '198.51.100.4' },
	{ id: 'd_3', address: '10.0.0.4', online: true, endpoint: '192.0.2.9' },
];

test('device_here', () => {
	eq(view.device_here(devs, '10.0.0.3'), 'd_2', 'through the tunnel: its address, online or not');
	eq(view.device_here(devs, '203.0.113.7'), 'd_1', 'beside the tunnel: where its tunnel comes from');
	eq(view.device_here(devs, '::ffff:203.0.113.7'), 'd_1', 'an IPv4 request on a dual-stack socket');
	eq(view.device_here(devs, '198.51.100.4'), null, 'a device that is not online does not count');
	eq(view.device_here(devs, '233.252.0.1'), null, 'from elsewhere');
	eq(view.device_here([ ...devs, { id: 'd_4', address: '10.0.0.5', online: true, endpoint: '203.0.113.7' } ], '203.0.113.7'), null,
		'two devices behind one address: neither');
	eq(view.device_here(devs, ''), null, 'no address');
	eq(view.device_here([ { id: 'd_5', address: '10.0.0.6', online: true, endpoint: '' } ], ''), null, 'no address, no endpoint');
});

test('month_days', () => {
	let n = +substr(day_key_ago(0), 8, 2);
	let days = {};
	// On the 1st, today is the 1st: then only today's own value.
	if (n > 1)
		days[day_key_ago(n - 1)] = [ 1, 2 ];
	days[day_key_ago(0)] = [ 5, 7 ];
	// Last month's last day stays out of this month's chart.
	days[day_key_ago(n)] = [ 100, 100 ];
	let s = view.month_days({ days });
	eq(length(s), n, 'one bar a day, from the 1st to today');
	eq(s[n - 1], [ 5, 7 ], 'today last, received and sent apart');
	eq(s[0], n > 1 ? [ 1, 2 ] : [ 5, 7 ], 'the 1st first');
	eq(length(view.month_days(null)), n, 'no usage yet: zeros');
	eq(view.month_days(null)[0], [ 0, 0 ], 'a day without traffic is zero both ways');
	eq(view.spark({ days }, 1), [ [ 5, 7 ] ], 'the week the same way, today last');
});

// What the set-up sheet reads off a device: the watcher's state, or without the agent a session that lives.
test('device_view: set-up state', () => {
	let m = {
		settings: { hostnames: false },
		servers: { s_1: { id: 's_1', keepalive: 25, obf: {} } },
		people: { p_1: { id: 'p_1', server: 's_1', devices: [ 'd_1' ] } },
		devices: { d_1: { id: 'd_1', person: 'p_1', kind: 'phone', public_key: 'K1', private_key: 'x', mtu: 0, keepalive: null } },
		_reconnect: {}, _issued: {},
	};
	let hs = time() - 10;
	let peers = { K1: { ifname: 'awga', endpoint: '203.0.113.7:4000', handshake: hs, rx: 100, tx: 100 } };
	let usage = { devices: {}, people: {} };
	let watched = { peers, presence: { online: { d_1: true } }, windows: {}, link: {}, setup: { d_1: { state: 'nodata', since: hs + 15 } } };
	eq(view.device_view(m, m.devices.d_1, usage, watched).setup, { state: 'nodata', since: hs + 15 }, 'the watcher\'s');
	eq(view.device_view(m, m.devices.d_1, usage, { ...watched, setup: {} }).setup, null, 'the watcher sees nothing');
	let alone = { peers, presence: null, windows: {}, link: {}, setup: null };
	eq(view.device_view(m, m.devices.d_1, usage, alone).setup, { state: 'flowing', since: hs }, 'no agent: a live session');
	eq(view.device_view(m, m.devices.d_1, usage, { ...alone, peers: {} }).setup, null, 'no agent, not online: nothing');
});
