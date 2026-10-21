// Dawnline — watchdog. The agent runs it every minute: it checks what keeps
// people connected and repairs what it can, waiting longer after each repair
// that did not help. What it finds goes to the service log (English, as
// logged); its state to RUN_DIR for the Health page, whose chip names are put
// in the admin's language when they are read (view()). A cron job
// (libexec/dawnline/heartbeat) looks after the agent itself.

import { stat } from 'fs';
import { _, L_ } from 'dawnline.i18n';
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
 * What to look at: { id (= the Health check id), src, name (chip, stored in English: view()
 * shows names() by id), who (the log's subject), ok,
 * problem, back, detail?, repair: { what, run }? }. The log reads "<who> <problem> - <what>"; its
 * words are L_(): English in the log, translated where it is shown.
 */
function probes(m) {
	let out = [];
	// The tunnels check themselves: AmneziaWG (packages, kernel module, netifd) and each server's interface.
	let tunnels = awg.probes(m, { udp_listening: health.udp_listening, reapply: () => apply.apply(), owner: (ifn) => netifd.owner(ifn) });
	push(out, ...tunnels);
	// A tunnel's interface edited outside Dawnline (LuCI, uci) keeps that until
	// the next apply: set up again with Dawnline's settings. Only while
	// AmneziaWG itself works (its target comes first, and is fixed first).
	if (filter(tunnels, (p) => p.id == 'awg')[0]?.ok)
		for (let id, diff in netifd.drift(m)) {
			let srv = m.servers[id];
			push(out, {
				id: `cfg_${id}`, src: 'awg', name: `${srv.name} · interface settings`, who: srv.name, ok: !length(diff),
				problem: sprintf(L_('interface %s was changed outside Dawnline'), srv.ifname),
				back: sprintf(L_("interface %s has Dawnline's settings again"), srv.ifname),
				// Option names only: their values hold the server's private key.
				detail: () => sprintf(L_('Changed: %s.'), join(', ', diff)),
				repair: { what: L_('setting it up again'), run: () => apply.apply() },
			});
		}
	if (length(m.servers))
		push(out, {
			id: 'nft', src: 'dawnline', name: 'Access rules', who: L_('Access rules'), ok: nft.present(),
			problem: L_('are missing'), back: L_('are loaded again'),
			repair: { what: L_('loading them again'), run: () => apply.apply() },
		});

	if (length(filter(values(m.servers), (x) => x.private_key))) {
		let fw = apply.firewall_drift(m);
		push(out, {
			id: 'fw', src: 'dawnline', name: 'Firewall', who: L_('Firewall'), ok: fw == null,
			problem: fw == 'off' ? L_("isn't running on this router (fw4): tunnels and the portal are closed")
				: fw == 'changed' ? L_("rules for Dawnline were changed or removed") : L_("rules for Dawnline aren't loaded"),
			back: L_('rules for Dawnline are in place again'),
			// fw4 stopped on purpose is the admin's call: report it, do not start it.
			repair: fw == 'off' ? null : { what: L_('restoring them'), run: () => { apply.apply(); system('fw4 -q reload'); } },
		});
	}

	let s = m.settings;
	if (s.portal_enabled && !length(health.needs().https) && !length(health.tcp_port_owners(s.portal_port)))
		push(out, {
			id: 'portal', src: 'portal', name: 'Portal', who: L_('Personal portal'), ok: health.tcp_listening(s.portal_port),
			problem: sprintf(L_("isn't answering on port %d"), s.portal_port), back: L_('answers again'),
			detail: () => sh_out("logread -l 400 2>/dev/null | grep 'uhttpd' | grep -iE 'error|fail|cert|key|bind|address' | tail -n 4"),
			repair: { what: L_('restarting it'), run: restart_services },
		});

	// Only while a server is on: with all of them off it idles on loopback.
	if (stat(loop.RESOLVER.conf) && length(filter(values(m.servers), (x) => x.enabled && x.private_key)))
		push(out, {
			id: 'resolver', src: 'dawnline', name: 'Resolver', who: L_('DNS for Home-only devices'), ok: loop.resolver_running(),
			problem: L_("isn't running"), back: L_('runs again'),
			repair: { what: L_('restarting it'), run: restart_services },
		});

	push(out, {
		id: 'rpc', src: 'dawnline', name: 'LuCI link', who: 'LuCI', ok: system('ubus list luci.dawnline >/dev/null 2>&1') == 0,
		problem: L_("can't reach Dawnline (luci.dawnline is missing in rpcd)"), back: L_('reaches Dawnline again'),
		detail: () => sh_out('logread -l 400 2>/dev/null | grep rpcd | tail -n 4'),
		// A reload keeps LuCI logins; a restart (second try) signs everyone out —
		// and after three it stops: restarting rpcd every hour for good would
		// sign every admin out for good.
		repair: { what: L_('reloading rpcd'), max: 3, run: (n) => system(n > 1 ? '/etc/init.d/rpcd restart >/dev/null 2>&1' : '/etc/init.d/rpcd reload >/dev/null 2>&1') },
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
				slog(p.src, 'up', x.stuck ? sprintf(L_('%s · restored'), p.back)
					: x.tries ? sprintf(x.tries > 1 ? L_('%s (after %d repairs)') : L_('%s (after %d repair)'), p.back, x.tries) : p.back, null, p.who);
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
			slog(p.src, 'error', sprintf(L_("%s - not repaired again (%d repairs didn't help)"), p.problem, p.repair.max), p.detail?.(), p.who);
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
			slog(p.src, 'error', sprintf(L_("%s - %d repairs didn't help"), p.problem, x.tries), p.detail?.(), p.who);
		}
		if (now < x.next)
			continue;
		x.tries++;
		x.last = now;
		x.next = now + WAIT[min(x.tries, length(WAIT) - 1)];
		x.reported = true;
		if (!x.stuck)
			slog(p.src, 'repair', sprintf(L_('%s - %s'), p.problem, p.repair.what), p.detail?.(), p.who);
		try {
			p.repair.run(x.tries);
		}
		catch (e) {
			if (!x.stuck)
				slog(p.src, 'error', sprintf(L_("couldn't be repaired: %s"), e.message), null, p.who);
		}
		if (!x.stuck)
			push(repairs, { ts: now, id: p.id, name: p.name });
	}
	for (let id in keys(t))
		if (!seen[id])
			delete t[id];
	write_json(STATE, { last: now, targets: t, repairs }, 0o644);
};

/**
 * The chip names of probes() by target id, in the language of the call. The
 * others (AmneziaWG's, "Home · AmneziaWG") are names only and stay as stored.
 */
function names() {
	return {
		agent: _('Agent'), nft: _('Access rules'), fw: _('Firewall'), portal: _('Portal'),
		resolver: _('Resolver'), rpc: _('LuCI link'),
	};
}

/** A target's chip name in the language of the call: names(), a server's interface settings, else as stored. */
function chip_name(m, n, id, stored) {
	if (n[id])
		return n[id];
	let srv = substr(id, 0, 4) == 'cfg_' ? m.servers[substr(id, 4)] : null;
	return srv ? sprintf(_('%s · interface settings'), srv.name) : stored;
}

/**
 * For the Health page: the watchdog's state and the newest log entries. Target
 * and repair names in the language of the call; the log as it was written.
 */
export function view(m) {
	let st = read_json(STATE, {});
	let beat = +(read_json(BEAT, 0) ?? 0);
	let n = names();
	// The agent itself: fine while it ticks (cron restarts it after 5 minutes without).
	let targets = [ { id: 'agent', name: n.agent, ok: beat > 0 && time() - beat < 180, tries: 0 } ];
	for (let id, x in (type(st.targets) == 'object' ? st.targets : {}))
		push(targets, { id, name: chip_name(m, n, id, x.name), ok: !!x.ok, tries: x.tries ?? 0 });
	return {
		watchdog: {
			enabled: m.settings.watchdog, last: st.last ?? null, beat: beat || null, now: time(),
			targets, repairs: map(st.repairs ?? [], (r) => ({ ...r, name: chip_name(m, n, r.id, r.name) })),
		},
		log: slog_read(200),
	};
};
