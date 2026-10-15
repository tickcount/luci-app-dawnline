// Dawnline — one interface over the router's package manager: opkg on
// OpenWrt 24.10, apk on 25.12. Commands that change packages take a log(line)
// callback, which gets their output line by line.

import { access, popen } from 'fs';
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

/** Package files (from a release): force also reinstalls the same version or goes back to an older one. */
export function install_files(files, force, log) {
	let args = join(' ', map(files, q));
	return logged(is_apk()
		? `apk add --allow-untrusted ${args}`
		: `opkg install ${force ? '--force-reinstall --force-downgrade ' : ''}${args}`, log).code == 0;
};

/** Packages by name from the feeds. */
export function add(names, log) {
	return logged(is_apk() ? `apk add ${join(' ', map(names, q))}` : `opkg install ${join(' ', map(names, q))}`, log).code == 0;
};

export function upgrade(names, log) {
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
			let m = match(line, /^(\S+?)-([0-9][^ ]*)\s+<\s+(\S+)/);
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
