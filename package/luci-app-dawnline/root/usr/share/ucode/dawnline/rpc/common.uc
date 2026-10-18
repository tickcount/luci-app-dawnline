// Dawnline — what the rpcd method modules (dawnline.rpc.*) share: the call
// wrapper, argument helpers, the disguise check and the portal port check.

import * as core from 'dawnline.core';
import * as awg from 'dawnline.awg';
import * as health from 'dawnline.health';
import * as schema from 'dawnline.schema';
import { uniq } from 'dawnline.util';

/**
 * An rpcd handler from fn(args): an object result is passed on, anything else
 * is wrapped as { result }, and a failure becomes { error } (the UI shows it).
 */
export function wrap(fn) {
	return function(req) {
		try {
			let r = fn(req.args ?? {});
			return type(r) == 'object' ? r : { result: r };
		}
		catch (e) {
			return { error: e.message ?? `${e}` };
		}
	};
};

/** An argument as a trimmed string ('' for null). */
export function str(v) {
	return v == null ? '' : trim(`${v}`);
};

/** Days of history a caller may ask for: 1–400, default 30. */
export function clamp_days(v) {
	let n = +(v ?? 30);
	return n >= 1 ? (n > 400 ? 400 : int(n)) : 30;
};

export const METHODS = [ 'off', 'standard', 'strong', 'balanced', 'max' ];

/** A disguise method the installed AmneziaWG can run. */
export function check_method(name) {
	if (index(METHODS, name) < 0)
		die('Unknown disguise method.');
	let c = awg.caps();
	if (name == 'max' && !c.v3)
		die(awg.installed()
			? 'Maximum needs AmneziaWG 3.1 on the router (kmod-amneziawg, amneziawg-tools 3.1): install a 3.1 build in Dawnline → Components.'
			: 'AmneziaWG is not installed: install it in Dawnline → Components, then choose Maximum.');
	if (name == 'balanced' && !c.v2)
		die(awg.installed()
			? 'Balanced needs AmneziaWG 2.0 or newer on the router: install a current build in Dawnline → Components.'
			: 'AmneziaWG is not installed: install it in Dawnline → Components, then choose Balanced.');
	return name;
};

/**
 * The portal's ports in the final configuration `m` (compared with `was`,
 * before the change) are acceptable: its HTTPS port and, when links on IP
 * addresses use plain HTTP, the next port too — both get a WAN ACCEPT rule.
 * Neither may be 22, 53, 80 or 443, beyond 65535, or taken by another program.
 */
/** TCP port forwards from the servers' WAN zones: [{ from, to, name }]. */
function tcp_forwards(m) {
	let out = [];
	for (let z in uniq([ 'wan', ...map(values(m.servers), (s) => s.wan_zone) ]))
		push(out, ...core.wan_forwards(z, 'tcp'));
	return out;
}

/**
 * TCP ports the portal can't take, and who holds them: [{ from, to, who }].
 * The router's own (22, 53, 80, 443), other programs and port forwards from WAN.
 */
export function tcp_taken(m) {
	let out = [];
	let held = {};
	let hold = (p, who) => {
		if (!held[p]) {
			held[p] = true;
			push(out, { from: p, to: p, who });
		}
	};
	for (let p in schema.RESERVED_PORTS)
		hold(p, 'the router itself');
	for (let p, name in health.tcp_port_programs())
		hold(+p, `${name} on this router`);
	for (let f in tcp_forwards(m))
		push(out, { from: f.from, to: f.to, who: `port forward “${f.name}”` });
	return out;
};

export function check_portal(m, was) {
	let s = m.settings;
	if (!s.portal_enabled)
		return;
	let port = s.portal_port;
	if (!schema.valid_port(port) || index(schema.RESERVED_PORTS, port) >= 0)
		die('Choose a free port between 1 and 65535 (not 22, 53, 80 or 443).');
	let ports = [ port ];
	if (core.portal_http(m)) {
		let hp = core.portal_http_port(m);
		if (!schema.valid_port(hp) || index(schema.RESERVED_PORTS, hp) >= 0)
			die(`Links on IP addresses use plain HTTP on the next port (${hp}), which the portal cannot take. Choose another portal port.`);
		push(ports, hp);
	}
	// Only ports the portal does not hold already: our own uhttpd is not an owner anyway.
	let held = [];
	if (was?.settings?.portal_enabled) {
		push(held, was.settings.portal_port);
		if (core.portal_http(was))
			push(held, core.portal_http_port(was));
	}
	for (let p in ports) {
		if (index(held, p) >= 0)
			continue;
		let owners = health.tcp_port_owners(p);
		if (length(owners))
			die(`TCP ${p} is already used by ${join(', ', owners)}.${p != port ? ' Links on IP addresses use plain HTTP on the port after the portal\'s.' : ''} Choose another portal port.`);
	}
	// A forwarded port never reaches the router: the portal would be unreachable.
	for (let p in ports)
		for (let f in tcp_forwards(m))
			if (f.from <= p && p <= f.to)
				die(`TCP ${p} is sent on by port forward “${f.name}”. Choose another portal port.`);
};
