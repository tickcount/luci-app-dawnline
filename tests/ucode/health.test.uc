// dawnline.health: where a public address points, in words. The name's AAAA
// records are checked against the router's public IPv6 addresses as well as
// its A records against the WAN. The facts take a test's reads instead of
// DNS, the WAN and `ip`.
import * as health from 'dawnline.health';

const HOST = 'vpn.example.com';
const WAN = '203.0.113.7';
// The WAN's own address and the LAN's from the delegated prefix: both reach the router.
const ROUTER6 = [ '2001:db8:1::1', '2001:db8:2::1' ];

function facts(ips, router6, wan) {
	return health.endpoint_facts(null, HOST, { ips, wan, router6 });
}

function words(ips, router6, wan) {
	return health.endpoint_words(facts(ips, router6, wan), 'UDP 51820');
}

test('own_ipv6: public addresses on any interface', () => {
	let links = [
		{ ifname: 'wan', addr_info: [ { family: 'inet6', local: '2001:db8:1::1', prefixlen: 128, scope: 'global' } ] },
		{ ifname: 'br-lan', addr_info: [
			{ family: 'inet6', local: '2001:db8:2::1', prefixlen: 64, scope: 'global' },
			{ family: 'inet6', local: 'fd12:3456:789a::1', prefixlen: 60, scope: 'global' },
			{ family: 'inet6', local: '2001:db8:2::99', prefixlen: 64, scope: 'global', dadfailed: true },
		] },
		{ ifname: 'lan2', addr_info: [ { family: 'inet6', local: 'FC00::1', prefixlen: 64, scope: 'global' } ] },
		{ ifname: 'lo' },
	];
	eq(health.own_ipv6(links), ROUTER6, 'the WAN and the LAN prefix; no ULA, no failed duplicate');
	eq(health.own_ipv6([ links[1] ]), [ '2001:db8:2::1' ], 'only the LAN has one');
	eq(health.own_ipv6([ { ifname: 'br-lan', addr_info: [ links[1].addr_info[1] ] } ]), [], 'only a ULA: none');
	eq(health.own_ipv6(null), [], 'nothing read');
});

test('endpoint_facts: AAAA records against the router', () => {
	let f = facts([ WAN, '2001:db8:2::1' ], ROUTER6, WAN);
	eq([ f.here, f.here6, f.foreign6 ], [ true, true, [] ], 'both records are the router');
	eq(facts([ WAN, '2001:DB8:2:0:0::1' ], ROUTER6, WAN).here6, true, 'another spelling of the same address');
	f = facts([ WAN, '2001:db8:2::1', '2001:db8:9::5' ], ROUTER6, WAN);
	eq([ f.here6, f.foreign6 ], [ false, [ '2001:db8:9::5' ] ], 'one of two is not');
	f = facts([ WAN, '2001:db8:9::5' ], [], WAN);
	eq([ f.here6, f.foreign6, f.router6 ], [ false, [ '2001:db8:9::5' ], [] ], 'the router has no IPv6: none is');
	f = facts([ WAN, '2001:db8:9::5' ], null, WAN);
	eq([ f.here6, f.foreign6, f.router6 ], [ false, null, null ], 'unknown: no verdict');
	eq(facts([ WAN ], ROUTER6, WAN).here6, false, 'no AAAA');
});

test('endpoint_words: IPv4 and IPv6 both at the router', () => {
	eq(words([ WAN, '2001:db8:2::1' ], ROUTER6, WAN),
		{ status: 'ok', text: 'vpn.example.com points at this router (203.0.113.7, 2001:db8:2::1).' }, 'A and AAAA');
	eq(words([ WAN ], null, WAN), { status: 'ok', text: 'vpn.example.com points at this router (203.0.113.7).' }, 'A only, as before');
	eq(words([ WAN, '2001:db8:9::5' ], null, WAN).status, 'ok', 'the router\'s IPv6 unknown: the AAAA gets no verdict');
});

test('endpoint_words: an AAAA record that is not the router', () => {
	eq(words([ WAN, '2001:db8:9::5' ], ROUTER6, WAN), { status: 'warn',
		text: 'vpn.example.com AAAA → 2001:db8:9::5 is not a public address of this router: devices that prefer IPv6 will fail to connect. Fix or remove this AAAA record.' },
		'a stale prefix');
	eq(words([ WAN, '2001:db8:9::5', '2001:db8:9::6' ], ROUTER6, WAN).text,
		'vpn.example.com AAAA → 2001:db8:9::5, 2001:db8:9::6 are not public addresses of this router: devices that prefer IPv6 will fail to connect. Fix or remove these AAAA records.',
		'two of them');
	eq(words([ WAN, '2001:db8:2::1', 'fd12:3456:789a::1' ], ROUTER6, WAN).text,
		'vpn.example.com AAAA → fd12:3456:789a::1 is not a public address of this router: devices that prefer IPv6 will fail to connect. Fix or remove this AAAA record.',
		'a ULA beside the right one');
	eq(words([ WAN, '2001:db8:9::5' ], [], WAN), { status: 'warn',
		text: 'vpn.example.com AAAA → 2001:db8:9::5, but this router has no public IPv6 address: devices that prefer IPv6 will fail to connect. Remove this AAAA record or set up IPv6 on the router.' },
		'the router has no IPv6');
	eq(words([ '198.51.100.4', '2001:db8:9::5' ], ROUTER6, WAN), { status: 'warn',
		text: 'vpn.example.com points at 198.51.100.4, not this router (WAN 203.0.113.7). Check your DNS / DDNS. ' +
			'vpn.example.com AAAA → 2001:db8:9::5 is not a public address of this router: devices that prefer IPv6 will fail to connect. Fix or remove this AAAA record.' },
		'both wrong: two sentences, IPv4 first');
	eq(words([ '198.51.100.4', '2001:db8:2::1' ], ROUTER6, WAN).text,
		'vpn.example.com points at 198.51.100.4, not this router (WAN 203.0.113.7). Check your DNS / DDNS.', 'only the A record wrong: as before');
	eq(words([ '198.51.100.4', '2001:db8:9::5' ], ROUTER6, null).text,
		'vpn.example.com AAAA → 2001:db8:9::5 is not a public address of this router: devices that prefer IPv6 will fail to connect. Fix or remove this AAAA record.',
		'no WAN address: the AAAA alone');
});

test('endpoint_words: IPv6 only', () => {
	eq(words([ '2001:db8:2::1' ], ROUTER6, WAN), { status: 'warn',
		text: "vpn.example.com → 2001:db8:2::1: IPv6 only, so only devices with IPv6 connect (the router's IPv4 203.0.113.7 has no name)." },
		'the v6_only wording stays');
	eq(words([ '2001:db8:2::1' ], ROUTER6, '100.64.1.2'),
		{ status: 'ok', text: 'vpn.example.com → 2001:db8:2::1: IPv6 only, so only devices with IPv6 connect.' }, 'behind CGNAT, as before');
	eq(words([ '2001:db8:9::5' ], ROUTER6, WAN), { status: 'warn',
		text: 'vpn.example.com → 2001:db8:9::5: IPv6 only, and not a public address of this router: no device can connect. Check your DNS / DDNS.' },
		'not the router');
	eq(words([ '2001:db8:9::5', '2001:db8:9::6' ], ROUTER6, WAN).text,
		'vpn.example.com → 2001:db8:9::5, 2001:db8:9::6: IPv6 only, and not public addresses of this router: no device can connect. Check your DNS / DDNS.',
		'two, neither the router');
	eq(words([ '2001:db8:9::5' ], [], '100.64.1.2'), { status: 'warn',
		text: 'vpn.example.com → 2001:db8:9::5: IPv6 only, but this router has no public IPv6 address: no device can connect. Check your DNS / DDNS, or set up IPv6 on the router.' },
		'the router has no IPv6');
	eq(words([ '2001:db8:2::1', '2001:db8:9::5' ], ROUTER6, WAN).text,
		'vpn.example.com AAAA → 2001:db8:9::5 is not a public address of this router: devices that prefer IPv6 will fail to connect. Fix or remove this AAAA record.',
		'one right, one wrong');
	eq(words([ '2001:db8:9::5' ], null, WAN).text,
		"vpn.example.com → 2001:db8:9::5: IPv6 only, so only devices with IPv6 connect (the router's IPv4 203.0.113.7 has no name).",
		'the router\'s IPv6 unknown: as before');
});

test('common home subnets', () => {
	eq(health.common_home([ '192.168.1.0/24', '10.0.1.0/24' ]), [ '192.168.1.0/24' ], 'the out-of-the-box /24 only');
	eq(health.common_home([ '192.168.0.0/16' ]), [ '192.168.0.0/16' ], 'a wider network that holds one');
	eq(health.common_home([ '10.37.12.0/24', '172.20.0.0/24' ]), [], 'rare ones');
	eq(health.common_home(null), [], 'none');
});
