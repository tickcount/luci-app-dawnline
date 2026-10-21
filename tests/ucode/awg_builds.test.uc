// dawnline.awg_builds: the AmneziaWG generation of package and kernel module
// versions, whether an installed update waits for a reboot (its old module
// stayed loaded) and the generation that really runs meanwhile, which is
// what caps() reports.
import * as builds from 'dawnline.awg_builds';
import * as awg from 'dawnline.awg';

// The live router's module (3.1) after an update from a 2.0 one that could not be swapped.
const KMOD_31 = '6.12.94.3.1.20260906-r1';
const WAITING = { reloaded: false, boot: 'boot-1', prev_gen: '2.0', prev_core: 98304 };

test('gen of package versions', () => {
	eq(builds.gen(null), null, 'not installed');
	eq(builds.gen('3.1.20260812-r1'), '3.1', 'amneziawg-tools 3.1');
	eq(builds.gen('3.1.0-r1'), '3.1', 'luci-proto-amneziawg 3.1');
	eq(builds.gen('1.0.20250722-r1'), '2.0', 'July 2025 on: 2.0');
	eq(builds.gen('1.0.20250901'), '2.0', 'no release suffix');
	eq(builds.gen('1.0.20250610-r1'), '1.0', 'before July 2025');
	eq(builds.gen('1.0.20241112-r2'), '1.0', '2024');
});

test('gen of kernel module versions', () => {
	eq(builds.gen(KMOD_31), '3.1', 'kernel release in front');
	eq(builds.gen('6.12.94.3.1.20260906'), '3.1', 'no release suffix');
	eq(builds.gen('6.6.73.1.0.20250722-r1'), '2.0', '2.0 module');
	eq(builds.gen('6.6.73.1.0.20250612-r1'), '1.0', 'first generation module');
	eq(builds.gen('5.15.150.1.0.20240711-r3'), '1.0', '2024 module on an older kernel');
	eq(builds.gen('3.1.20260812'), '3.1', 'the version.h string of a 3.1 module');
});

test('pending: an update waits for a reboot', () => {
	ok(builds.pending(WAITING, 'boot-1', 98304), 'the old module still loaded, same boot');
	ok(!builds.pending(WAITING, 'boot-2', 98304), 'rebooted');
	ok(!builds.pending(WAITING, 'boot-1', null), 'no module loaded: the next one is the new one');
	ok(!builds.pending(WAITING, 'boot-1', 110592), 'another module loaded (reloaded by hand)');
	ok(!builds.pending({ ...WAITING, reloaded: true }, 'boot-1', 98304), 'the install swapped it');
	ok(!builds.pending({ ...WAITING, reloaded: null }, 'boot-1', 98304), 'a record of a module Dawnline did not install');
	ok(!builds.pending({ osrelease: '6.12.94', source: 'slava', tag: 'v25.12.5', installed: 1 }, 'boot-1', 98304),
		'a record from before boots were kept');
	ok(!builds.pending({ ...WAITING, boot: null }, null, 98304), 'the kernel gave no boot id');
	ok(!builds.pending(null, 'boot-1', 98304), 'no record');
});

test('caps: the generation that runs while a reboot is pending', () => {
	eq(builds.running_gen(WAITING, 'boot-1', 98304, KMOD_31), '2.0', 'the 2.0 module runs, not the 3.1 package');
	eq(builds.running_gen(WAITING, 'boot-2', 98304, KMOD_31), '3.1', 'after the reboot: the package');
	eq(builds.running_gen(WAITING, 'boot-1', null, KMOD_31), '3.1', 'nothing loaded: the package loads');
	eq(builds.running_gen(null, 'boot-1', 98304, KMOD_31), '3.1', 'no record: the package');
	eq(builds.running_gen({ ...WAITING, prev_gen: null }, 'boot-1', 98304, KMOD_31), null,
		'a module installed by hand before: unknown, the tools are believed');
	eq(builds.running_gen(null, null, null, null), null, 'nothing installed');
});

test('caps in a container without AmneziaWG', () => {
	let c = awg.caps();
	eq(c.kmod, null, 'no module package');
	eq(c.pending, false, 'nothing waits for a reboot');
	eq(builds.module_core(), null, 'no module loaded');
});
