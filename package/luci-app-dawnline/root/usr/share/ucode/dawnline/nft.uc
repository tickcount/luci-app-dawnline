// Dawnline — the nft table `inet dawnline`: each person's access, enforced
// on the tunnel interfaces before anything else on the router sees the
// traffic, and where tunnel DNS goes. Its shape follows the servers and their
// home networks (rebuild); who is in which set follows people's state and
// changes often (update, one atomic transaction).

import { unlink } from 'fs';
import { sh, ensure_dir, write_file, rand_hex, ip2int, RUN_DIR } from 'dawnline.util';
import * as core from 'dawnline.core';
import * as net from 'dawnline.net';
import * as loop from 'dawnline.loop';

const PRIVATE4 = [ '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '169.254.0.0/16', '224.0.0.0/3' ];
/** The sets whose members change at run time (update replaces them together). */
const SETS = [ 'lan_ok', 'lan_all', 'lan_part', 'mesh_pairs', 'inet_ok', 'svc_ok', 'svc_host', 'dns_real' ];

function ip4(a) {
	return ip2int(a ?? '') != null;
}

/** Per-person runtime membership: which tunnel addresses may reach what. */
export function access_sets(m, usage, states) {
	// lan_ok: home access (the router itself, the mesh); lan_all: every home
	// network; lan_part: device . network for people limited to some networks;
	// mesh_pairs: device . device within a circle (or one person's own devices);
	// svc_ok: device . service . port; svc_host: device . service with no ports (all of them).
	let sets = {};
	for (let k in SETS)
		sets[k] = [];
	let snap = net.snapshot();
	let homes = {}, groups = {};
	for (let id, d in m.devices) {
		let p = m.people[d.person];
		// Off: paused, ended, over quota or out of hours. Addresses go into nft as they are: IPv4 only.
		if (!p || d.disabled || !ip4(d.address) || states[p.id] != 'active')
			continue;
		// Home names: the plain resolver (their internet does not use the tunnel).
		if (p.access == 'lan' && p.dns_mode == 'home')
			push(sets.dns_real, d.address);
		if (p.access == 'internet' || p.access == 'both')
			push(sets.inet_ok, d.address);
		if (p.access == 'both' || (p.access == 'lan' && !length(p.services))) {
			push(sets.lan_ok, d.address);
			let srv = m.servers[p.server];
			let h = homes[p.id] ??= srv ? core.person_home(srv, p, snap) : { all: true, nets: [] };
			if (h.all)
				push(sets.lan_all, d.address);
			else
				for (let n in h.nets)
					push(sets.lan_part, `${d.address} . ${n}`);
			// Who this device may reach directly: its circle, or at least its owner's devices.
			if (srv?.mesh == 'circles') {
				let ci = core.person_circle(m, p);
				push(groups[ci ? `c:${ci.id}` : `p:${p.id}`] ??= [], d.address);
			}
		}
		else if (p.access == 'lan')
			for (let sid in p.services) {
				let s = m.services[sid];
				if (!s || !ip4(s.address))
					continue;
				if (!length(s.ports))
					push(sets.svc_host, `${d.address} . ${s.address}`);
				for (let port in s.ports)
					if (match(port, /^[0-9]+$/))
						push(sets.svc_ok, `${d.address} . ${s.address} . ${port}`);
			}
	}
	for (let g, addrs in groups)
		for (let a in addrs)
			for (let b in addrs)
				if (a != b)
					push(sets.mesh_pairs, `${a} . ${b}`);
	return sets;
};

function set_elems(arr) {
	return length(arr) ? `elements = { ${join(', ', arr)} }` : '';
}

function table(m, sets) {
	let ifs = [], lan = [], tun = [];
	let dns_addr = loop.client_dns();
	if (!ip4(dns_addr))
		dns_addr = null;
	let rt = loop.resolver_target();
	let snap = net.snapshot();
	for (let id, srv in m.servers) {
		// Only valid interface names reach here (core.tunnels): they are written into the rules as strings.
		let tns = core.tunnels(srv);
		for (let t in tns) {
			push(ifs, `"${t.ifname}"`);
			push(tun, t.subnet);
		}
		if (length(tns))
			push(lan, ...net.server_net(srv, snap).nets);
	}
	lan = net.collapse(lan);
	tun = net.collapse(tun);
	let t = [];
	push(t, 'table inet dawnline {');
	push(t, `	set lan_nets { type ipv4_addr; flags interval; auto-merge; ${set_elems(lan)} }`);
	// Tunnel subnets are never "home", even inside a wider route to the LAN.
	push(t, `	set tun_nets { type ipv4_addr; flags interval; auto-merge; ${set_elems(tun)} }`);
	push(t, `	set lan_ok { type ipv4_addr; ${set_elems(sets.lan_ok)} }`);
	push(t, `	set lan_all { type ipv4_addr; ${set_elems(sets.lan_all)} }`);
	push(t, `	set lan_part { type ipv4_addr . ipv4_addr; flags interval; ${set_elems(sets.lan_part)} }`);
	push(t, `	set mesh_pairs { type ipv4_addr . ipv4_addr; ${set_elems(sets.mesh_pairs)} }`);
	push(t, `	set inet_ok { type ipv4_addr; ${set_elems(sets.inet_ok)} }`);
	push(t, `	set svc_ok { type ipv4_addr . ipv4_addr . inet_service; ${set_elems(sets.svc_ok)} }`);
	push(t, `	set svc_host { type ipv4_addr . ipv4_addr; ${set_elems(sets.svc_host)} }`);
	push(t, `	set dns_real { type ipv4_addr; ${set_elems(sets.dns_real)} }`);
	push(t, '	chain pre {');
	// Ahead of mangle-priority hooks (transparent proxies mark at -150).
	push(t, '		type filter hook prerouting priority -160; policy accept;');
	if (length(ifs))
		push(t, `		iifname { ${join(', ', ifs)} } jump guard`);
	push(t, '	}');
	push(t, '	chain guard {');
	push(t, '		meta nfproto ipv6 drop');
	push(t, '		ct state established,related accept');
	push(t, '		icmp type echo-request fib daddr type local accept');
	push(t, '		fib daddr type local meta l4proto { tcp, udp } th dport 53 accept');
	push(t, '		fib daddr type local ip saddr @lan_ok accept');
	push(t, '		fib daddr type local counter drop');
	if (dns_addr)
		// DNS through the netns (it forwards to the LAN's DNS), for everyone.
		push(t, `		ip daddr ${dns_addr} meta l4proto { tcp, udp } th dport 53 accept`);
	push(t, '		ip daddr @lan_nets ip daddr != @tun_nets ip saddr @lan_all accept');
	push(t, '		ip saddr . ip daddr @lan_part ip daddr != @tun_nets accept');
	// Devices with home access are part of home: they reach each other, where the
	// server allows it (everyone, or within circles). Within one server: the
	// firewall has no forwarding between different servers' zones.
	for (let id, srv in m.servers)
		for (let tn in core.tunnels(srv))
			if (srv.mesh == 'all')
				push(t, `		iifname "${tn.ifname}" ip saddr @lan_ok ip daddr @lan_ok accept`);
			else if (srv.mesh == 'circles')
				push(t, `		iifname "${tn.ifname}" ip saddr . ip daddr @mesh_pairs accept`);
	push(t, '		meta l4proto { tcp, udp } ip saddr . ip daddr . th dport @svc_ok accept');
	push(t, '		ip saddr . ip daddr @svc_host accept');
	push(t, `		ip daddr { ${join(', ', PRIVATE4)} } counter drop`);
	push(t, '		ip saddr @inet_ok accept');
	push(t, '		counter drop');
	push(t, '	}');
	// The other way: fw4 lets the server's home zones reach the tunnel; here
	// only connections from its home networks to people with home access pass
	// (paused, ended and internet-only people are not reachable). The admin's
	// own port forwards (DNAT) stay with fw4.
	push(t, '	chain inbound {');
	push(t, '		type filter hook forward priority filter - 5; policy accept;');
	if (length(ifs))
		push(t, `		oifname { ${join(', ', ifs)} } iifname != { ${join(', ', ifs)} } ct state new jump to_device`);
	push(t, '	}');
	push(t, '	chain to_device {');
	push(t, '		meta nfproto ipv6 drop');
	push(t, '		ct status dnat accept');
	push(t, '		ip saddr @lan_nets ip saddr != @tun_nets ip daddr @lan_all accept');
	push(t, '		ip daddr . ip saddr @lan_part ip saddr != @tun_nets accept');
	push(t, '		counter reject with icmpx admin-prohibited');
	push(t, '	}');
	// Devices ask the tunnel address; send each query where it belongs.
	let to_resolver = rt.mode == 'ns' && ip4(rt.address) ? `dnat ip to ${rt.address}:53` : `redirect to :${+rt.port}`;
	let lan_dns = loop.lan_dns();
	if (!ip4(lan_dns))
		lan_dns = null;
	push(t, '	chain dns {');
	push(t, '		type nat hook prerouting priority dstnat - 5; policy accept;');
	if (length(ifs))
		// Home names (and no LAN DNS at all): the plain resolver, whatever address was asked.
		push(t, `		iifname { ${join(', ', ifs)} } ip saddr @dns_real meta l4proto { tcp, udp } th dport 53 ${to_resolver}`);
	for (let id, srv in m.servers)
		for (let tn in core.tunnels(srv)) {
			// Everyone else: the LAN's DNS, through the netns (from the LAN side) when internet goes that way.
			let target = srv.lan_like && dns_addr ? `dnat ip to ${dns_addr}:53` : lan_dns ? `dnat ip to ${lan_dns}:53` : to_resolver;
			push(t, `		iifname "${tn.ifname}" ip daddr ${tn.address} meta l4proto { tcp, udp } th dport 53 ${target}`);
		}
	push(t, '	}');
	push(t, '}');
	return join('\n', t) + '\n';
}

/** Run an nft script (one transaction); null when it loaded, else what nft said. */
export function load(script) {
	ensure_dir(RUN_DIR);
	// A file of its own: two writers must never load each other's script.
	let f = `${RUN_DIR}/nft.${rand_hex(4)}.rules`;
	if (!write_file(f, script))
		return `couldn't write ${f}`;
	let r = sh(`nft -f ${f}`);
	unlink(f);
	if (r.code == 0)
		return null;
	// Without the random file name, so the same failure reads the same every time.
	return replace(trim(r.out), f, 'rules') || `nft exited with ${r.code}`;
};

/** Full table rebuild (structure changes: servers, home networks, DNS paths); null or the error. */
export function rebuild(m, sets) {
	return load('table inet dawnline\ndelete table inet dawnline\n' + table(m, sets));
};

/**
 * Replace the members of every runtime set at once; null or the error. Fails
 * as a whole when the table or one of its sets is missing (not loaded yet,
 * or an older shape): the caller then rebuilds.
 */
export function update(sets) {
	let s = '';
	for (let name in SETS) {
		s += `flush set inet dawnline ${name}\n`;
		if (length(sets[name]))
			s += `add element inet dawnline ${name} { ${join(', ', sets[name])} }\n`;
	}
	return load(s);
};

/** Is the table loaded (watchdog). */
export function present() {
	return system('nft list table inet dawnline >/dev/null 2>&1') == 0;
};

export function remove() {
	system('nft delete table inet dawnline 2>/dev/null');
};
