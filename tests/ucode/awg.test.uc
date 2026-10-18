// dawnline.awg: disguise presets against their own validation, and the parser
// of `awg show all dump` on the output formats of AmneziaWG 1.0, 2.0 and 3.1
// (the stand-in awg in fixtures/bin prints the fixture put at AWG_DUMP).
import { readfile, writefile, unlink } from 'fs';
import * as awg from 'dawnline.awg';

const AWG_DUMP = '/tmp/dawnline-tests/awg-dump';
let fixtures = sourcepath(0, true) + '/fixtures';

test('obf_preset off', () => {
	let o = awg.obf_preset('off');
	eq(o, { jc: '0', jmin: '0', jmax: '0', s1: '0', s2: '0', h1: '1', h2: '2', h3: '3', h4: '4' }, 'plain WireGuard headers');
	eq(awg.obf_errors(o), [], 'valid');
});

test('obf_preset standard and strong', () => {
	for (let name in [ 'standard', 'strong' ])
		for (let i = 0; i < 25; i++) {
			let o = awg.obf_preset(name);
			eq(awg.obf_errors(o), [], `${name} is valid`);
			let jc = +o.jc, jmin = +o.jmin, jmax = +o.jmax;
			ok(name == 'strong' ? jc >= 6 && jc <= 10 : jc >= 3 && jc <= 6, `${name} jc=${o.jc}`);
			ok(jmin >= 64 && jmax > jmin && jmax <= 1024, `${name} junk sizes ${o.jmin}-${o.jmax}`);
			ok(+o.s1 + 56 != +o.s2, 's1 + 56 != s2');
			eq(length(uniq([ o.h1, o.h2, o.h3, o.h4 ])), 4, 'distinct headers');
			for (let k in [ 'h1', 'h2', 'h3', 'h4' ])
				ok(+o[k] >= 5, `${k} above the reserved values`);
			eq(o.s3, null, 'no 2.0 values');
		}
});

test('obf_preset balanced', () => {
	for (let i = 0; i < 25; i++) {
		let o = awg.obf_preset('balanced');
		eq(awg.obf_errors(o), [], 'balanced is valid');
		ok(+o.jc >= 4 && +o.jc <= 8, `jc=${o.jc}`);
		ok(+o.s3 >= 8 && +o.s3 <= 48 && +o.s4 >= 4 && +o.s4 <= 16, `padding ${o.s3}/${o.s4}`);
		ok(substr(o.i1, 0, 3) == '<r ' && substr(o.i2, 0, 3) == '<r ', 'DNS-shaped signature packets');
		eq(o.header_protection_key, null, 'no 3.1 values');
	}
});

test('obf_preset max', () => {
	let o = awg.obf_preset('max');
	eq(o.header_protection_key, 'yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=', 'key from awg genkey');
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
	eq(awg.obf_errors(o), [], 'max is valid');
});

test('obf_errors', () => {
	eq(awg.obf_errors({}), [], 'nothing set');
	eq(awg.obf_errors({ jc: '11' }), [ 'jc=11 (0-10)' ], 'jc range');
	eq(awg.obf_errors({ jmin: '0', jmax: '0' }), [], 'zero junk sizes are allowed');
	eq(awg.obf_errors({ jmin: '2000' }), [ 'jmin=2000 (0-1024)' ], 'jmin range');
	eq(awg.obf_errors({ jmin: '200', jmax: '100' }), [ 'jmin > jmax' ], 'order');
	eq(awg.obf_errors({ s1: '5', s2: '61' }), [ 's1 + 56 = s2' ], 'the handshake size clash');
	eq(awg.obf_errors({ s4: '33' }), [ 's4=33 (0-32)' ], 's4 range');
	eq(awg.obf_errors({ jc: 'x' }), [ 'jc=x (0-10)' ], 'not a number');
	eq(awg.obf_errors({ h1: '7', h2: '7' }), [ 'h1-h4 must be distinct' ], 'duplicate headers');
	eq(awg.obf_errors({ h1: '7-9', h2: 'abc' }), [ 'h2 must be a number or range' ], 'header ranges');
	eq(awg.obf_neutral({ jc: '0', jmin: '0', jmax: '0', s1: '0', s2: '0', h1: '1', h2: '2', h3: '3', h4: '4' }), true, 'off is neutral');
	eq(awg.obf_neutral({ jc: '4', jmin: '64', jmax: '128' }), false, 'junk is not neutral');
});

function dump_of(name) {
	writefile(AWG_DUMP, readfile(`${fixtures}/awg-dump-${name}.txt`));
	return awg.dump();
}

test('dump: AmneziaWG 1.0 (14 interface fields)', () => {
	let d = dump_of('1.0');
	eq(d.ok, true, 'ok');
	eq(d.ifaces, { awgmain: { public_key: 'xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=', port: 51820 } }, 'interface');
	eq(d.peers['HIgo9xNzJMWLKASShiTqIybxZ0U3wGLiUeJ1PKf8ykw='],
		{ ifname: 'awgmain', endpoint: '203.0.113.7:41821', handshake: 1760000000, rx: 123456, tx: 654321 }, 'peer with a session');
	eq(d.peers['TrMvSoP4jYQlY6RIzBgbssQqY3vxI2Pi+y71lOWWXX0='],
		{ ifname: 'awgmain', endpoint: '', handshake: 0, rx: 0, tx: 0 }, 'peer that never connected');
});

test('dump: AmneziaWG 2.0 (33 interface fields)', () => {
	let d = dump_of('2.0');
	eq(d.ifaces, { awgmain: { public_key: 'xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=', port: 51820 } }, 'interface');
	eq(keys(d.peers), [ 'HIgo9xNzJMWLKASShiTqIybxZ0U3wGLiUeJ1PKf8ykw=' ], 'one peer');
});

test('dump: AmneziaWG 3.1 (33 interface fields, protection on)', () => {
	let d = dump_of('3.1');
	eq(d.ifaces, { awgmain: { public_key: 'xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=', port: 51820 } }, 'interface');
	eq(length(d.peers), 2, 'two peers');
});

test('dump: the tool fails', () => {
	unlink(AWG_DUMP);
	let d = awg.dump();
	eq(d, { ok: false, ifaces: {}, peers: {} }, 'nothing known');
});
