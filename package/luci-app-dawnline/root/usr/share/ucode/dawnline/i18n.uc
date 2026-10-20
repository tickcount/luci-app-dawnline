// Dawnline — the backend's messages in the admin's language: what die()
// reports, the health checks, the updater's phases. Text is English in the
// code, wrapped in _() and N_() (web/i18n/extract.ts collects them into the
// luci-i18n-dawnline-<lang> catalog with the admin UI's strings), with
// placeholders filled by sprintf() after the lookup:
//
//   die(sprintf(_('Download failed: %s'), asset));
//
// Translated through LuCI's own catalog reader (luci.core, as LuCI's pages
// are) in the language use() set: the admin page's, sent with every RPC call
// (rpcd/ucode/luci.dawnline) and handed to the updater. With no language,
// no Dawnline translation installed for it, or no luci-base (the unit tests'
// rootfs), the English as written. The portal sets none: its page translates
// the messages it gets with its own catalog.

import { stat } from 'fs';

const DIR = '/usr/lib/lua/luci/i18n';

// A C module, loaded at run time: luci-base may be missing, and a static import would not compile then.
let lmo = null;
try {
	lmo = require('luci.core');
}
catch (e) {
	lmo = null;
}

let active = null;

/**
 * Speak `lang` from now on ("ru"; null or "en" for English). Only a language
 * with a Dawnline catalog: LuCI's others alone would translate a few words.
 */
export function use(lang) {
	active = null;
	if (!lmo || type(lang) != 'string' || lang == 'en' || !match(lang, /^[a-z][a-z][a-z]?([_-][A-Za-z][A-Za-z][A-Za-z]?[A-Za-z]?)?$/))
		return;
	lang = lc(replace(lang, '_', '-'));
	if (!stat(`${DIR}/dawnline.${lang}.lmo`))
		return;
	if (lmo.load_catalog(lang, DIR) && lmo.change_catalog(lang))
		active = lang;
};

/** The language use() set, when its catalog is in use; null for English. */
export function current() {
	return active;
};

/** `msg` in the language use() set (the English when the catalog has no translation). */
export function _(msg) {
	return (active ? lmo.translate(msg) : null) ?? msg;
};

/** `one` or `many` for n, by the language's plural rules (Russian has three forms). */
export function N_(n, one, many) {
	return (active ? lmo.ntranslate(n, one, many) : null) ?? (n == 1 ? one : many);
};

/**
 * A service log line's words, as written: the log is kept in English (the
 * agent that writes most of it has no language) and read later in any.
 * Marking them collects them into the catalog and into the admin page's list
 * of log templates, which puts each line into the reader's language when it
 * is shown (web/src/admin/events/logwords.ts): sprintf(L_('updated · %s → %s'), a, b).
 * Keep a line's English as it was: old lines match it too.
 */
export function L_(s) {
	return s;
};
