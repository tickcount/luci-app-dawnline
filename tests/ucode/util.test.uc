// dawnline.util: validation, addresses, slugs and dates (pure functions).
import * as util from 'dawnline.util';

test('valid_name', () => {
	ok(util.valid_name('Alice'), 'plain');
	ok(util.valid_name('Мама'), 'non-ASCII letters');
	ok(!util.valid_name(''), 'empty');
	ok(!util.valid_name('   '), 'blank');
	ok(!util.valid_name(null), 'null');
	ok(!util.valid_name(42), 'number');
	ok(util.valid_name('a' + replace(sprintf('%47s', ''), ' ', 'b')), '48 characters');
	ok(!util.valid_name('a' + replace(sprintf('%48s', ''), ' ', 'b')), '49 characters');
	ok(util.valid_name('ЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭЯЧ'), '25 Cyrillic letters (50 bytes) are 25 characters');
	ok(!util.valid_name('Bob "B"'), 'quotes');
	ok(!util.valid_name('a<b'), 'angle bracket');
	ok(!util.valid_name('a"b'), 'quote');
	ok(!util.valid_name('a\\b'), 'backslash');
	ok(!util.valid_name('a\tb'), 'control character');
});

test('valid_host', () => {
	ok(util.valid_host('vpn.example.com'), 'name');
	ok(util.valid_host('router'), 'single label');
	ok(util.valid_host('203.0.113.7'), 'IPv4');
	ok(util.valid_host('2001:db8::1'), 'IPv6');
	ok(!util.valid_host('-a.example.com'), 'leading dash');
	ok(!util.valid_host('a..example.com'), 'empty label');
	ok(!util.valid_host('bad host'), 'space');
	ok(!util.valid_host(''), 'empty');
	ok(!util.valid_host(null), 'null');
	let label = replace(sprintf('%63s', ''), ' ', 'a');
	ok(util.valid_host(`${label}.example`), '63-char label');
	ok(!util.valid_host(`${label}a.example`), '64-char label');
	ok(!util.valid_host(join('.', [ label, label, label, label, 'x' ])), 'over 253 characters');
});

test('valid_date', () => {
	ok(util.valid_date('2026-01-31'), 'ISO day');
	ok(!util.valid_date('2026-1-31'), 'no padding');
	ok(!util.valid_date('20260131'), 'no dashes');
	ok(!util.valid_date('2026-01-31T00:00'), 'trailing time');
	ok(!util.valid_date(20260131), 'not a string');
});

test('valid_slug and valid_key', () => {
	ok(util.valid_slug('alice'), 'word');
	ok(util.valid_slug('a'), 'one character');
	ok(util.valid_slug('alice-2'), 'dash inside');
	ok(!util.valid_slug('-alice'), 'leading dash');
	ok(!util.valid_slug('Alice'), 'upper case');
	ok(!util.valid_slug(replace(sprintf('%33s', ''), ' ', 'a')), '33 characters');
	ok(util.valid_key('yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk='), 'WireGuard key');
	ok(!util.valid_key('yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk'), 'no padding');
	ok(!util.valid_key('yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmb='), 'impossible last sextet');
	ok(!util.valid_key(''), 'empty');
});

test('valid_key without a regex', () => {
	let k = 'yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=';
	ok(util.valid_key('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnop0='), 'letters');
	ok(util.valid_key('qrstuvwxyz0123456789+/qrstuvwxyz0123456789w='), 'digits, + and /');
	ok(!util.valid_key(`${k}=`), '45 characters');
	ok(!util.valid_key(substr(k, 1)), '43 characters');
	ok(!util.valid_key(replace(k, '+', '-')), 'URL-safe alphabet');
	ok(!util.valid_key(`${substr(k, 0, 20)}=${substr(k, 21)}`), 'padding inside');
	ok(!util.valid_key(`${substr(k, 0, 20)}\u0000${substr(k, 21)}`), 'NUL byte');
	ok(!util.valid_key(`${k}\u0000x`), 'NUL and more after the key');
	ok(!util.valid_key(` ${substr(k, 1)}`), 'space');
	ok(!util.valid_key(null), 'null');
	ok(!util.valid_key([ k ]), 'array');
	// The pattern it stands for, on keys changed at both ends and in the middle.
	let re = /^[A-Za-z0-9+\/]{42}[AEIMQUYcgkosw048]=$/;
	for (let i in [ 0, 1, 21, 41, 42, 43 ])
		for (let c in [ 'A', 'z', '0', '9', '+', '/', 'b', 'k', '=', '-', '_', ' ', '.', '\n' ]) {
			let s = `${substr(k, 0, i)}${c}${substr(k, i + 1)}`;
			eq(util.valid_key(s), match(s, re) != null, s);
		}
});

test('valid_host without a regex', () => {
	ok(util.valid_host('a'), 'one character');
	ok(util.valid_host('xn--80ak6aa92e.com'), 'dashes inside a label');
	ok(util.valid_host('Router-1.LAN'), 'upper case');
	ok(!util.valid_host('example.com.'), 'trailing dot');
	ok(!util.valid_host('.example.com'), 'leading dot');
	ok(!util.valid_host('a-.example.com'), 'dash ending a label');
	ok(!util.valid_host('under_score.example'), 'underscore');
	ok(!util.valid_host('example.com\u0000x'), 'NUL byte');
	// The pattern it stands for (and the address checks after it), on names with
	// each character replaced, removed or with one inserted before it.
	let re = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
	let old = (s) => length(s) <= 253 && (match(s, re) != null || util.ip2int(s) != null || util.is_ip6(s));
	let label = replace(sprintf('%63s', ''), ' ', 'b');
	for (let h in [ 'vpn.example.com', 'a.b-c.d', `${label}.x`, `x.${label}`, '203.0.113.7', '2001:db8::1' ]) {
		let at = [];
		for (let i = 0; i <= length(h); i++)
			if (length(h) < 20 || i < 2 || i > length(h) - 3 || (i > 60 && i < 66))
				push(at, i);
		for (let i in at)
			for (let c in [ 'a', 'Z', '0', '-', '.', '_', ' ', '*', ':', '\n', '' ]) {
				let s = `${substr(h, 0, i)}${c}${substr(h, i + 1)}`, t = `${substr(h, 0, i)}${c}${substr(h, i)}`;
				eq(util.valid_host(s), old(s), s);
				eq(util.valid_host(t), old(t), t);
			}
	}
});

test('valid_iface without a regex', () => {
	ok(util.valid_iface('wan'), 'wan');
	ok(util.valid_iface('lan.100'), 'dot');
	ok(util.valid_iface('@wan6'), 'alias');
	ok(!util.valid_iface(''), 'empty');
	ok(!util.valid_iface(replace(sprintf('%33s', ''), ' ', 'a')), '33 characters');
	ok(!util.valid_iface('wan\u0000x'), 'NUL byte');
	ok(!util.valid_iface(null), 'null');
	ok(!util.valid_iface([ 'wan' ]), 'array');
	// The pattern it stands for, as above.
	let re = /^[A-Za-z0-9_.@-]{1,32}$/;
	for (let n in [ 'wan', 'br-lan.10', 'A_z@0', replace(sprintf('%32s', ''), ' ', 'x') ])
		for (let i = 0; i <= length(n); i++)
			for (let c in [ 'a', 'Z', '9', '_', '.', '@', '-', ' ', '$', ';', '/', '\n', '' ]) {
				let s = `${substr(n, 0, i)}${c}${substr(n, i + 1)}`, t = `${substr(n, 0, i)}${c}${substr(n, i)}`;
				eq(util.valid_iface(s), match(s, re) != null, s);
				eq(util.valid_iface(t), match(t, re) != null, t);
			}
});

test('ip2int / int2ip / cidr_any', () => {
	eq(util.ip2int('10.9.0.1'), 168361985, 'ip2int');
	eq(util.int2ip(168361985), '10.9.0.1', 'int2ip');
	eq(util.ip2int('256.0.0.1'), null, 'octet over 255');
	eq(util.ip2int('1.2.3'), null, 'three octets');
	eq(util.cidr_any('10.0.0.5'), { net: util.ip2int('10.0.0.5'), prefix: 32, size: 1, ip: util.ip2int('10.0.0.5') }, 'bare address is a /32');
	eq(util.cidr_any('10.0.0.5/8'), { net: util.ip2int('10.0.0.0'), prefix: 8, size: 16777216, ip: util.ip2int('10.0.0.5') }, 'masked base');
	eq(util.cidr_any('10.0.0.0/33'), null, 'prefix over 32');
	eq(util.cidr_any(null), null, 'null');
	eq(util.in_nets('10.9.0.7', [ '192.168.0.0/16', '10.9.0.0/29' ]), '10.9.0.0/29', 'first match');
	eq(util.in_nets('10.9.0.8', [ '10.9.0.0/29' ]), null, 'just outside');
	eq(util.in_nets('nonsense', [ '10.9.0.0/29' ]), null, 'not an address');
});

test('parse_cidr', () => {
	let c = util.parse_cidr('10.9.0.0/24');
	eq([ util.int2ip(c.net), c.prefix, c.size, util.int2ip(c.first), util.int2ip(c.last) ], [ '10.9.0.0', 24, 256, '10.9.0.1', '10.9.0.254' ], '/24');
	eq(util.int2ip(util.parse_cidr('10.9.0.77/24').net), '10.9.0.0', 'host bits masked off');
	eq(util.cidr_str(util.parse_cidr('10.9.0.77/24')), '10.9.0.0/24', 'cidr_str');
	eq(util.parse_cidr('10.9.0.0/7'), null, 'too wide');
	eq(util.parse_cidr('10.9.0.0/31'), null, 'too narrow');
	eq(util.parse_cidr('10.9.0.0'), null, 'no prefix');
	eq(util.parse_cidr('300.0.0.0/24'), null, 'bad octet');
	eq(util.parse_cidr(null), null, 'null');
	ok(util.cidr_overlaps(util.parse_cidr('10.9.0.0/24'), util.parse_cidr('10.9.0.128/25')), 'overlap');
	ok(!util.cidr_overlaps(util.parse_cidr('10.9.0.0/24'), util.parse_cidr('10.9.1.0/24')), 'adjacent');
	ok(util.in_cidr('10.9.0.200', util.parse_cidr('10.9.0.0/24')), 'in_cidr');
	ok(!util.in_cidr('10.9.1.1', util.parse_cidr('10.9.0.0/24')), 'not in_cidr');
});

test('parse_cidr and cidr_any share one pattern', () => {
	// The patterns each had, on networks changed at each character.
	let old_any = (s) => {
		let m = match(s ?? '', /^([0-9.]+)(\/([0-9]+))?$/);
		if (!m)
			return null;
		let ip = util.ip2int(m[1]), prefix = m[3] != null ? +m[3] : 32;
		if (ip == null || prefix > 32)
			return null;
		let size = 1 << (32 - prefix);
		return { net: ip - ip % size, prefix, size, ip };
	};
	let old_cidr = (s) => {
		let m = match(s ?? '', /^([0-9.]+)\/([0-9]+)$/);
		if (!m)
			return null;
		let ip = util.ip2int(m[1]), prefix = +m[2];
		if (ip == null || prefix < 8 || prefix > 30)
			return null;
		let size = 1 << (32 - prefix);
		let net = ip - ip % size;
		return { net, prefix, size, first: net + 1, last: net + size - 2, ip };
	};
	for (let n in [ '10.9.0.0/24', '192.168.1.77/30', '0.0.0.0/8', '10.0.0.5', '1.2.3.4/32', '//', '' ])
		for (let i = 0; i <= length(n); i++)
			for (let c in [ '0', '9', '.', '/', ' ', 'a', '-', '\n', '' ]) {
				let s = `${substr(n, 0, i)}${c}${substr(n, i + 1)}`, t = `${substr(n, 0, i)}${c}${substr(n, i)}`;
				eq(util.parse_cidr(s), old_cidr(s), s);
				eq(util.parse_cidr(t), old_cidr(t), t);
				eq(util.cidr_any(s), old_any(s), s);
				eq(util.cidr_any(t), old_any(t), t);
			}
});

test('cloudflare_ip', () => {
	ok(util.cloudflare_ip('104.16.1.1'), 'v4 range');
	ok(util.cloudflare_ip('2606:4700::1'), 'v6 range');
	ok(!util.cloudflare_ip('8.8.8.8'), 'other v4');
	ok(!util.cloudflare_ip('2001:db8::1'), 'other v6');
	ok(!util.cloudflare_ip(null), 'null');
});

test('slugify', () => {
	eq(util.slugify('Alice Smith'), 'alice-smith', 'spaces to dashes');
	eq(util.slugify('  --Bob!!  '), 'bob', 'trimmed dashes');
	eq(util.slugify(''), 'user', 'empty');
	eq(util.slugify(null), 'user', 'null');
	eq(util.slugify('Мама'), 'mama', 'Cyrillic written in Latin');
	eq(util.slugify('Юля Щукина'), 'yulya-shchukina', 'Cyrillic words');
	eq(util.slugify('日本'), 'user', 'nothing left');
	eq(length(util.slugify(replace(sprintf('%40s', ''), ' ', 'x'))), 32, 'cut at 32');
});

test('dates', () => {
	let end = util.date_end('2026-02-28');
	let t = localtime(end);
	eq([ t.year, t.mon, t.mday, t.hour, t.min, t.sec ], [ 2026, 2, 28, 23, 59, 59 ], 'end of the local day');
	eq(util.date_end('2026-2-28'), null, 'bad date');
	let noon = timelocal({ year: 2026, mon: 3, mday: 1, hour: 12, min: 0, sec: 0 });
	eq(util.day_key(noon), '2026-03-01', 'day_key');
	eq(util.month_key(noon), '2026-03', 'month_key');
	eq(util.day_key_ago(1, noon), '2026-02-28', 'day_key_ago crosses the month');
	eq(util.day_key_ago(0, noon), '2026-03-01', 'zero days');
	eq(util.uniq([ 'a', 'b', 'a', 'c', 'b' ]), [ 'a', 'b', 'c' ], 'uniq');
});

test('text: ulength, ucut, translit, host_label, tunnel_name', () => {
	eq(util.ulength('Мама'), 4, 'characters, not bytes');
	eq(util.ulength('abc'), 3, 'ascii');
	eq(util.ucut('Привет', 3), 'При', 'cut by characters');
	eq(util.ucut('ab', 5), 'ab', 'shorter than the cut');
	eq(util.translit('Мама Таня'), 'mama tanya', 'Russian');
	eq(util.translit('Їжак Ґава ёж'), 'yizhak gava yozh', 'Ukrainian letters and ё');
	eq(util.translit('Mixed Текст 1'), 'Mixed tekst 1', 'Latin and digits pass');
	eq(util.host_label('Galaxy S24'), 'galaxy-s24', 'label');
	eq(util.host_label('Телефон Ёжика'), 'telefon-yozhika', 'Cyrillic label');
	eq(util.tunnel_name('Outline Home'), 'Outline-Home', 'tunnel name keeps the case');
	eq(util.tunnel_name('Дом у моря'), 'dom-u-morya', 'Cyrillic tunnel name');
	eq(util.tunnel_name('  My  VPN (home)! '), 'My-VPN-home', 'tunnel name: runs of other characters are one dash');
	eq(util.tunnel_name('A very long server name'), 'A-very-long-ser', 'tunnel name: 15 characters at most');
	eq(util.tunnel_name('Home server 12345'), 'Home-server-123', 'tunnel name: cut');
	eq(util.tunnel_name('Lakeside house x'), 'Lakeside-house', 'tunnel name: no dash left at the cut');
	eq(util.tunnel_name('nul'), 'dawnline', 'tunnel name: a Windows device name');
	eq(util.tunnel_name('COM1'), 'dawnline', 'tunnel name: a Windows device name, any case');
	eq(util.tunnel_name('???'), 'dawnline', 'tunnel name: nothing left');
	eq(util.tunnel_name(null), 'dawnline', 'tunnel name: null');
	eq(util.host_label('!!!'), 'device', 'nothing left');
	eq(length(util.host_label(replace(sprintf('%50s', ''), ' ', 'x'))), 40, 'cut at 40');
});

test('host_label, tunnel_name, slugify: dashes trimmed without a regex', () => {
	// What they were with the dash patterns and the device-name regex, on names
	// changed at each character (names come from uci, which holds no NUL byte).
	let old_label = (s) => {
		let l = replace(lc(util.translit(`${s ?? ''}`)), /[^a-z0-9]+/g, '-');
		l = replace(substr(replace(l, /^-+|-+$/g, ''), 0, 40), /-+$/g, '');
		return l || 'device';
	};
	let old_tunnel = (s) => {
		let l = replace(util.translit(`${s ?? ''}`), /[^A-Za-z0-9]+/g, '-');
		l = replace(substr(replace(l, /^-+|-+$/g, ''), 0, 15), /-+$/g, '');
		return l && !match(l, /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i) ? l : 'dawnline';
	};
	let old_slug = (s) => {
		let out = lc(util.translit(trim(`${s ?? ''}`)));
		out = replace(out, /[^a-z0-9]+/g, '-');
		out = replace(out, /^-+|-+$/g, '');
		return substr(out, 0, 32) || 'user';
	};
	let same = (s) => {
		eq(util.host_label(s), old_label(s), s);
		eq(util.tunnel_name(s), old_tunnel(s), s);
		eq(util.slugify(s), old_slug(s), s);
	};
	let long = replace(sprintf('%13s', ''), ' ', 'x');
	for (let n in [ 'Outline Home', '--a--b--', ' (My VPN)! ', 'Дом у моря', `${long}-yz`, `${long}y-z`,
	                `${long}${long}${long}-ab`, `${replace(sprintf('%31s', ''), ' ', 'q')}--r`, '-', '' ])
		for (let i = 0; i <= length(n); i++)
			for (let c in [ 'a', 'Z', '0', '-', ' ', '!', '.', '_', 'Ж', '\n', '' ]) {
				same(`${substr(n, 0, i)}${c}${substr(n, i + 1)}`);
				same(`${substr(n, 0, i)}${c}${substr(n, i)}`);
			}
	// Windows device names in any case, and their neighbours.
	for (let b in [ 'con', 'prn', 'aux', 'nul', 'com', 'lpt', 'co', 'conx' ])
		for (let d in [ '', '0', '1', '5', '9', 'x', '10', '-1', ' 2' ]) {
			same(`${b}${d}`);
			same(uc(`${b}${d}`));
			same(`${uc(substr(b, 0, 1))}${substr(b, 1)}${d}`);
		}
	same(null);
});
