// dawnline.geo: which addresses need a lookup, how results go into the cache
// (bounded, never pushing out what is still shown) and the activity-log label.
import * as geo from 'dawnline.geo';

const NOW = 1790000000;
const PLACE = { lat: 45.04, lon: 38.98, city: 'Krasnodar', country: 'Russia', cc: 'RU', asn: 12389, org: 'Rostelecom' };

test('stale', () => {
	let cache = { ips: {
		'37.78.36.76': { ...PLACE, ts: NOW - 86400 },
		'212.233.85.1': { ...PLACE, ts: NOW - 31 * 86400 },
		'185.135.150.35': { fail: NOW - 3600 },
		'185.135.150.28': { fail: NOW - 2 * 86400 },
		'83.239.111.148': { lat: 1, lon: 2, city: 'Old', ts: NOW },
	}, home: null };
	eq(geo.stale(cache, [ '37.78.36.76' ], NOW), [], 'fresh: known');
	eq(geo.stale(cache, [ '212.233.85.1' ], NOW), [ '212.233.85.1' ], 'older than the TTL');
	eq(geo.stale(cache, [ '185.135.150.35' ], NOW), [], 'failed today: not again yet');
	eq(geo.stale(cache, [ '185.135.150.28' ], NOW), [ '185.135.150.28' ], 'failed two days ago: retried');
	eq(geo.stale(cache, [ '83.239.111.148' ], NOW), [ '83.239.111.148' ], 'an entry from before ASNs were kept');
	eq(geo.stale(cache, [ '10.0.1.164', '100.64.1.1', '', null, 'fe80::1' ], NOW), [], 'local addresses never');
	eq(geo.stale(cache, [ '1.1.1.1', '8.8.8.8', '1.1.1.1' ], NOW), [ '1.1.1.1', '8.8.8.8' ], 'once each, in order');
});

test('merge', () => {
	let cache = { ips: {}, home: null };
	ok(geo.merge(cache, { '1.1.1.1': { ...PLACE }, '8.8.8.8': false }, [], NOW), 'changed');
	eq(cache.ips['1.1.1.1'], { ...PLACE, ts: NOW }, 'a place, stamped');
	eq(cache.ips['8.8.8.8'], { fail: NOW }, 'nothing found: a failure, retried later');
	ok(!geo.merge(cache, {}, [], NOW), 'no results: unchanged');
	ok(!geo.merge(cache, { '10.0.0.1': PLACE }, [], NOW) && !cache.ips['10.0.0.1'], 'a local address is not kept');
	eq(geo.place(cache, '1.1.1.1')?.city, 'Krasnodar', 'place');
	eq(geo.place(cache, '8.8.8.8'), null, 'no place for a failure');
});

test('merge keeps the cache bounded, what is shown stays', () => {
	let cache = { ips: {}, home: null };
	for (let i = 0; i < 500; i++)
		cache.ips[`1.0.${int(i / 250)}.${i % 250 + 1}`] = { ...PLACE, ts: NOW - 1000 + i };
	let oldest = '1.0.0.1', second = '1.0.0.2';
	ok(geo.merge(cache, { '9.9.9.9': PLACE }, [ oldest ], NOW), 'changed');
	eq(length(keys(cache.ips)), 500, 'back to the cap');
	ok(cache.ips[oldest] != null, 'the oldest is still shown: kept');
	ok(cache.ips[second] == null, 'the oldest not shown went');
	ok(cache.ips['9.9.9.9'] != null, 'the new one is in');
});

test('label', () => {
	eq(geo.label(PLACE), 'Krasnodar · Rostelecom', 'city and ISP');
	eq(geo.label({ city: '', org: 'Rostelecom' }), 'Rostelecom', 'no city');
	eq(geo.label(null), null, 'no place');
});
