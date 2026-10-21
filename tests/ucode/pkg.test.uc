// dawnline.pkg: the package a control text or file names (ipk control,
// `apk adbdump`), and when an apk install of package files took: every
// package at its file's version, a rollback to an older one included.
import * as pkg from 'dawnline.pkg';

const DIR = '/tmp/dawnline-tests/pkg';

// AmneziaWG 3.1 as the Components tab installs it, and the 2.0 build before it.
const NEW = [
	{ name: 'kmod-amneziawg', version: '6.12.94.3.1.20260906-r1', file: '/tmp/x/kmod.apk' },
	{ name: 'amneziawg-tools', version: '3.1.20260812-r1', file: '/tmp/x/tools.apk' },
	{ name: 'luci-proto-amneziawg', version: '3.1.0-r1', file: '/tmp/x/proto.apk' },
];
const OLD = { 'kmod-amneziawg': '6.12.94.1.0.20250722-r1', 'amneziawg-tools': '1.0.20250722-r1', 'luci-proto-amneziawg': '2.0.0-r1' };

function at(list) {
	let have = {};
	for (let w in list)
		have[w.name] = w.version;
	return have;
}

test('control_info of an ipk control file', () => {
	eq(pkg.control_info('Package: amneziawg-tools\nVersion: 1.0.20250722-r1\nDepends: libc\nArchitecture: aarch64_cortex-a53\n', true),
		{ name: 'amneziawg-tools', version: '1.0.20250722-r1' }, 'fields');
	eq(pkg.control_info('Description: no package here\n', true), { name: null, version: null }, 'nothing said');
});

test('control_info of apk adbdump', () => {
	let dump = '#%SCHEMA: 00504B47\ninfo:\n  name: kmod-amneziawg\n  version: 6.12.94.3.1.20260906-r1\n' +
		'  description: AmneziaWG kernel module\n  arch: aarch64_cortex-a53\n  depends: # 2 items\n    - kernel=6.12.94\n' +
		'    - kmod-udptunnel4\npaths: # 2 items\n  - name: lib/modules\n  - name: lib/modules/6.12.94\n    files: # 1 items\n' +
		'      - name: amneziawg.ko\n';
	eq(pkg.control_info(dump, false), { name: 'kmod-amneziawg', version: '6.12.94.3.1.20260906-r1' }, 'the package, not its files');
	eq(pkg.control_info('', false), { name: null, version: null }, 'adbdump failed');
	eq(pkg.control_info(null, false), { name: null, version: null }, 'no output');
});

test('file_info of an ipk', () => {
	system(`rm -rf ${DIR} && mkdir -p ${DIR}`);
	ok(system(`cd ${DIR} && printf 'Package: luci-proto-amneziawg\\nVersion: 2.0.0-r1\\n' > control && tar -czf control.tar.gz ./control && tar -czf proto.ipk ./control.tar.gz`) == 0,
		'made the ipk');
	eq(pkg.file_info(`${DIR}/proto.ipk`), { name: 'luci-proto-amneziawg', version: '2.0.0-r1' }, 'name and version');
	eq(pkg.file_version(`${DIR}/proto.ipk`), '2.0.0-r1', 'file_version');
});

test('mismatched: an update took', () => {
	eq(pkg.mismatched(NEW, at(NEW)), [], 'every package at its file');
});

test('mismatched: a rollback to an older build took', () => {
	let back = map(keys(OLD), (n) => ({ name: n, version: OLD[n], file: `/tmp/x/${n}.apk` }));
	eq(pkg.mismatched(back, OLD), [], 'older versions are what the files hold');
});

test('mismatched: apk left a package alone', () => {
	let have = { ...at(NEW), 'amneziawg-tools': OLD['amneziawg-tools'] };
	eq(pkg.mismatched(NEW, have), [ NEW[1] ], 'the tools kept their old version');
	eq(pkg.mismatched(NEW, OLD), NEW, 'nothing changed');
});

test('mismatched: missing or unreadable', () => {
	let have = at(NEW);
	delete have['luci-proto-amneziawg'];
	eq(pkg.mismatched(NEW, have), [ NEW[2] ], 'not installed after the install');
	let blind = [ { name: null, version: null, file: '/tmp/x/broken.apk' } ];
	eq(pkg.mismatched(blind, {}), blind, 'a file that names no package never counts as installed');
	eq(pkg.mismatched([ { name: 'amneziawg-tools', version: null, file: '/tmp/x/t.apk' } ], { 'amneziawg-tools': null }),
		[ { name: 'amneziawg-tools', version: null, file: '/tmp/x/t.apk' } ], 'no version on either side');
	eq(pkg.mismatched(NEW, null), NEW, 'no installed versions');
});
