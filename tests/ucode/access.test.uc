// dawnline.access: the Check access walk for a device that keeps its own
// local network out of the tunnel (lan_bypass), and the way its internet
// leaves, on a model and a network snapshot of the test's own (nothing read
// from the container).
import * as access from 'dawnline.access';

const KEY_TV = 'a8Z2wq0b8rQx3mN6kYyQ2G3bQm2kq5tY5m7Q0yq3m3c=', KEY_PHONE = 'b8Z2wq0b8rQx3mN6kYyQ2G3bQm2kq5tY5m7Q0yq3m3c=';

/** Bob (Internet only) on a server that sends everyone direct: a TV with lan_bypass and a phone without. */
function model() {
	return {
		settings: { portal_enabled: false },
		servers: {
			home: { id: 'home', name: 'Home', ifname: 'awghome', subnet: '10.9.0.0/29', private_key: 'k', enabled: true, lan_like: false,
				auto_wan: false, wan_device: 'eth1', auto_lan: false, lan_devices: [ 'br-lan' ], mesh: 'all', device_mesh: true, dns: [] },
		},
		people: { bob: { id: 'bob', name: 'Bob', server: 'home', access: 'internet', services: [], devices: [ 'tv', 'phone' ] } },
		devices: {
			tv: { id: 'tv', person: 'bob', name: 'TV', address: '10.9.0.2', public_key: KEY_TV, lan_bypass: true },
			phone: { id: 'phone', person: 'bob', name: 'Phone', address: '10.9.0.3', public_key: KEY_PHONE, lan_bypass: false },
		},
		services: {},
		circles: {},
	};
}

const CTX = {
	states: { bob: 'active' },
	dmp: { peers: {}, windows: {} },
	snap: {
		devices: {
			'br-lan': { nets: [ '192.168.1.0/24' ], zone: 'lan', addrs: [ '192.168.1.1/24' ] },
			eth1: { nets: [ '203.0.113.0/24' ], zone: 'wan', addrs: [ '203.0.113.7/24' ] },
			awghome: { nets: [ '10.9.0.0/29' ], addrs: [ '10.9.0.1/29' ] },
		},
		lan: 'br-lan',
		wan: 'eth1',
	},
};

function last(r) {
	return r.steps[length(r.steps) - 1];
}

test('check: a device with its local network outside the tunnel', () => {
	let m = model();
	let r = access.check(m, 'tv', '192.168.1.20', CTX);
	eq([ r.ok, last(r).ok, last(r).title ], [ false, false, "Its configuration doesn't send it to the router" ],
		'a home address: on its own network, not blocked in the tunnel');
	ok(index(last(r).detail, "the device's own network handles it") >= 0, 'says where it goes');
	r = access.check(m, 'tv', '192.168.1.1:80', CTX);
	eq(last(r).title, "Its configuration doesn't send it to the router", 'the router\'s LAN address is on its own network too');
	r = access.check(m, 'tv', '10.9.0.1:53', CTX);
	eq([ r.ok, r.steps[1].title ], [ true, '10.9.0.1 is this router: DNS is open to everyone' ], 'its DNS stays in the tunnel');
	r = access.check(m, 'tv', '8.8.8.8', CTX);
	eq([ r.ok, last(r).title, last(r).detail ], [ true, '8.8.8.8 is on the internet', 'It leaves through eth1.' ], 'the internet through the tunnel');

	r = access.check(m, 'phone', '192.168.1.20', CTX);
	eq([ r.ok, last(r).title ], [ false, '192.168.1.20 is at home (br-lan)' ], 'without it: into the tunnel, and blocked there');
});

test('check: the way out is the server\'s', () => {
	let m = model();
	eq(last(access.check(m, 'phone', '8.8.8.8', CTX)).detail, 'It leaves through eth1.', 'direct');
	m.servers.home.lan_like = true;
	eq(last(access.check(m, 'phone', '8.8.8.8', CTX)).detail, 'It leaves like a home device would.', 'like a home device');
});
