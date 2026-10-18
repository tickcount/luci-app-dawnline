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

test('text: ulength, ucut, translit, host_label', () => {
	eq(util.ulength('Мама'), 4, 'characters, not bytes');
	eq(util.ulength('abc'), 3, 'ascii');
	eq(util.ucut('Привет', 3), 'При', 'cut by characters');
	eq(util.ucut('ab', 5), 'ab', 'shorter than the cut');
	eq(util.translit('Мама Таня'), 'mama tanya', 'Russian');
	eq(util.translit('Їжак Ґава ёж'), 'yizhak gava yozh', 'Ukrainian letters and ё');
	eq(util.translit('Mixed Текст 1'), 'Mixed tekst 1', 'Latin and digits pass');
	eq(util.host_label('Galaxy S24'), 'galaxy-s24', 'label');
	eq(util.host_label('Телефон Ёжика'), 'telefon-yozhika', 'Cyrillic label');
	eq(util.host_label('!!!'), 'device', 'nothing left');
	eq(length(util.host_label(replace(sprintf('%50s', ''), ' ', 'x'))), 40, 'cut at 40');
});
