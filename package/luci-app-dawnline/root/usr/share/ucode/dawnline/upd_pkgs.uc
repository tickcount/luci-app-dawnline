// Dawnline updater: the OpenWrt packages Dawnline adds — the home-like link
// (ip-full, kmod-veth) and HTTPS plus certificates for the personal portal —
// checked against and updated from the OpenWrt feeds.
// ctx is the updater's job context (see usr/libexec/dawnline/updater).

import * as pkg from 'dawnline.pkg';

/** What Dawnline itself adds to OpenWrt (the rest of LuCI, ucode, rpcd and uhttpd is the stock system). */
export const NAMES = [ 'ip-full', 'kmod-veth', 'libustream-openssl', 'openssl-util', 'acme', 'acme-acmesh-dnsapi', 'luci-app-acme' ];

// Packages released together with each of the above, updated as a set so OpenSSL never ends up
// half old and half new.
const FAMILY = [
	[ /^ip-full$/, /^ip-/ ],
	[ /^(libustream-openssl|openssl-util)$/, /^(libustream-openssl|libopenssl|openssl-util$)/ ],
	[ /^(acme|luci-app-acme$)/, /^acme/ ],
];

function family(p) {
	for (let f in FAMILY)
		if (match(p, f[0]))
			return f[1];
	return null;
}

/** The packages to update for these names: each one plus its upgradable family. */
function with_family(names, up) {
	let set = {};
	for (let n in names) {
		if (up[n])
			set[n] = true;
		let f = family(n);
		if (f)
			for (let u in keys(up))
				if (match(u, f))
					set[u] = true;
	}
	return sort(keys(set));
}

/** refresh: update the package lists first (a check by hand or on schedule). */
export function check(ctx, refresh) {
	if (refresh ?? true) {
		ctx.phase('Refreshing package lists');
		pkg.refresh();
	}
	let up = pkg.upgradable();
	let res = {}, all = {};
	for (let p in NAMES) {
		let v = pkg.version(p);
		let set = v ? with_family([ p ], up) : [];
		res[p] = { installed: v, latest: v && up[p] ? up[p] : null, with: filter(set, (x) => x != p) };
		for (let x in set)
			all[x] = true;
	}
	let n = length(keys(all));
	ctx.log(n ? `${n} package update${n == 1 ? '' : 's'} in the feeds: ${join(', ', sort(keys(all)))}` : 'System packages are up to date');
	return { pkgs: res, updates: n, status: n ? 'outdated' : 'latest' };
};

/** arg: name,name,… (only names Dawnline manages): missing ones are installed, present ones updated with their family. */
export function install(ctx, arg) {
	let names = filter(split(arg ?? '', ','), (x) => x != '');
	for (let n in names)
		if (index(NAMES, n) < 0)
			die(`${n} is not a package Dawnline manages`);
	if (!length(names))
		die('Nothing to install');
	ctx.phase('Refreshing package lists');
	pkg.refresh(ctx.log);
	let missing = filter(names, (n) => pkg.version(n) == null);
	let have = with_family(filter(names, (n) => pkg.version(n) != null), pkg.upgradable());
	if (length(have)) {
		ctx.phase(`Updating ${join(', ', have)}`);
		if (!pkg.upgrade(have, ctx.log))
			die('Update failed');
	}
	if (length(missing)) {
		ctx.phase(`Installing ${join(', ', missing)}`);
		if (!pkg.add(missing, ctx.log))
			die('Installation failed');
	}
	// The portal's HTTPS runs in uhttpd; a piece that just arrived lets the portal or the home-like link start.
	let touched = [ ...missing, ...have ];
	if (length(filter(missing, (n) => match(n, /^(openssl-util|libustream|ip-full|kmod-veth)/)))) {
		ctx.after('apply');
		ctx.after('uhttpd');
	}
	else if (length(filter(touched, (n) => match(n, /^(libustream|libopenssl)/))))
		ctx.after('uhttpd');
	return { updated: have, installed: missing, check: check(ctx, false) };
};
