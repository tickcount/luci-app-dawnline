// Dawnline — one interface over the router's package manager: opkg on
// OpenWrt 24.10, apk on 25.12. Commands that change packages take a log(line)
// callback, which gets their output line by line.

import { access, popen, stat } from 'fs';
import { q } from 'dawnline.util';

function run(cmd) {
	let p = popen(cmd + ' 2>&1', 'r');
	if (!p)
		return { code: 127, out: '' };
	let out = p.read('all') ?? '';
	return { code: p.close(), out };
}

function logged(cmd, log) {
	let r = run(cmd);
	for (let line in split(trim(r.out), '\n'))
		if (length(trim(line)))
			log?.(`  ${line}`);
	return r;
}

export function is_apk() {
	return access('/usr/bin/apk', 'x');
};

export function ext() {
	return is_apk() ? 'apk' : 'ipk';
};

/** The installed version of a package, or null. */
export function version(name) {
	let esc = replace(name, /[.+]/g, '\\$&');
	if (is_apk()) {
		let m = match(run(`apk list --installed ${q(name)}`).out, regexp(`^${esc}-([^ ]+) `));
		return m ? m[1] : null;
	}
	// Libraries carry their ABI in the name (libustream-openssl20201210).
	let re = regexp(`^${esc}([0-9]+)? - (.+)$`), found = null;
	for (let line in split(run('opkg list-installed').out, '\n')) {
		let m = match(trim(line), re);
		if (m && (found == null || m[1] == null))
			found = m;
	}
	return found ? trim(found[2]) : null;
};

/** The version inside a package file, or null. */
export function file_version(path) {
	if (match(path, /\.ipk$/)) {
		let o = run(`tar -xzOf ${q(path)} ./control.tar.gz | tar -xzO ./control`).out;
		return match(o, /(^|\n)Version: *([^\n]+)/)?.[2];
	}
	return match(run(`apk adbdump ${q(path)}`).out, /\n *version: *([^\n]+)/)?.[1];
};

/**
 * Compare two package versions the way the package manager does (so -r10 is
 * newer than -r9 and ~rc before the release): -1, 0 or 1; null when unknown.
 */
export function cmp(a, b) {
	if (a == null || b == null)
		return null;
	if (a == b)
		return 0;
	if (is_apk()) {
		let r = trim(run(`apk version -t ${q(a)} ${q(b)}`).out);
		return r == '<' ? -1 : r == '>' ? 1 : r == '=' ? 0 : null;
	}
	if (run(`opkg compare-versions ${q(a)} '<<' ${q(b)}`).code == 0)
		return -1;
	if (run(`opkg compare-versions ${q(a)} '>>' ${q(b)}`).code == 0)
		return 1;
	return 0;
};

export function refresh(log) {
	return logged(is_apk() ? 'apk update' : 'opkg update', log).code == 0;
};

/** Free space on the overlay in KB (null when unknown). */
function overlay_free_kb() {
	let out = run('df -Pk /overlay 2>/dev/null || df -Pk / 2>/dev/null').out;
	let m = match(out, /\n\S+\s+[0-9]+\s+[0-9]+\s+([0-9]+)\s/);
	return m ? +m[1] : null;
}

/**
 * Room for `files` (or `need_kb` from the feeds): the package manager
 * unpacks before it removes, so a full flash leaves half an install behind.
 * Dies with the numbers.
 */
function preflight(files, need_kb, log) {
	let free = overlay_free_kb();
	if (free == null)
		return;
	let need = need_kb ?? 512;
	for (let f in files ?? [])
		need += int(((stat(f)?.size ?? 0) * 3) / 1024);
	if (free < need)
		die(`Not enough free space on the router: ${int(free / 1024)} MB free, about ${int(need / 1024) + 1} MB needed. Remove old backups or packages first`);
	log?.(`  ${int(free / 1024)} MB free on the overlay`);
}

/** Package files (from a release): force also reinstalls the same version or goes back to an older one. */
export function install_files(files, force, log) {
	preflight(files, 0, log);
	let args = join(' ', map(files, q));
	if (!is_apk())
		return logged(`opkg install ${force ? '--force-reinstall --force-downgrade ' : ''}${args}`, log).code == 0;
	// apk leaves an installed version alone, whatever the file: a reinstall
	// that changed nothing is a failure, not a silent "done".
	let marker = '/usr/share/ucode/dawnline/util.uc';
	let before = force ? stat(marker)?.mtime : null;
	let ok = logged(`apk add --allow-untrusted ${args}`, log).code == 0;
	if (ok && force && before != null && stat(marker)?.mtime == before) {
		log?.('  apk did not reinstall the version that is already installed');
		die("apk doesn't reinstall an installed version. Install a different release, or run install.sh on the router");
	}
	return ok;
};

/** Packages by name from the feeds. */
export function add(names, log) {
	preflight(null, 2048, log);
	return logged(is_apk() ? `apk add ${join(' ', map(names, q))}` : `opkg install ${join(' ', map(names, q))}`, log).code == 0;
};

export function upgrade(names, log) {
	preflight(null, 2048, log);
	return logged(is_apk() ? `apk upgrade ${join(' ', map(names, q))}` : `opkg upgrade ${join(' ', map(names, q))}`, log).code == 0;
};

export function remove(names, log) {
	return logged(is_apk() ? `apk del ${join(' ', map(names, q))}` : `opkg remove ${join(' ', map(names, q))}`, log).code == 0;
};

/** Installed packages with a newer version in the feeds: { name: latest }. */
export function upgradable() {
	let up = {};
	if (is_apk()) {
		for (let line in split(run('apk version -l "<"').out, '\n')) {
			// "name-version-rN < newer": the version is what follows the last dash
			// before the release suffix (a name may hold digits, a version no dash).
			let m = match(line, /^(\S+)-([^- ]+-r[0-9]+)\s+<\s+(\S+)/);
			if (m)
				up[m[1]] = m[3];
		}
	}
	else
		for (let line in split(run('opkg list-upgradable').out, '\n')) {
			let m = match(line, /^(\S+) - (\S+) - (\S+)/);
			if (m)
				up[m[1]] = m[3];
		}
	return up;
};
