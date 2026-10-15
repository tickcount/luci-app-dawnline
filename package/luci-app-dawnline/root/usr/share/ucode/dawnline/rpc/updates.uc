// Dawnline rpcd methods for the Components tab: status, starting update jobs
// (the updater does the work in the background), releases, release notes
// and the changes between two releases. luci.dawnline merges `methods`.

import { readfile } from 'fs';
import { cursor } from 'uci';
import { read_json, ensure_dir, VERSION, REPO, RUN_DIR } from 'dawnline.util';
import * as core from 'dawnline.core';
import * as health from 'dawnline.health';
import * as upd from 'dawnline.updates';
import * as gh from 'dawnline.github';
import * as builds from 'dawnline.awg_builds';
import { NAMES as PKG_NAMES } from 'dawnline.upd_pkgs';

const TAG = /^v?[0-9][0-9A-Za-z.+~-]{0,40}$/;
// check[:app|amneziawg|packages] | app[@tag|:reinstall|:rollback]
// | amneziawg[:auto|slava|grey[:ru]|:rollback] | pkgs:<name,…> (only packages Dawnline manages)
const TARGET = /^(check(:(app|amneziawg|packages))?|app(@v?[0-9][0-9A-Za-z.+~-]{0,40}|:reinstall|:rollback)?|amneziawg(:rollback|:(auto|slava|grey)(:ru)?)?|pkgs:[a-z0-9][a-z0-9.+,-]*)$/;

function wrap(fn) {
	return function(req) {
		try {
			let r = fn(req.args ?? {});
			return type(r) == 'object' ? r : { result: r };
		}
		catch (e) {
			return { error: e.message ?? `${e}` };
		}
	};
}

/** AmneziaWG interfaces by name: switching builds restarts them. */
function awg_tunnels() {
	let out = [];
	let c = cursor();
	c.load('network');
	c.foreach('network', 'interface', (s) => {
		if (s.proto == 'amneziawg' && s.disabled != '1')
			push(out, s._dawnline_name ?? s['.name']);
	});
	return out;
}

function status(a) {
	let m = core.load();
	let rel = {};
	for (let line in split(readfile('/etc/openwrt_release') ?? '', '\n')) {
		let x = match(line, /^DISTRIB_(RELEASE|TARGET|ARCH)='([^']*)'/);
		if (x)
			rel[lc(x[1])] = x[2];
	}
	return {
		version: VERSION,
		firmware: { version: rel.release ?? '', target: rel.target ?? '', arch: rel.arch ?? '' },
		portal: m.settings.portal_enabled,
		home: length(filter(values(m.servers), (x) => x.lan_like)) > 0,
		needs: health.needs(),
		check: read_json(upd.CHECK_FILE, null),
		job: upd.job(),
		now: time(),
		repo: REPO,
		policy: m.settings.updates,
		auto: upd.auto_state(),
		kept: upd.kept_all(builds.firmware()?.postfix),
		history: slice(upd.history(), 0, 12),
		tunnels: awg_tunnels(),
	};
}

/** Releases for the Versions list (Dawnline), five per page. */
function releases(a) {
	let page = +(a.page ?? 1);
	if (page != int(page) || page < 1 || page > 50)
		die('Unknown page.');
	return { releases: map(gh.releases(REPO, page), (x) => ({ ...x, body: null, digests: null })), page };
}

/** Release notes for What's new: Dawnline by tag, or an AmneziaWG build's release. */
function notes(a) {
	let rp = a.component == 'amneziawg' ? builds.SOURCES[a.build || 'slava']?.repo : REPO;
	let tag = a.tag ?? '';
	if (!rp || !match(tag, TAG))
		die('Unknown release.');
	let r = gh.release(rp, tag);
	if (!r && a.component != 'amneziawg' && substr(tag, 0, 1) != 'v')
		r = gh.release(rp, `v${tag}`);
	if (!r)
		die(`No release ${tag} in ${rp}.`);
	return { ...r, digests: null, repo: rp };
}

/** What changed between the installed Dawnline and a release (points for the Components tab). */
function changes(a) {
	let to = a.to ?? '', from = a.from ?? '';
	if (!match(to, TAG) || (from != '' && !match(from, TAG)))
		die('Unknown release.');
	// The installed version as a tag when it was released (a build ahead of the releases has none).
	let base = null;
	for (let t in (from != '' ? [ `v${replace(from, /^v/, '')}`, replace(from, /^v/, '') ] : []))
		if (!base && gh.release(REPO, t))
			base = t;
	return { items: gh.changes(REPO, base, to) };
}

/**
 * Start an update job. Returns the new job once its worker has written it,
 * else null (the caller follows updates_status); never an older job.
 */
function run(a) {
	let what = a.what ?? 'check';
	if (length(what) > 400 || !match(what, TARGET))
		die('Unknown update target.');
	// Checked here too, so a wrong name never becomes a failed job in the history.
	if (substr(what, 0, 5) == 'pkgs:')
		for (let n in split(substr(what, 5), ','))
			if (index(PKG_NAMES, n) < 0)
				die(n == '' ? 'Unknown update target.' : `${n} is not a package Dawnline manages.`);
	if (upd.busy())
		die('Another component action is already running.');
	ensure_dir(RUN_DIR);
	let t0 = time();
	let args = substr(what, 0, 5) == 'check' ? `check ${substr(what, 6)}` : `install ${what}`;
	system(`start-stop-daemon -S -b -x /usr/libexec/dawnline/updater -- ${args}`);
	for (let i = 0; i < 20; i++) {
		let j = read_json(upd.JOB_FILE, null);
		if (j?.state == 'running' && j.started >= t0)
			return { started: true, job: j };
		system('usleep 100000 2>/dev/null || sleep 1');
	}
	return { started: true, job: null };
}

export const methods = {
	updates_status: { call: wrap(status) },
	updates_run: { args: { what: '' }, call: wrap(run) },
	updates_releases: { args: { page: 1 }, call: wrap(releases) },
	updates_notes: { args: { component: '', tag: '', build: '' }, call: wrap(notes) },
	updates_changes: { args: { from: '', to: '' }, call: wrap(changes) },
};
