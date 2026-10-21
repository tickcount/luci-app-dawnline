// dawnline.loop: the "like a home device" link's errors, stored as codes and
// put into words when read; the netns's MAC and which LAN address it may use;
// the policy rules for the servers that send their devices this way, and the
// commands that bring the rules the kernel shows to them.
import * as loop from 'dawnline.loop';
import { ip2int, parse_cidr } from 'dawnline.util';

test('error_text', () => {
	eq(loop.error_text(null), null, 'no error');
	eq(loop.error_text({ code: 'no_lan' }), 'No LAN detected.', 'no LAN');
	eq(loop.error_text({ code: 'not_bridge', dev: 'eth1' }), 'eth1 is not a bridge, so Dawnline cannot join the LAN as a device.', 'not a bridge');
	eq(loop.error_text({ code: 'no_address', net: 'lan' }), 'No free address on lan.', 'no address');
	eq(loop.error_text({ code: 'setup', detail: 'ip: RTNETLINK answers: File exists' }), 'Setup failed: ip: RTNETLINK answers: File exists', 'setup');
	eq(loop.error_text('an old message'), 'an old message', 'older files: as written');
});

test('lan_mac', () => {
	let mac = loop.lan_mac('d4:0d:ab:06:94:aa\n');
	// Pinned: another MAC after an update would make the netns look like someone else once.
	eq(mac, '7a:4e:71:7a:e0:83', 'hashed from the bridge MAC, as sysfs gives it');
	eq(loop.lan_mac('D4:0D:AB:06:94:AA'), mac, 'the same however it is written');
	ok(loop.lan_mac('d4:0d:ab:06:94:ab') != mac, 'another bridge, another MAC');
	for (let b in [ 'd4:0d:ab:06:94:aa', 'd4:0d:ab:06:94:ab', '00:00:00:00:00:00', 'ff:ff:ff:ff:ff:ff' ]) {
		let m = loop.lan_mac(b);
		ok(match(m, /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/), `${b}: a MAC`);
		let first = hex(substr(m, 0, 2));
		eq([ first & 1, first & 2 ], [ 0, 2 ], `${b}: unicast, locally administered`);
	}
});

test('address_free', () => {
	let lan = parse_cidr('10.0.1.1/24');
	let facts = { pool: [ ip2int('10.0.1.100'), ip2int('10.0.1.249') ], statics: [ ip2int('10.0.1.50') ] };
	let ours = '7a:4e:71:7a:e0:83', old = '7e:8b:31:7d:04:ba', other = '3c:22:fb:01:02:03';
	let free = (ip, used, mine) => loop.address_free(ip2int(ip), lan, facts, used ?? {}, mine ?? [ ours, null ]);
	ok(free('10.0.1.254'), 'nobody on it');
	ok(free('10.0.1.254', { '10.0.1.254': ours }), 'the neighbour entry of the netns before it was created again');
	ok(free('10.0.1.254', { '10.0.1.254': old }, [ ours, old ]), 'the netns as it is now (an older version gave it a random MAC)');
	ok(!free('10.0.1.254', { '10.0.1.254': old }), 'a MAC that is not the netns\'s: someone else');
	ok(!free('10.0.1.254', { '10.0.1.254': other }, [ ours, null ]), 'another device');
	ok(!free('10.0.1.254', { '10.0.1.254': true }), 'an entry without a MAC');
	ok(!free('10.0.1.1'), 'the router');
	ok(!free('10.0.1.50'), 'a static lease');
	ok(!free('10.0.1.100') && !free('10.0.1.249'), 'the DHCP pool');
	ok(free('10.0.1.99') && free('10.0.1.250'), 'next to the pool');
	ok(!free('10.0.1.0') && !free('10.0.1.255'), 'the network and broadcast addresses');
	ok(loop.address_free(ip2int('10.0.1.120'), lan, { pool: null, statics: [] }, {}, [ ours ]), 'no DHCP on the LAN: the pool is free');
});

// The netns's rules: the flowtable only on the netns's own links, never on
// the root namespace's (the guard on dawn0 must see every packet).
test('ns_rules', () => {
	let p = { address: '10.0.1.250', dns: '10.0.1.1' };
	let fast = loop.ns_rules(p, true), plain = loop.ns_rules(p, false);
	eq(map(match(fast, /devices = \{ ([^}]*) \}/g), (m) => m[1]), [ '"dlx1", "dll1"' ], 'one flowtable, on dlx1 and dll1 only');
	ok(!match(fast, /dlx0|dll0/), 'no root namespace link');
	ok(index(fast, 'ct state established meta l4proto { tcp, udp } flow add @ft') >= 0, 'established flows added');
	ok(index(plain, 'flowtable') < 0 && index(plain, 'flow add') < 0, 'plain: no flowtable');
	eq(replace(fast, /\n\tflowtable ft \{(\n\t\t[^\n]*)*\n\t\}|\n\t\tct state established meta l4proto \{ tcp, udp \} flow add @ft/g, ''), plain, 'otherwise the same rules');
});

// A plan with one server sending its devices like a home device (plan() makes
// it, from the server's interface, its tunnel and its home networks).
const PLAN = { address: '192.168.1.250', table: 2077,
	servers: [ { ifname: 'awghome', subnet: '10.9.0.0/29', direct: [ '10.9.0.0/29', '192.168.1.0/24' ] } ] };

test('rules', () => {
	eq(loop.rules(PLAN), [
		{ pref: 5205, iif: 'awghome', to: '192.168.1.250/32', table: '2077' },
		{ pref: 5210, iif: 'awghome', to: '10.9.0.0/29', table: 'main' },
		{ pref: 5210, iif: 'awghome', to: '192.168.1.0/24', table: 'main' },
		{ pref: 5290, iif: 'awghome', to: null, table: '2077' },
	], 'DNS into the netns, home and the tunnel by main, the rest into the netns');
	eq(loop.rules({ servers: [] }), [], 'no server sends anyone');
	eq(loop.rules(null), [], 'no plan');
});

// What `ip -j -4 rule show` prints for the rules of PLAN: "src": "all" for a
// rule without a source, a /32 without its length (iproute2 iprule.c).
const HOME_SHOWN = [
	{ priority: 5205, src: 'all', iif: 'awghome', dst: '192.168.1.250', table: '2077' },
	{ priority: 5210, src: 'all', iif: 'awghome', dst: '10.9.0.0', dstlen: 29, table: 'main' },
	{ priority: 5210, src: 'all', iif: 'awghome', dst: '192.168.1.0', dstlen: 24, table: 'main' },
	{ priority: 5290, src: 'all', iif: 'awghome', table: '2077' },
];

test('rule_cmds: the rules the kernel shows, against the plan', () => {
	eq(loop.rule_cmds(PLAN, HOME_SHOWN), [], 'as wanted: nothing to do (no rule added again, none removed)');
	eq(loop.rule_cmds(PLAN, slice(HOME_SHOWN, 0, 3)), [ "ip -4 rule add priority 5290 iif 'awghome' lookup 2077" ], 'one gone: only it comes back');
	eq(loop.rule_cmds(PLAN, [ ...HOME_SHOWN, HOME_SHOWN[3] ]), [ "ip -4 rule del priority 5290 iif 'awghome' lookup 2077" ], 'one twice: one of them goes');
	eq(loop.rule_cmds(PLAN, []), [
		"ip -4 rule add priority 5205 iif 'awghome' to 192.168.1.250/32 lookup 2077",
		"ip -4 rule add priority 5210 iif 'awghome' to 10.9.0.0/29 lookup main",
		"ip -4 rule add priority 5210 iif 'awghome' to 192.168.1.0/24 lookup main",
		"ip -4 rule add priority 5290 iif 'awghome' lookup 2077",
	], 'none yet: all of them');
	eq(loop.rule_cmds({ servers: [] }, HOME_SHOWN), [
		"ip -4 rule del priority 5205 iif 'awghome' to 192.168.1.250 lookup 2077",
		"ip -4 rule del priority 5210 iif 'awghome' to 10.9.0.0/29 lookup main",
		"ip -4 rule del priority 5210 iif 'awghome' to 192.168.1.0/24 lookup main",
		"ip -4 rule del priority 5290 iif 'awghome' lookup 2077",
	], 'none wanted: each removed as shown, without "from all"');
	eq(loop.rule_cmds({ ...PLAN, servers: [ { ...PLAN.servers[0], direct: [ '10.9.0.0/29', '192.168.2.0/24' ] } ] }, HOME_SHOWN), [
		"ip -4 rule add priority 5210 iif 'awghome' to 192.168.2.0/24 lookup main",
		"ip -4 rule del priority 5210 iif 'awghome' to 192.168.1.0/24 lookup main",
	], 'another home network: the new rule first, then the old one goes');
	eq(loop.rule_cmds(PLAN, [ ...HOME_SHOWN, { priority: 5290, src: '10.9.0.2', iif: 'awghome', table: '2077' } ]),
		[ "ip -4 rule del priority 5290 from 10.9.0.2 iif 'awghome' lookup 2077" ], 'a rule of ours with a source is not one of them: it goes');
});
