// Dawnline — small helpers shared by the rpcd plugin, the CLI, the agent and
// the portal CGI. Nothing in here touches configuration.

import { open, readfile, writefile, rename, mkdir, stat, unlink, popen, lsdir } from 'fs';

export const VERSION = '0.1.1';
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

/** Atomic write (temp file + rename). `mode` defaults to 0600. */
export function write_file(path, data, mode) {
	let tmp = `${path}.tmp${rand_hex(3)}`;
	let f = open(tmp, 'w', mode ?? 0o600);
	if (!f)
		return false;
	f.write(data);
	f.close();
	return rename(tmp, path);
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
	for (let c in CF_V4) {
		let m = match(c, /^([0-9.]+)\/([0-9]+)$/);
		let size = 1 << (32 - +m[2]), net = ip2int(m[1]);
		if (n >= net && n < net + size)
			return true;
	}
	return false;
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

/* ---------- validation ---------- */

export function valid_slug(s) {
	return type(s) == 'string' && match(s, /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$|^[a-z0-9]$/) != null;
};

export function valid_name(s) {
	return type(s) == 'string' && length(trim(s)) > 0 && length(s) <= 48 && match(s, /[<>"\\[:cntrl:]]/) == null;
};

export function valid_key(s) {
	return type(s) == 'string' && match(s, /^[A-Za-z0-9+\/]{42}[AEIMQUYcgkosw048]=$/) != null;
};

export function valid_host(s) {
	return type(s) == 'string' && length(s) <= 253 &&
		(match(s, /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/) != null ||
		 ip2int(s) != null || match(s, /^[0-9a-fA-F:]+$/) != null);
};

export function valid_date(s) {
	return type(s) == 'string' && match(s, /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/) != null;
};

/** Turn a display name into a portal slug candidate. */
export function slugify(s) {
	let out = lc(trim(`${s ?? ''}`));
	out = replace(out, /[^a-z0-9]+/g, '-');
	out = replace(out, /^-+|-+$/g, '');
	return substr(out, 0, 32) || 'user';
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
