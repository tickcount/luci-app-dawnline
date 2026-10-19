// dawnline.view: which device a portal page was opened from.
import * as view from 'dawnline.view';

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
