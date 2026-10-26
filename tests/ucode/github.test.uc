// dawnline.github: which URLs are a release's files (those can come through
// the API instead of github.com's redirect) and the points of a commit message.
import * as gh from 'dawnline.github';

test('release_file', () => {
	eq(gh.release_file('https://github.com/tickcount/luci-app-dawnline/releases/download/v0.16.0/sha256sums.txt'),
		{ repo: 'tickcount/luci-app-dawnline', tag: 'v0.16.0', name: 'sha256sums.txt' }, 'a Dawnline release file');
	eq(gh.release_file('https://github.com/Slava-Shchipunov/awg-openwrt/releases/download/v24.10.4/kmod-amneziawg_v24.10.4_aarch64_cortex-a53_mediatek_filogic.ipk'),
		{ repo: 'Slava-Shchipunov/awg-openwrt', tag: 'v24.10.4', name: 'kmod-amneziawg_v24.10.4_aarch64_cortex-a53_mediatek_filogic.ipk' },
		'an AmneziaWG build');
	eq(gh.release_file('https://ghfast.top/https://github.com/tickcount/luci-app-dawnline/releases/download/v0.16.0/a.ipk'), null, 'a mirror');
	eq(gh.release_file('https://raw.githubusercontent.com/tickcount/luci-app-dawnline/main/install.sh'), null, 'not a release file');
	eq(gh.release_file('https://github.com/tickcount/luci-app-dawnline/releases/latest'), null, 'the latest redirect');
	eq(gh.release_file('https://github.com/a/b/releases/download/v1/x.ipk?raw=1'), null, 'a query');
	eq(gh.release_file('https://github.com/a/b/releases/download/v1/sub/x.ipk'), null, 'a deeper path');
	eq(gh.release_file(null), null, 'nothing');
});

test('points', () => {
	eq(gh.points('Dawnline 0.16.0\n\n- Check no longer times out\n- Downloads without curl\n  go through the API'),
		[ 'Check no longer times out', 'Downloads without curl go through the API' ], 'a release commit, a wrapped point');
	eq(gh.points('Fix the portal'), [ 'Fix the portal' ], 'another commit: its title');
	eq(gh.points('Dawnline 0.16.0'), [], 'a bare release title');
	eq(gh.points('Merge branch x\n\n- y'), [], 'a merge');
});
