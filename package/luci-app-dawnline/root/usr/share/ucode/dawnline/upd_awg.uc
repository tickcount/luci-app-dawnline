// Dawnline updater: AmneziaWG — the builds published for this firmware by
// each source, installing or switching a build (verified against GitHub's
// sha256), the Russian LuCI translation, and rolling back to a kept build.
// Every install and rollback is recorded (dawnline.awg_builds), with whether
// the new kernel module runs or waits for the next boot.
// ctx is the updater's job context (see usr/libexec/dawnline/updater).

import { stat } from 'fs';
import { cursor } from 'uci';
import { iface_intent } from 'dawnline.util';
import * as upd from 'dawnline.updates';
import * as gh from 'dawnline.github';
import * as pkg from 'dawnline.pkg';
import * as builds from 'dawnline.awg_builds';
import { _, N_ } from 'dawnline.i18n';

function sh(cmd) {
	return system(`${cmd} >/dev/null 2>&1`);
}

/**
 * Download one package of a build to dir, verified when GitHub publishes its
 * sha256 (then mirrors may serve it); without a sha256 only github.com itself.
 * Returns the path or null.
 */
function fetch(ctx, fw, name, src, dir) {
	let file = builds.asset(fw, name);
	let dest = `${dir}/${src}_${file}`;
	let want = gh.asset_sha256(builds.SOURCES[src].repo, fw.tag, file);
	let url = `https://github.com/${builds.SOURCES[src].repo}/releases/download/${fw.tag}/${file}`;
	return gh.download(url, dest, { sha256: want, mirrors: ctx.pol.mirrors, log: ctx.log }) ? dest : null;
}

/** The newest tag of the same OpenWrt series (24.10.x) in a repository, if newer than ours. */
function newer_series_tag(rp, tag) {
	let series = match(tag, /^v([0-9]+\.[0-9]+)\./)?.[1];
	let best = null;
	try {
		for (let x in gh.releases(rp, 1)) {
			let t = x.tag;
			if (series && match(t, regexp(`^v${replace(series, '.', '\\.')}\\.`)) && pkg.cmp(substr(t, 1), substr(tag, 1)) > 0 &&
				(!best || pkg.cmp(substr(t, 1), substr(best, 1)) > 0))
				best = t;
		}
	}
	catch (e) {}
	return best;
}

export function check(ctx) {
	let installed = builds.installed();
	let ru = pkg.version(builds.RU) != null;
	let cur = installed['amneziawg-tools'];
	let fw = builds.firmware();
	if (!fw)
		return { installed: cur, gen: builds.gen(cur), packages: installed, current: null, ru, sources: {}, update: false, status: '',
			note: _('Cannot detect the firmware target') };
	if (fw.snapshot)
		return { installed: cur, gen: builds.gen(cur), packages: installed, current: null, ru, sources: {}, update: false, status: '',
			note: _('This is a SNAPSHOT firmware: the AmneziaWG projects publish builds for releases only') };
	let dir = `${ctx.work}/check`;
	system(`mkdir -p '${dir}'`);
	let sources = {};
	for (let id in builds.ORDER) {
		let src = builds.SOURCES[id];
		ctx.log(sprintf(_('Looking for the %s build for OpenWrt %s'), src.label, substr(fw.tag, 1)));
		let f = fetch(ctx, fw, 'amneziawg-tools', id, dir);
		let v = f ? pkg.file_version(f) : null;
		let date = null;
		try {
			date = f ? gh.release(src.repo, fw.tag)?.published : null;
		}
		catch (e) {}
		let s = { label: src.label, repo: src.repo, tag: fw.tag, version: v, gen: builds.gen(v), date };
		// A newer firmware may already get 3.1 from this source.
		if (s.gen != '3.1') {
			let nt = newer_series_tag(src.repo, fw.tag);
			if (nt) {
				let nf = fetch(ctx, builds.for_tag(fw, nt), 'amneziawg-tools', id, dir);
				if (builds.gen(nf ? pkg.file_version(nf) : null) == '3.1')
					s.newer = { tag: nt, gen: '3.1' };
			}
		}
		sources[id] = s;
	}
	// The installed build: the source whose package matches. Unknown stays unknown
	// (an automatic update never switches a build it could not identify).
	let current = null;
	for (let id, x in sources)
		if (!current && cur && x.version == cur)
			current = id;
	let mine = current ? sources[current] : null;
	let c = cur && mine?.version ? pkg.cmp(cur, mine.version) : null;
	// An update that waits for a reboot: Components says so after a check.
	let pending = builds.waits_for_reboot();
	let st = c == null ? '' : c < 0 ? 'outdated' : c > 0 ? 'dev' : 'latest';
	ctx.log(cur == null ? _('AmneziaWG is not installed')
		: !current ? sprintf(_('AmneziaWG %s: no source publishes this build for this firmware any more'), cur)
		: st == 'outdated' ? sprintf(_('AmneziaWG update is available: %s → %s'), cur, mine.version)
		: sprintf(_('AmneziaWG is up to date (%s)'), cur));
	return { installed: cur, gen: builds.gen(cur), packages: installed, current, ru, release: fw.tag, sources,
		latest: mine?.version ?? null, status: st,
		update: cur == null || st == 'outdated',
		// An update that changes the generation (2.0 → 3.1) breaks older apps: never automatic.
		gen_change: cur != null && mine?.version != null && builds.gen(cur) != builds.gen(mine.version),
		pending,
		note: !length(filter(values(sources), (x) => x.version)) ? sprintf(_('No AmneziaWG build for OpenWrt %s yet'), substr(fw.tag, 1))
			: pending ? _('The AmneziaWG update is installed and starts after a reboot.') : null };
};

/**
 * Tunnels on a new kernel module: every AmneziaWG interface is brought down,
 * the module swapped and the interfaces brought up again. False when the old
 * module stays loaded: the tunnels come back on it (the tools talk to an
 * older module at its own netlink version) and the installed one starts
 * with the next boot, which caps() and Health then wait for.
 */
function reload_module(ctx) {
	let ifaces = [];
	let c = cursor();
	c.load('network');
	c.foreach('network', 'interface', (s) => {
		if (s.proto == 'amneziawg' && s.disabled != '1')
			push(ifaces, s['.name']);
	});
	let n = length(ifaces);
	ctx.phase(sprintf(N_(n, 'Reloading the kernel module (%d tunnel restarts)', 'Reloading the kernel module (%d tunnels restart)'), n));
	for (let i in ifaces) {
		iface_intent(i, 'update', c.get('network', i, '_dawnline_name') ?? i);
		sh(`ifdown '${i}'`);
	}
	if (stat('/sys/module/amneziawg'))
		ctx.run('rmmod amneziawg');
	let swapped = !stat('/sys/module/amneziawg');
	if (swapped) {
		ctx.run('modprobe amneziawg');
		if (!stat('/sys/module/amneziawg'))
			die(_("The new AmneziaWG kernel module doesn't load on this firmware: the tunnels stay down until it does (see the log above)"));
	}
	for (let i in ifaces)
		sh(`ifup '${i}'`);
	return swapped;
}

/**
 * After packages changed: the module loaded, netifd knowing the protocol,
 * Dawnline set up again. was: the module loaded before (builds.module_now()).
 * Returns whether the module that runs is the installed one; false while the
 * old one stays loaded until the next boot.
 */
function settle(ctx, before, after, was) {
	let b = before['kmod-amneziawg'], a = after['kmod-amneziawg'];
	let fresh = true;
	// A new module package, one over a module loaded by hand, or an earlier
	// update that still waits for a boot (Reinstall tries again).
	if (a && (a != b || was.pending) && (b || was.core != null))
		fresh = reload_module(ctx);
	else if (a && !b) {
		ctx.phase(_('Loading the kernel module'));
		if (ctx.run('modprobe amneziawg').code != 0 && !stat('/sys/module/amneziawg'))
			die(_("AmneziaWG is installed, but its kernel module doesn't load on this firmware"));
	}
	// netifd reads its protocol handlers when it starts.
	if (index(ctx.run('ubus call network get_proto_handlers').out, '"amneziawg"') < 0) {
		ctx.phase(_('Restarting the network so it knows AmneziaWG (connections drop for a few seconds)'));
		ctx.run('/etc/init.d/network restart');
	}
	ctx.after('apply');
	return fresh;
}

/**
 * The packages are in: settle them and record the build (source, tag) with
 * the module that ran before (was). An old module that stays loaded is no
 * failure: the job says so, and Health until the next boot.
 */
function finish(ctx, out, source, tag, was) {
	out.after = builds.installed();
	out.reloaded = settle(ctx, out.before, out.after, was);
	builds.record(source, tag, out.after, { prev_gen: was.gen, prev_core: was.core, reloaded: out.reloaded });
	if (!out.reloaded)
		ctx.log(_('The old kernel module stays loaded (another AmneziaWG interface may use it): the AmneziaWG update is installed and starts after a reboot.'));
	return out;
}

/** The first source that publishes every package for this firmware. */
function pick(fw) {
	for (let id in builds.ORDER) {
		let r = null;
		try {
			r = gh.release(builds.SOURCES[id].repo, fw.tag);
		}
		catch (e) {}
		if (r && length(filter(builds.PKGS, (p) => index(r.assets, builds.asset(fw, p)) >= 0)) == length(builds.PKGS))
			return id;
	}
	return null;
}

/** arg: [auto|slava|grey][:ru] | rollback */
export function install(ctx, arg) {
	let before = builds.installed();
	let was = builds.module_now(before['kmod-amneziawg']);
	let out = { from: before['amneziawg-tools'], to: null, before };
	let fw = builds.firmware();
	if (!fw)
		die(_('Cannot detect the firmware target'));
	if (arg == 'rollback') {
		let k = upd.kept('amneziawg');
		if (!k)
			die(_('No previous AmneziaWG build is kept on the router'));
		if (k.firmware && k.firmware != fw.postfix)
			die(_('The kept AmneziaWG build was made for another firmware: it would not load on this one'));
		out.to = k.version;
		out.build = k.build;
		ctx.versions(out.from, out.to);
		ctx.phase(sprintf(_('Rolling back to %s'), k.version));
		if (!pkg.install_files(k.files, true, ctx.log))
			die(_('Package installation failed'));
		upd.forget('amneziawg');
		return finish(ctx, out, k.build, fw.tag, was);
	}
	let parts = split(arg ?? '', ':');
	let id = parts[0] || 'auto';
	let want_ru = parts[1] == 'ru';
	if (id == 'auto') {
		id = pick(fw);
		if (!id)
			die(sprintf(_('No AmneziaWG build for OpenWrt %s (%s) yet'), substr(fw.tag, 1), fw.postfix));
	}
	let src = builds.SOURCES[id];
	if (!src)
		die(sprintf(_('Unknown AmneziaWG build %s'), id));
	out.build = id;
	let files = [];
	for (let p in [ ...builds.PKGS, ...(want_ru ? [ builds.RU ] : []) ]) {
		ctx.phase(sprintf(_('Downloading %s from %s'), p, src.repo));
		let f = fetch(ctx, fw, p, id, ctx.work);
		if (!f)
			die(sprintf(_('No %s build for OpenWrt %s in %s, or it could not be verified'), p, substr(fw.tag, 1), src.repo));
		push(files, f);
	}
	out.to = pkg.file_version(files[1]);
	ctx.versions(out.from, out.to);
	// The build being replaced, for Roll back: from another source that still publishes it.
	if (ctx.pol.keep && out.from && out.to != out.from) {
		let dir = `${ctx.work}/keep`;
		system(`mkdir -p '${dir}'`);
		let kept = null;
		for (let sid in builds.ORDER) {
			if (sid == id || kept)
				continue;
			let f = fetch(ctx, fw, 'amneziawg-tools', sid, dir);
			if (f && pkg.file_version(f) == out.from)
				kept = sid;
		}
		if (kept) {
			ctx.phase(sprintf(_('Keeping AmneziaWG %s for rollback'), out.from));
			let keepf = filter(map(builds.PKGS, (p) => fetch(ctx, fw, p, kept, dir)), (x) => x);
			if (length(keepf) == length(builds.PKGS))
				upd.keep('amneziawg', out.from, keepf, kept, fw.postfix);
		}
		else
			ctx.log(_('Warning: the installed build is no longer published, nothing to keep for rollback'));
	}
	ctx.phase(_('Refreshing package lists'));
	pkg.refresh(ctx.log);
	ctx.phase(sprintf(_('Installing the %s build'), src.label));
	if (!pkg.install_files(files, true, ctx.log))
		die(_('Package installation failed'));
	if (!want_ru && pkg.version(builds.RU))
		pkg.remove([ builds.RU ], ctx.log);
	return finish(ctx, out, id, fw.tag, was);
};
