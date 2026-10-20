// Dawnline — netifd: one AmneziaWG interface per server, named after its
// ifname and marked `_dawnline` = server id. Only interfaces Dawnline created
// are changed or removed: a name already used by another interface (`lan`, a
// tunnel of your own, one from an imported config) is left alone and the
// server is reported instead. Why a server is kept down is kept in
// core.BLOCKED as a code with its values (awg.blocked_text says it).

import { cursor } from 'uci';
import { stat, unlink, writefile } from 'fs';
import { q, uci_put, uci_section, ack_config, iface_intent, ensure_dir, read_json, write_json, slog, RUN_DIR } from 'dawnline.util';
import * as core from 'dawnline.core';
import * as awg from 'dawnline.awg';
import { L_ } from 'dawnline.i18n';

// Set while AmneziaWG is missing and that was logged (once until it is back).
const NO_AWG = `${RUN_DIR}/netifd-no-awg`;

function log(who, msg, level, detail) {
	slog('dawnline', level ?? 'info', msg, detail, who);
}

/** The server id that owns network.<ifname>: null when the section is free, '' when someone else's. */
export function owner(ifname, c) {
	if (!c) {
		c = cursor();
		c.load('network');
	}
	if (c.get('network', ifname) == null)
		return null;
	return c.get('network', ifname, '_dawnline') ?? '';
};

/** Bring network config in line with the servers; true when it changed. */
export function sync(m) {
	let c = cursor();
	c.load('network');
	let changed = false, touched = [], want = {};
	// Servers whose interface can't be set up (core.BLOCKED), each logged once while it lasts.
	let was = read_json(core.BLOCKED, {}), blocked = {};
	let block = (srv, why, detail) => {
		blocked[srv.id] = why;
		// The rest of this apply works from the same model: no tunnel for it there either.
		srv.blocked = why;
		if (sprintf('%J', was[srv.id]) != sprintf('%J', why))
			log(srv.name, awg.blocked_note(why), 'error', detail);
	};

	// Without amneziawg-tools there is no protocol script: changing or bringing
	// up an interface would only stop a tunnel that is still running.
	let tools = awg.state().tools;
	if (tools && stat(NO_AWG))
		unlink(NO_AWG);
	else if (!tools && length(filter(values(m.servers), (s) => s.private_key)) && !stat(NO_AWG)) {
		log('AmneziaWG', L_("isn't installed: tunnels were left as they are"), 'error', L_('Install it in Dawnline → Components.'));
		ensure_dir(RUN_DIR);
		writefile(NO_AWG, `${time()}`);
	}

	for (let id, srv in m.servers) {
		if (!srv.private_key)
			continue;
		let ifn = srv.ifname;
		if (!core.valid_ifname(ifn)) {
			block(srv, { code: 'ifname', ifname: ifn }, 'Interface name: 1-12 lowercase letters, digits or _.');
			continue;
		}
		let own = owner(ifn, c);
		if (own != null && own != id) {
			block(srv, { code: 'taken', ifname: ifn },
				'Dawnline never changes interfaces it did not create. Choose another interface name for this server.');
			continue;
		}
		// A disguise this build cannot run (a 3.1 preset after a rollback to
		// 2.0): the kernel would drop those options silently and run a tunnel
		// no device can reach. Down, and said so, until the build or the
		// disguise is changed.
		let why = tools ? awg.obf_unsupported(srv.obf) : null;
		if (why) {
			block(srv, why, 'Install that AmneziaWG build in Dawnline → Components, or switch the disguise on the Server page.');
			continue;
		}
		delete srv.blocked;
		want[ifn] = true;
		if (!tools)
			continue;
		// Per server: with several, each changed one has to be brought up again.
		let mine = uci_section(c, 'network', ifn, 'interface');
		let set = (opt, val) => {
			if (uci_put(c, 'network', ifn, opt, val))
				mine = true;
		};
		for (let k, v in awg.netifd_options(srv))
			set(k, v);
		set('disabled', srv.enabled ? null : '1');
		set('auto', srv.enabled ? null : '0');
		set('_dawnline', id);
		// For the log once the server is gone.
		set('_dawnline_name', srv.name);
		if (mine) {
			changed = true;
			push(touched, ifn);
			// The hotplug log says why the tunnel goes down (not a failure).
			iface_intent(ifn, srv.enabled ? 'settings' : 'off', srv.name);
		}
	}

	if (sprintf('%J', blocked) != sprintf('%J', was)) {
		ensure_dir(RUN_DIR);
		write_json(core.BLOCKED, blocked, 0o644);
	}

	// Remove interfaces Dawnline created for servers that no longer exist.
	let stale = [];
	c.foreach('network', 'interface', (s) => {
		if (s._dawnline && !want[s['.name']])
			push(stale, s['.name']);
	});
	for (let ifn in stale) {
		iface_intent(ifn, 'removed', c.get('network', ifn, '_dawnline_name') ?? ifn);
		system(`ifdown ${q(ifn)} 2>/dev/null`);
		c.delete('network', ifn);
		changed = true;
	}

	if (changed) {
		c.commit('network');
		ack_config([ 'network' ]);
		system('ubus call network reload');
		for (let ifn in touched)
			if (m.servers[c.get('network', ifn, '_dawnline')]?.enabled)
				system(`ifup ${q(ifn)}`);
		// Each tunnel's own line (restarting, turned off, removed) comes from hotplug.
		system(`logger -t dawnline ${q('network updated: ' + join(', ', [ ...touched, ...stale ]))}`);
	}
	return changed;
};
