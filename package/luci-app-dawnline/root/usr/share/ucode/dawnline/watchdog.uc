// Dawnline — watchdog. The agent runs it every minute: it checks what keeps
// people connected and repairs what it can, waiting longer after each repair
// that did not help. What it finds goes to the service log; its state to
// RUN_DIR for the Health page. A cron job (libexec/dawnline/heartbeat) looks
// after the agent itself.

import { stat } from 'fs';
import { sh_out, q, read_json, write_json, slog, slog_read, RUN_DIR } from 'dawnline.util';
import * as core from 'dawnline.core';
import * as live from 'dawnline.live';
import * as apply from 'dawnline.apply';
import * as loop from 'dawnline.loop';
import * as ops from 'dawnline.ops';

export const STATE = `${RUN_DIR}/watchdog.json`;
/** The agent writes the time here on every tick. */
export const BEAT = `${RUN_DIR}/agent.beat`;
// Seconds before the next repair, by the number of repairs so far.
const WAIT = [ 0, 120, 600, 1800, 3600 ];

/** Why a tunnel is down, from netifd and the last related syslog lines. */
export function iface_errors(ifname) {
	let s = live.iface_status(ifname);
	let errs = map(s?.errors ?? [], (e) => e.code + (length(e.data ?? []) ? ` (${join(' ', e.data)})` : ''));
	// Only what explains a failure, not the ordinary "is now up/down" lines.
	let lines = sh_out(`logread -l 400 2>/dev/null | grep -E ${q(`${ifname}|amneziawg`)} | grep -iE 'error|fail|invalid|unrecogni|cannot|unable|not found|refused|denied' | tail -n 6`);
	return join('\n', filter([ length(errs) ? `netifd: ${join(', ', errs)}` : null, lines ], (x) => x));
};

function restart_services() {
	// procd keeps unchanged instances (the agent running this) and starts missing ones.
	system('/etc/init.d/dawnline start >/dev/null 2>&1');
}

/**
 * What to look at: { id (= the Health check id), src, name (chip), who (the log's subject), ok,
 * problem, back, detail?, repair: { what, run }? }. The log reads "<who> <problem> — <what>".
 */
function probes(m) {
	let out = [];
	// The kernel module first: without it no tunnel can run (they come back on the next pass).
	if (length(filter(values(m.servers), (x) => x.enabled && x.private_key)) && stat('/usr/bin/awg'))
		push(out, {
			id: 'awg', src: 'awg', name: 'AmneziaWG', who: 'AmneziaWG', ok: stat('/sys/module/amneziawg') != null,
			problem: "kernel module isn't loaded", back: 'kernel module is loaded again',
			detail: () => sh_out("modprobe amneziawg 2>&1; dmesg 2>/dev/null | grep -i amneziawg | grep -iE 'error|fail|invalid|unknown|disagrees|taint' | tail -n 4"),
			repair: { what: 'loading it', run: () => system('modprobe amneziawg >/dev/null 2>&1') },
		});
	for (let id, srv in m.servers) {
		if (!srv.enabled || !srv.private_key)
			continue;
		let s = live.iface_status(srv.ifname);
		let up = !!s?.up;
		push(out, {
			id: `up_${id}`, src: 'awg', name: srv.name, who: srv.name, ok: up && ops.udp_listening(srv.port),
			problem: !s ? 'is missing from the router' : !up ? "isn't running" : `isn't accepting connections on port ${srv.port}`,
			back: `is running again · accepting connections on port ${srv.port}`,
			detail: () => iface_errors(srv.ifname),
			repair: s ? { what: 'restarting it', run: () => system(`ifup ${q(srv.ifname)}`) } : { what: 'setting it up again', run: () => apply.apply() },
		});
	}
	if (length(m.servers))
		push(out, {
			id: 'nft', src: 'dawnline', name: 'Access rules', who: 'Access rules', ok: system('nft list table inet dawnline >/dev/null 2>&1') == 0,
			problem: 'are missing', back: 'are loaded again',
			repair: { what: 'loading them again', run: () => apply.apply() },
		});

	if (length(filter(values(m.servers), (x) => x.private_key))) {
		let fw = apply.firewall_drift(m);
		push(out, {
			id: 'fw', src: 'dawnline', name: 'Firewall', who: 'Firewall', ok: fw == null,
			problem: fw == 'off' ? "isn't running on this router (fw4): tunnels and the portal are closed"
				: fw == 'changed' ? "rules for Dawnline were changed or removed" : "rules for Dawnline aren't loaded",
			back: 'rules for Dawnline are in place again',
			// fw4 stopped on purpose is the admin's call: report it, do not start it.
			repair: fw == 'off' ? null : { what: 'restoring them', run: () => { apply.apply(); system('fw4 -q reload'); } },
		});
	}

	let s = m.settings;
	if (s.portal_enabled && core.portal_public_port(m) == 443 && s.portal_port != 443)
		push(out, {
			id: 'portal_lan', src: 'portal', name: 'Portal at home', who: 'Personal portal', ok: !apply.uhttpd_drift(m),
			problem: "links don't open at home (LuCI's web server lost the setting)", back: 'links open at home again',
			repair: { what: 'restoring it', run: () => apply.apply() },
		});
	if (s.portal_enabled && !length(ops.needs().https) && !length(ops.tcp_port_owners(s.portal_port)))
		push(out, {
			id: 'portal', src: 'portal', name: 'Portal', who: 'Personal portal', ok: ops.tcp_listening(s.portal_port),
			problem: `isn't answering on port ${s.portal_port}`, back: 'answers again',
			detail: () => sh_out("logread -l 400 2>/dev/null | grep 'uhttpd' | grep -iE 'error|fail|cert|key|bind|address' | tail -n 4"),
			repair: { what: 'restarting it', run: restart_services },
		});

	if (stat(loop.RESOLVER.conf))
		push(out, {
			id: 'resolver', src: 'dawnline', name: 'Resolver', who: 'DNS for Home-only devices', ok: loop.resolver_running(),
			problem: "isn't running", back: 'runs again',
			repair: { what: 'restarting it', run: restart_services },
		});

	push(out, {
		id: 'rpc', src: 'dawnline', name: 'LuCI link', who: 'LuCI', ok: system('ubus list luci.dawnline >/dev/null 2>&1') == 0,
		problem: "can't reach Dawnline (luci.dawnline is missing in rpcd)", back: 'reaches Dawnline again',
		detail: () => sh_out('logread -l 400 2>/dev/null | grep rpcd | tail -n 4'),
		// A reload keeps LuCI logins; a restart (second try) signs everyone out.
		repair: { what: 'reloading rpcd', run: (n) => system(n > 1 ? '/etc/init.d/rpcd restart >/dev/null 2>&1' : '/etc/init.d/rpcd reload >/dev/null 2>&1') },
	});
	return out;
}

/** One pass. With repairs off it only reports. */
export function run(m) {
	let now = time();
	let fix = m.settings.watchdog;
	let st = read_json(STATE, {});
	let t = type(st.targets) == 'object' ? st.targets : {};
	let repairs = filter(st.repairs ?? [], (r) => now - r.ts < 86400);
	let seen = {};
	for (let p in probes(m)) {
		seen[p.id] = true;
		let x = t[p.id] ??= { bad: 0, tries: 0, next: 0 };
		x.name = p.name;
		x.ok = p.ok;
		if (p.ok) {
			if (x.reported)
				slog(p.src, 'up', p.back + (x.stuck ? ' · restored' : x.tries ? ` (after ${x.tries} repair${x.tries > 1 ? 's' : ''})` : ''), null, p.who);
			x.bad = 0;
			x.tries = 0;
			x.next = 0;
			x.reported = false;
			x.stuck = false;
			continue;
		}
		// One bad minute can be a restart in progress.
		if (++x.bad < 2)
			continue;
		if (!fix || !p.repair) {
			if (!x.reported)
				slog(p.src, 'error', p.problem, p.detail?.(), p.who);
			x.reported = true;
			continue;
		}
		// Three repairs did not help: say so once, in red, and from then on keep
		// trying quietly until it works again (that is logged).
		if (x.tries >= 3 && !x.stuck && now - (x.last ?? 0) >= 50) {
			x.stuck = true;
			slog(p.src, 'error', `${p.problem} — ${x.tries} repairs didn't help`, p.detail?.(), p.who);
		}
		if (now < x.next)
			continue;
		x.tries++;
		x.last = now;
		x.next = now + WAIT[min(x.tries, length(WAIT) - 1)];
		x.reported = true;
		if (!x.stuck)
			slog(p.src, 'repair', `${p.problem} — ${p.repair.what}`, p.detail?.(), p.who);
		try {
			p.repair.run(x.tries);
		}
		catch (e) {
			if (!x.stuck)
				slog(p.src, 'error', `couldn't be repaired: ${e.message}`, null, p.who);
		}
		if (!x.stuck)
			push(repairs, { ts: now, id: p.id, name: p.name });
	}
	for (let id in keys(t))
		if (!seen[id])
			delete t[id];
	write_json(STATE, { last: now, targets: t, repairs }, 0o644);
};

/** For the Health page: the watchdog's state and the newest log entries. */
export function view(m) {
	let st = read_json(STATE, {});
	let beat = +(read_json(BEAT, 0) ?? 0);
	// The agent itself: fine while it ticks (cron restarts it after 5 minutes without).
	let targets = [ { id: 'agent', name: 'Agent', ok: beat > 0 && time() - beat < 180, tries: 0 } ];
	for (let id, x in (type(st.targets) == 'object' ? st.targets : {}))
		push(targets, { id, name: x.name, ok: !!x.ok, tries: x.tries ?? 0 });
	return {
		watchdog: {
			enabled: m.settings.watchdog, last: st.last ?? null, beat: beat || null, now: time(),
			targets, repairs: st.repairs ?? [],
		},
		log: slog_read(200),
	};
};
