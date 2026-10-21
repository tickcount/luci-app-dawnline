// Dawnline — where AmneziaWG comes from: the awg-openwrt projects publish
// builds per OpenWrt release and target (the kernel module must match the
// firmware), and the record of what was installed on which kernel and boot
// (an update whose module could not be swapped starts with the next boot:
// until then caps() and Health go by the module that still runs). Used by
// the updater, the Components RPCs, dawnline.awg and Health. Installing
// itself is dawnline.upd_awg.

import { readfile, stat } from 'fs';
import { connect } from 'ubus';
import { ensure_dir, read_json, write_json, DATA_DIR } from 'dawnline.util';
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
	return { tag: `v${rel.version}`, postfix: `_v${rel.version}_${arch}_${target[0]}_${target[1]}`, ext: pkg.ext(),
		snapshot: match(rel.version, /SNAPSHOT/) != null };
};

/** What was installed, for whom: /etc/dawnline/awg.json (survives a sysupgrade with the data). */
export const RECORD = `${DATA_DIR}/awg.json`;

/** This boot (a new one loads the module on disk), or null when the kernel does not say. */
export function boot_id() {
	return trim(readfile('/proc/sys/kernel/random/boot_id') ?? '') || null;
};

/**
 * The size in memory of the loaded kernel module, or null when none is
 * loaded. sysfs has no version for it, but builds differ in size: a module
 * reloaded by hand ends a wait for a reboot (pending()).
 */
export function module_core() {
	let n = int(trim(readfile('/sys/module/amneziawg/coresize') ?? ''));
	return n > 0 ? n : null;
};

/**
 * Remember which build was installed on which kernel. After a firmware
 * upgrade the module is gone (it was built for that kernel): Health can then
 * say so and offer the build for the new one (dawnline.health). `run` comes
 * from an install: prev_gen and prev_core, the module that ran before it
 * (module_now()), and reloaded, false while that one stays loaded until the
 * next boot. null for a module Dawnline did not install (adopt()).
 */
export function record(source, tag, packages, run) {
	ensure_dir(DATA_DIR, 0o700);
	write_json(RECORD, {
		osrelease: trim(readfile('/proc/sys/kernel/osrelease') ?? ''),
		source, tag, packages, installed: time(), boot: boot_id(),
		prev_gen: run?.prev_gen ?? null, prev_core: run?.prev_core ?? null, reloaded: run?.reloaded ?? null,
	}, 0o600);
};

/**
 * A record for a module Dawnline did not install (install.sh, by hand, or
 * before Dawnline kept records), so kernel_changed() notices the next
 * firmware upgrade: the kernel it is for, source null, `installed` the time
 * Dawnline first saw it. Only when there is no record and the module is
 * loaded or on disk for the running kernel. The agent calls it when it starts.
 */
export function adopt() {
	let rel = trim(readfile('/proc/sys/kernel/osrelease') ?? '');
	if (stat(RECORD) || (!stat('/sys/module/amneziawg') && (rel == '' || !stat(`/lib/modules/${rel}/amneziawg.ko`))))
		return;
	record(null, null, null, null);
};

/**
 * The firmware the recorded AmneziaWG build was for, when it is not this one
 * (and the module is gone): { was, now, tag, source }, else null.
 */
export function kernel_changed() {
	let r = read_json(RECORD, null);
	let now = trim(readfile('/proc/sys/kernel/osrelease') ?? '');
	if (!r?.osrelease || r.osrelease == now)
		return null;
	return { was: r.osrelease, now, tag: r.tag, source: r.source };
};

/** The file name of a package in a build. */
export function asset(fw, name) {
	return `${name}${fw.postfix}.${fw.ext}`;
};

/** The same firmware, another release of its series (v24.10.6 → v24.10.8). */
export function for_tag(fw, tag) {
	return { ...fw, tag, postfix: replace(fw.postfix, fw.tag, tag) };
};

/**
 * AmneziaWG generation of a package version: 3.x packages carry 3.1; 1.0.x
 * ones are 2.0 (S3/S4, I1-I5, header ranges) from July 2025 on, and the
 * first generation before that. A kernel module's version carries the kernel
 * release in front (6.12.94.3.1.20260906): the AmneziaWG part is at the end.
 */
export function gen(version) {
	if (version == null)
		return null;
	let v = match(`${version}`, /([0-9]+\.[0-9]+\.[0-9]{8})(-r?[0-9]+)?$/)?.[1] ?? `${version}`;
	if (match(v, /^3\./))
		return '3.1';
	if (match(v, /^1\.0\.2024/) || match(v, /^1\.0\.20250[1-6]/))
		return '1.0';
	return '2.0';
};

/**
 * An installed update that waits for a reboot: the install could not swap
 * the kernel module (the old one stayed loaded), this is still the boot it
 * ran in, and the module loaded is still the one from before it (core:
 * module_core() now). Pure: rec is the record or null.
 */
export function pending(rec, boot, core) {
	return rec?.reloaded === false && rec.boot != null && rec.boot == boot && core != null && rec.prev_core == core;
};

/**
 * The AmneziaWG generation of the kernel module that runs: the one from
 * before the install while it waits for a reboot (pending(); null when that
 * module had no package), else the installed package's version (gen()).
 * Pure, with the record, this boot and module_core() passed in.
 */
export function running_gen(rec, boot, core, version) {
	return pending(rec, boot, core) ? rec.prev_gen : gen(version);
};

/**
 * The kernel module loaded now, taken before an install changes packages:
 * { core, gen, pending }. core is null when none is loaded; gen is what it
 * runs (running_gen(), from `version`, the kmod-amneziawg package installed
 * now); pending, an earlier update that still waits for a reboot.
 */
export function module_now(version) {
	let rec = read_json(RECORD, null), boot = boot_id(), core = module_core();
	return { core, gen: core == null ? null : running_gen(rec, boot, core, version), pending: pending(rec, boot, core) };
};

/** The installed AmneziaWG update waits for a reboot (pending(), for Health and Components). */
export function waits_for_reboot() {
	return pending(read_json(RECORD, null), boot_id(), module_core());
};

/** The installed AmneziaWG packages: { name: version | null }. */
export function installed() {
	let r = {};
	for (let p in PKGS)
		r[p] = pkg.version(p);
	return r;
};
