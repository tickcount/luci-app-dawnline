// Dawnline — the portal's certificate (configured, ACME or self-signed) and
// the addresses its links could use.

import { lsdir } from 'fs';
import { cursor } from 'uci';
import { q, sh, sh_out, ensure_dir, file_exists, valid_host, ip2int, cloudflare_ip, DATA_DIR } from 'dawnline.util';
import * as core from 'dawnline.core';
import * as lookup from 'dawnline.lookup';

/** The DNS names a certificate file covers. */
export function cert_names(path) {
	let sans = sh_out(`openssl x509 -in ${q(path)} -noout -text 2>/dev/null | grep -o 'DNS:[^,]*'`) ?? '';
	return filter(split(replace(sans, /DNS:/g, ''), /[ \t\r\n]+/), (x) => x != '');
};

/** A certificate name covers host: the same name, or a wildcard one level up. */
export function name_covers(name, host) {
	if (name == host)
		return true;
	let dot = index(host ?? '', '.');
	return substr(name, 0, 2) == '*.' && dot > 0 && substr(host, dot) == substr(name, 1);
};

// A module constant, compiled once, not for each file of the directory.
const FULLCHAIN = /^(.+)\.fullchain\.crt$/;

/** ACME certificates on the router and the names each covers. */
export function acme_certs() {
	let out = [];
	for (let f in sort(lsdir('/etc/ssl/acme') ?? [])) {
		let m = match(f, FULLCHAIN);
		if (!m)
			continue;
		let c = `/etc/ssl/acme/${f}`, k = `/etc/ssl/acme/${m[1]}.key`;
		if (file_exists(k))
			push(out, { cert: c, key: k, names: cert_names(c) });
	}
	return out;
};

/** The ACME certificate that covers host (exact name or a wildcard), if any. */
export function acme_cert_for(host) {
	for (let a in acme_certs())
		for (let n in a.names)
			if (name_covers(n, host))
				return a;
	return null;
};

/** Certificate the portal should use: configured, ACME for the host, or self-signed. */
export function portal_cert(s) {
	if (s.portal_cert && s.portal_key && file_exists(s.portal_cert) && file_exists(s.portal_key))
		return { cert: s.portal_cert, key: s.portal_key, self_signed: false };
	if (s.portal_host) {
		for (let base in [ `/etc/ssl/acme/${s.portal_host}`, `/etc/acme/${s.portal_host}_ecc/${s.portal_host}` ]) {
			let c = `${base}.fullchain.crt`, k = `${base}.key`;
			if (file_exists(c) && file_exists(k))
				return { cert: c, key: k, self_signed: false };
		}
		// An ACME certificate issued for several names, the portal's among them.
		let a = acme_cert_for(s.portal_host);
		if (a)
			return { cert: a.cert, key: a.key, self_signed: false };
	}
	let c = `${DATA_DIR}/portal.crt`, k = `${DATA_DIR}/portal.key`;
	if (!file_exists(c) || !file_exists(k)) {
		ensure_dir(DATA_DIR, 0o700);
		let cn = s.portal_host || 'dawnline';
		sh(`openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 3650 -subj ${q('/CN=' + cn)} -keyout ${k} -out ${c}`);
		system(`chmod 600 ${k}`);
	}
	return { cert: c, key: k, self_signed: true };
};

/*
 * Addresses the portal could use in links, found on the router: names in ACME
 * certificates, server endpoints, DDNS names, the current one, and the WAN IP.
 * Each says where it points and whether a certificate covers it.
 */
export function portal_candidates(m) {
	let wan = lookup.router_wan(m);
	let names = [];
	let add = (h) => {
		if (h && valid_host(h) && ip2int(h) == null && substr(h, 0, 2) != '*.' && index(names, h) < 0)
			push(names, h);
	};
	let certs = acme_certs();
	for (let a in certs)
		for (let n in a.names)
			add(n);
	for (let id, srv in m.servers)
		add(srv.endpoint);
	let dc = cursor();
	if (dc.load('ddns'))
		dc.foreach('ddns', 'service', (sv) => {
			if (sv.enabled != '0') {
				add(sv.lookup_host);
				add(sv.domain);
			}
		});
	for (let h in core.portal_hosts(m))
		add(h);
	let found = lookup.resolve_all(names);
	let covered = (h) => length(filter(certs, (a) => length(filter(a.names, (n) => name_covers(n, h))) > 0)) > 0;
	let out = [];
	for (let h in names) {
		let ips = found[h] ?? [];
		push(out, { host: h, kind: 'name', ips, here: wan != null && index(ips, wan) >= 0,
			cloudflare: length(filter(ips, (x) => cloudflare_ip(x))) > 0, cert: covered(h) });
	}
	if (wan)
		push(out, { host: wan, kind: 'ip', ips: [ wan ], here: true, cloudflare: false, cert: false });
	for (let ph in core.portal_hosts(m))
		if (ip2int(ph) != null && ph != wan)
			push(out, { host: ph, kind: 'ip', ips: [ ph ], here: false, cloudflare: false, cert: false });
	// Best first: here with a certificate, then here, then the rest.
	let score = (c) => (c.here ? 4 : 0) + (c.cert ? 2 : 0) + (c.kind == 'name' ? 1 : 0) - (c.cloudflare ? 8 : 0);
	return sort(out, (a, b) => score(b) - score(a));
};
