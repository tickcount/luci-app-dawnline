// Dawnline — where AmneziaWG comes from: the awg-openwrt projects publish
// builds per OpenWrt release and target (the kernel module must match the
// firmware). Used by the updater and the Components RPCs.

import { readfile } from 'fs';
import { connect } from 'ubus';
import * as pkg from 'dawnline.pkg';

export const SOURCES = {
	slava: { repo: 'Slava-Shchipunov/awg-openwrt', label: 'Slava-Shchipunov' },
	grey: { repo: '2Grey/awg-openwrt', label: '2Grey' },
};
/** Tried in this order when no build is chosen. */
export const ORDER = [ 'slava', 'grey' ];
export const PKGS = [ 'kmod-amneziawg', 'amneziawg-tools', 'luci-proto-amneziawg' ];
export const RU = 'luci-i18n-amneziawg-ru';

/**
 * This firmware as the builds name it: { tag: 'v24.10.6', postfix:
 * '_v24.10.6_aarch64_cortex-a53_mediatek_filogic', ext }, or null.
 */
export function firmware() {
	let u = connect();
	let b = u?.call('system', 'board') ?? {};
	u?.disconnect();
	let rel = b.release ?? {};
	let target = split(rel.target ?? '', '/');
	let arch = rel.arch ?? match(readfile('/etc/openwrt_release') ?? '', /DISTRIB_ARCH='([^']*)'/)?.[1];
	if (!rel.version || length(target) != 2 || !arch)
		return null;
	return { tag: `v${rel.version}`, postfix: `_v${rel.version}_${arch}_${target[0]}_${target[1]}`, ext: pkg.ext() };
};

/** The file name of a package in a build. */
export function asset(fw, name) {
	return `${name}${fw.postfix}.${fw.ext}`;
};

/** The same firmware, another release of its series (v24.10.6 → v24.10.8). */
export function for_tag(fw, tag) {
	return { ...fw, tag, postfix: replace(fw.postfix, fw.tag, tag) };
};

/** AmneziaWG generation of a tools version: 3.x packages carry 3.1, older ones (1.0.x) 2.0. */
export function gen(version) {
	return version == null ? null : match(version, /^3\./) ? '3.1' : '2.0';
};

/** The installed AmneziaWG packages: { name: version | null }. */
export function installed() {
	let r = {};
	for (let p in PKGS)
		r[p] = pkg.version(p);
	return r;
};
