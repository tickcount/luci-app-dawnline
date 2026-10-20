// Dawnline — GitHub for the updater and the Components tab: API calls with a
// short cache, releases (with each asset's sha256), the changes between two
// tags, and verified downloads.
//
// Trust: the API is only ever asked directly (TLS to api.github.com). Files
// may come through a mirror when GitHub is unreachable, but only when their
// sha256 is known from the API, and a file is kept only if it matches.

import { stat, popen, access } from 'fs';
import { q, read_json, write_json, ensure_dir, RUN_DIR } from 'dawnline.util';
import { _ } from 'dawnline.i18n';

/** Prefixes that fetch github.com files when GitHub itself is unreachable. */
export const MIRRORS = [ 'https://ghfast.top/', 'https://gh-proxy.com/', 'https://ghproxy.net/' ];

function run(cmd) {
	let p = popen(cmd + ' 2>&1', 'r');
	if (!p)
		return { code: 127, out: '' };
	let out = p.read('all') ?? '';
	return { code: p.close(), out };
}

function have_curl() {
	return access('/usr/bin/curl', 'x');
}

/**
 * GET a URL: { status, body } (status 0 when there was no answer). curl gives
 * the HTTP status, so a 403 rate limit is told apart from a dead network.
 */
function get(url, timeout) {
	timeout ??= 12;
	if (have_curl()) {
		let r = run(`curl -sSL --connect-timeout 6 --max-time ${+timeout} -H 'Accept: application/vnd.github+json' -A Dawnline -w '\\n%{http_code}' ${q(url)}`);
		// The body, then the status on the last line (-w).
		let i = rindex(r.out, '\n');
		let code = i < 0 ? '' : substr(r.out, i + 1);
		return match(code, /^[0-9][0-9][0-9]$/) ? { status: +code, body: substr(r.out, 0, i) } : { status: 0, body: '' };
	}
	let r = run(`uclient-fetch -q -T ${+timeout} -O - ${q(url)}`);
	return { status: r.code == 0 ? 200 : 0, body: r.code == 0 ? r.out : '' };
}

/** JSON from the GitHub API, or null when GitHub did not answer; dies on a rate limit or another API error. */
function api_json(url) {
	let r = get(url);
	if (r.status == 0)
		return null;
	let j = null;
	try {
		j = json(r.body);
	}
	catch (e) {
		return null;
	}
	if (r.status == 403 || r.status == 429 || (type(j) == 'object' && match(j.message ?? '', /rate limit/i)))
		die(_('GitHub API rate limit reached: try again in an hour.'));
	if (r.status == 404)
		return null;
	if (r.status >= 400)
		die(sprintf(_('GitHub: %s'), j?.message ?? `HTTP ${r.status}`));
	return j;
}

function cached(key, ttl, fn) {
	let path = `${RUN_DIR}/gh-${replace(key, /[^A-Za-z0-9_.-]/g, '_')}.json`;
	let c = read_json(path, null);
	if (c && time() - (c.at ?? 0) < ttl)
		return c.data;
	let data = fn();
	if (data != null) {
		ensure_dir(RUN_DIR);
		write_json(path, { at: time(), data });
	}
	return data ?? c?.data;
}

/* ---------- releases ---------- */

function slim(x) {
	let digests = {};
	for (let a in x.assets ?? [])
		if (match(a.digest ?? '', /^sha256:[0-9a-f]{64}$/))
			digests[a.name] = substr(a.digest, 7);
	return {
		tag: x.tag_name, name: x.name ?? x.tag_name, published: x.published_at ?? null,
		prerelease: !!x.prerelease, url: x.html_url ?? null, body: substr(x.body ?? '', 0, 12000),
		assets: map(x.assets ?? [], (a) => a.name), digests,
	};
}

/** Releases of a repository, newest first, five per page (drafts skipped). */
export function releases(rp, page) {
	page = page ?? 1;
	return cached(`rel-${rp}-${page}`, 600, () => {
		let j = api_json(`https://api.github.com/repos/${rp}/releases?per_page=5&page=${+page}`);
		return type(j) == 'array' ? map(filter(j, (x) => !x.draft), slim) : null;
	}) ?? [];
};

/** One release by tag (notes, assets and their sha256), or null. */
export function release(rp, tag) {
	return cached(`tag-${rp}-${tag}`, 600, () => {
		let j = api_json(`https://api.github.com/repos/${rp}/releases/tags/${tag}`);
		return type(j) == 'object' && j.tag_name ? slim(j) : null;
	});
};

/** The sha256 GitHub publishes for a release file, or null (unknown: no mirrors for it). */
export function asset_sha256(rp, tag, name) {
	try {
		return release(rp, tag)?.digests?.[name] ?? null;
	}
	catch (e) {
		return null;
	}
};

/** The latest stable release; the /releases/latest redirect when the API is out of reach. */
export function latest(rp) {
	let r = null;
	try {
		r = cached(`latest-${rp}`, 300, () => {
			let j = api_json(`https://api.github.com/repos/${rp}/releases/latest`);
			return type(j) == 'object' && j.tag_name ? slim(j) : null;
		});
	}
	catch (e) {}
	if (r)
		return r;
	if (have_curl()) {
		let o = run(`curl -sI --connect-timeout 15 --max-time 30 -o /dev/null -w '%{redirect_url}' ${q('https://github.com/' + rp + '/releases/latest')}`);
		let m = match(trim(o.out), /\/releases\/tag\/([^\/?#]+)$/);
		if (m)
			return { tag: m[1], name: m[1], published: null, prerelease: false, url: `https://github.com/${rp}/releases/tag/${m[1]}`, body: '', assets: [], digests: {} };
	}
	return null;
};

/* ---------- what changed ---------- */

/**
 * What changed in a commit message, as points: release commits ("Dawnline
 * 0.3.1") list their changes as "- " lines in the body; other commits are
 * their title. Wrapped points are joined back into one line.
 */
export function points(msg) {
	let lines = split(msg ?? '', '\n');
	let title = trim(lines[0] ?? '');
	if (match(title, /^Merge /))
		return [];
	let out = [], cur = null;
	for (let i = 1; i < length(lines); i++) {
		let m = match(lines[i], /^\s*[-*]\s+(.*)$/);
		if (m) {
			if (cur != null)
				push(out, cur);
			cur = trim(m[1]);
		}
		else if (cur != null && match(lines[i], /^\s+\S/))
			cur += ' ' + trim(lines[i]);
		else if (cur != null) {
			push(out, cur);
			cur = null;
		}
	}
	if (cur != null)
		push(out, cur);
	if (!length(out) && !match(title, /^(Dawnline )?v?[0-9]+\.[0-9]+(\.[0-9]+)?$/) && title != '')
		push(out, title);
	return out;
};

/** The changes from one tag to another, newest first: commit by commit, or the release's own commit. */
export function changes(rp, base, head) {
	return cached(`changes-${rp}-${base}-${head}`, 600, () => {
		let out = [];
		let j = base ? api_json(`https://api.github.com/repos/${rp}/compare/${base}...${head}`) : null;
		if (type(j?.commits) == 'array') {
			for (let i = length(j.commits) - 1; i >= 0; i--)
				for (let p in points(j.commits[i]?.commit?.message))
					push(out, p);
			return slice(out, 0, 20);
		}
		let c = api_json(`https://api.github.com/repos/${rp}/commits/${head}`);
		return c?.commit ? slice(points(c.commit.message), 0, 20) : null;
	}) ?? [];
};

/* ---------- downloads ---------- */

export function sha256(path) {
	return match(run(`sha256sum ${q(path)}`).out, /^([0-9a-f]{64})/)?.[1];
};

/**
 * Download to a file. o: { sha256, mirrors, log }. Direct first; mirrors
 * only when the sha256 is known (from the API) and mirrors are allowed. A
 * file that does not match the sha256 is thrown away and the next source is
 * tried. Returns the URL that worked, or null.
 */
export function download(url, dest, o) {
	o ??= {};
	let want = o.sha256 ? lc(o.sha256) : null;
	let tries = [ url ];
	if (want && o.mirrors && match(url, /^https:\/\/(github\.com|raw\.githubusercontent\.com)\//))
		for (let m in MIRRORS)
			push(tries, m + url);
	for (let i, u in tries) {
		let host = replace(u, /^https:\/\/([^\/]+)\/.*$/, '$1');
		if (i > 0)
			o.log?.(sprintf(_('Trying mirror %s'), host));
		let r = have_curl()
			? run(`curl -fsSL --connect-timeout 15 --max-time 300 --retry 1 -o ${q(dest)} ${q(u)}`)
			: run(`uclient-fetch -q -T 30 -O ${q(dest)} ${q(u)}`);
		if (r.code == 0 && (stat(dest)?.size ?? 0) > 0) {
			if (!want || sha256(dest) == want)
				return u;
			o.log?.(sprintf(_("Warning: %s sent a file that does not match GitHub's sha256, discarded"), host));
		}
		system(`rm -f ${q(dest)}`);
		if (i == 0 && length(tries) > 1)
			o.log?.(_('GitHub did not answer, trying mirrors'));
	}
	return null;
};
