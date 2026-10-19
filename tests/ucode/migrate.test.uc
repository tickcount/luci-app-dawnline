// dawnline.migrate: the one-time steps on the fixture config (real libuci):
// each changes what it must the first time and nothing the second time.
// This test rewrites /etc/config/dawnline and /etc/config/uhttpd.
import { cursor } from 'uci';
import { stat } from 'fs';
import * as core from 'dawnline.core';
import * as migrate from 'dawnline.migrate';

function conf(name) {
	let c = cursor();
	c.load(name);
	return c;
}

test('before: the fixture holds the old state', () => {
	let c = conf('dawnline');
	eq(c.get('dawnline', 'bob', 'code'), 'XyZ12345', 'random code');
	eq(c.get('dawnline', 'main', 'mtu'), '1380', 'stored MTU');
	eq(c.get('dawnline', 'settings', 'portal_title'), 'My VPN', 'a portal title');
	eq(conf('uhttpd').get('uhttpd', 'main', 'error_page'), '/cgi-bin/dawnline-portal', 'portal as error page');
});

test('run: the steps change what they must', () => {
	migrate.run();
	let c = conf('dawnline');
	ok(match(c.get('dawnline', 'bob', 'code'), core.WORD_CODE), 'bob has a word code');
	eq(c.get('dawnline', 'alice', 'code'), 'abcdef-ghijkl-mnopqr', 'alice keeps hers');
	eq(c.get('dawnline', 'main', 'mtu'), null, 'MTU is automatic');
	eq(c.get('dawnline', 'main', 'subnet'), '10.9.0.0/29', 'the rest of the server stays');
	eq(c.get('dawnline', 'settings', 'portal_443'), null, 'no portal_443');
	eq(c.get('dawnline', 'settings', 'portal_title'), null, 'no portal title');
	eq(conf('uhttpd').get('uhttpd', 'main', 'error_page'), null, 'error page gone');
	eq(conf('uhttpd').get('uhttpd', 'main', 'home'), '/www', 'the rest of uhttpd stays');
	eq(stat('/etc/config/dawnline').perm, { setuid: false, setgid: false, sticky: false,
		user_read: true, user_write: true, user_exec: false,
		group_read: false, group_write: false, group_exec: false,
		other_read: false, other_write: false, other_exec: false }, 'config stays private');
});

test('run again: a step runs once', () => {
	let before = conf('dawnline').get('dawnline', 'bob', 'code');
	let mtime = stat('/etc/config/dawnline').mtime;
	migrate.run();
	eq(conf('dawnline').get('dawnline', 'bob', 'code'), before, 'the code is not drawn again');
	eq(stat('/etc/config/dawnline').mtime, mtime, 'nothing written');
});
