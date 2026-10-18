// dawnline.updates: the update policy from raw settings, what is due at a
// given time, and release version ordering.
import * as updates from 'dawnline.updates';

function at(y, mo, d, h, mi) {
	return timelocal({ year: y, mon: mo, mday: d, hour: h, min: mi, sec: 0 });
}

test('policy defaults', () => {
	eq(updates.policy(null), { check: true, interval: '1d', auto: true, mode: 'scheduled', time: '04:00',
		targets: [ 'app', 'packages' ], keep: false, mirrors: true }, 'no settings');
	eq(updates.policy({}), updates.policy(null), 'empty settings');
});

test('policy values', () => {
	let p = updates.policy({ update_check: '0', update_interval: '7d', update_auto: 'no', update_mode: 'immediate',
		update_time: '23:59', update_targets: 'amneziawg', update_keep: '1', update_mirrors: 'off' });
	eq(p, { check: false, interval: '7d', auto: false, mode: 'immediate', time: '23:59', targets: [ 'amneziawg' ], keep: true, mirrors: false }, 'all set');
	eq(updates.policy({ update_interval: '2d' }).interval, '1d', 'unknown interval');
	eq(updates.policy({ update_time: '24:00' }).time, '04:00', 'bad time');
	eq(updates.policy({ update_time: '4:30' }).time, '4:30', 'unpadded time');
	eq(updates.policy({ update_mode: 'later' }).mode, 'scheduled', 'unknown mode');
	eq(updates.policy({ update_targets: [ 'packages', 'bogus', 'app' ] }).targets, [ 'packages', 'app' ], 'unknown targets dropped');
	eq(updates.policy({ update_targets: [ 'none' ] }).targets, [], '"none" is no target');
	eq(updates.policy({ update_targets: [] }).targets, [], 'empty list');
});

test('due', () => {
	let pol = updates.policy({ update_time: '04:00' });
	let t = at(2026, 3, 10, 4, 30);
	eq(updates.due(pol, {}, t), 'install', 'in the window, never run');
	eq(updates.due(pol, { install_day: '2026-03-10' }, t), 'check', 'window spent, check is due');
	eq(updates.due(pol, { install_day: '2026-03-10', check: t - 3600 }, t), null, 'checked an hour ago');
	eq(updates.due(pol, { check: t - 90000 }, at(2026, 3, 10, 12, 0)), 'check', 'outside the window, a day has passed');
	eq(updates.due(pol, {}, at(2026, 3, 10, 5, 30)), 'check', 'window over (an hour)');
	eq(updates.due(updates.policy({ update_auto: '0', update_check: '0' }), {}, t), null, 'everything off');
	eq(updates.due(updates.policy({ update_mode: 'immediate' }), {}, t), 'check', 'immediate mode has no window');
	eq(updates.due(updates.policy({ update_targets: [] }), {}, t), 'check', 'nothing to install');
	let late = updates.policy({ update_time: '23:30' });
	eq(updates.due(late, {}, at(2026, 3, 11, 0, 15)), 'install', 'window across midnight');
	eq(updates.mark_day(late, {}, at(2026, 3, 11, 0, 15)).install_day, '2026-03-10', 'mark_day records the slot\'s day');
});

test('version_cmp', () => {
	eq(updates.version_cmp('0.5.1', '0.5.1'), 0, 'equal');
	eq(updates.version_cmp('v0.5.1', '0.5.1'), 0, 'v prefix');
	eq(updates.version_cmp('0.5.1', '0.5.2'), -1, 'patch');
	eq(updates.version_cmp('0.10.0', '0.9.9'), 1, 'numbers, not strings');
	eq(updates.version_cmp('0.6', '0.6.0'), 0, 'missing part is zero');
	eq(updates.version_cmp('0.6.0-rc1', '0.6.0'), -1, 'pre-release before the release');
	eq(updates.version_cmp('0.6.0-rc2', '0.6.0-rc10'), -1, 'rc numbers as numbers');
	eq(updates.version_cmp('0.6.0-beta', '0.6.0-rc1'), -1, 'beta before rc');
	eq(updates.version_cmp('garbage', '0.1'), -1, 'unparsable is lowest');
});
