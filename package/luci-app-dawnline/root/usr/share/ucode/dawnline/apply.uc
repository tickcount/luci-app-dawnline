// Dawnline — reconciliation. Turns /etc/config/dawnline into router state:
//   * network interfaces (dawnline.netifd) and the devices loaded live into
//     them (dawnline.awg)
//   * firewall zones, forwardings, WAN rules and reply routes (dawnline.fw)
//   * the nft table `inet dawnline` enforcing each person's access (dawnline.nft)
//   * hostnames in /tmp/hosts/dawnline
//   * the "like a home device" path and the Home-only resolver (dawnline.loop)
// Only objects created by Dawnline are ever modified.
//
// apply(), sync() and sync_loop() run under one lock ('apply') and read the
// model inside it, so a rebuild and a runtime update never interleave and the
// last one to run always works from the newest configuration. The config lock
// (dawnline.store) is never taken while 'apply' is held.

import { readfile, writefile, stat, unlink } from 'fs';
import { ensure_dir, write_file, write_json, with_lock, ip2int, slog, RUN_DIR } from 'dawnline.util';
import * as core from 'dawnline.core';
import * as net from 'dawnline.net';
import * as loop from 'dawnline.loop';
import * as awg from 'dawnline.awg';
import * as nft from 'dawnline.nft';
import * as fw from 'dawnline.fw';
import * as netifd from 'dawnline.netifd';
import * as migrate from 'dawnline.migrate';

const HOSTS_FILE = '/tmp/hosts/dawnline';
/** The network signature the last apply() worked from (the agent compares against it). */
export const NET_SIG = `${RUN_DIR}/net.sig`;
// The last access-table error that was logged (each distinct failure once).
const NFT_ERR = `${RUN_DIR}/nft.err`;

function log(who, msg, level, detail) {
	slog('dawnline', level ?? 'info', msg, detail, who);
}

/* ---------- hostnames ---------- */

function host_label(s) {
	let l = replace(lc(s), /[^a-z0-9]+/g, '-');
	l = replace(l, /^-+|-+$/g, '');
	return substr(l, 0, 40) || 'device';
}

export function sync_hosts(m) {
	let lines = [];
	if (m.settings.hostnames)
		for (let id, d in m.devices) {
			let p = m.people[d.person];
			if (p && ip2int(d.address) != null)
				push(lines, `${d.address} ${host_label(d.name)}.${p.id}.${m.settings.domain}`);
		}
	let ls = loop.status();
	if (ls.active)
		push(lines, `${ls.address} dawnline.${m.settings.domain}`);
	let body = length(lines) ? join('\n', lines) + '\n' : '';
	// dnsmasq runs as its own user; rpcd's umask would leave the file 0600.
	let readable = ((stat(HOSTS_FILE)?.perm?.other_read) ?? false);
	if ((readfile(HOSTS_FILE) ?? '') == body && (body == '' || readable))
		return false;
	ensure_dir('/tmp/hosts');
	if (body == '')
		unlink(HOSTS_FILE);
	else {
		writefile(HOSTS_FILE, body);
		system(`chmod 644 ${HOSTS_FILE}`);
	}
	system('killall -HUP dnsmasq 2>/dev/null');
	return true;
};

/* ---------- access table ---------- */

export function states_for(m, usage) {
	let st = {};
	for (let id, p in m.people)
		st[id] = core.person_state(m, p, usage);
	return st;
};

/** Per-person runtime membership (dawnline.nft). */
export function access_sets(m, usage, states) {
	return nft.access_sets(m, usage, states);
};

/** Log an access-table failure once per distinct error; true when the table is in place. */
function nft_result(err) {
	let was = readfile(NFT_ERR);
	if (err == null) {
		if (was != null)
			unlink(NFT_ERR);
		return true;
	}
	if (was != err) {
		log('Access rules', "couldn't load — devices aren't loaded into the tunnels until they do", 'error', err);
		ensure_dir(RUN_DIR);
		writefile(NFT_ERR, err);
	}
	return false;
}

/**
 * The table in place: rebuilt with `full`, otherwise members only, rebuilt
 * when that fails (no table yet at boot, or an older shape) — an error only
 * when the rebuild fails too.
 */
function load_table(m, sets, full) {
	let err = full ? nft.rebuild(m, sets) : nft.update(sets);
	if (err != null && !full)
		err = nft.rebuild(m, sets);
	return nft_result(err);
}

/** Full table rebuild (structure changes: servers, LAN subnets). */
export function rebuild_nft(m, sets) {
	return nft_result(nft.rebuild(m, sets));
};

/** Atomically replace set contents only. */
export function update_sets(sets) {
	return nft.update(sets) == null;
};

export function remove_nft() {
	nft.remove();
};

/** For the watchdog (dawnline.fw). */
export function firewall_drift(m) {
	return fw.drift(m);
};

/* ---------- runtime sync ---------- */

/*
 * With the lock held: access sets first, and devices into the tunnels only
 * once the table that limits them is in place.
 */
function locked_sync(m, usage, full) {
	let states = states_for(m, usage);
	let sets = nft.access_sets(m, usage, states);
	let peers = {};
	if (load_table(m, sets, full))
		peers = awg.sync_peers(m, states);
	sync_hosts(m);
	ensure_dir(RUN_DIR);
	write_json(`${RUN_DIR}/states.json`, states, 0o644);
	return { peers, states };
}

/**
 * Runtime sync: devices into the tunnels (AmneziaWG peers), access sets,
 * hostnames. Cheap; safe to call often. The model is always read again under
 * the lock (`m` is accepted for older callers and not used); `usage` is the
 * caller's (the agent holds the live counters).
 */
export function sync(m, usage) {
	return with_lock('apply', () => locked_sync(core.load(), usage ?? core.load_usage()));
};

/**
 * Everything on the router that Dawnline's state is derived from: WAN and
 * LAN, the home networks and zones of each server, the netns address and the
 * LAN's DNS. The agent re-applies when it changes (LAN renumbered, interface
 * added, bridge recreated, DHCP DNS changed, ...).
 */
export function net_signature(m) {
	let snap = net.snapshot(true);
	let srvs = {};
	for (let id, srv in m.servers)
		srvs[id] = net.server_net(srv, snap);
	let lan = snap.devices[snap.lan];
	return sprintf('%J', { wan: snap.wan, lan: snap.lan, addrs: lan?.addrs, servers: srvs, dns: loop.lan_dns(), loop: loop.client_dns() });
};

/**
 * Keep the "like a home device" path and the resolver in step (agent tick).
 * Cheap when nothing changed; rebuilds the access table when the netns
 * address appears, moves or goes away (the guard allows DNS to it).
 */
export function sync_loop(m, usage, force) {
	let p = with_lock('apply', () => {
		let mm = core.load();
		let before = `${loop.client_dns()} ${loop.resolver_target().mode}`;
		let lp = loop.ensure(mm, force);
		loop.sync_resolver(mm);
		fw.sync_reply_routes(mm);
		if (`${loop.client_dns()} ${loop.resolver_target().mode}` != before)
			locked_sync(mm, usage ?? core.load_usage(), true);
		return lp;
	});
	loop.remember(p);
	return p;
};

/* ---------- entry points ---------- */

/** Full reconcile: router configuration + runtime state. */
export function apply(opts) {
	opts ??= {};
	migrate.run();
	let r = with_lock('apply', () => {
		let m = core.load();
		let usage = core.load_usage();
		let network = netifd.sync(m);
		let firewall = fw.sync(m);
		let lp = loop.ensure(m, true);
		loop.sync_resolver(m);
		fw.sync_reply_routes(m);
		let s = locked_sync(m, usage, true);
		ensure_dir(RUN_DIR);
		write_file(NET_SIG, net_signature(m), 0o644);
		return { network, firewall, lp, peers: s.peers };
	});
	loop.remember(r.lp);
	return { network: r.network, firewall: r.firewall, like_home: r.lp.error ? { error: r.lp.error } : !r.lp.off, peers: r.peers };
};

/** Remove everything Dawnline created (used by the uninstaller). */
export function teardown() {
	with_lock('apply', () => {
		let m = core.load();
		loop.remove();
		unlink(loop.RESOLVER.conf);
		m.servers = {};
		m.settings.portal_enabled = false;
		netifd.sync(m);
		fw.sync(m);
		fw.sync_reply_routes(m);
		nft.remove();
		unlink(HOSTS_FILE);
		unlink(NET_SIG);
		system('killall -HUP dnsmasq 2>/dev/null');
	});
	migrate.uhttpd();
	// The agent's heartbeat check.
	if (system('grep -qs /usr/libexec/dawnline/heartbeat /etc/crontabs/root') == 0)
		system("sed -i '\\#/usr/libexec/dawnline/heartbeat#d' /etc/crontabs/root; /etc/init.d/cron restart >/dev/null 2>&1");
};
