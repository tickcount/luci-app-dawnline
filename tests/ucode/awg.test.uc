// dawnline.awg: disguise presets against their own validation, the values
// AmneziaWG refuses (obf_unsafe, one case per rule), the parser of `awg show
// <ifname> dump` on the output formats of AmneziaWG 1.0, 2.0 and 3.1 and how
// each tunnel's read went (the stand-in awg in fixtures/bin prints the
// fixture put at AWG_DUMP), the devices a tunnel should hold, Reconnect, a
// device's configuration from the fixture model, what the server's interface
// and the read-only status get of it.
import { readfile, writefile, unlink } from 'fs';
import { cursor } from 'uci';
import { valid_key, cidr_any } from 'dawnline.util';
import * as awg from 'dawnline.awg';
import * as core from 'dawnline.core';
import * as backup from 'dawnline.backup';
import * as rpc_status from 'dawnline.rpc.status';
import * as nft from 'dawnline.nft';

const AWG_DUMP = '/tmp/dawnline-tests/awg-dump';
let fixtures = sourcepath(0, true) + '/fixtures';

test('obf_preset off', () => {
	let o = awg.obf_preset('off');
	eq(o, { jc: '0', jmin: '0', jmax: '0', s1: '0', s2: '0', h1: '1', h2: '2', h3: '3', h4: '4' }, 'plain WireGuard headers');
	eq(awg.obf_errors(o), [], 'valid');
});

test('obf_preset balanced', () => {
	for (let i = 0; i < 25; i++) {
		let o = awg.obf_preset('balanced');
		eq(awg.obf_errors(o), [], 'balanced is valid');
		ok(+o.jc >= 4 && +o.jc <= 8, `jc=${o.jc}`);
		let jmin = +o.jmin, jmax = +o.jmax;
		ok(jmin >= 64 && jmax > jmin && jmax <= 1024, `junk sizes ${o.jmin}-${o.jmax}`);
		ok(+o.s1 + 56 != +o.s2, 's1 + 56 != s2');
		eq(length(uniq([ o.h1, o.h2, o.h3, o.h4 ])), 4, 'distinct headers');
		for (let k in [ 'h1', 'h2', 'h3', 'h4' ])
			ok(+o[k] >= 5, `${k} above the reserved values`);
		ok(+o.s3 >= 8 && +o.s3 <= 48 && +o.s4 >= 4 && +o.s4 <= 16, `padding ${o.s3}/${o.s4}`);
		ok(substr(o.i1, 0, 3) == '<r ' && substr(o.i2, 0, 3) == '<r ', 'DNS-shaped signature packets');
		eq(o.header_protection_key, null, 'no 3.1 values');
	}
});

test('obf_preset max', () => {
	let o = awg.obf_preset('max');
	ok(valid_key(o.header_protection_key), 'a header protection key');
	ok(o.header_protection_key != awg.obf_preset('max').header_protection_key, 'made for each server, without awg genkey');
	ok(+o.jc >= 4 && +o.jc <= 6, 'jc');
	ok(substr(o.i1, 0, 3) == '<r ', 'DNS-like first packet');
	eq([ o.random_trailers, o.disable_cookies, o.content_padding_addition ], [ 'on', 'on', '10-100' ], '3.1 options');
	ok(substr(o.i2, 0, 3) == '<r ', 'DNS-answer second packet');
	// The template varies by name length and top-level domain (the letters
	// themselves are random at run time): over many servers, more than one shape.
	let shapes = {};
	for (let i = 0; i < 20; i++)
		shapes[awg.obf_preset('max').i1] = true;
	ok(length(keys(shapes)) > 1, 'signature packets differ between servers');
	// The preset passes the server's own validation (jmin/jmax may be small: 0.5.2).
	for (let i = 0; i < 25; i++)
		eq(awg.obf_errors(awg.obf_preset('max')), [], 'max is valid');
});

test('obf_errors: Dawnline\'s own bounds on top of obf_unsafe', () => {
	eq(awg.obf_errors({}), [], 'nothing set');
	eq(awg.obf_errors(null), [], 'no values');
	eq(awg.obf_errors({ jc: '11' }), [ 'Jc must be from 0 to 10.' ], 'jc range');
	eq(awg.obf_errors({ jmin: '0', jmax: '0' }), [], 'zero junk sizes are allowed');
	eq(awg.obf_errors({ jmin: '2000', jmax: '3000' }), [ 'Jmin must be from 0 to 1024.', 'Jmax must be from 0 to 1024.' ], 'junk sizes');
	eq(awg.obf_errors({ s1: '5', s2: '61' }), [ 'S2 must not be S1 + 56: the handshake initiation and response would have the same size.' ],
		'the handshake size clash');
	eq(awg.obf_errors({ s4: '33' }), [ 'S4 must be from 0 to 32.' ], 's4 range');
	// What AmneziaWG refuses comes first, said once.
	eq(awg.obf_errors({ jc: 'x' }), [ 'Jc must be a whole number from 0 to 65535.' ], 'not a number');
	eq(awg.obf_errors({ jmin: '200', jmax: '100' }), [ 'Jmin must not be larger than Jmax.' ], 'order');
	eq(awg.obf_errors({ h1: '7', h2: '7' }), [ 'H1 and H2 overlap: each packet type needs values of its own.' ], 'duplicate headers');
	eq(awg.obf_neutral({ jc: '0', jmin: '0', jmax: '0', s1: '0', s2: '0', h1: '1', h2: '2', h3: '3', h4: '4' }), true, 'off is neutral');
	eq(awg.obf_neutral({ jc: '4', jmin: '64', jmax: '128' }), false, 'junk is not neutral');
});

// One case per rule of obf_unsafe: what an import, a restore or a hand edit must never hand to the kernel.
const HPK = 'yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=';
const MAX = { s1: '12', s2: '12', s3: '12', s4: '12', header_protection_key: HPK };

test('obf_unsafe: what the presets and older servers hold passes', () => {
	eq(awg.obf_unsafe(null), [], 'no values');
	eq(awg.obf_unsafe(awg.obf_preset('off')), [], 'off');
	for (let i = 0; i < 25; i++) {
		eq(awg.obf_unsafe(awg.obf_preset('balanced')), [], 'balanced');
		eq(awg.obf_unsafe(awg.obf_preset('max')), [], 'max');
	}
	// Values from before 0.8 and hand-tuned ones the kernel takes: none of Dawnline's own bounds here.
	let old = { jc: '12', jmin: '50', jmax: '1400', s1: '100', s2: '156', h1: '1234567', h2: '2345678', h3: '3456789', h4: '4567890' };
	eq(awg.obf_unsafe(old), [], 'older and hand-tuned values');
	ok(length(awg.obf_errors(old)) > 0, 'which a new server would not get');
});

test('obf_unsafe: 16-bit numbers', () => {
	eq(awg.obf_unsafe({ jc: '65535', s4: '0' }), [], 'the ends');
	eq(awg.obf_unsafe({ jc: '65536' }), [ 'Jc must be a whole number from 0 to 65535.' ], 'too large');
	eq(awg.obf_unsafe({ s3: '-1' }), [ 'S3 must be a whole number from 0 to 65535.' ], 'negative');
	eq(awg.obf_unsafe({ jmax: '1e3' }), [ 'Jmax must be a whole number from 0 to 65535.' ], 'not digits');
});

test('obf_unsafe: Jmin not above Jmax', () => {
	eq(awg.obf_unsafe({ jmin: '50', jmax: '50' }), [], 'equal');
	eq(awg.obf_unsafe({ jmin: '51', jmax: '50' }), [ 'Jmin must not be larger than Jmax.' ], 'the kernel would write past its junk buffer');
	eq(awg.obf_unsafe({ jmin: '51' }), [], 'Jmax not given');
});

test('obf_unsafe: header values are numbers or ranges', () => {
	eq(awg.obf_unsafe({ h1: '100-200', h2: '300', h3: '4294967295', h4: '0' }), [], 'numbers and ranges');
	eq(awg.obf_unsafe({ h1: '200-100' }), [ 'H1 must be a number or a range like 100-200, up to 4294967295.' ], 'reversed');
	eq(awg.obf_unsafe({ h2: '4294967296' }), [ 'H2 must be a number or a range like 100-200, up to 4294967295.' ], 'past 32 bits');
	eq(awg.obf_unsafe({ h3: '5-6-7' }), [ 'H3 must be a number or a range like 100-200, up to 4294967295.' ], 'two dashes');
	eq(awg.obf_unsafe({ h4: 'abc' }), [ 'H4 must be a number or a range like 100-200, up to 4294967295.' ], 'not a number');
});

test('obf_unsafe: header values do not overlap', () => {
	eq(awg.obf_unsafe({ h1: '10-20', h2: '20-30', h3: '40', h4: '50' }), [ 'H1 and H2 overlap: each packet type needs values of its own.' ], 'a shared end');
	eq(awg.obf_unsafe({ h1: '10-20', h2: '30', h3: '15', h4: '50' }), [ 'H1 and H3 overlap: each packet type needs values of its own.' ], 'one inside a range');
	// One not given keeps WireGuard's type: 1-4.
	eq(awg.obf_unsafe({ h1: '1-10' }), [ 'H1 and H2 overlap: each packet type needs values of its own.', 'H1 and H3 overlap: each packet type needs values of its own.',
		'H1 and H4 overlap: each packet type needs values of its own.' ], 'over the default types');
	eq(awg.obf_unsafe({ h1: '5-10' }), [], 'clear of them');
});

test('obf_unsafe: header protection needs a key and 12-byte padding', () => {
	eq(awg.obf_unsafe(MAX), [], 'the 3.1 values');
	eq(awg.obf_unsafe({ ...MAX, header_protection_key: 'abc' }), [ 'The header protection key is not a key.' ], 'not a key');
	eq(awg.obf_unsafe({ ...MAX, s3: '11' }), [ 'S3 must be at least 12 with header protection.' ], 'too little padding');
	eq(awg.obf_unsafe({ ...MAX, s4: null }), [ 'S4 must be at least 12 with header protection.' ], 'no padding');
	eq(awg.obf_unsafe({ s1: '0', s2: '0' }), [], 'none needed without the key');
});

test('obf_unsafe: 3.1 timers and counts', () => {
	eq(awg.obf_unsafe({ rekey_after_time: '100-120', rekey_timeout: '3', keepalive_timeout: '0', max_handshake_attempts: '0-0' }), [],
		'numbers, ranges and 0 (the default)');
	eq(awg.obf_unsafe({ rekey_timeout: '0-7' }), [ 'RekeyTimeout must be a number or a range like 5-15, from 1 to 65535.' ], 'a 0 in a range');
	eq(awg.obf_unsafe({ keepalive_timeout: '15-5' }), [ 'KeepaliveTimeout must be a number or a range like 5-15, from 1 to 65535.' ], 'reversed');
	eq(awg.obf_unsafe({ max_handshake_attempts: '70000' }), [ 'MaxHandshakeAttempts must be a number or a range like 5-15, from 1 to 65535.' ], 'past 16 bits');
	eq(awg.obf_unsafe({ content_padding_addition: '0-100' }), [], 'padding may start at 0');
	eq(awg.obf_unsafe({ content_padding_addition: '10-x' }), [ 'ContentPaddingAddition must be a number or a range like 10-100, up to 65535.' ], 'padding');
});

test('obf_unsafe: RejectAfterTime up to 180 seconds', () => {
	eq(awg.obf_unsafe({ reject_after_time: '150-180' }), [], 'the preset');
	eq(awg.obf_unsafe({ reject_after_time: '150-181' }), [ 'RejectAfterTime must be at most 180 seconds.' ], 'the kernel drops keys after 180 seconds');
});

test('obf_unsafe: switches', () => {
	eq(awg.obf_unsafe({ random_trailers: 'on', disable_cookies: '0' }), [], 'on, off, 1, 0');
	eq(awg.obf_unsafe({ random_trailers: 'yes' }), [ 'RandomTrailers must be on or off.' ], 'what the .conf parser refuses');
	eq(awg.obf_unsafe({ disable_cookies: 'true' }), [ 'DisableCookies must be on or off.' ], 'the same for cookies');
});

test('obf_unsafe: signature packet tags', () => {
	let bad = (name, tag) => `${name}: <${tag}> is not a tag AmneziaWG apps accept: use <b 0x…> with an even number of hex digits, <r N>, <rc N> or <rd N> with N from 1 to 1000, or <t>.`;
	eq(awg.obf_unsafe({ i1: '<b 0xC0ffee><r 1><rc 1000><rd 12><t>', i2: 'text between tags <r 2> is skipped' }), [], 'every tag both parsers know');
	eq(awg.obf_unsafe({ i1: '<b 0xabc>' }), [ bad('I1', 'b 0xabc') ], 'an odd number of hex digits');
	eq(awg.obf_unsafe({ i1: '<b 0x>' }), [ bad('I1', 'b 0x') ], 'no bytes');
	eq(awg.obf_unsafe({ i1: '<b ff00>' }), [ bad('I1', 'b ff00') ], 'no 0x (the kernel needs it)');
	eq(awg.obf_unsafe({ i1: '<b 0xzz>' }), [ bad('I1', 'b 0xzz') ], 'not hex');
	eq(awg.obf_unsafe({ i2: '<r -5>' }), [ bad('I2', 'r -5') ], 'a negative length writes past the packet');
	eq(awg.obf_unsafe({ i2: '<rc 0>' }), [ bad('I2', 'rc 0') ], 'no length');
	eq(awg.obf_unsafe({ i2: '<rd 1001>' }), [ bad('I2', 'rd 1001') ], 'too long');
	eq(awg.obf_unsafe({ i3: '<r  5>' }), [ bad('I3', 'r  5') ], 'two spaces');
	eq(awg.obf_unsafe({ i3: '<t >' }), [ bad('I3', 't ') ], 'a space after t');
	eq(awg.obf_unsafe({ i4: '<c>' }), [ bad('I4', 'c') ], 'the kernel\'s counter, which amneziawg-go refuses');
	for (let t in [ 'd', 'ds', 'dz' ])
		eq(awg.obf_unsafe({ i4: `<${t}>` }), [ bad('I4', t) ], `amneziawg-go's <${t}>, which the kernel refuses`);
	eq(awg.obf_unsafe({ i5: '<>' }), [ bad('I5', '') ], 'an empty tag');
	eq(awg.obf_unsafe({ i5: '<r <5>' }), [ bad('I5', 'r <5') ], 'a tag inside a tag');
	eq(awg.obf_unsafe({ i5: '<b 0x0102030405060708090a0b0c0d0e0f>' }), [], 'long tags are fine');
	eq(awg.obf_unsafe({ i5: '<x 0x0102030405060708090a0b0c0d0e0f>' }), [ bad('I5', 'x 0x0102030405060708090a…') ], 'shown cut short');
	eq(awg.obf_unsafe({ i1: '<r 5' }), [ 'I1 has a tag that is not closed with >.' ], 'not closed');
	eq(awg.obf_unsafe({ i1: '<r 5><b 0x00> # note' }), [ 'I1 may not contain # or a line break.' ], 'a comment in a .conf');
	eq(awg.obf_unsafe({ i1: '<r 5>\n<t>' }), [ 'I1 may not contain # or a line break.' ], 'a line break');
});

test('obf_unsafe: I1-I5 fit one configuration', () => {
	// A tag of 100 characters.
	let tag = '<b 0x';
	for (let n = 0; n < 47; n++)
		tag += 'ab';
	tag += '>';
	let many = (n) => {
		let out = '';
		for (let k = 0; k < n; k++)
			out += tag;
		return out;
	};
	let four = many(4);
	eq(awg.obf_unsafe({ i1: four, i2: four, i3: four, i4: four, i5: four }), [], '2000 characters');
	eq(awg.obf_unsafe({ i1: four, i2: four, i3: four, i4: four, i5: many(5) }), [ 'I1-I5 together must be at most 2000 characters, not 2100.' ], 'over 2000');
});

test('obf_unsafe: an import or restore with such values is refused', () => {
	let dir = '/tmp/dawnline-tests/import';
	let errs = (text) => {
		system(`rm -rf ${dir}; mkdir -p ${dir}/.delta`);
		writefile(`${dir}/dawnline`, text);
		let c = cursor(dir, `${dir}/.delta`);
		c.load('dawnline');
		let out = backup.config_errors(c);
		system(`rm -rf ${dir}`);
		return out;
	};
	let fixture = readfile('/etc/config/dawnline');
	let bad = errs(replace(fixture, "option jmax '128'", "option jmax '32'"));
	ok(index(bad, 'Server Main: Jmin must not be larger than Jmax.') >= 0, `refused: ${join(' ', bad)}`);
	eq(filter(errs(fixture), (e) => index(e, 'Jmin') >= 0), [], 'the fixture as it is');
});

// The stand-in's call log and failures (fixtures/bin/awg).
const AWG_CALLS = '/tmp/dawnline-tests/awg-calls';
const AWG_FAIL = '/tmp/dawnline-tests/awg-fail-';
const SERVER_KEY = 'xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=';
const PEER_ON = 'HIgo9xNzJMWLKASShiTqIybxZ0U3wGLiUeJ1PKf8ykw=', PEER_NEW = 'TrMvSoP4jYQlY6RIzBgbssQqY3vxI2Pi+y71lOWWXX0=';

// A fixture's lines as another interface's (`show all` prints the ifname first).
function lines_as(name, ifname) {
	let out = '';
	for (let l in split(readfile(`${fixtures}/awg-dump-${name}.txt`), '\n'))
		if (l != '')
			out += `${ifname}${substr(l, length('awgmain'))}\n`;
	return out;
}

// lo is in every container's /sys/class/net (index 1), and is no AmneziaWG
// interface: the stand-in prints the fixture's lines for it, as for a tunnel.
function dump_of(name) {
	writefile(AWG_DUMP, lines_as(name, 'lo'));
	return awg.dump([ 'lo' ]);
}

test('dump: AmneziaWG 1.0 (14 interface fields)', () => {
	let d = dump_of('1.0');
	eq(d.ok, true, 'ok');
	eq(d.reads, { lo: 'read' }, 'read');
	eq(d.ifaces, { lo: { public_key: SERVER_KEY, port: 51820, ifindex: 1 } }, 'interface; its index is the epoch of its counters');
	eq(d.peers[PEER_ON], { ifname: 'lo', endpoint: '203.0.113.7:41821', handshake: 1760000000, rx: 123456, tx: 654321 },
		'peer with a session, with the ifname the lines leave out');
	eq(d.peers[PEER_NEW], { ifname: 'lo', endpoint: '', handshake: 0, rx: 0, tx: 0 }, 'peer that never connected');
});

test('dump: AmneziaWG 2.0 (33 interface fields)', () => {
	let d = dump_of('2.0');
	eq(d.ifaces, { lo: { public_key: SERVER_KEY, port: 51820, ifindex: 1 } }, 'interface');
	eq(keys(d.peers), [ PEER_ON ], 'one peer');
});

test('dump: AmneziaWG 3.1 (33 interface fields, protection on)', () => {
	let d = dump_of('3.1');
	eq(d.ifaces, { lo: { public_key: SERVER_KEY, port: 51820, ifindex: 1 } }, 'interface');
	eq(length(d.peers), 2, 'two peers');
});

// awgmain is not in the container's /sys/class/net, as a tunnel netifd could not bring up.
test('dump: a tunnel that is not there is down, without a process', () => {
	writefile(AWG_DUMP, readfile(`${fixtures}/awg-dump-1.0.txt`));
	unlink(AWG_CALLS);
	eq(awg.dump([ 'awgmain' ]), { ok: true, reads: { awgmain: 'down' }, ifaces: {}, peers: {} }, 'its counters are gone');
	eq(readfile(AWG_CALLS), null, 'awg is not asked about a link the kernel does not have');
	eq(awg.dump([]), { ok: true, reads: {}, ifaces: {}, peers: {} }, 'no tunnel runs');
});

test('dump: each tunnel on its own', () => {
	writefile(AWG_DUMP, readfile(`${fixtures}/awg-dump-1.0.txt`) + lines_as('2.0', 'lo'));
	let d = awg.dump([ 'awgmain', 'lo' ]);
	eq([ d.ok, d.reads ], [ true, { awgmain: 'down', lo: 'read' } ], 'one down, one read');
	eq(keys(d.ifaces), [ 'lo' ], 'only what was read');
	eq(filter(values(d.peers), (p) => p.ifname != 'lo'), [], 'no peers of the one that is down');
});

// The tool says "Operation not supported" for lo on a real system.
test('dump: a tunnel that exists but cannot be read', () => {
	writefile(AWG_DUMP, lines_as('2.0', 'lo'));
	writefile(`${AWG_FAIL}lo`, 'Unable to access interface: Operation not supported\n');
	let d = awg.dump([ 'awgmain', 'lo' ]);
	unlink(`${AWG_FAIL}lo`);
	eq(d.ok, false, 'not every tunnel was read');
	eq(d.reads, { awgmain: 'down', lo: 'error' }, 'each on its own');
	eq([ d.ifaces, d.peers ], [ {}, {} ], 'nothing of the failed one');
});

// The agent's watcher reads every second: with one server, one process.
test('dump: only the tunnels asked for, one process each', () => {
	writefile(AWG_DUMP, lines_as('1.0', 'lo') + lines_as('2.0', 'wgclient'));
	unlink(AWG_CALLS);
	let d = awg.dump([ 'lo' ]);
	// The tests after these find no tunnel, as on a router without AmneziaWG running.
	unlink(AWG_DUMP);
	eq(readfile(AWG_CALLS), 'show lo dump\n', 'one call, never `all`');
	eq(keys(d.ifaces), [ 'lo' ], 'the other tunnel is not read');
	eq(d.peers[PEER_ON].ifname, 'lo', 'its peers stand in for none of ours');
});

test('tunnel_devices: what sync_peers loads', () => {
	let m = {
		servers: { s: { public_key: SERVER_KEY } },
		people: { a: { id: 'a', server: 's' }, b: { id: 'b', server: 's' }, c: { id: 'c', server: 'other' } },
		devices: {
			on: { person: 'a', public_key: PEER_ON, address: '10.9.0.2' },
			own: { person: 'a', public_key: SERVER_KEY, address: '10.9.0.8' },
			off: { person: 'a', public_key: PEER_NEW, address: '10.9.0.3', disabled: true },
			paused: { person: 'b', public_key: SERVER_KEY, address: '10.9.0.4' },
			elsewhere: { person: 'c', public_key: PEER_NEW, address: '10.9.0.5' },
			badkey: { person: 'a', public_key: 'not a key', address: '10.9.0.6' },
			badaddr: { person: 'a', public_key: PEER_NEW, address: '' },
			nobody: { person: 'gone', public_key: PEER_NEW, address: '10.9.0.7' },
		},
	};
	let st = { a: 'quota', b: 'paused', c: 'active' };
	eq(map(awg.tunnel_devices(m, 's', st), (d) => d.address), [ '10.9.0.2' ],
		'over the limit stays; off, paused, other servers, lines syncconf would refuse and the server\'s own key (ignored by the kernel) do not');
	eq(map(awg.tunnel_devices(m, 'other', st), (d) => d.address), [ '10.9.0.5' ], 'the other server');
	eq(awg.tunnel_devices(m, 'none', st), [], 'none');
});

test('peer_diff: by key, per tunnel', () => {
	let dmp = { peers: {} };
	dmp.peers[PEER_ON] = { ifname: 'awgmain' };
	dmp.peers[SERVER_KEY] = { ifname: 'awgmain' };
	dmp.peers[PEER_NEW] = { ifname: 'awgother' };
	let devs = (...ks) => map(ks, (k) => ({ public_key: k }));
	eq(awg.peer_diff(devs(PEER_ON, SERVER_KEY), dmp, 'awgmain'), { loaded: 2, missing: 0, extra: 0 }, 'the same');
	eq(awg.peer_diff(devs(PEER_ON, PEER_NEW), dmp, 'awgmain'), { loaded: 2, missing: 1, extra: 1 },
		'a stale peer standing in for a missing one');
	eq(awg.peer_diff(devs(PEER_ON), dmp, 'awgmain'), { loaded: 2, missing: 0, extra: 1 }, 'one too many');
	eq(awg.peer_diff(devs(PEER_NEW), dmp, 'awgdown'), { loaded: 0, missing: 1, extra: 0 }, 'a tunnel with no peers read');
	eq(awg.peer_diff([], { peers: {} }, 'awgmain'), { loaded: 0, missing: 0, extra: 0 }, 'nothing either way');
});

test('handshake_since: Reconnect hides older handshakes', () => {
	eq(awg.handshake_since(1000, null), 1000, 'never set up again');
	eq(awg.handshake_since(1000, 0), 1000, 'no time');
	eq(awg.handshake_since(1000, 1500), 0, 'connected before: not set up yet');
	eq(awg.handshake_since(1500, 1500), 0, 'the same second does not count');
	eq(awg.handshake_since(1600, 1500), 1600, 'connected after');
	eq(awg.handshake_since(0, 1500), 0, 'never connected');
});

test('blocked reasons', () => {
	let srv = (b) => ({ name: 'Home', blocked: b });
	eq(awg.blocked_text(srv(null)), null, 'not kept down');
	eq(awg.blocked_text(srv({ code: 'ifname', ifname: 'bad name' })), 'Home has an invalid interface name "bad name".', 'interface name');
	eq(awg.blocked_text(srv({ code: 'taken', ifname: 'wg0' })), "Home can't use the network interface wg0: it exists and isn't Dawnline's.", 'foreign interface');
	eq(awg.blocked_text(srv({ code: 'disguise', need: '3.1', installed: '2.0' })), 'Home is kept down: its disguise needs AmneziaWG 3.1 (installed: 2.0).', 'disguise');
	eq(awg.blocked_text(srv({ code: 'disguise', need: '3.1' })), 'Home is kept down: its disguise needs AmneziaWG 3.1 (installed: none).', 'disguise, none installed');
	// Files of older versions hold the English fragment after the name.
	eq(awg.blocked_text(srv('has an invalid interface name "x"')), 'Home has an invalid interface name "x".', 'old fragment');
	eq(awg.blocked_note({ code: 'ifname', ifname: 'x' }), 'has an invalid interface name "x"', 'the log keeps the fragment');
	// Values AmneziaWG refuses: which ones, from the server's own when read.
	let bad = { name: 'Home', obf: { jmin: '60', jmax: '50' }, blocked: { code: 'disguise_invalid' } };
	eq(awg.blocked_text(bad), 'Home is kept down: its disguise has values AmneziaWG cannot take. Jmin must not be larger than Jmax.', 'invalid values');
	eq(awg.blocked_text({ ...bad, obf: {} }), 'Home is kept down: its disguise has values AmneziaWG cannot take.', 'fixed since');
	eq(awg.blocked_note(bad.blocked), 'is kept down: its disguise has values AmneziaWG cannot take', 'the log');
	eq(awg.blocked_fix(bad.blocked), 'Choose a disguise on the Server page: it replaces the values set by hand.', 'what to do about it');
	eq(awg.blocked_fix({ code: 'taken', ifname: 'wg0' }), 'Choose another interface name in the server settings.', 'what to do about a name');
});

test('netifd_options: the server keeps its defence against handshake floods', () => {
	let m = core.load();
	let srv = m.servers.main;
	srv.obf = awg.obf_preset('max');
	let o = awg.netifd_options(srv);
	ok('awg_disable_cookies' in o, 'named, so netifd.sync takes it off an interface that had it');
	eq(o.awg_disable_cookies, null, 'no DisableCookies on the server');
	eq([ o.awg_header_protection_key, o.awg_jc, o.awg_i1, o.awg_random_trailers ], [ srv.obf.header_protection_key, srv.obf.jc, srv.obf.i1, 'on' ],
		'the rest of the disguise stays');
	ok(index(split(awg.client_config(m, m.devices.alice_phone).conf, '\n'), 'DisableCookies = on') >= 0, 'devices keep it');
});

test('client_config: one keep-alive for the .conf and the AmneziaVPN key', () => {
	let m = core.load();
	let srv = m.servers.main, dev = m.devices.alice_phone;
	let ka = () => {
		let c = awg.client_config(m, dev);
		return [ match(c.conf, /\nPersistentKeepalive = ([^\n]*)\n/)?.[1], c.amnezia.persistent_keep_alive ];
	};
	eq(ka(), [ '25', '25' ], 'a number without header protection');
	srv.obf = awg.obf_preset('max');
	eq(ka(), [ '25-35', '25-35' ], 'jittered with 3.1');
	srv.keepalive = 0;
	eq(ka(), [ null, '0' ], 'off');
});

test('status: the header protection key stays out of what read-only users get', () => {
	eq(awg.obf_public({ jc: '4', header_protection_key: HPK }), { jc: '4' }, 'obf_public');
	eq(awg.obf_public(null), {}, 'no values');
	// Server main on Maximum, as a uci change not committed (the fixture file stays as it is).
	let c = cursor();
	c.load('dawnline');
	let o = awg.obf_preset('max');
	for (let k, v in o)
		c.set('dawnline', 'main', k, v);
	c.save('dawnline');
	let out = rpc_status.methods.status.call({ args: { days: 30 } });
	c.revert('dawnline');
	eq(out.error, null, 'status answers');
	let srv = filter(out.servers ?? [], (x) => x.id == 'main')[0];
	eq([ srv?.hpk, srv?.obf?.header_protection_key, srv?.obf?.disable_cookies ], [ true, null, 'on' ], 'whether there is a key, not which');
	let text = sprintf('%J', out);
	ok(index(text, o.header_protection_key) < 0, 'the key is nowhere in the answer');
	let found = uniq(map(match(text, /[A-Za-z0-9+\/]{43}=/g) ?? [], (x) => x[0]));
	eq(found, [ srv.public_key ], 'no key but the server\'s public one');
});

test('client_config: an IPv6 endpoint in brackets, without a regex', () => {
	let m = core.load();
	let srv = m.servers.main, dev = m.devices.alice_phone;
	let ep = (h) => {
		srv.endpoint = h;
		return match(awg.client_config(m, dev).conf, /\nEndpoint = ([^\n]*)\n/)?.[1];
	};
	eq(ep('vpn.example.com'), 'vpn.example.com:51820', 'a name');
	eq(ep('203.0.113.7'), '203.0.113.7:51820', 'IPv4');
	eq(ep('2001:db8::1'), '[2001:db8::1]:51820', 'IPv6');
	eq(ep('[2001:db8::1]'), '[2001:db8::1]:51820', 'IPv6 in brackets already');
	eq(ep(''), 'vpn.example.com:51820', 'the portal name when the server has none');
	// The regexes it stands for, on hosts changed at each character.
	for (let h in [ '2001:db8::1', '[::1]', 'a.b' ])
		for (let i = 0; i <= length(h); i++)
			for (let c in [ ':', '[', ']', 'a', '' ]) {
				let s = `${substr(h, 0, i)}${c}${substr(h, i + 1)}`;
				let want = match(s, /:/) && !match(s, /^\[/) ? `[${s}]` : s;
				eq(ep(s), `${want || 'vpn.example.com'}:51820`, s);
			}
});

test('config_fingerprint leaves out the private key and the junk', () => {
	let m = core.load();
	let dev = m.devices.alice_phone;
	let f = awg.config_fingerprint(m, dev);
	ok(match(f, /^[0-9a-f]{8}$/), 'eight hex digits');
	dev.private_key = 'yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=';
	eq(awg.config_fingerprint(m, dev), f, 'a private key');
	m.servers.main.obf.jc = '7';
	eq(awg.config_fingerprint(m, dev), f, 'another junk count');
	m.servers.main.port = 51821;
	ok(awg.config_fingerprint(m, dev) != f, 'another port');
	eq(awg.config_fingerprint(m, null), null, 'no device');
});

/* ---------- a device's local network, MTU and keep-alive ---------- */

// Exactly the complement: aligned prefixes, none overlapping another or a
// private range, and all of them together the whole address space.
test('BYPASS4: every IPv4 address outside the private ranges, once', () => {
	let nets = [ ...map(awg.BYPASS4, (n) => [ n, false ]), ...map(nft.PRIVATE4, (n) => [ n, true ]) ];
	let total = 0;
	for (let i = 0; i < length(nets); i++) {
		let a = cidr_any(nets[i][0]);
		ok(a && a.ip == a.net, `${nets[i][0]}: a prefix`);
		total += a.size;
		for (let j = i + 1; j < length(nets); j++) {
			let b = cidr_any(nets[j][0]);
			ok(a.net + a.size <= b.net || b.net + b.size <= a.net, `${nets[i][0]} and ${nets[j][0]} apart`);
		}
	}
	eq(total, 4294967296, 'together: every address');
});

test('BYPASS6: every IPv6 address outside fc00::/7, fe80::/10 and ff00::/8, once', () => {
	// Each of them is /16 or wider: the first 16 bits decide.
	let span = (n) => {
		let p = split(n, '/'), len = +p[1];
		ok(len >= 1 && len <= 16 && substr(p[0], -2) == '::', `${n}: a prefix of the first 16 bits`);
		let g = substr(p[0], 0, length(p[0]) - 2);
		let start = g == '' ? 0 : hex(g), size = 1 << (16 - len);
		ok(start % size == 0, `${n}: aligned`);
		return [ start, size ];
	};
	let nets = map([ ...awg.BYPASS6, 'fc00::/7', 'fe80::/10', 'ff00::/8' ], span);
	let total = 0;
	for (let i = 0; i < length(nets); i++) {
		total += nets[i][1];
		for (let j = i + 1; j < length(nets); j++)
			ok(nets[i][0] + nets[i][1] <= nets[j][0] || nets[j][0] + nets[j][1] <= nets[i][0], `${i} and ${j} apart`);
	}
	eq(total, 65536, 'together: every address');
});

test('allowed_ips: the local network outside the tunnel', () => {
	let m = core.load();
	let srv = m.servers.main;
	// No home network from the container's own interfaces.
	srv.auto_lan = false;
	srv.lan_devices = [];
	let alice = m.people.alice, bob = m.people.bob;
	eq(awg.allowed_ips(m, srv, bob), [ '0.0.0.0/0', '::/0' ], 'no device: everything');
	eq(awg.allowed_ips(m, srv, bob, { lan_bypass: false }), [ '0.0.0.0/0', '::/0' ], 'as before');
	let dns = (list) => [ ...slice(list, 0, 2), '10.9.0.1/32', ...slice(list, 2) ];
	eq(awg.allowed_ips(m, srv, bob, { lan_bypass: true }), [ ...dns(awg.BYPASS4), ...awg.BYPASS6 ], 'internet: the rest, and its DNS');
	eq(awg.allowed_ips(m, srv, alice, { lan_bypass: true }), [ ...slice(awg.BYPASS4, 0, 2), '10.9.0.0/29', ...slice(awg.BYPASS4, 2), ...awg.BYPASS6 ],
		'home too: the tunnel network with the other devices (the DNS is in it)');
	srv.mesh = 'off';
	srv.device_mesh = false;
	eq(awg.allowed_ips(m, srv, alice, { lan_bypass: true }), [ ...dns(awg.BYPASS4), ...awg.BYPASS6 ], 'no mesh: the router');
	srv.dns = [ '192.168.1.1', '192.168.1.53', 'fd00::53', '2001:4860:4860::8888', 'fe80::1' ];
	let all = awg.allowed_ips(m, srv, bob, { lan_bypass: true });
	ok(index(all, '192.168.1.1/32') >= 0 && index(all, '192.168.1.53/32') >= 0, 'every private IPv4 DNS server stays in the tunnel, not only the first');
	eq(slice(all, length(all) - length(awg.BYPASS6) - 2), [ ...awg.BYPASS6, 'fd00::53/128', 'fe80::1/128' ],
		'a private IPv6 one too; a public IPv6 one is in the rest already');
	eq(length(all), length(awg.BYPASS4) + 2 + length(awg.BYPASS6) + 2, 'nothing else');
	srv.dns = [ '1.1.1.1' ];
	eq(awg.allowed_ips(m, srv, bob, { lan_bypass: true }), [ ...awg.BYPASS4, ...awg.BYPASS6 ], 'a public DNS is in the rest already');
	alice.access = 'lan';
	alice.dns_mode = 'home';
	let lan = awg.allowed_ips(m, srv, alice, { lan_bypass: true });
	eq(lan, awg.allowed_ips(m, srv, alice), 'Home only: the same either way');
	let c = awg.client_config(m, { ...m.devices.alice_phone, person: 'bob', lan_bypass: true });
	eq(c.amnezia.allowed_ips, [ ...awg.BYPASS4, ...awg.BYPASS6 ], 'in the AmneziaVPN key');
	ok(index(c.conf, `AllowedIPs = ${join(', ', [ ...awg.BYPASS4, ...awg.BYPASS6 ])}\n`) >= 0, 'in the .conf');
});

test('keepalive_range and idle_handshake', () => {
	let srv = { keepalive: 25, obf: {} };
	eq(awg.keepalive_range(srv, {}), [ 25, 25 ], 'the server\'s, no range');
	eq(awg.keepalive_range(srv, { keepalive: 120 }), [ 120, 120 ], 'the device\'s own');
	eq(awg.keepalive_range(srv, { keepalive: 0 }), null, 'off for the device');
	eq(awg.keepalive_range({ keepalive: 0, obf: {} }, {}), null, 'off on the server');
	let max = { keepalive: 25, obf: awg.obf_preset('max') };
	eq(awg.keepalive_range(max, {}), [ 25, 35 ], 'jittered with 3.1');
	eq(awg.keepalive_range(max, { keepalive: 60 }), [ 60, 70 ], 'the device\'s own, jittered');
	// The first keep-alive after the rekey time (120 s; RekeyAfterTime's upper end) starts a handshake.
	eq(awg.idle_handshake(srv, {}), 145, 'within the rekey time: up to one keep-alive past it');
	eq(awg.idle_handshake(max, {}), 155, 'Maximum: RekeyAfterTime 100-120, keep-alive up to 35');
	eq(awg.idle_handshake(srv, { keepalive: 100 }), 220, 'every second keep-alive');
	eq(awg.idle_handshake(srv, { keepalive: 300 }), 300, 'every keep-alive once they are further apart');
	eq(awg.idle_handshake({ keepalive: 25, obf: { rekey_after_time: '200-400' } }, {}), 205, 'past 180 s the key is refused anyway');
	eq(awg.idle_handshake(srv, { keepalive: 0 }), null, 'no keep-alive: none');
});

test('client_config: the device\'s own MTU and keep-alive', () => {
	let m = core.load();
	let dev = m.devices.alice_phone;
	let line = (c, k) => match(c.conf, regexp(`\n${k} = ([^\n]*)\n`))?.[1];
	let c = awg.client_config(m, dev);
	eq([ line(c, 'MTU'), line(c, 'PersistentKeepalive'), c.amnezia.mtu ], [ '1280', '25', '1280' ], 'the server\'s (a phone)');
	let fp = awg.config_fingerprint(m, dev);
	let old = { ...dev };
	delete old.mtu;
	delete old.keepalive;
	delete old.lan_bypass;
	eq(awg.config_fingerprint(m, old), fp, 'a device without values of its own keeps its fingerprint (as before the options)');
	dev.mtu = 1420;
	dev.keepalive = 0;
	c = awg.client_config(m, dev);
	eq([ line(c, 'MTU'), line(c, 'PersistentKeepalive'), c.amnezia.mtu, c.amnezia.persistent_keep_alive ], [ '1420', null, '1420', '0' ],
		'its own; keep-alive off');
	ok(awg.config_fingerprint(m, dev) != fp, 'a change asks it to import again');
	m.servers.main.obf = awg.obf_preset('max');
	dev.keepalive = 120;
	c = awg.client_config(m, dev);
	eq([ line(c, 'PersistentKeepalive'), c.amnezia.persistent_keep_alive ], [ '120-130', '120-130' ], 'jittered with 3.1');
});
