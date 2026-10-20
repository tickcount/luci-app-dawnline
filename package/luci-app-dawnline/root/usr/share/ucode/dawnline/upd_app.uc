// Dawnline updater: Dawnline itself — check the latest release, install a
// release (latest, a tag, the same one again) or the kept previous version.
// The admin's translations installed on the router (luci-i18n-dawnline-<lang>)
// come from the same release and go in with it, in one transaction.
// ctx is the updater's job context (see usr/libexec/dawnline/updater).

import { readfile, lsdir } from 'fs';
import { VERSION, REPO } from 'dawnline.util';
import * as upd from 'dawnline.updates';
import * as gh from 'dawnline.github';
import * as pkg from 'dawnline.pkg';
import { _ } from 'dawnline.i18n';

function status(installed, latest) {
	let c = upd.version_cmp(installed, latest);
	return c < 0 ? 'outdated' : c > 0 ? 'dev' : 'latest';
}

export function check(ctx) {
	let r = gh.latest(REPO);
	if (!r)
		return { installed: VERSION, latest: null, update: false, repo: REPO, status: '', note: sprintf(_('Cannot reach github.com/%s'), REPO) };
	let latest = replace(r.tag, /^v/, '');
	let st = status(VERSION, latest);
	ctx.log(st == 'outdated' ? sprintf(_('Dawnline update is available: %s → %s'), VERSION, latest)
		: st == 'dev' ? sprintf(_('Installed Dawnline %s is newer than the release %s'), VERSION, latest)
		: sprintf(_('Dawnline is up to date (%s)'), VERSION));
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

/** The languages of the translations installed here, by their catalogs (dawnline.<lang>.lmo). */
export function langs() {
	let out = [];
	for (let f in lsdir('/usr/lib/lua/luci/i18n') ?? []) {
		let m = match(f, /^dawnline\.([A-Za-z_-]+)\.lmo$/);
		if (m)
			push(out, m[1]);
	}
	return sort(out);
};

const i18n_pkg = (lang) => `luci-i18n-dawnline-${lang}`;

/**
 * Download one file of a release, verified against its sha256. `optional`: a
 * release without it (one from before the translations) gives null.
 */
function fetch_file(ctx, tag, asset, dir, optional) {
	ctx.phase(sprintf(_('Downloading %s'), asset));
	let want = want_sha(ctx, tag, asset, dir);
	if (!want && optional) {
		ctx.log(sprintf(_('Release %s has no %s: it stays as it is'), tag, asset));
		return null;
	}
	if (!want)
		die(sprintf(_('Release %s publishes no checksum for %s: not installing an unverified package'), tag, asset));
	let f = `${dir}/${asset}`;
	if (!gh.download(`https://github.com/${REPO}/releases/download/${tag}/${asset}`, f, { sha256: want, mirrors: ctx.pol.mirrors, log: ctx.log }))
		die(sprintf(_('Download failed: %s'), asset));
	ctx.log(sprintf(_('sha256 matches the release (%s…)'), substr(want, 0, 12)));
	return f;
}

/** A release's package and the translations installed here, verified. */
function fetch(ctx, tag, dir) {
	let ver = replace(tag, /^v/, '');
	let files = [ fetch_file(ctx, tag, `luci-app-dawnline-${ver}.${pkg.ext()}`, dir) ];
	for (let l in langs()) {
		let f = fetch_file(ctx, tag, `${i18n_pkg(l)}-${ver}.${pkg.ext()}`, dir, true);
		if (f)
			push(files, f);
	}
	return files;
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
	ctx.phase(_('Backing up configuration'));
	system('/usr/bin/dawnline backup --reason pre-update >/dev/null 2>&1');
}

/**
 * Add the translation `lang` of the installed version from its release, or
 * (lang null) remove the installed ones. LuCI reads its catalogs once per web
 * server process: it restarts after the job.
 */
function set_lang(ctx, lang) {
	if (lang == null) {
		let have = map(langs(), i18n_pkg);
		if (length(have)) {
			ctx.phase(_('Removing the translation'));
			if (!pkg.remove(have, ctx.log))
				die(_('The translation could not be removed'));
		}
	}
	else {
		let tag = tag_of(VERSION);
		let f = fetch_file(ctx, tag, `${i18n_pkg(lang)}-${VERSION}.${pkg.ext()}`, ctx.work, true);
		if (!f)
			die(sprintf(_('Release %s has no translation into %s: install a release that has one'), tag, lang));
		ctx.phase(_('Installing the translation'));
		if (!pkg.install_files([ f ], false, ctx.log))
			die(_('Installation failed'));
	}
	ctx.after('luci');
	return { from: VERSION, to: VERSION, lang };
}

/** arg: null (latest) | @<tag> | reinstall | rollback | lang:<code> | nolang */
export function install(ctx, arg) {
	if (arg == 'nolang')
		return set_lang(ctx, null);
	if (substr(arg ?? '', 0, 5) == 'lang:')
		return set_lang(ctx, substr(arg, 5));
	let out = { from: VERSION, to: null };
	if (arg == 'rollback') {
		let k = upd.kept('app');
		if (!k)
			die(_('No previous Dawnline version is kept on the router'));
		out.to = k.version;
		ctx.versions(VERSION, k.version);
		backup(ctx);
		ctx.phase(sprintf(_('Rolling back to %s'), k.version));
		if (!pkg.install_files(k.files, true, ctx.log))
			die(_('Installation failed'));
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
	let files = fetch(ctx, tag, ctx.work);
	// The version being replaced, for Roll back (downloaded again: opkg keeps
	// no package files). Always for an automatic run: nobody is there to
	// recover a router whose new version does not come up (postupdate rolls
	// back to it on its own).
	if ((ctx.pol.keep || ctx.auto?.()) && out.to != VERSION && upd.kept('app')?.version != VERSION) {
		ctx.phase(sprintf(_('Keeping Dawnline %s for rollback'), VERSION));
		try {
			system(`mkdir -p '${ctx.work}/keep'`);
			upd.keep('app', VERSION, fetch(ctx, tag_of(VERSION), `${ctx.work}/keep`));
		}
		catch (e) {
			ctx.log(sprintf(_('Warning: could not keep %s: %s'), VERSION, e.message));
		}
	}
	backup(ctx);
	ctx.phase(_('Installing package'));
	if (!pkg.install_files(files, force, ctx.log))
		die(_('Installation failed'));
	ctx.after('app');
	return out;
};
