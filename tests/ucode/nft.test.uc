// dawnline.nft: the access table rendered for a model with two servers (one
// sending everyone like a home device, one direct) and the router read as a
// fixed context: exactly what 0.13.0 renders (fixtures/nft-table.txt, made by
// that version from this model).
import { readfile } from 'fs';
import * as nft from 'dawnline.nft';

const KEY = 'yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=';
const SNAP = { devices: { 'br-lan': { nets: [ '192.168.1.0/24' ], zone: 'lan', addrs: [ '192.168.1.1/24' ] }, eth1: { nets: [], zone: 'wan' } },
	wan: 'eth1', lan: 'br-lan', zones: [ 'lan', 'wan' ] };
// The netns is up (its DNS address, the Home-only resolver inside it) and the LAN's DNS is the router.
const CTX = { dns_addr: '192.168.1.250', resolver: { mode: 'ns', address: '169.254.77.2', port: 53 }, lan_dns: '192.168.1.1', snap: SNAP };
const STATES = { alice: 'active', bob: 'active', carol: 'active', dave: 'active', erin: 'active' };
let golden = readfile(sourcepath(0, true) + '/fixtures/nft-table.txt');

/** Server home sends everyone like a home device, work sends everyone direct. */
function model() {
	let srv = (id, ifname, subnet, lan_like, mesh) => ({ id, name: id, ifname, subnet, private_key: KEY, enabled: true, lan_like, mesh,
		auto_wan: true, auto_lan: true, lan_devices: [], lan_zone: 'lan', wan_zone: 'wan', obf: {} });
	let person = (id, server, access, extra) => ({ id, name: id, server, access, dns_mode: 'device', services: [], home_nets: [],
		circle: '', ...(extra ?? {}) });
	let dev = (person, address) => ({ person, address, disabled: false });
	return {
		settings: { portal_enabled: true, portal_port: 8443, portal_host: 'vpn.example.com', portal_alt: [] },
		servers: { home: srv('home', 'awghome', '10.9.0.0/29', true, 'all'), work: srv('work', 'awgwork', '10.9.1.0/29', false, 'circles') },
		people: {
			alice: person('alice', 'home', 'both'), bob: person('bob', 'work', 'internet'),
			carol: person('carol', 'home', 'lan', { dns_mode: 'home' }), dave: person('dave', 'home', 'internet'),
			erin: person('erin', 'work', 'both'),
		},
		devices: {
			a1: dev('alice', '10.9.0.2'), b1: dev('bob', '10.9.1.2'), c1: dev('carol', '10.9.0.3'),
			d1: dev('dave', '10.9.0.4'), d2: dev('dave', '10.9.0.5'), e1: dev('erin', '10.9.1.3'),
		},
		services: {}, circles: {},
	};
}

function render(m, states) {
	return nft.render(m, nft.access_sets(m, null, states ?? STATES, SNAP), CTX);
}

test('render: the table as it was', () => {
	ok(golden != null, 'the fixture is there');
	eq(render(model()), golden, 'line for line');
	let m = model();
	m.devices.b1.lan_bypass = true;
	eq(render(m), golden, 'a device that keeps its own local network out of the tunnel changes nothing here');
});
