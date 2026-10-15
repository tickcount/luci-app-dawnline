// Dawnline — fw4 and routing around it: each tunnel's zone, its forwardings
// to home and WAN, the WAN rules for the tunnels and the portal (named
// sections dawnline_*), what the watchdog checks about them, and the reply
// routes that keep Dawnline's own answers on the main table. Only sections
// named dawnline_* are ever changed.

import { cursor } from 'uci';
import { sh, sh_out, uniq, uci_put, uci_section, ack_config } from 'dawnline.util';
import * as core from 'dawnline.core';
import * as net from 'dawnline.net';

const LOOP_ZONE = 'dl_loop';
/*
 * Our own answers leave by the main table: the portal's (TCP) and each
 * tunnel's (UDP). Proxies on the router (tproxy with an fwmark rule) may mark
 * the router's own traffic to internet addresses and divert it locally, which
 * swallows replies to outside clients. These rules sit before such fwmark
 * rules and only match the router's own traffic (iif lo) from our listening
 * ports: forwarded traffic keeps whatever routing the router has for it.
 */
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
	for (let id, srv in m.servers) {
		if (!length(core.tunnels(srv)))
			continue;
		let z = `dawnline_${id}`;
		let sn = net.server_net(srv, snap);
		portal_zone ??= sn.wan.zone;
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
		if (match(s['.name'], /^dawnline_/) && !want[s['.name']])
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

/** Our reply rules of one family as `ip rule show` prints them: [{ proto, port, lo }]. */
function reply_rules(fam) {
	let out = [];
	// "90:	from all iif lo ipproto udp sport 51820 lookup main" (older versions: without "iif lo").
	for (let line in split(sh_out(`ip ${fam} rule show priority ${PREF_REPLY} 2>/dev/null`) ?? '', '\n')) {
		let mm = match(line, /ipproto (tcp|udp) sport ([0-9]+) lookup main/);
		if (mm)
			push(out, { proto: mm[1], port: mm[2], lo: index(line, ' iif lo ') >= 0 });
	}
	return out;
}

/** One `iif lo ipproto <p> sport <port> lookup main` rule per listening port and family. */
export function sync_reply_routes(m) {
	let want = [];
	if (m.settings.portal_enabled) {
		push(want, `tcp ${+m.settings.portal_port}`);
		if (core.portal_http(m))
			push(want, `tcp ${core.portal_http_port(m)}`);
	}
	for (let id, srv in m.servers)
		if (srv.private_key && srv.enabled && +srv.port)
			push(want, `udp ${+srv.port}`);
	want = uniq(want);
	for (let fam in [ '-4', '-6' ]) {
		// Ours that are no longer wanted, and the older ones that also caught forwarded traffic.
		for (let r in reply_rules(fam))
			if (!r.lo || index(want, `${r.proto} ${r.port}`) < 0)
				sh(`ip ${fam} rule del priority ${PREF_REPLY}${r.lo ? ' iif lo' : ''} ipproto ${r.proto} sport ${r.port} lookup main 2>/dev/null`);
		let have = map(filter(reply_rules(fam), (r) => r.lo), (r) => `${r.proto} ${r.port}`);
		for (let w in want)
			if (index(have, w) < 0)
				sh(`ip ${fam} rule add priority ${PREF_REPLY} iif lo ipproto ${split(w, ' ')[0]} sport ${split(w, ' ')[1]} lookup main`);
	}
};
