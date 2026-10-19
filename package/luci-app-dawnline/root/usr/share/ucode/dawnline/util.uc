// Dawnline — small helpers shared by the rpcd plugin, the CLI, the agent and
// the portal CGI. Nothing in here loads or commits configuration (the uci
// helpers work on a cursor the caller owns).

import { open, readfile, writefile, rename, mkdir, stat, unlink, popen, lsdir } from 'fs';

export const VERSION = '0.9.0';
/** GitHub repository with Dawnline releases (updates and the installer). */
export const REPO = 'tickcount/luci-app-dawnline';
export const RUN_DIR = '/var/run/dawnline';
export const DATA_DIR = '/etc/dawnline';

/* ---------- shell ---------- */

export function q(s) {
	return "'" + replace(`${s}`, "'", "'\\''") + "'";
};

/** Run a shell command; returns { code, out }. Stdout and stderr are merged. */
export function sh(cmd) {
	let p = popen(`${cmd} 2>&1`, 'r');
	if (!p)
		return { code: -1, out: '' };
	let out = p.read('all') ?? '';
	let code = p.close();
	return { code: code ?? 0, out: out };
};

/** Trimmed stdout of a command, or null when it failed. */
export function sh_out(cmd) {
	let r = sh(cmd);
	return r.code == 0 ? trim(r.out) : null;
};

/** Fire-and-forget: run a shell snippet detached from the caller. */
export function sh_bg(cmd) {
	system(`( ${cmd} ) >/dev/null 2>&1 </dev/null &`);
};

/* ---------- randomness ---------- */

export function rand_bytes(n) {
	let f = open('/dev/urandom', 'r');
	let b = f.read(n);
	f.close();
	return b;
};

export function rand_hex(n) {
	return hexenc(rand_bytes(n));
};

const ALNUM = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** URL-safe random token without look-alike characters. */
export function rand_token(len) {
	let b = rand_bytes(len), s = '';
	for (let i = 0; i < len; i++)
		s += substr(ALNUM, ord(b, i) % length(ALNUM), 1);
	return s;
};

export function rand_int(lo, hi) {
	let b = rand_bytes(4);
	let n = (ord(b, 0) << 24 | ord(b, 1) << 16 | ord(b, 2) << 8 | ord(b, 3)) & 0x7fffffff;
	return lo + n % (hi - lo + 1);
};

/* ---------- files ---------- */

export function ensure_dir(path, mode) {
	let parts = split(path, '/'), cur = '';
	for (let p in parts) {
		if (p == '')
			continue;
		cur += '/' + p;
		if (!stat(cur))
			mkdir(cur, mode ?? 0o755);
	}
};

export function read_json(path, fallback) {
	let s = readfile(path);
	if (s == null || s == '')
		return fallback;
	try {
		let v = json(s);
		return v ?? fallback;
	}
	catch (e) {
		return fallback;
	}
};

/**
 * Atomic write (temp file + rename). `mode` defaults to 0600. A short write
 * (flash full) leaves the old file in place and returns false.
 */
export function write_file(path, data, mode) {
	let tmp = `${path}.tmp${rand_hex(3)}`;
	let f = open(tmp, 'w', mode ?? 0o600);
	if (!f)
		return false;
	data = `${data ?? ''}`;
	let n = length(data) ? f.write(data) : 0;
	let closed = f.close();
	if (n != length(data) || !closed) {
		unlink(tmp);
		return false;
	}
	if (!rename(tmp, path)) {
		unlink(tmp);
		return false;
	}
	return true;
};

export function write_json(path, data, mode) {
	return write_file(path, sprintf('%J', data), mode);
};

export function file_exists(path) {
	return stat(path) != null;
};

/** Exclusive lock on a file under RUN_DIR; returns a handle to pass to unlock(). */
export function lock(name) {
	ensure_dir(RUN_DIR);
	let f = open(`${RUN_DIR}/${name}.lock`, 'w');
	if (f)
		f.lock('x');
	return f;
};

export function unlock(f) {
	if (f) {
		f.lock('u');
		f.close();
	}
};

// Locks this process holds through with_lock (flock does not nest: a second
// open of the same lock file in one process would wait for itself).
let held = {};

/**
 * Run fn() holding the named lock and return what it returns. Nested calls
 * for the same name in one process run fn() directly. Anything fn throws
 * releases the lock and is rethrown with the same message.
 */
export function with_lock(name, fn) {
	if (held[name])
		return fn();
	let l = lock(name);
	held[name] = true;
	try {
		let r = fn();
		delete held[name];
		unlock(l);
		return r;
	}
	catch (e) {
		delete held[name];
		unlock(l);
		die(e.message ?? `${e}`);
	}
};

/* ---------- uci (on the caller's cursor) ---------- */

/** Set an option only when it differs (null, '' or [] delete it); true if something changed. */
export function uci_put(c, conf, sec, opt, val) {
	let cur = c.get(conf, sec, opt);
	if (val == null || val == '' || (type(val) == 'array' && !length(val))) {
		if (cur != null) {
			c.delete(conf, sec, opt);
			return true;
		}
		return false;
	}
	if (type(val) == 'array') {
		if (type(cur) == 'array' && join('\n', cur) == join('\n', val))
			return false;
	}
	else if (cur == `${val}`)
		return false;
	c.set(conf, sec, opt, type(val) == 'array' ? val : `${val}`);
	return true;
};

/** Make `sec` a section of type `stype` (recreated when its type differs); true if it changed. */
export function uci_section(c, conf, sec, stype) {
	if (c.get(conf, sec) == stype)
		return false;
	if (c.get(conf, sec) != null)
		c.delete(conf, sec);
	c.set(conf, sec, stype);
	return true;
};

/**
 * After committing a config ourselves (and applying it), record its new
 * checksum so a later `reload_config` does not treat it as changed and
 * restart unrelated services that reload on any network change.
 */
export function ack_config(confs) {
	let md5f = '/var/run/config.md5';
	if (!stat(md5f))
		return;
	let lines = split(trim(readfile(md5f) ?? ''), '\n');
	for (let conf in confs) {
		let path = `/var/run/config.check/${conf}`;
		let sum = sh_out(`uci show ${q(conf)} | md5sum | cut -d' ' -f1`);
		if (!sum)
			continue;
		let found = false;
		for (let i = 0; i < length(lines); i++)
			if (substr(lines[i], -length(path) - 2) == `  ${path}`) {
				lines[i] = `${sum}  ${path}`;
				found = true;
			}
		if (!found)
			push(lines, `${sum}  ${path}`);
	}
	writefile(md5f, join('\n', lines) + '\n');
};

/* ---------- service log ---------- */

/*
 * Tunnel and service starts and stops, watchdog repairs and errors: one JSON
 * object per line in tmpfs (appends from several processes stay whole), a
 * copy on flash that the agent refreshes hourly, and a line in syslog.
 * src: awg | dawnline | portal; level: info | up | down | repair | error.
 */
export const SLOG = `${RUN_DIR}/service.log`;
export const SLOG_SAVED = `${DATA_DIR}/service.log`;
const SLOG_KEEP = 300;

export function slog(src, level, msg, detail, who, extra) {
	let e = { ts: time(), src, level, msg };
	// The subject, shown first and bold: a server's name, "Personal portal", "Dawnline".
	if (who)
		e.who = `${who}`;
	// The admin's own changes: { by: 'admin', kind: 'server', note: 'port 50115' }
	// read "You <msg> <kind> <who> · <note>".
	for (let k in [ 'by', 'kind', 'note' ])
		if (extra?.[k])
			e[k] = `${extra[k]}`;
	if (detail)
		e.detail = substr(trim(`${detail}`), 0, 2000);
	ensure_dir(RUN_DIR);
	let f = open(SLOG, 'a', 0o600);
	if (f) {
		f.write(sprintf('%J\n', e));
		f.close();
	}
	let line = e.by == 'admin' ? join(' ', filter([ 'admin', msg, e.kind, who, e.note ? '· ' + e.note : null ], (x) => x)) : who ? `${who} ${msg}` : msg;
	system(`logger -t dawnline${level == 'error' ? ' -p user.err' : ''} ${q(line)}`);
};

/** A change the admin made in LuCI, for the service log. */
export function admin_log(src, msg, kind, who, note, detail) {
	slog(src, 'info', msg, detail, who, { by: 'admin', kind, note });
};

/*
 * Why Dawnline itself is about to take a tunnel down, so the hotplug log can
 * tell that from a tunnel that stopped on its own. reason: settings | off |
 * removed | update. Kept for two minutes.
 */
const INTENT = `${RUN_DIR}/iface-intent.json`;

export function iface_intent(ifname, reason, name) {
	let all = read_json(INTENT, {});
	let now = time();
	for (let k, v in all)
		if (now - v.ts >= 120)
			delete all[k];
	all[ifname] = { reason, name, ts: now };
	ensure_dir(RUN_DIR);
	write_json(INTENT, all, 0o600);
};

/**
 * The note for a stop of `ifname`, or null. netifd may report one stop more
 * than once (the interface, then its device): the note covers every report
 * within 15 s of the first, then it is spent.
 */
export function take_iface_intent(ifname) {
	let all = read_json(INTENT, {});
	let it = all[ifname];
	let now = time();
	if (!it || now - it.ts >= 120 || (it.used && now - it.used >= 15))
		return null;
	if (!it.used) {
		it.used = now;
		write_json(INTENT, all, 0o600);
	}
	return it;
};

/** Newest first. */
export function slog_read(limit) {
	let lines = split(readfile(SLOG) ?? readfile(SLOG_SAVED) ?? '', '\n');
	let out = [];
	for (let i = length(lines) - 1; i >= 0 && length(out) < (limit ?? SLOG_KEEP); i--) {
		if (lines[i] == '')
			continue;
		try {
			let e = json(lines[i]);
			if (type(e) == 'object' && e.ts)
				push(out, e);
		}
		catch (err) {}
	}
	return out;
};

/** Keep the last entries only, and save them to flash when asked. */
export function slog_trim(save) {
	let lines = filter(split(readfile(SLOG) ?? '', '\n'), (l) => l != '');
	if (length(lines) > SLOG_KEEP + 50) {
		lines = slice(lines, -SLOG_KEEP);
		write_file(SLOG, join('\n', lines) + '\n');
	}
	if (save && length(lines) && stat(SLOG)?.mtime > (stat(SLOG_SAVED)?.mtime ?? 0)) {
		ensure_dir(DATA_DIR, 0o700);
		write_file(SLOG_SAVED, join('\n', lines) + '\n');
	}
};

/** Remove entries (all, or older than `days`); returns how many went. */
export function slog_clear(days) {
	let keep = [], removed = 0, cut = days > 0 ? time() - days * 86400 : null;
	for (let l in split(readfile(SLOG) ?? readfile(SLOG_SAVED) ?? '', '\n')) {
		if (l == '')
			continue;
		let e = null;
		try {
			e = json(l);
		}
		catch (err) {}
		if (cut != null && e?.ts >= cut)
			push(keep, l);
		else
			removed++;
	}
	let data = length(keep) ? join('\n', keep) + '\n' : '';
	ensure_dir(RUN_DIR);
	write_file(SLOG, data);
	if (stat(SLOG_SAVED))
		write_file(SLOG_SAVED, data);
	return removed;
};

/** After a reboot tmpfs is empty: continue the log saved on flash. */
export function slog_restore() {
	if (!stat(SLOG) && stat(SLOG_SAVED)) {
		ensure_dir(RUN_DIR);
		write_file(SLOG, readfile(SLOG_SAVED) ?? '');
	}
};

/* ---------- IPv4 ---------- */

export function ip2int(ip) {
	let m = match(ip, /^([0-9]+)\.([0-9]+)\.([0-9]+)\.([0-9]+)$/);
	if (!m)
		return null;
	let n = 0;
	for (let i = 1; i <= 4; i++) {
		let o = +m[i];
		if (o > 255)
			return null;
		n = n * 256 + o;
	}
	return n;
};

export function int2ip(n) {
	return sprintf('%d.%d.%d.%d', (n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255);
};

/**
 * "a.b.c.d[/len]" with any prefix 0-32 (a bare address is a /32) →
 * { net, prefix, size, ip }; null for anything else. Routes, rules and
 * allowed networks use this; parse_cidr is the stricter one for subnets.
 */
export function cidr_any(s) {
	let m = match(s ?? '', /^([0-9.]+)(\/([0-9]+))?$/);
	if (!m)
		return null;
	let ip = ip2int(m[1]), prefix = m[3] != null ? +m[3] : 32;
	if (ip == null || prefix > 32)
		return null;
	let size = 1 << (32 - prefix);
	return { net: ip - ip % size, prefix, size, ip };
};

/** The first of `nets` (CIDR strings, any prefix) that holds `ip` (a string or an int), or null. */
export function in_nets(ip, nets) {
	let n = type(ip) == 'int' ? ip : ip2int(ip);
	if (n == null)
		return null;
	for (let s in nets) {
		let c = cidr_any(s);
		if (c && n >= c.net && n < c.net + c.size)
			return s;
	}
	return null;
};

// Cloudflare's published ranges (https://www.cloudflare.com/ips/).
const CF_V4 = [ '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18',
	'108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17',
	'162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22' ];
const CF_V6 = [ /^2400:cb00:/i, /^2606:4700:/i, /^2803:f800:/i, /^2405:b500:/i, /^2405:8100:/i, /^2a06:98c[0-7]:/i, /^2c0f:f248:/i ];

/** True for an address in Cloudflare's network (its proxies and edge). */
export function cloudflare_ip(a) {
	let n = ip2int(a);
	if (n == null) {
		for (let r in CF_V6)
			if (match(a ?? '', r))
				return true;
		return false;
	}
	return in_nets(n, CF_V4) != null;
};

/** Parse "a.b.c.d/len" → { net, prefix, first, last, size } (net is the masked base). */
export function parse_cidr(cidr) {
	let m = match(cidr ?? '', /^([0-9.]+)\/([0-9]+)$/);
	if (!m)
		return null;
	let ip = ip2int(m[1]), prefix = +m[2];
	if (ip == null || prefix < 8 || prefix > 30)
		return null;
	let size = 1 << (32 - prefix);
	let net = ip - ip % size;
	return { net, prefix, size, first: net + 1, last: net + size - 2, ip };
};

export function cidr_str(c) {
	return `${int2ip(c.net)}/${c.prefix}`;
};

export function cidr_overlaps(a, b) {
	return a.net < b.net + b.size && b.net < a.net + a.size;
};

export function in_cidr(ip, c) {
	let n = type(ip) == 'int' ? ip : ip2int(ip);
	return n != null && n >= c.net && n < c.net + c.size;
};

/* ---------- text ---------- */

/** Characters in a UTF-8 string (length() counts bytes: "Мама" is 8 of them). */
export function ulength(s) {
	let n = 0;
	for (let i = 0; i < length(s); i++)
		if ((ord(s, i) & 0xc0) != 0x80)
			n++;
	return n;
};

/** The first `n` characters of a UTF-8 string, never cut inside one. */
export function ucut(s, n) {
	let i = 0, c = 0;
	while (i < length(s)) {
		if ((ord(s, i) & 0xc0) != 0x80) {
			if (c == n)
				break;
			c++;
		}
		i++;
	}
	return substr(s, 0, i);
};

// Cyrillic (Russian, Ukrainian) to Latin: а-я by code point from U+0430, then
// ё, і, ї, є, ґ; the rest of a string passes as it is.
const CYR_A = 0x430;
const CYRILLIC = [ 'a', 'b', 'v', 'g', 'd', 'e', 'zh', 'z', 'i', 'y', 'k', 'l', 'm', 'n', 'o', 'p', 'r', 's', 't', 'u',
	'f', 'kh', 'ts', 'ch', 'sh', 'shch', '', 'y', '', 'e', 'yu', 'ya' ];
const CYRILLIC_MORE = { '1105': 'yo', '1110': 'i', '1111': 'yi', '1108': 'ye', '1169': 'g' };

/**
 * Cyrillic letters written in Latin ("Мама" → "mama", "Юля" → "yulya"):
 * ids, hostnames and file names are ASCII, and a person should recognise
 * their own in them. Other characters are left alone.
 */
export function translit(s) {
	let out = '', i = 0, n = length(s);
	while (i < n) {
		let b = ord(s, i);
		if (b < 0x80) {
			out += substr(s, i, 1);
			i++;
			continue;
		}
		let cp = 0, len = 1;
		if ((b & 0xe0) == 0xc0 && i + 1 < n) {
			cp = ((b & 0x1f) << 6) | (ord(s, i + 1) & 0x3f);
			len = 2;
		}
		else if ((b & 0xf0) == 0xe0 && i + 2 < n) {
			cp = ((b & 0x0f) << 12) | ((ord(s, i + 1) & 0x3f) << 6) | (ord(s, i + 2) & 0x3f);
			len = 3;
		}
		else if ((b & 0xf8) == 0xf0 && i + 3 < n)
			len = 4;
		// Upper case to lower: А-Я, Ё, І, Ї, Є, Ґ.
		if (cp >= 0x410 && cp <= 0x42f)
			cp += 0x20;
		else if (cp == 0x401)
			cp = 0x451;
		else if (cp == 0x406)
			cp = 0x456;
		else if (cp == 0x407)
			cp = 0x457;
		else if (cp == 0x404)
			cp = 0x454;
		else if (cp == 0x490)
			cp = 0x491;
		let t = cp >= CYR_A && cp < CYR_A + length(CYRILLIC) ? CYRILLIC[cp - CYR_A] : CYRILLIC_MORE[`${cp}`];
		out += t != null ? t : substr(s, i, len);
		i += len;
	}
	return out;
};

/* ---------- validation ---------- */

export function valid_slug(s) {
	return type(s) == 'string' && match(s, /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$|^[a-z0-9]$/) != null;
};

/** A name people see: 1-48 characters (not bytes), none of < > " \ or control characters. */
export function valid_name(s) {
	return type(s) == 'string' && ulength(trim(s)) > 0 && ulength(s) <= 48 && match(s, /[<>"\\[:cntrl:]]/) == null;
};

/** What valid_name wants, for the admin. */
export const NAME_RULE = 'Enter a name: up to 48 characters, without < > " or \\.';

export function valid_key(s) {
	return type(s) == 'string' && match(s, /^[A-Za-z0-9+\/]{42}[AEIMQUYcgkosw048]=$/) != null;
};

/** An IPv6 address in its usual spelling (no zone, no brackets). */
export function is_ip6(s) {
	return type(s) == 'string' && match(s, /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/) != null && match(s, /:::/) == null;
};

export function valid_host(s) {
	return type(s) == 'string' && length(s) <= 253 &&
		(match(s, /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/) != null ||
		 ip2int(s) != null || is_ip6(s));
};

/** YYYY-MM-DD, and a day that exists (2026-02-30 does not). */
export function valid_date(s) {
	let m = type(s) == 'string' ? match(s, /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/) : null;
	if (!m)
		return false;
	let l = localtime(timelocal({ year: +m[1], mon: +m[2], mday: +m[3], hour: 12, min: 0, sec: 0 }));
	return l.year == +m[1] && l.mon == +m[2] && l.mday == +m[3];
};

/** Turn a display name into a portal slug candidate ("Мама Таня" → "mama-tanya"). */
export function slugify(s) {
	let out = lc(translit(trim(`${s ?? ''}`)));
	out = replace(out, /[^a-z0-9]+/g, '-');
	out = replace(out, /^-+|-+$/g, '');
	return substr(out, 0, 32) || 'user';
};

/**
 * A device's name as a DNS label ("Galaxy S24" → "galaxy-s24", "Телефон" →
 * "telefon"): at most 40 characters, "device" when nothing is left.
 */
export function host_label(s) {
	let l = replace(lc(translit(`${s ?? ''}`)), /[^a-z0-9]+/g, '-');
	l = replace(substr(replace(l, /^-+|-+$/g, ''), 0, 40), /-+$/g, '');
	return l || 'device';
};

/**
 * A server's name as a tunnel name ("Outline Home" → "Outline-Home"): the
 * AmneziaWG and WireGuard apps name the tunnel after the file, and Android and
 * wg-quick refuse anything but [a-zA-Z0-9_=+.-] up to 15 characters; Windows
 * refuses its device names (CON, NUL, COM1…). "dawnline" when nothing is left.
 */
export function tunnel_name(s) {
	let l = replace(translit(`${s ?? ''}`), /[^A-Za-z0-9]+/g, '-');
	l = replace(substr(replace(l, /^-+|-+$/g, ''), 0, 15), /-+$/g, '');
	return l && !match(l, /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i) ? l : 'dawnline';
};

/* ---------- time ---------- */

/** "YYYY-MM-DD" → epoch of the end of that local day (23:59:59). */
export function date_end(s) {
	let m = match(s ?? '', /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/);
	if (!m)
		return null;
	return timelocal({ sec: 59, min: 59, hour: 23, mday: +m[3], mon: +m[2], year: +m[1] });
};

export function today() {
	let t = localtime();
	return sprintf('%04d-%02d-%02d', t.year, t.mon, t.mday);
};

export function month_key(ts) {
	let t = localtime(ts ?? time());
	return sprintf('%04d-%02d', t.year, t.mon);
};

export function day_key(ts) {
	let t = localtime(ts ?? time());
	return sprintf('%04d-%02d-%02d', t.year, t.mon, t.mday);
};

/**
 * The day key `days` days before `ts` (default now). Counted from local noon,
 * so a 23- or 25-hour day around a DST change neither skips nor repeats a day.
 */
export function day_key_ago(days, ts) {
	let t = localtime(ts ?? time());
	let noon = timelocal({ year: t.year, mon: t.mon, mday: t.mday, hour: 12, min: 0, sec: 0 });
	return day_key(noon - (days ?? 0) * 86400);
};

export function uniq(arr) {
	let seen = {}, out = [];
	for (let v in arr)
		if (!seen[v]) {
			seen[v] = true;
			push(out, v);
		}
	return out;
};

export function list_dir(path) {
	return lsdir(path) ?? [];
};

export function remove(path) {
	return unlink(path);
};

export function now() {
	return time();
};

/** netifd's view of an interface (ubus network.interface.<name> status), or null. */
export function iface_status(ifname) {
	if (!match(ifname ?? '', /^[A-Za-z0-9_.@-]{1,32}$/))
		return null;
	let s = sh_out(`ubus call network.interface.${ifname} status 2>/dev/null`);
	if (!s)
		return null;
	try {
		return json(s);
	}
	catch (e) {
		return null;
	}
};
