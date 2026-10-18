// Dawnline updater: AmneziaWG — the builds published for this firmware by
// each source, installing or switching a build (verified against GitHub's
// sha256), the Russian LuCI translation, and rolling back to a kept build.
// ctx is the updater's job context (see usr/libexec/dawnline/updater).

import { stat } from 'fs';
import { cursor } from 'uci';
import { iface_intent } from 'dawnline.util';
import * as upd from 'dawnline.updates';
import * as gh from 'dawnline.github';
import * as pkg from 'dawnline.pkg';
import * as builds from 'dawnline.awg_builds';

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
			note: 'Cannot detect the firmware target' };
	let dir = `${ctx.work}/check`;
	system(`mkdir -p '${dir}'`);
	let sources = {};
	for (let id in builds.ORDER) {
		let src = builds.SOURCES[id];
		ctx.log(`Looking for the ${src.label} build for OpenWrt ${substr(fw.tag, 1)}`);
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
	let st = c == null ? '' : c < 0 ? 'outdated' : c > 0 ? 'dev' : 'latest';
	ctx.log(cur == null ? 'AmneziaWG is not installed'
		: !current ? `AmneziaWG ${cur}: no source publishes this build for this firmware any more`
		: st == 'outdated' ? `AmneziaWG update is available: ${cur} → ${mine.version}`
		: `AmneziaWG is up to date (${cur})`);
	return { installed: cur, gen: builds.gen(cur), packages: installed, current, ru, release: fw.tag, sources,
		latest: mine?.version ?? null, status: st,
		update: cur == null || st == 'outdated',
		// An update that changes the generation (2.0 → 3.1) breaks older apps: never automatic.
		gen_change: cur != null && mine?.version != null && builds.gen(cur) != builds.gen(mine.version),
		note: !length(filter(values(sources), (x) => x.version)) ? `No AmneziaWG build for OpenWrt ${substr(fw.tag, 1)} yet` : null };
};

/** Tunnels on a new kernel module: every AmneziaWG interface is brought down and up again. */
function reload_module(ctx, before, after) {
	if (!before['kmod-amneziawg'] || before['kmod-amneziawg'] == after['kmod-amneziawg'])
		return;
	let ifaces = [];
	let c = cursor();
	c.load('network');
	c.foreach('network', 'interface', (s) => {
		if (s.proto == 'amneziawg' && s.disabled != '1')
			push(ifaces, s['.name']);
	});
	ctx.phase(`Reloading the kernel module (${length(ifaces)} tunnel(s) restart)`);
	for (let i in ifaces) {
		iface_intent(i, 'update', c.get('network', i, '_dawnline_name') ?? i);
		sh(`ifdown '${i}'`);
	}
	// Both steps must really happen: the new tools against the old module (or
	// no module at all) leave every tunnel down while the job says "done".
	ctx.run('rmmod amneziawg');
	if (stat('/sys/module/amneziawg'))
		die('The old AmneziaWG kernel module is still loaded (another AmneziaWG interface may use it): reboot the router to finish the update');
	ctx.run('modprobe amneziawg');
	if (!stat('/sys/module/amneziawg'))
		die("The new AmneziaWG kernel module doesn't load on this firmware: the tunnels stay down until it does (see the log above)");
	for (let i in ifaces)
		sh(`ifup '${i}'`);
}

/** After packages changed: the module loaded, netifd knowing the protocol, Dawnline set up again. */
function settle(ctx, before, after) {
	if (!before['kmod-amneziawg'] && after['kmod-amneziawg']) {
		ctx.phase('Loading the kernel module');
		if (ctx.run('modprobe amneziawg').code != 0 && !stat('/sys/module/amneziawg'))
			die("AmneziaWG is installed, but its kernel module doesn't load on this firmware");
	}
	else
		reload_module(ctx, before, after);
	// netifd reads its protocol handlers when it starts.
	if (index(ctx.run('ubus call network get_proto_handlers').out, '"amneziawg"') < 0) {
		ctx.phase('Restarting the network so it knows AmneziaWG (connections drop for a few seconds)');
		ctx.run('/etc/init.d/network restart');
	}
	ctx.after('apply');
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
	let out = { from: before['amneziawg-tools'], to: null, before };
	let fw = builds.firmware();
	if (!fw)
		die('Cannot detect the firmware target');
	if (arg == 'rollback') {
		let k = upd.kept('amneziawg');
		if (!k)
			die('No previous AmneziaWG build is kept on the router');
		if (k.firmware && k.firmware != fw.postfix)
			die('The kept AmneziaWG build was made for another firmware: it would not load on this one');
		out.to = k.version;
		out.build = k.build;
		ctx.versions(out.from, out.to);
		ctx.phase(`Rolling back to ${k.version}`);
		if (!pkg.install_files(k.files, true, ctx.log))
			die('Package installation failed');
		upd.forget('amneziawg');
		out.after = builds.installed();
		settle(ctx, before, out.after);
		return out;
	}
	let parts = split(arg ?? '', ':');
	let id = parts[0] || 'auto';
	let want_ru = parts[1] == 'ru';
	if (id == 'auto') {
		id = pick(fw);
		if (!id)
			die(`No AmneziaWG build for OpenWrt ${substr(fw.tag, 1)} (${fw.postfix}) yet`);
	}
	let src = builds.SOURCES[id];
	if (!src)
		die(`Unknown AmneziaWG build ${id}`);
	out.build = id;
	let files = [];
	for (let p in [ ...builds.PKGS, ...(want_ru ? [ builds.RU ] : []) ]) {
		ctx.phase(`Downloading ${p} from ${src.repo}`);
		let f = fetch(ctx, fw, p, id, ctx.work);
		if (!f)
			die(`No ${p} build for OpenWrt ${substr(fw.tag, 1)} in ${src.repo}, or it could not be verified`);
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
			ctx.phase(`Keeping AmneziaWG ${out.from} for rollback`);
			let keepf = filter(map(builds.PKGS, (p) => fetch(ctx, fw, p, kept, dir)), (x) => x);
			if (length(keepf) == length(builds.PKGS))
				upd.keep('amneziawg', out.from, keepf, kept, fw.postfix);
		}
		else
			ctx.log('Warning: the installed build is no longer published, nothing to keep for rollback');
	}
	ctx.phase('Refreshing package lists');
	pkg.refresh(ctx.log);
	ctx.phase(`Installing the ${src.label} build`);
	if (!pkg.install_files(files, true, ctx.log))
		die('Package installation failed');
	if (!want_ru && pkg.version(builds.RU))
		pkg.remove([ builds.RU ], ctx.log);
	out.after = builds.installed();
	settle(ctx, before, out.after);
	return out;
};
