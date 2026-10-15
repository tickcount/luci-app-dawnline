// Dawnline: "Find home devices" (Bonjour over the tunnel). Multicast DNS does
// not cross WireGuard, so what umdns sees on the home networks is published
// as unicast DNS-SD records in dnsmasq: iPhone, iPad and Mac look there
// (browse domains under the home domain and the reverse zone of their own
// tunnel address) and list AirPlay, printers and shared Macs as at home.

'use strict';

import { readfile, writefile, unlink, lsdir, stat } from 'fs';
import { read_json, write_json, ensure_dir, RUN_DIR } from 'dawnline.util';
import * as ops from 'dawnline.ops';

const FILE = 'dawnline-bonjour.conf';
const STATE = `${RUN_DIR}/bonjour.json`;
/** dnsmasq restarts to read the records: at most this often when only TXT data changed. */
const QUIET = 600;
/** Not useful from a phone, or not a service at all. */
const SKIP = [ '_device-info._tcp', '_companion-link._tcp', '_sleep-proxy._udp', '_workstation._tcp', '_rdlink._tcp', '_hap._udp' ];

export function enabled(m) {
	for (let id, srv in m.servers)
		if (srv.bonjour && srv.private_key)
			return true;
	return false;
};

/** dnsmasq's conf-dirs (one per instance), from its generated configs. */
function conf_dirs() {
	let out = [];
	for (let f in lsdir('/var/etc') ?? []) {
		if (!match(f, /^dnsmasq\.conf\./))
			continue;
		for (let line in split(readfile(`/var/etc/${f}`) ?? '', '\n')) {
			let mm = match(line, /^conf-dir=([^,]+)/);
			if (mm && index(out, mm[1]) < 0)
				push(out, mm[1]);
		}
	}
	return out;
}

/** An instance name as dnsmasq takes it: printable ASCII, no dots or commas. */
function instance(s) {
	s = replace(s ?? '', /[\u2018\u2019]/g, "'");
	s = replace(s, /[\u201c\u201d]/g, '');
	s = replace(s, /[^\x20-\x7e]/g, '');
	s = replace(s, /[.,"\\]/g, ' ');
	s = trim(replace(s, / +/g, ' '));
	return substr(s, 0, 63);
}

function label(s) {
	return substr(trim(replace(replace(s ?? '', /[^A-Za-z0-9-]+/g, '-'), /^-+|-+$/g, '')), 0, 63);
}

/** Reverse zone of a server's tunnel network (its /24), where devices look for browse domains. */
function reverse24(subnet) {
	let mm = match(subnet ?? '', /^([0-9]+)\.([0-9]+)\.([0-9]+)\.[0-9]+\//);
	return mm ? `0.${mm[3]}.${mm[2]}.${mm[1]}.in-addr.arpa` : null;
}

/** The records, and a signature of what matters without TXT data. */
export function records(m, services) {
	let dom = m.settings.domain || 'lan';
	let lines = [], sig = [];
	let zones = [ dom ];
	for (let id, srv in m.servers)
		if (srv.bonjour && reverse24(srv.subnet))
			push(zones, reverse24(srv.subnet));
	for (let z in zones)
		for (let b in [ 'b', 'db', 'lb' ])
			push(lines, `ptr-record=${b}._dns-sd._udp.${z},${dom}`);
	let types = {}, hosts = {};
	for (let s in services) {
		if (!s.port || index(SKIP, s.type) >= 0 || !match(s.type, /^_[A-Za-z0-9-]+\._(tcp|udp)$/))
			continue;
		let name = instance(s.name), host = label(s.host) || label(replace(s.address, /\./g, '-'));
		if (name == '')
			continue;
		let full = `${name}.${s.type}.${dom}`;
		types[s.type] = true;
		hosts[host] = s.address;
		push(lines, `ptr-record=${s.type}.${dom},${full}`);
		push(lines, `srv-host=${full},${host}.${dom},${s.port}`);
		let txt = filter(s.txt ?? [], (t) => type(t) == 'string' && length(t) <= 255 && !match(t, /["\\\n]/));
		push(lines, length(txt) ? `txt-record=${full},${join(',', map(txt, (t) => `"${t}"`))}` : `txt-record=${full}`);
		push(sig, `${full}|${host}|${s.port}`);
	}
	for (let t in sort(keys(types)))
		push(lines, `ptr-record=_services._dns-sd._udp.${dom},${t}.${dom}`);
	for (let h in sort(keys(hosts))) {
		push(lines, `host-record=${h}.${dom},${hosts[h]}`);
		push(sig, `${h}=${hosts[h]}`);
	}
	return { conf: '# Written by Dawnline: home devices for Bonjour over the tunnel.\n' + join('\n', lines) + '\n', sig: join('\n', sort(sig)) };
};

function restart_dnsmasq() {
	system('/etc/init.d/dnsmasq restart >/dev/null 2>&1');
}

/**
 * Keep the records in step with what umdns sees (agent tick and apply).
 * Turned off: the records go away.
 */
export function sync(m, force) {
	let dirs = conf_dirs();
	if (!enabled(m) || !ops.mdns_running()) {
		let removed = false;
		for (let d in dirs)
			if (stat(`${d}/${FILE}`)) {
				unlink(`${d}/${FILE}`);
				removed = true;
			}
		if (removed)
			restart_dnsmasq();
		unlink(STATE);
		return false;
	}
	let r = records(m, ops.mdns_services());
	let st = read_json(STATE, {});
	let now = time();
	let same = st.conf == r.conf;
	let quiet = !force && st.sig == r.sig && now - (st.ts ?? 0) < QUIET;
	let missing = length(filter(dirs, (d) => !stat(`${d}/${FILE}`)));
	if ((same || quiet) && !missing)
		return false;
	for (let d in dirs) {
		ensure_dir(d);
		writefile(`${d}/${FILE}`, r.conf);
		system(`chmod 644 ${d}/${FILE}`);
	}
	write_json(STATE, { conf: r.conf, sig: r.sig, ts: now }, 0o644);
	restart_dnsmasq();
	return true;
};

/** Turning it on: umdns must run and look at the home networks. */
export function start_mdns() {
	system('/etc/init.d/umdns enable >/dev/null 2>&1; /etc/init.d/umdns start >/dev/null 2>&1');
};

export function view(m) {
	let s = ops.mdns_running() ? ops.mdns_services() : [];
	return {
		running: ops.mdns_running(),
		services: length(filter(s, (x) => x.port && index(SKIP, x.type) < 0)),
	};
};
