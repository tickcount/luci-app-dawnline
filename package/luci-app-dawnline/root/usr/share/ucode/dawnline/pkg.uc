// Dawnline — one interface over the router's package manager: opkg on
// OpenWrt 24.10, apk on 25.12. Commands that change packages take a log(line)
// callback, which gets their output line by line.

import { access, popen, stat } from 'fs';
import { q } from 'dawnline.util';
import { _ } from 'dawnline.i18n';

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

/**
 * The package a control text names: { name, version }, each null when it
 * does not say. Pure: an ipk's control file (ipk true), else `apk adbdump`
 * of an apk, whose first name and version are the package's own (its files
 * are "- name:" entries further down).
 */
export function control_info(text, ipk) {
	if (ipk)
		return { name: match(text, /(^|\n)Package: *([^\n]+)/)?.[2], version: match(text, /(^|\n)Version: *([^\n]+)/)?.[2] };
	return { name: match(text, /\n *name: *([^\n]+)/)?.[1], version: match(text, /\n *version: *([^\n]+)/)?.[1] };
};

/** The package inside a file: { name, version }, each null when the file does not say. */
export function file_info(path) {
	if (match(path, /\.ipk$/))
		return control_info(run(`tar -xzOf ${q(path)} ./control.tar.gz | tar -xzO ./control`).out, true);
	return control_info(run(`apk adbdump ${q(path)}`).out, false);
};

/** The version inside a package file, or null. */
export function file_version(path) {
	return file_info(path).version;
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
		die(sprintf(_('Not enough free space on the router: %d MB free, about %d MB needed. Remove old backups or packages first'),
			int(free / 1024), int(need / 1024) + 1));
	log?.('  ' + sprintf(_('%d MB free on the overlay'), int(free / 1024)));
}

/** Dawnline's own package: a file of it tells whether apk really reinstalled it. */
const SELF = 'luci-app-dawnline', SELF_MARKER = '/usr/share/ucode/dawnline/util.uc';

/**
 * The packages an apk install did not leave at their file's version: apk
 * takes a given file as it is (an older version too, a rollback) but leaves
 * an installed version alone, whatever the file. Pure: want [{ name,
 * version, file }] from the files (file_info()), have { name: installed
 * version }. [] when every package took.
 */
export function mismatched(want, have) {
	return filter(want, (w) => w.name == null || w.version == null || have?.[w.name] != w.version);
};

/**
 * Package files (from a release): true when every one is installed. force
 * also reinstalls the same version or goes back to an older one (opkg; apk
 * takes a file as it is: Dawnline's own package is checked by a file of it,
 * any other by its installed version).
 */
export function install_files(files, force, log) {
	preflight(files, 0, log);
	let args = join(' ', map(files, q));
	if (!is_apk())
		return logged(`opkg install ${force ? '--force-reinstall --force-downgrade ' : ''}${args}`, log).code == 0;
	let want = map(files, (f) => ({ ...file_info(f), file: f }));
	let own = length(filter(want, (w) => w.name == SELF)) > 0;
	// Dawnline's own reinstall that changed nothing is a failure, not a silent "done".
	let before = own && force ? stat(SELF_MARKER)?.mtime : null;
	if (logged(`apk add --allow-untrusted ${args}`, log).code != 0)
		return false;
	if (own) {
		if (force && before != null && stat(SELF_MARKER)?.mtime == before) {
			log?.('  ' + _('apk did not reinstall the version that is already installed'));
			die(_("apk doesn't reinstall an installed version. Install a different release, or run install.sh on the router"));
		}
		return true;
	}
	// Any other package took when it is at its file's version (the same
	// version again counts: apk keeps the installed one).
	let have = {};
	for (let w in want)
		if (w.name != null)
			have[w.name] = version(w.name);
	let bad = mismatched(want, have);
	for (let w in bad)
		log?.('  ' + sprintf(_('apk did not install %s %s (installed: %s)'), w.name ?? w.file, w.version ?? '?', have[w.name] ?? '-'));
	return !length(bad);
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
