// The portal's languages: English (the code's) and the translations bundled
// with it (i18n/<lang>.po, turned into lookup tables at build time). The page
// opens in the visitor's own choice, kept in this browser, or else in the
// first of the browser's (the system's) languages it has; the language menu in
// the breadcrumb switches it in place. This module installs the globals _()
// and N_() that the page and the shared code call (shared/i18n.ts), so it is
// imported before anything that draws.

import type { Catalog } from '../../i18n/po';
import ru from './i18n/ru.po';

export interface Lang {
  code: string;
  /** In its own language: what the menu lists. */
  name: string;
}

export const LANGS: Lang[] = [
  { code: 'en', name: 'English' },
  { code: 'ru', name: 'Русский' },
];

const catalogs: Record<string, Catalog[]> = { ru: [ru] };

/** Which plural form n takes (the index into the .po's msgstr[n]), by each language's gettext rule. */
const FORMS: Record<string, (n: number) => number> = {
  en: (n) => (n !== 1 ? 1 : 0),
  ru: (n) => (n % 10 === 1 && n % 100 !== 11 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2),
};

const STORE = 'dl.lang';

/** The language to open in: the visitor's kept choice, else the browser's first we have, else English. */
export function pickLang(kept: string | null, browser: readonly string[]): string {
  const have = (c: string | null | undefined) => (c && LANGS.some((l) => l.code === c) ? c : null);
  return have(kept) ?? browser.map((b) => have(b.toLowerCase().split(/[-_]/)[0])).find(Boolean) ?? 'en';
}

let current = 'en';
let active: Catalog[] = [];
const listeners: (() => void)[] = [];

const key = (s: string, ctx?: string) => (ctx ? `${ctx}\u0004${s}` : s);

function tr(s: string, ctx?: string): string {
  const k = key(s, ctx);
  for (const c of active) if (k in c.s) return c.s[k];
  return s;
}

function ntr(n: number, s: string, p: string, ctx?: string): string {
  const k = key(s, ctx);
  const forms = active.find((c) => k in c.p)?.p[k];
  return forms?.[(FORMS[current] ?? FORMS.en)(n)] ?? (n === 1 ? s : p);
}

export const lang = () => current;

/**
 * A message the router sent: in English when no translation is installed on
 * it, so the page translates the ones its catalog has (the backend's
 * portal.uc and devices.uc are in it).
 */
export const routerText = (msg: string) => tr(msg);

/** Switch the page's language; `keep`: remember it in this browser (the visitor chose it). */
export function setLang(code: string, keep = true) {
  current = LANGS.some((l) => l.code === code) ? code : 'en';
  active = catalogs[current] ?? [];
  document.documentElement.lang = current;
  if (keep)
    try {
      localStorage.setItem(STORE, current);
    } catch {
      /* no storage: the choice lasts this visit */
    }
  listeners.forEach((f) => f());
}

/** Redraw on a language change (main.ts: the page; the demo: its own parts). */
export function onLang(f: () => void) {
  listeners.push(f);
}

/** More strings for a language (the demo's own, from its catalog). */
export function addCatalog(code: string, c: Catalog) {
  (catalogs[code] ??= []).push(c);
  if (code === current) active = catalogs[code];
}

function kept(): string | null {
  try {
    return localStorage.getItem(STORE);
  } catch {
    return null;
  }
}

Object.assign(globalThis, { _: tr, N_: ntr });
setLang(pickLang(kept(), navigator.languages?.length ? navigator.languages : [navigator.language]), false);
