// Dawnline — what the settings section may hold: one entry per option with
// its type, default and range, used to validate what the admin saves and to
// parse what is stored. Also the address checks the rest of the code shares.
//
// Booleans are stored as '1' / '0' only, and parsed the way the init script's
// config_get_bool does, so the service and the code never disagree.

import { stat } from 'fs';
import { ip2int, valid_host, ulength } from 'dawnline.util';
import { INTERVALS, TARGETS } from 'dawnline.updates';
import { _ } from 'dawnline.i18n';

/* ---------- addresses ---------- */

/** An IPv4 address in dotted form. */
export function ipv4(s) {
	return type(s) == 'string' && ip2int(s) != null;
};

/**
 * An IPv6 address → its eight 16-bit groups, or null. Accepts '::' and an
 * embedded IPv4 at the end (::ffff:192.0.2.1); no zone ids or prefixes.
 */
export function ipv6_groups(s) {
	if (type(s) != 'string' || length(s) < 2 || length(s) > 45 || !match(s, /^[0-9A-Fa-f:.]+$/))
		return null;
	let tail = [];
	let v4 = match(s, /^(.*:)([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)$/);
	if (v4) {
		let n = ip2int(v4[2]);
		if (n == null)
			return null;
		tail = [ (n >> 16) & 0xffff, n & 0xffff ];
		s = substr(v4[1], -2) == '::' ? v4[1] : substr(v4[1], 0, length(v4[1]) - 1);
	}
	else if (index(s, '.') >= 0)
		return null;
	let halves = split(s, '::');
	if (length(halves) > 2)
		return null;
	let groups = (part) => {
		let out = [];
		if (part == '')
			return out;
		for (let g in split(part, ':')) {
			if (!match(g, /^[0-9A-Fa-f]{1,4}$/))
				return null;
			push(out, hex(g));
		}
		return out;
	};
	let head = groups(halves[0]);
	let rest = length(halves) == 2 ? groups(halves[1]) : [];
	if (head == null || rest == null)
		return null;
	if (length(halves) == 1) {
		push(head, ...tail);
		return length(head) == 8 ? head : null;
	}
	push(rest, ...tail);
	let gap = 8 - length(head) - length(rest);
	if (gap < 1)
		return null;
	let out = [ ...head ];
	for (let i = 0; i < gap; i++)
		push(out, 0);
	push(out, ...rest);
	return out;
};

/** An IPv6 address (any valid notation). */
export function ipv6(s) {
	return ipv6_groups(s) != null;
};

/** An IPv4 or IPv6 address. */
export function ip(s) {
	return ipv4(s) || ipv6(s);
};

/** A TCP/UDP port as typed: 1-5 digits, 1-65535. */
export function valid_port(v) {
	let s = trim(`${v ?? ''}`);
	return match(s, /^[0-9]{1,5}$/) != null && +s >= 1 && +s <= 65535;
};

/* ---------- parsing stored values ---------- */

/** A stored boolean, as the init script's config_get_bool reads it. */
export function bool(v, dflt) {
	v = lc(trim(`${v ?? ''}`));
	if (index([ '1', 'on', 'true', 'yes', 'enabled' ], v) >= 0)
		return true;
	if (index([ '0', 'off', 'false', 'no', 'disabled' ], v) >= 0)
		return false;
	return dflt;
};

/** A stored whole number within [min, max], else the default. */
export function to_int(v, dflt, lo, hi) {
	let s = trim(`${v ?? ''}`);
	if (!match(s, /^-?[0-9]{1,9}$/))
		return dflt;
	let n = +s;
	return (lo != null && n < lo) || (hi != null && n > hi) ? dflt : n;
};

/* ---------- the settings section ---------- */

/*
 * type: bool | int | enum | host | hosts | url | file | domain | ipv4 | time | targets
 * dflt: the parsed default; restart: the portal (uhttpd) must restart when it changes;
 * min/max: ints; values: enums. The error for a bad value is in messages().
 */
export const SETTINGS = {
	portal_enabled: { type: 'bool', dflt: false, restart: true },
	portal_host: { type: 'host', dflt: '', restart: true },
	portal_alt: { type: 'hosts', dflt: [], restart: true },
	portal_port: { type: 'int', dflt: 8443, min: 1, max: 65535, restart: true },
	portal_redirect: { type: 'url', dflt: '' },
	portal_cert: { type: 'file', dflt: '', restart: true },
	portal_key: { type: 'file', dflt: '', restart: true },
	default_device_limit: { type: 'int', dflt: 3, min: 1, max: 32 },
	hostnames: { type: 'bool', dflt: true },
	domain: { type: 'domain', dflt: 'lan' },
	// Off until the admin turns it on: lookups send people's addresses to a third party.
	geo_enabled: { type: 'bool', dflt: false },
	geo_provider: { type: 'enum', dflt: 'ipwho.is', values: [ 'ipwho.is', 'ipapi.co' ] },
	log_connections: { type: 'bool', dflt: true },
	watchdog: { type: 'bool', dflt: true },
	log_keep_days: { type: 'int', dflt: 30, min: 0, max: 9999 },
	log_max: { type: 'int', dflt: 2000, min: 100, max: 20000 },
	log_persist: { type: 'enum', dflt: 'hourly', values: [ '10min', 'hourly', 'off' ] },
	usage_keep_days: { type: 'int', dflt: 62, min: 7, max: 1830 },
	usage_keep_months: { type: 'int', dflt: 24, min: 1, max: 120 },
	// Empty means "no fallback" (stored as 'none'); unset means the default.
	home_dns_fallback: { type: 'ipv4', dflt: '1.1.1.1' },
	update_check: { type: 'bool', dflt: true },
	update_interval: { type: 'enum', dflt: '1d', values: keys(INTERVALS) },
	update_auto: { type: 'bool', dflt: true },
	update_mode: { type: 'enum', dflt: 'scheduled', values: [ 'immediate', 'scheduled' ] },
	update_time: { type: 'time', dflt: '04:00' },
	update_targets: { type: 'targets', dflt: [ 'app', 'packages' ] },
	update_keep: { type: 'bool', dflt: false },
	update_mirrors: { type: 'bool', dflt: true },
};

/** Ports the portal never takes: SSH, DNS and the LuCI web server. */
export const RESERVED_PORTS = [ 22, 53, 80, 443 ];

/** What the admin is told about a bad value, by setting (made per call: the language changes between calls). */
function messages() {
	return {
		portal_host: _('Public address must be a hostname or IP address.'),
		portal_alt: _('Other addresses must be hostnames or IP addresses.'),
		portal_port: _('Choose a free port between 1 and 65535 (not 22, 53, 80 or 443).'),
		portal_redirect: _('Redirect must be a full http:// or https:// address.'),
		default_device_limit: _('Default device limit must be 1-32.'),
		domain: _('Domain may use lowercase letters, digits, dashes and dots.'),
		geo_provider: _('Unknown location service.'),
		log_keep_days: _('Keep activity for 0 (no age limit) to 9999 days.'),
		log_max: _('Log size must be 100-20000 events.'),
		log_persist: _('Save the log every 10min, hourly or off.'),
		usage_keep_days: _('Daily traffic history must be 7-1830 days.'),
		usage_keep_months: _('Monthly traffic history must be 1-120 months.'),
		home_dns_fallback: _('Fallback DNS must be an IPv4 address (or empty for none).'),
		update_interval: _('Check every 6h, 12h, 1d or 7d.'),
		update_mode: _('Install updates immediately or scheduled.'),
		update_time: _('Enter a time as HH:MM, 00:00 to 23:59.'),
	};
}

function bad(key) {
	die(messages()[key] ?? sprintf(_('Invalid value for %s.'), key));
}

/**
 * Check a value the admin saves for setting `key`. Returns what to store: a
 * string, a list, or null to remove the option (back to the default). Dies
 * with a message for the admin when the value is not acceptable.
 */
export function validate(key, val) {
	let spec = SETTINGS[key];
	if (!spec)
		die(sprintf(_('Unknown setting %s.'), key));
	let t = spec.type;
	if (t == 'hosts') {
		let lst = [];
		for (let x in (type(val) == 'array' ? val : [])) {
			// A typo must not vanish on Save: refused, like the main address.
			if (type(x) != 'string' || (trim(x) != '' && !valid_host(trim(x))))
				bad(key);
			if (trim(x) != '' && index(lst, trim(x)) < 0)
				push(lst, trim(x));
		}
		return length(lst) ? lst : null;
	}
	if (t == 'targets') {
		let lst = [];
		for (let x in (type(val) == 'array' ? val : []))
			if (index(TARGETS, x) >= 0 && index(lst, x) < 0)
				push(lst, x);
		// An empty list is a choice too ("none"), unlike a missing option (the default).
		return length(lst) ? lst : [ 'none' ];
	}
	if (type(val) == 'bool')
		val = val ? '1' : '0';
	val = trim(`${val ?? ''}`);
	if (t == 'ipv4' && val == '')
		return 'none';
	if (val == '')
		return null;
	if (t == 'bool') {
		if (val != '0' && val != '1')
			die(sprintf(_('%s is 0 or 1.'), key));
	}
	else if (t == 'int') {
		if (!match(val, /^[0-9]{1,9}$/) || +val < spec.min || +val > spec.max)
			bad(key);
		val = `${+val}`;
	}
	else if (t == 'enum') {
		if (index(spec.values, val) < 0)
			bad(key);
	}
	else if (t == 'host') {
		if (!valid_host(val))
			bad(key);
	}
	else if (t == 'url') {
		if (length(val) > 300 || !match(val, /^https?:\/\/[A-Za-z0-9.-]+(:[0-9]+)?(\/[^[:space:]"'<>]*)?$/))
			bad(key);
	}
	else if (t == 'file') {
		if (substr(val, 0, 1) != '/' || !stat(val))
			die(sprintf(_('File %s does not exist.'), val));
	}
	else if (t == 'domain') {
		if (!match(val, /^[a-z0-9-]{1,32}(\.[a-z0-9-]{1,32})*$/))
			bad(key);
	}
	else if (t == 'ipv4') {
		if (!ipv4(val))
			bad(key);
	}
	else if (t == 'time') {
		if (!match(val, /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/))
			bad(key);
	}
	return val;
};

/**
 * A stored setting parsed by its schema entry: the typed value, or the default
 * when it is missing or invalid. For dawnline.core's load().
 */
export function get(raw, key) {
	let spec = SETTINGS[key];
	let v = raw?.[key];
	if (!spec)
		return v;
	let t = spec.type;
	if (t == 'bool')
		return bool(v, spec.dflt);
	if (t == 'int')
		return to_int(v, spec.dflt, spec.min, spec.max);
	if (t == 'hosts' || t == 'targets')
		return v == null ? spec.dflt : filter(type(v) == 'array' ? v : [ v ], (x) => x != '');
	if (v == null || v == '')
		return spec.dflt;
	if (t == 'enum')
		return index(spec.values, v) >= 0 ? v : spec.dflt;
	if (t == 'ipv4')
		return v == 'none' ? '' : (ipv4(v) ? v : spec.dflt);
	return v;
};
