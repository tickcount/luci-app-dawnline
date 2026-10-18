// dawnline.schema: what the admin may save (validate) and how stored values
// are read (get), one case per settings type.
import * as schema from 'dawnline.schema';

test('validate: bool', () => {
	eq(schema.validate('portal_enabled', true), '1', 'true');
	eq(schema.validate('portal_enabled', false), '0', 'false');
	eq(schema.validate('portal_enabled', '1'), '1', 'string 1');
	eq(schema.validate('portal_enabled', ''), null, 'empty removes the option');
	throws(() => schema.validate('portal_enabled', 'yes'), /0 or 1/, 'yes');
});

test('validate: int', () => {
	eq(schema.validate('portal_port', '8443'), '8443', 'in range');
	eq(schema.validate('portal_port', ' 443 '), '443', 'trimmed');
	eq(schema.validate('portal_port', '08443'), '8443', 'leading zero dropped');
	eq(schema.validate('portal_port', 9000), '9000', 'number');
	throws(() => schema.validate('portal_port', '0'), /free port/, 'below min');
	throws(() => schema.validate('portal_port', '70000'), /free port/, 'above max');
	throws(() => schema.validate('portal_port', 'abc'), /free port/, 'letters');
	throws(() => schema.validate('portal_port', '-1'), /free port/, 'negative');
	throws(() => schema.validate('default_device_limit', '33'), /1-32/, 'device limit');
	eq(schema.validate('log_keep_days', '0'), '0', 'zero allowed where min is 0');
});

test('validate: enum', () => {
	eq(schema.validate('geo_provider', 'ipapi.co'), 'ipapi.co', 'known');
	throws(() => schema.validate('geo_provider', 'maxmind'), /Unknown location service/, 'unknown');
	eq(schema.validate('update_interval', '7d'), '7d', 'interval from dawnline.updates');
	throws(() => schema.validate('update_interval', '2d'), /6h, 12h, 1d or 7d/, 'unknown interval');
});

test('validate: host and hosts', () => {
	eq(schema.validate('portal_host', 'vpn.example.com'), 'vpn.example.com', 'name');
	eq(schema.validate('portal_host', '203.0.113.7'), '203.0.113.7', 'address');
	throws(() => schema.validate('portal_host', 'bad host!'), /hostname or IP/, 'bad');
	eq(schema.validate('portal_alt', [ 'a.example.com', ' a.example.com ', '', 'b.example.com' ]),
		[ 'a.example.com', 'b.example.com' ], 'trimmed, deduplicated, empty ones dropped');
	throws(() => schema.validate('portal_alt', [ 'a.example.com', 'bad host' ]), /hostnames or IP/, 'a typo is refused, not dropped');
	eq(schema.validate('portal_alt', []), null, 'empty list removes the option');
	eq(schema.validate('portal_alt', 'a.example.com'), null, 'not a list');
});

test('validate: url', () => {
	eq(schema.validate('portal_redirect', 'https://example.com/x?y=1'), 'https://example.com/x?y=1', 'https with path');
	eq(schema.validate('portal_redirect', 'http://example.com:8080'), 'http://example.com:8080', 'http with port');
	throws(() => schema.validate('portal_redirect', 'ftp://example.com'), /full http/, 'scheme');
	throws(() => schema.validate('portal_redirect', 'https://example.com/<x>'), /full http/, 'angle brackets');
	throws(() => schema.validate('portal_redirect', 'https://example.com/' + replace(sprintf('%300s', ''), ' ', 'a')), /full http/, 'over 300 characters');
});

test('validate: file', () => {
	eq(schema.validate('portal_cert', '/etc/passwd'), '/etc/passwd', 'existing file');
	throws(() => schema.validate('portal_cert', '/nonexistent/cert.pem'), /does not exist/, 'missing');
	throws(() => schema.validate('portal_cert', 'cert.pem'), /does not exist/, 'relative');
});

test('validate: domain', () => {
	eq(schema.validate('domain', 'lan'), 'lan', 'single');
	eq(schema.validate('domain', 'home.arpa'), 'home.arpa', 'dotted');
	throws(() => schema.validate('domain', 'Lan'), /lowercase/, 'upper case');
	throws(() => schema.validate('domain', replace(sprintf('%33s', ''), ' ', 'a')), /lowercase/, '33-char label');
});

test('validate: ipv4', () => {
	eq(schema.validate('home_dns_fallback', '9.9.9.9'), '9.9.9.9', 'address');
	eq(schema.validate('home_dns_fallback', ''), 'none', 'empty means no fallback');
	throws(() => schema.validate('home_dns_fallback', '999.1.1.1'), /IPv4/, 'bad octet');
	throws(() => schema.validate('home_dns_fallback', 'dns.example'), /IPv4/, 'name');
});

test('validate: time', () => {
	eq(schema.validate('update_time', '04:00'), '04:00', 'padded');
	eq(schema.validate('update_time', '4:00'), '4:00', 'unpadded');
	eq(schema.validate('update_time', '23:59'), '23:59', 'last minute');
	throws(() => schema.validate('update_time', '24:00'), /HH:MM/, 'hour 24');
	throws(() => schema.validate('update_time', '23:60'), /HH:MM/, 'minute 60');
});

test('validate: text', () => {
	eq(schema.validate('portal_title', 'My VPN'), 'My VPN', 'plain');
	eq(schema.validate('portal_title', replace(sprintf('%64s', ''), ' ', 'a')), replace(sprintf('%64s', ''), ' ', 'a'), '64 characters');
	throws(() => schema.validate('portal_title', replace(sprintf('%65s', ''), ' ', 'a')), /64 characters/, '65 characters');
	throws(() => schema.validate('portal_title', 'a\nb'), /64 characters/, 'control character');
});

test('validate: targets', () => {
	eq(schema.validate('update_targets', [ 'app', 'bogus', 'app', 'amneziawg' ]), [ 'app', 'amneziawg' ], 'known ones, once');
	eq(schema.validate('update_targets', []), [ 'none' ], 'empty is a choice');
	eq(schema.validate('update_targets', 'app'), [ 'none' ], 'not a list');
});

test('validate: unknown key', () => {
	throws(() => schema.validate('nonsense', '1'), /Unknown setting/);
});

test('get', () => {
	eq(schema.get({ portal_enabled: 'on' }, 'portal_enabled'), true, 'bool synonyms');
	eq(schema.get({ portal_enabled: 'maybe' }, 'portal_enabled'), false, 'bad bool is the default');
	eq(schema.get({}, 'portal_enabled'), false, 'missing bool');
	eq(schema.get({ portal_port: '443' }, 'portal_port'), 443, 'int');
	eq(schema.get({ portal_port: '99999' }, 'portal_port'), 8443, 'int out of range is the default');
	eq(schema.get({ portal_port: 'x' }, 'portal_port'), 8443, 'bad int');
	eq(schema.get({}, 'portal_alt'), [], 'missing list');
	eq(schema.get({ portal_alt: 'a.example.com' }, 'portal_alt'), [ 'a.example.com' ], 'single value as list');
	eq(schema.get({ portal_alt: [ 'a', '' ] }, 'portal_alt'), [ 'a' ], 'empty entries dropped');
	eq(schema.get({}, 'update_targets'), [ 'app', 'packages' ], 'default targets');
	eq(schema.get({ geo_provider: 'ipapi.co' }, 'geo_provider'), 'ipapi.co', 'enum');
	eq(schema.get({ geo_provider: 'x' }, 'geo_provider'), 'ipwho.is', 'bad enum is the default');
	eq(schema.get({ home_dns_fallback: 'none' }, 'home_dns_fallback'), '', 'none reads as empty');
	eq(schema.get({}, 'home_dns_fallback'), '1.1.1.1', 'missing ipv4');
	eq(schema.get({ home_dns_fallback: '300.1.1.1' }, 'home_dns_fallback'), '1.1.1.1', 'bad ipv4');
	eq(schema.get({}, 'portal_title'), 'Dawnline', 'missing text');
	eq(schema.get({ portal_title: '' }, 'portal_title'), 'Dawnline', 'empty text');
	eq(schema.get({ portal_host: 'vpn.example.com' }, 'portal_host'), 'vpn.example.com', 'host passes through');
	eq(schema.get({ other: 'raw' }, 'other'), 'raw', 'unknown key is the raw value');
	eq(schema.get(null, 'portal_port'), 8443, 'no section');
});

test('parsing helpers', () => {
	eq(schema.bool('TRUE', false), true, 'case-insensitive');
	eq(schema.bool(' 0 ', true), false, 'trimmed');
	eq(schema.bool(null, true), true, 'default');
	eq(schema.to_int('-5', 0, 0, 10), 0, 'below min');
	eq(schema.to_int('7', 0, 0, 10), 7, 'in range');
	eq(schema.to_int('7.5', 0), 0, 'not whole');
	ok(schema.valid_port('65535'), 'max port');
	ok(!schema.valid_port('0'), 'port 0');
	ok(!schema.valid_port('65536'), 'port 65536');
	ok(!schema.valid_port('12a'), 'letters');
	ok(!schema.valid_port(null), 'null');
});

test('addresses', () => {
	ok(schema.ipv4('10.0.0.1') && !schema.ipv4('10.0.0.256') && !schema.ipv4(null), 'ipv4');
	eq(schema.ipv6_groups('::1'), [ 0, 0, 0, 0, 0, 0, 0, 1 ], 'loopback');
	eq(schema.ipv6_groups('2001:db8::1'), [ 0x2001, 0xdb8, 0, 0, 0, 0, 0, 1 ], 'compressed');
	eq(schema.ipv6_groups('::ffff:192.0.2.1'), [ 0, 0, 0, 0, 0, 0xffff, 0xc000, 0x0201 ], 'embedded IPv4');
	eq(schema.ipv6_groups('1:2:3:4:5:6:7:8'), [ 1, 2, 3, 4, 5, 6, 7, 8 ], 'full');
	eq(schema.ipv6_groups('1:2:3:4:5:6:7:8:9'), null, 'nine groups');
	eq(schema.ipv6_groups('1:2:3:4:5:6:7'), null, 'seven groups, no gap');
	eq(schema.ipv6_groups('1::2::3'), null, 'two gaps');
	eq(schema.ipv6_groups('fe80::1%eth0'), null, 'zone id');
	eq(schema.ipv6_groups('12345::'), null, 'group too long');
	ok(schema.ip('10.0.0.1') && schema.ip('fe80::1') && !schema.ip('nope'), 'ip');
});
