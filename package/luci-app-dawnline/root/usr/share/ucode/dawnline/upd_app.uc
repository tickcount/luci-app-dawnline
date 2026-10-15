// Dawnline updater: Dawnline itself — check the latest release, install a
// release (latest, a tag, the same one again) or the kept previous version.
// ctx is the updater's job context (see usr/libexec/dawnline/updater).

import { readfile } from 'fs';
import { VERSION, REPO } from 'dawnline.util';
import * as upd from 'dawnline.updates';
import * as gh from 'dawnline.github';
import * as pkg from 'dawnline.pkg';

function status(installed, latest) {
	let c = upd.version_cmp(installed, latest);
	return c < 0 ? 'outdated' : c > 0 ? 'dev' : 'latest';
}

export function check(ctx) {
	let r = gh.latest(REPO);
	if (!r)
		return { installed: VERSION, latest: null, update: false, repo: REPO, status: '', note: `Cannot reach github.com/${REPO}` };
	let latest = replace(r.tag, /^v/, '');
	let st = status(VERSION, latest);
	ctx.log(st == 'outdated' ? `Dawnline update is available: ${VERSION} → ${latest}`
		: st == 'dev' ? `Installed Dawnline ${VERSION} is newer than the release ${latest}`
		: `Dawnline is up to date (${VERSION})`);
	return { installed: VERSION, latest, tag: r.tag, repo: REPO, url: r.url, published: r.published, update: st == 'outdated', status: st };
};

/**
 * The sha256 a release publishes for a file: GitHub's own (API), else the
 * release's sha256sums.txt fetched straight from github.com (never a mirror).
 */
function want_sha(ctx, tag, asset, dir) {
	let want = gh.asset_sha256(REPO, tag, asset);
	if (want)
		return want;
	let sums = `${dir}/sha256sums-${replace(tag, /[^A-Za-z0-9.-]/g, '_')}.txt`;
	if (!gh.download(`https://github.com/${REPO}/releases/download/${tag}/sha256sums.txt`, sums, { mirrors: false, log: ctx.log }))
		return null;
	for (let line in split(readfile(sums) ?? '', '\n')) {
		let m = match(trim(line), /^([0-9a-f]{64})[ \t]+\*?(\S+)$/);
		if (m && m[2] == asset)
			return m[1];
	}
	return null;
}

/** Download a release's package, verified against its sha256. */
function fetch(ctx, tag, dir) {
	let ver = replace(tag, /^v/, '');
	let asset = `luci-app-dawnline-${ver}.${pkg.ext()}`;
	ctx.phase(`Downloading ${asset}`);
	let want = want_sha(ctx, tag, asset, dir);
	if (!want)
		die(`Release ${tag} publishes no checksum for ${asset}: not installing an unverified package`);
	let f = `${dir}/${asset}`;
	if (!gh.download(`https://github.com/${REPO}/releases/download/${tag}/${asset}`, f, { sha256: want, mirrors: ctx.pol.mirrors, log: ctx.log }))
		die(`Download failed: ${asset}`);
	ctx.log(`sha256 matches the release (${substr(want, 0, 12)}…)`);
	return f;
}

/** The release tag of a version: tags may or may not carry the v. */
function tag_of(ver) {
	for (let t in [ `v${ver}`, ver ]) {
		try {
			if (gh.release(REPO, t))
				return t;
		}
		catch (e) {}
	}
	return `v${ver}`;
}

function backup(ctx) {
	ctx.phase('Backing up configuration');
	system('/usr/bin/dawnline backup --reason pre-update >/dev/null 2>&1');
}

/** arg: null (latest) | @<tag> | reinstall | rollback */
export function install(ctx, arg) {
	let out = { from: VERSION, to: null };
	if (arg == 'rollback') {
		let k = upd.kept('app');
		if (!k)
			die('No previous Dawnline version is kept on the router');
		out.to = k.version;
		ctx.versions(VERSION, k.version);
		backup(ctx);
		ctx.phase(`Rolling back to ${k.version}`);
		if (!pkg.install_files(k.files, true, ctx.log))
			die('Installation failed');
		upd.forget('app');
		ctx.after('app');
		return out;
	}
	let tag, force = false;
	if (arg == 'reinstall') {
		tag = tag_of(VERSION);
		force = true;
	}
	else if (arg && substr(arg, 0, 1) == '@') {
		tag = substr(arg, 1);
		force = upd.version_cmp(replace(tag, /^v/, ''), VERSION) <= 0;
	}
	else {
		let c = check(ctx);
		if (!c.latest)
			die(c.note);
		if (!c.update) {
			out.to = VERSION;
			return out;
		}
		tag = c.tag;
	}
	out.to = replace(tag, /^v/, '');
	ctx.versions(VERSION, out.to);
	let f = fetch(ctx, tag, ctx.work);
	// The version being replaced, for Roll back (downloaded again: opkg keeps no package files).
	if (ctx.pol.keep && out.to != VERSION && upd.kept('app')?.version != VERSION) {
		ctx.phase(`Keeping Dawnline ${VERSION} for rollback`);
		try {
			system(`mkdir -p '${ctx.work}/keep'`);
			upd.keep('app', VERSION, [ fetch(ctx, tag_of(VERSION), `${ctx.work}/keep`) ]);
		}
		catch (e) {
			ctx.log(`Warning: could not keep ${VERSION}: ${e.message}`);
		}
	}
	backup(ctx);
	ctx.phase('Installing package');
	if (!pkg.install_files([ f ], force, ctx.log))
		die('Installation failed');
	ctx.after('app');
	return out;
};
