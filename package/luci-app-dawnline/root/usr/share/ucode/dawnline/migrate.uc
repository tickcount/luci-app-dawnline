// Dawnline — one-time steps for routers set up by older versions. Each one
// checks first and writes nothing when there is nothing to do; dawnline.apply
// runs them before it takes its own lock (changes to /etc/config/dawnline go
// through dawnline.store and its config lock).

import { cursor } from 'uci';
import { stat, unlink } from 'fs';
import { q, slog } from 'dawnline.util';
import * as core from 'dawnline.core';
import * as store from 'dawnline.store';

const LAN_CGI = '/www/cgi-bin/dawnline-portal';
const LAN_CGI_URL = '/cgi-bin/dawnline-portal';

/** Every personal code is a word code; older random ones are replaced (their links stop working). */
function word_codes() {
	let old = (s) => s.code != null && !match(s.code, core.WORD_CODE);
	let c = cursor();
	c.load('dawnline');
	let any = false;
	c.foreach('dawnline', 'person', (s) => {
		if (old(s))
			any = true;
	});
	if (!any)
		return;
	store.transact((w, m) => {
		w.foreach('dawnline', 'person', (s) => {
			if (old(s)) {
				w.set('dawnline', s['.name'], 'code', core.new_code());
				w.delete('dawnline', s['.name'], 'words');
			}
		});
	});
	slog('dawnline', 'info', 'moved to word codes', null, 'Personal links');
}

/*
 * Older versions answered on 443 at home through LuCI's web server (its error
 * page ran the portal CGI). The portal now keeps its own port: remove that.
 */
export function uhttpd() {
	let c = cursor();
	c.load('uhttpd');
	if (c.get('uhttpd', 'main', 'error_page') == LAN_CGI_URL) {
		c.delete('uhttpd', 'main', 'error_page');
		c.commit('uhttpd');
		system('/etc/init.d/uhttpd reload >/dev/null 2>&1');
		system(`logger -t dawnline ${q('portal removed from the LuCI web server')}`);
	}
	if (stat(LAN_CGI))
		unlink(LAN_CGI);
	// The old setting itself.
	let d = cursor();
	d.load('dawnline');
	if (d.get('dawnline', 'settings', 'portal_443') != null)
		store.transact((w, m) => w.delete('dawnline', 'settings', 'portal_443'));
};

/** All of them, in order. */
export function run() {
	word_codes();
	uhttpd();
};
