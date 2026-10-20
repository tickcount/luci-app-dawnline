// Dawnline — fw4 and routing around it: each tunnel's zone, its forwardings
// to home and WAN, the WAN rules for the tunnels and the portal (named
// sections dawnline_*), what the watchdog checks about them, and the nft
// table that keeps Dawnline's own answers out of proxies. Only sections
// named dawnline_* are ever changed.

import { readfile, unlink } from 'fs';
import { q, sh, sh_out, uniq, in_nets, uci_put, uci_section, ack_config, write_file, RUN_DIR } from 'dawnline.util';
import { cursor } from 'uci';
import * as core from 'dawnline.core';
import * as net from 'dawnline.net';
import * as nft from 'dawnline.nft';
import * as loop from 'dawnline.loop';

const LOOP_ZONE = 'dl_loop';
/*
 * Our own answers leave by the main table: the portal's (TCP) and each
 * tunnel's (UDP). Proxies on the router (tproxy with an fwmark rule to a
 * `local default` table) mark the router's own traffic to internet addresses
 * in an output route chain, which diverts replies to outside clients into lo.
 * A policy rule on the source port can't exempt them: the reroute after the
 * mark is set looks up without ports. So a later output route chain of our
 * own clears exactly those proxy marks on packets from our listening ports,
 * and the kernel routes them again by main. Forwarded traffic is not touched.
 */
const REPLY_TABLE = 'dawnline_reply';
const REPLY_SIG = `${RUN_DIR}/reply.nft`;
/** Older versions kept answers out of proxies with `ip rule` at this priority; it never matched. */
const PREF_REPLY = 90;

/** With `dry`, only says whether the firewall config differs from what Dawnline wants. */
export function sync(m, dry) {
	let c = cursor();
	c.load('firewall');
	let changed = false, want = {};

	let sec = (name, stype, opts) => {
		want[name] = true;
		changed = uci_section(c, 'firewall', name, stype) || changed;
		for (let k, v in opts)
			changed = uci_put(c, 'firewall', name, k, v) || changed;
	};

	let snap = net.snapshot(true);
	let portal_zone = null, want_loop = false;
	// Where tunnel DNS is sent (dawnline.nft): into the netns for home names
	// while any server runs "like a home device", and to the LAN's DNS for
	// everyone else. A server that does not forward to those zones on its own
	// gets a rule for port 53 alone.
	let any_loop = length(filter(values(m.servers), (s) => s.lan_like && length(core.tunnels(s)))) > 0;
	let lan_dns = loop.lan_dns();
	let lan_dns_zone = null;
	if (lan_dns)
		for (let dev, d in snap.devices)
			if (d.zone && in_nets(lan_dns, d.nets ?? []))
				lan_dns_zone ??= d.zone;
	for (let id, srv in m.servers) {
		if (!length(core.tunnels(srv)))
			continue;
		let z = `dawnline_${id}`;
		let sn = net.server_net(srv, snap);
		portal_zone ??= sn.wan.zone;
		if (!srv.lan_like && any_loop)
			sec(`${z}_loopdns`, 'rule', {
				name: `Dawnline-${srv.ifname}-names`, src: srv.ifname, dest: LOOP_ZONE,
				proto: 'tcp udp', dest_port: 53, target: 'ACCEPT',
			});
		if (lan_dns_zone && lan_dns_zone != srv.ifname && index(sn.zones, lan_dns_zone) < 0)
			sec(`${z}_landns`, 'rule', {
				name: `Dawnline-${srv.ifname}-dns`, src: srv.ifname, dest: lan_dns_zone, dest_ip: lan_dns,
				proto: 'tcp udp', dest_port: 53, target: 'ACCEPT',
			});
		sec(`${z}_zone`, 'zone', {
			// Forward within the zone (device to device) is decided by the inet dawnline table.
			name: srv.ifname, network: [ srv.ifname ],
			input: 'ACCEPT', output: 'ACCEPT', forward: 'ACCEPT',
		});
		// Access per person is enforced by the inet dawnline table; the zone
		// only needs to be allowed to reach each home-network zone and WAN.
		// The home network may open connections to the devices too (a router
		// or a NAS on the tunnel); their answers pass the table as established.
		for (let i, zone in sn.zones)
			if (zone != sn.wan.zone && zone != srv.ifname) {
				let sfx = i == 0 ? '' : `_${replace(zone, /[^A-Za-z0-9_]/g, '_')}`;
				sec(`${z}_lan${sfx}`, 'forwarding', { src: srv.ifname, dest: zone });
				sec(`${z}_from_lan${sfx}`, 'forwarding', { src: zone, dest: srv.ifname });
			}
		sec(`${z}_wan`, 'forwarding', { src: srv.ifname, dest: sn.wan.zone });
		if (srv.lan_like) {
			sec(`${z}_loop`, 'forwarding', { src: srv.ifname, dest: LOOP_ZONE });
			want_loop = true;
		}
		sec(`${z}_port`, 'rule', {
			name: `Dawnline-${srv.ifname}`, src: sn.wan.zone, proto: 'udp',
			dest_port: srv.port, target: 'ACCEPT', enabled: srv.enabled ? null : '0',
		});
	}

	// The link into the netns that re-enters the router from the LAN.
	if (want_loop) {
		sec('dawnline_loop', 'zone', {
			name: LOOP_ZONE, device: [ net.INTERNAL.transit ],
			input: 'REJECT', output: 'ACCEPT', forward: 'REJECT',
		});
		// The Home-only resolver in the netns reaches its upstream DNS this way.
		sec('dawnline_loop_wan', 'forwarding', { src: LOOP_ZONE, dest: portal_zone ?? 'wan' });
	}

	// Never open SSH, DNS or the LuCI web server for the portal, whatever the settings say.
	let portal_port_ok = (p) => p >= 1 && p <= 65535 && index([ 22, 53, 80, 443 ], p) < 0;
	if (m.settings.portal_enabled && portal_port_ok(m.settings.portal_port)) {
		let wan = portal_zone ?? 'wan';
		sec('dawnline_portal', 'rule', {
			name: 'Dawnline-Portal', src: wan, proto: 'tcp',
			dest_port: m.settings.portal_port, target: 'ACCEPT',
		});
		// IP addresses in links: plain HTTP next to the HTTPS port, and 80 forwarded to it.
		if (core.portal_http(m) && portal_port_ok(core.portal_http_port(m))) {
			sec('dawnline_portal_http', 'rule', {
				name: 'Dawnline-Portal-HTTP', src: wan, proto: 'tcp',
				dest_port: core.portal_http_port(m), target: 'ACCEPT',
			});
		}
		// The portal keeps its own port: 80 and 443 stay with the LuCI web server.
	}

	let stale = [];
	c.foreach('firewall', null, (s) => {
		if (substr(s['.name'], 0, 9) == 'dawnline_' && !want[s['.name']])
			push(stale, s['.name']);
	});
	for (let s in stale) {
		c.delete('firewall', s);
		changed = true;
	}
	if (dry)
		return changed;

	if (changed) {
		c.commit('firewall');
		ack_config([ 'firewall' ]);
		system('fw4 -q reload');
		system("logger -t dawnline 'firewall updated'");
	}
	return changed;
};

/**
 * For the watchdog: what is wrong with Dawnline's firewall, or null.
 * 'off': fw4 is not running at all (not ours to start); 'changed': the config
 * lost or changed Dawnline's sections; 'not loaded': fw4 runs without them.
 */
export function drift(m) {
	let t = sh_out('nft -t list table inet fw4 2>/dev/null') ?? '';
	if (t == '')
		return 'off';
	if (sync(m, true))
		return 'changed';
	// Named rules show up in fw4's ruleset as comments.
	let names = [];
	for (let id, srv in m.servers)
		if (srv.enabled && length(core.tunnels(srv)))
			push(names, `Dawnline-${srv.ifname}`);
	if (m.settings.portal_enabled)
		push(names, 'Dawnline-Portal');
	for (let n in names)
		if (index(t, `${n}"`) < 0)
			return 'not loaded';
	return null;
};

const MARK_ALL = 0xffffffff;
// "1000:	from all fwmark 0x1 lookup 100", or "fwmark 0x1/0xff". A module
// constant, compiled once, not for each rule.
const MARK_RULE = /^(\d+):.*fwmark 0x([0-9a-f]+)(\/0x([0-9a-f]+))?.* lookup (\S+)/;

function hx(n) {
	return sprintf('0x%x', n);
}

/**
 * Policy rules that send marked traffic into a table with `local default`,
 * the way transparent proxies capture the router's own traffic:
 * [{ pref, mark, mask, table }], one per mark and mask.
 */
export function proxy_diverts() {
	let out = [], seen = {};
	for (let fam in [ '-4', '-6' ])
		for (let line in split(sh_out(`ip ${fam} rule show 2>/dev/null`) ?? '', '\n')) {
			let mm = match(line, MARK_RULE);
			if (!mm || +mm[1] >= 32766)
				continue;
			let d = { pref: +mm[1], mark: hex(mm[2]), mask: mm[4] ? hex(mm[4]) : MARK_ALL, table: mm[5] };
			let key = `${d.mark}/${d.mask}`;
			if (seen[key] || !match(sh_out(`ip ${fam} route show table ${d.table} 2>/dev/null`) ?? '', /(^|\n)local default/))
				continue;
			seen[key] = true;
			push(out, d);
		}
	return out;
};

/** A divert as `ip rule` shows it, for people: "pref 1000 fwmark 0x1 → table 100". */
export function divert_str(d) {
	return `pref ${d.pref} fwmark ${hx(d.mark)}${d.mask == MARK_ALL ? '' : `/${hx(d.mask)}`} → table ${d.table}`;
};

/** Ports Dawnline answers on from the outside: { tcp: [...], udp: [...] }. */
function reply_ports(m) {
	let p = { tcp: [], udp: [] };
	let ok = (n) => n >= 1 && n <= 65535;
	if (m.settings.portal_enabled) {
		push(p.tcp, +m.settings.portal_port);
		if (core.portal_http(m))
			push(p.tcp, +core.portal_http_port(m));
	}
	for (let id, srv in m.servers)
		if (srv.private_key && srv.enabled)
			push(p.udp, +srv.port);
	return { tcp: uniq(filter(p.tcp, ok)), udp: uniq(filter(p.udp, ok)) };
}

/** The reply table for these diverts, or '' when there is nothing to keep out of them. */
function reply_script(m, diverts) {
	let p = reply_ports(m);
	if (!length(diverts) || !length(p.tcp) && !length(p.udp))
		return '';
	let t = [];
	push(t, `table inet ${REPLY_TABLE} {`);
	push(t, '	chain out {');
	// After the proxies' own output chains (they mark at mangle, -150).
	push(t, '		type route hook output priority filter + 10; policy accept;');
	for (let proto in [ 'tcp', 'udp' ]) {
		if (!length(p[proto]))
			continue;
		for (let d in diverts)
			// Only the divert's bits: other marks on the packet (multi-WAN) stay.
			push(t, `		${proto} sport { ${join(', ', p[proto])} } ` + (d.mask == MARK_ALL
				? `meta mark ${hx(d.mark)} meta mark set 0x0`
				: `meta mark & ${hx(d.mask)} == ${hx(d.mark)} meta mark set meta mark & ${hx(~d.mask & MARK_ALL)}`));
	}
	push(t, '	}');
	push(t, '}');
	return join('\n', t) + '\n';
}

function reply_loaded() {
	return system(`nft list table inet ${REPLY_TABLE} >/dev/null 2>&1`) == 0;
}

/** Are the answers from our ports kept out of these diverts right now (watchdog)? */
export function reply_ok(m, diverts) {
	let s = reply_script(m, diverts);
	return s == '' || (s == readfile(REPLY_SIG) && reply_loaded());
};

/**
 * Keep the reply table in step with our ports and the proxies' diverts (apply
 * and every agent tick: a proxy may start after Dawnline). Cheap when nothing changed.
 */
export function sync_reply_routes(m) {
	// Rules of older versions ("90: from all iif lo ipproto udp sport 51820 lookup main", once without "iif lo").
	for (let fam in [ '-4', '-6' ])
		for (let line in split(sh_out(`ip ${fam} rule show priority ${PREF_REPLY} 2>/dev/null`) ?? '', '\n')) {
			let mm = match(line, /(iif lo )?ipproto (tcp|udp) sport ([0-9]+) lookup main/);
			if (mm)
				sh(`ip ${fam} rule del priority ${PREF_REPLY}${mm[1] ? ' iif lo' : ''} ipproto ${mm[2]} sport ${mm[3]} lookup main 2>/dev/null`);
		}
	let s = reply_script(m, proxy_diverts());
	if (s == '') {
		if (reply_loaded())
			system(`nft delete table inet ${REPLY_TABLE} 2>/dev/null`);
		unlink(REPLY_SIG);
		return;
	}
	if (s == readfile(REPLY_SIG) && reply_loaded())
		return;
	let err = nft.load(`table inet ${REPLY_TABLE}\ndelete table inet ${REPLY_TABLE}\n${s}`);
	if (err) {
		unlink(REPLY_SIG);
		system(`logger -t dawnline -p user.err ${q('reply table: ' + err)}`);
		return;
	}
	write_file(REPLY_SIG, s, 0o644);
};
