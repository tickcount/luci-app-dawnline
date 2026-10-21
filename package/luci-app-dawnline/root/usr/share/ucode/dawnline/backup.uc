// Dawnline — backups (tar.gz of the config and its data files), restoring
// them, and the JSON export / import. Whatever comes back in is checked first:
// only Dawnline's own regular files, and servers that cannot take over one of
// the router's own interfaces or networks, or hand the kernel disguise values
// AmneziaWG refuses.

import { readfile, stat, unlink, lsdir, rename } from 'fs';
import { cursor } from 'uci';
import {
	q, sh, ensure_dir, read_json, write_json, write_file, file_exists, rand_hex, lock, unlock, DATA_DIR, RUN_DIR, VERSION
} from 'dawnline.util';
import * as core from 'dawnline.core';
import * as awg from 'dawnline.awg';
import * as live from 'dawnline.live';
import * as apply from 'dawnline.apply';
import * as net from 'dawnline.net';
import * as health from 'dawnline.health';
import { _ } from 'dawnline.i18n';

const BACKUP_DIR = `${DATA_DIR}/backups`;
/**
 * How many backups of each kind stay (the newest): the nightly ones must not
 * push out what the admin made by hand or what a removal left behind.
 */
const KEEP = { manual: 10, auto: 7, 'pre-delete': 5, 'pre-remove': 3, 'pre-update': 3, 'pre-restore': 3, 'pre-import': 3 };
const NAME = /^dawnline-([0-9]{8}-[0-9]{6})(-([a-z0-9-]+))?\.tar\.gz$/;
/** What a backup holds (paths inside the archive, relative to /). */
const FILES = [ 'etc/config/dawnline', 'etc/dawnline/usage.json', 'etc/dawnline/events.json' ];
/**
 * Kinds that hold the config alone (about 20 KB): the history can be a
 * megabyte or more, and these are made often and never to bring history
 * back. Manual, pre-restore and pre-import backups protect the data that is
 * about to be replaced, so they take everything.
 */
const CONFIG_ONLY = [ 'auto', 'pre-delete', 'pre-remove', 'pre-update' ];
/** The unpacked size a backup may have (the upload itself is limited to 4 MB). */
const MAX_UNPACKED = 16 * 1024 * 1024;

/* ---------- checking a configuration before it is used ---------- */

/**
 * What is wrong with a configuration about to replace the current one
 * (cursor `c` holds it): each server must have a valid, unique interface
 * name that is not one of the router's own interfaces, a free subnet, a
 * unique port and disguise values AmneziaWG takes (awg.obf_unsafe), and the
 * people and devices must be consistent (core.model_errors). [] when it can
 * be used.
 */
export function config_errors(c) {
	let m = core.load(c);
	let errs = core.model_errors(m);
	let nc = cursor();
	nc.load('network');
	let foreign = health.foreign_subnets();
	let internal = values(net.INTERNAL);
	let ifnames = {}, ports = {}, subnets = [];
	for (let id, srv in m.servers) {
		for (let e in [ ...core.server_errors(m, srv, [ ...foreign, ...subnets ]), ...awg.obf_unsafe(srv.obf) ])
			push(errs, sprintf(_('Server %s: %s'), srv.name, e));
		if (ifnames[srv.ifname])
			push(errs, sprintf(_('Server %s: interface %s is also used by %s.'), srv.name, srv.ifname, ifnames[srv.ifname]));
		ifnames[srv.ifname] = srv.name;
		let t = nc.get('network', srv.ifname);
		if (index(internal, srv.ifname) >= 0 || (t != null && (t != 'interface' || nc.get('network', srv.ifname, '_dawnline') == null)))
			push(errs, sprintf(_("Server %s: %s is one of the router's own network interfaces."), srv.name, srv.ifname));
		if (ports[srv.port])
			push(errs, sprintf(_('Server %s: UDP %s is also used by %s.'), srv.name, srv.port, ports[srv.port]));
		ports[srv.port] = srv.name;
		if (srv.subnet)
			push(subnets, srv.subnet);
	}
	return errs;
};

/** Check the config file in `dir` (as /etc/config/dawnline would be); dies listing the problems. */
function check_config_dir(dir) {
	ensure_dir(`${dir}/.delta`, 0o700);
	// Its own delta directory: changes staged in LuCI must not leak into the check.
	let c = cursor(dir, `${dir}/.delta`);
	if (!c.load('dawnline'))
		die(_('The configuration in this file cannot be read.'));
	let errs = config_errors(c);
	if (length(errs))
		die(sprintf(_("This configuration can't be used: %s"), join(' ', errs)));
}

/** A private scratch directory under RUN_DIR (the caller removes it). */
function scratch(kind) {
	ensure_dir(RUN_DIR);
	let dir = `${RUN_DIR}/${kind}.${rand_hex(4)}`;
	system(`rm -rf ${q(dir)}; mkdir -m 700 -p ${q(dir)}`);
	return dir;
}

/* ---------- backups ---------- */

export function backup_list() {
	let out = [];
	for (let f in lsdir(BACKUP_DIR) ?? []) {
		let mm = match(f, NAME);
		if (!mm)
			continue;
		let st = stat(`${BACKUP_DIR}/${f}`);
		push(out, { name: f, created: st?.mtime ?? 0, size: st?.size ?? 0, reason: mm[3] ?? 'manual' });
	}
	return sort(out, (a, b) => b.created - a.created);
};

/**
 * Make a backup now; returns its name. Written whole or not at all (a half
 * archive from a full flash never shows up as a backup). Of each kind the
 * oldest beyond KEEP are removed, except `keep` (the backup being restored,
 * which must survive the backup made just before restoring it).
 */
export function backup_create(reason, keep) {
	let kind = reason && match(reason, /^[a-z0-9-]{1,24}$/) ? reason : 'manual';
	let config_only = index(CONFIG_ONLY, kind) >= 0;
	// Flush live counters first so the backup has current usage.
	if (!config_only) {
		let u = read_json(`${RUN_DIR}/usage.json`, null);
		if (u)
			write_json(`${DATA_DIR}/usage.json`, u, 0o600);
		live.persist_events();
	}
	ensure_dir(BACKUP_DIR, 0o700);
	let t = localtime();
	let name = sprintf('dawnline-%04d%02d%02d-%02d%02d%02d%s.tar.gz', t.year, t.mon, t.mday, t.hour, t.min, t.sec, kind == 'manual' ? '' : `-${kind}`);
	let want = config_only ? [ FILES[0] ] : FILES;
	let files = join(' ', map(filter(want, (f) => file_exists(`/${f}`)), q));
	// Not a NAME until it is complete.
	let tmp = `${BACKUP_DIR}/.${name}.tmp`;
	let r = sh(`tar -czf ${q(tmp)} -C / ${files}`);
	if (r.code != 0 || !rename(tmp, `${BACKUP_DIR}/${name}`)) {
		unlink(tmp);
		let why = trim(r.out);
		die(why ? sprintf(_('Backup failed: %s'), why) : _('Backup failed: the archive could not be written (is the flash full?)'));
	}
	system(`chmod 600 ${q(BACKUP_DIR + '/' + name)}`);
	let by_kind = {};
	for (let b in backup_list())
		if (b.name != keep && b.name != name)
			push(by_kind[b.reason] ??= [], b);
	for (let k, list in by_kind)
		for (let i = KEEP[k] ?? 3; i < length(list); i++)
			unlink(`${BACKUP_DIR}/${list[i].name}`);
	return name;
};

function backup_path(name) {
	if (!match(name ?? '', NAME))
		die(_('Invalid backup name.'));
	let p = `${BACKUP_DIR}/${name}`;
	if (!file_exists(p))
		die(_('Backup not found.'));
	return p;
}

/**
 * Validate an archive: only Dawnline's own files, all of them regular files
 * (no links, devices or directories), within a sane unpacked size.
 */
function check_archive(path) {
	let r = sh(`tar -tvzf ${q(path)}`);
	if (r.code != 0)
		die(_('Not a valid backup archive.'));
	let has_config = false, total = 0;
	for (let line in split(trim(r.out), '\n')) {
		let f = split(trim(line), /[ \t]+/);
		let name = replace(f[length(f) >= 6 ? 5 : length(f) - 1] ?? '', /^\.?\//, '');
		// "-rw------- root/root 1234 2026-01-01 12:00:00 etc/config/dawnline"; links show "a -> b".
		if (substr(line, 0, 1) != '-' || index(line, ' -> ') >= 0 || index(line, ' link to ') >= 0)
			die(sprintf(_('Unexpected entry in backup: %s'), name));
		if (index(FILES, name) < 0)
			die(sprintf(_('Unexpected file in backup: %s'), name));
		total += +(f[2] ?? 0) || 0;
		if (name == 'etc/config/dawnline')
			has_config = true;
	}
	if (!has_config)
		die(_('Backup does not contain /etc/config/dawnline.'));
	if (total > MAX_UNPACKED)
		die(_('Backup is too large.'));
}

/**
 * Put the files unpacked in `dir` in place, under the config lock. The
 * config goes first: when it cannot be written nothing else is touched, and
 * a data file that fails afterwards is reported, not ignored.
 */
function install_files(dir) {
	ensure_dir(DATA_DIR, 0o700);
	let l = lock('config');
	try {
		for (let f in FILES) {
			let data = readfile(`${dir}/${f}`);
			if (data != null && !write_file(`/${f}`, data, 0o600))
				die(sprintf(_("Couldn't write %s. Is the flash full?"), `/${f}`));
		}
	}
	catch (e) {
		unlock(l);
		die(e.message);
	}
	unlock(l);
	system('chmod 600 /etc/config/dawnline');
}

export function backup_restore(name, path) {
	path ??= backup_path(name);
	check_archive(path);
	let dir = scratch('restore');
	try {
		let r = sh(`tar -xzf ${q(path)} -C ${q(dir)} ${join(' ', map(FILES, q))} 2>/dev/null; test -f ${q(dir + '/etc/config/dawnline')}`);
		if (r.code != 0)
			die(_('Not a valid backup archive.'));
		check_config_dir(`${dir}/etc/config`);
		backup_create('pre-restore', name);
		install_files(dir);
	}
	catch (e) {
		system(`rm -rf ${q(dir)}`);
		die(e.message);
	}
	system(`rm -rf ${q(dir)}`);
	// Live counters must follow the restored file: the agent reloads them from
	// flash on its next tick (its watcher may write the old ones again before).
	unlink(`${RUN_DIR}/usage.json`);
	unlink(`${RUN_DIR}/events.json`);
	write_file(live.USAGE_RELOAD, `${time()}`, 0o600);
	return apply.apply();
};

export function backup_delete(name) {
	unlink(backup_path(name));
	return true;
};

export function backup_read(name) {
	return b64enc(readfile(backup_path(name)));
};

export function backup_upload(data_b64) {
	let data = b64dec(data_b64 ?? '');
	if (!data || length(data) > 4 * 1024 * 1024)
		die(_('Upload is empty or too large.'));
	ensure_dir(RUN_DIR);
	let tmp = `${RUN_DIR}/upload.tar.gz`;
	write_file(tmp, data);
	let res;
	try {
		res = backup_restore(null, tmp);
	}
	catch (e) {
		unlink(tmp);
		die(e.message);
	}
	unlink(tmp);
	return res;
};

/* ---------- export / import (JSON) ---------- */

export function export_json() {
	let c = cursor();
	c.load('dawnline');
	let sections = [];
	c.foreach('dawnline', null, (s) => {
		let o = { '.type': s['.type'], '.name': s['.name'] };
		for (let k, v in s)
			if (substr(k, 0, 1) != '.')
				o[k] = v;
		push(sections, o);
	});
	return { format: 'dawnline', version: VERSION, exported: time(), sections };
};

/** An export as /etc/config/dawnline text; dies on anything that is not one. */
function export_to_uci(data) {
	if (type(data) != 'object' || data.format != 'dawnline' || type(data.sections) != 'array')
		die(_('Not a Dawnline export.'));
	let types = { settings: true, server: true, person: true, device: true, service: true, circle: true };
	let esc = (x) => replace(`${x}`, "'", "'\\''");
	let lines = [];
	for (let s in data.sections) {
		if (type(s) != 'object' || !types[s['.type']] || !match(s['.name'] ?? '', /^[A-Za-z0-9_]{1,64}$/))
			die(sprintf(_('Invalid section %s.'), s?.['.name']));
		push(lines, `config ${s['.type']} '${s['.name']}'`);
		for (let k, v in s) {
			if (substr(k, 0, 1) == '.')
				continue;
			if (!match(k, /^[a-z0-9_]{1,32}$/) || (type(v) != 'string' && type(v) != 'array'))
				die(sprintf(_('Invalid option %s.'), k));
			if (type(v) == 'array')
				for (let x in v) {
					if (type(x) != 'string')
						die(sprintf(_('Invalid option %s.'), k));
					push(lines, `\tlist ${k} '${esc(x)}'`);
				}
			else
				push(lines, `\toption ${k} '${esc(v)}'`);
		}
		push(lines, '');
	}
	return join('\n', lines);
}

export function import_json(data) {
	let text = export_to_uci(data);
	let dir = scratch('import');
	try {
		write_file(`${dir}/dawnline`, text, 0o600);
		check_config_dir(dir);
	}
	catch (e) {
		system(`rm -rf ${q(dir)}`);
		die(e.message);
	}
	system(`rm -rf ${q(dir)}`);
	backup_create('pre-import');
	let l = lock('config');
	let ok = write_file('/etc/config/dawnline', text, 0o600);
	unlock(l);
	if (!ok)
		die(sprintf(_("Couldn't write %s. Is the flash full?"), '/etc/config/dawnline'));
	return apply.apply();
};
