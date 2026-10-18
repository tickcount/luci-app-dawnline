// Dawnline — watchdog. The agent runs it every minute: it checks what keeps
// people connected and repairs what it can, waiting longer after each repair
// that did not help. What it finds goes to the service log; its state to
// RUN_DIR for the Health page. A cron job (libexec/dawnline/heartbeat) looks
// after the agent itself.

import { stat } from 'fs';
import { sh_out, q, read_json, write_json, slog, slog_read, RUN_DIR } from 'dawnline.util';
import * as apply from 'dawnline.apply';
import * as loop from 'dawnline.loop';
import * as health from 'dawnline.health';
import * as awg from 'dawnline.awg';
import * as nft from 'dawnline.nft';
import * as netifd from 'dawnline.netifd';
import * as upd from 'dawnline.updates';

export const STATE = `${RUN_DIR}/watchdog.json`;
/** The agent writes the time here on every tick. */
export const BEAT = `${RUN_DIR}/agent.beat`;
// Seconds before the next repair, by the number of repairs so far.
const WAIT = [ 0, 120, 600, 1800, 3600 ];
// Good minutes in a row before a repaired target's count of repairs is
// forgotten: one good minute between two failures is still flapping.
const SETTLED = 10;

/** Why a tunnel is down (AmneziaWG; kept here for older callers). */
export function iface_errors(ifname) {
	return awg.iface_errors(ifname);
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
	// The tunnels check themselves: AmneziaWG (packages, kernel module, netifd) and each server's interface.
	push(out, ...awg.probes(m, { udp_listening: health.udp_listening, reapply: () => apply.apply(), owner: (ifn) => netifd.owner(ifn) }));
	if (length(m.servers))
		push(out, {
			id: 'nft', src: 'dawnline', name: 'Access rules', who: 'Access rules', ok: nft.present(),
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
	if (s.portal_enabled && !length(health.needs().https) && !length(health.tcp_port_owners(s.portal_port)))
		push(out, {
			id: 'portal', src: 'portal', name: 'Portal', who: 'Personal portal', ok: health.tcp_listening(s.portal_port),
			problem: `isn't answering on port ${s.portal_port}`, back: 'answers again',
			detail: () => sh_out("logread -l 400 2>/dev/null | grep 'uhttpd' | grep -iE 'error|fail|cert|key|bind|address' | tail -n 4"),
			repair: { what: 'restarting it', run: restart_services },
		});

	// Only while a server is on: with all of them off it idles on loopback.
	if (stat(loop.RESOLVER.conf) && length(filter(values(m.servers), (x) => x.enabled && x.private_key)))
		push(out, {
			id: 'resolver', src: 'dawnline', name: 'Resolver', who: 'DNS for Home-only devices', ok: loop.resolver_running(),
			problem: "isn't running", back: 'runs again',
			repair: { what: 'restarting it', run: restart_services },
		});

	push(out, {
		id: 'rpc', src: 'dawnline', name: 'LuCI link', who: 'LuCI', ok: system('ubus list luci.dawnline >/dev/null 2>&1') == 0,
		problem: "can't reach Dawnline (luci.dawnline is missing in rpcd)", back: 'reaches Dawnline again',
		detail: () => sh_out('logread -l 400 2>/dev/null | grep rpcd | tail -n 4'),
		// A reload keeps LuCI logins; a restart (second try) signs everyone out —
		// and after three it stops: restarting rpcd every hour for good would
		// sign every admin out for good.
		repair: { what: 'reloading rpcd', max: 3, run: (n) => system(n > 1 ? '/etc/init.d/rpcd restart >/dev/null 2>&1' : '/etc/init.d/rpcd reload >/dev/null 2>&1') },
	});
	return out;
}

/** One pass. With repairs off it only reports. */
export function run(m) {
	let now = time();
	let fix = m.settings.watchdog;
	// An update is replacing packages or restarting tunnels: what looks broken
	// meanwhile is being worked on; repairs would only get in its way.
	let busy = upd.busy();
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
			x.next = 0;
			x.reported = false;
			x.stuck = false;
			// The repairs so far are forgotten only once it has stayed up a while:
			// a target that fails every other minute keeps its back-off.
			x.good = (x.good ?? 0) + 1;
			if (x.good >= SETTLED) {
				x.tries = 0;
				x.good = 0;
			}
			continue;
		}
		x.good = 0;
		// One bad minute can be a restart in progress.
		if (++x.bad < 2)
			continue;
		if (busy)
			continue;
		if (p.repair?.max && x.tries >= p.repair.max && !x.reported) {
			slog(p.src, 'error', `${p.problem} — not repaired again (${p.repair.max} repairs didn't help)`, p.detail?.(), p.who);
			x.reported = true;
			continue;
		}
		if (!fix || !p.repair || (p.repair.max && x.tries >= p.repair.max)) {
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
