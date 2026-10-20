// Translation helpers for the admin UI and the portal. Text is English in the
// code and goes through the globals _() and N_(): LuCI's own in the admin UI
// (cbi.js, looking up the luci-i18n-dawnline-* catalog of the page's
// language), installed by the portal from its bundled catalog (portal/i18n.ts).
// web/i18n/extract.ts collects the strings into the catalogs; how to write them
// is in rules/i18n.md.
//
// Placeholders are %s and %d, filled in order by fmt() (LuCI's
// String.format exists only in the admin UI). Numbers and dates follow the
// page's language: <html lang>, which LuCI sets from its language and the
// portal from the visitor's choice.

/** The page's language: "en", "ru". */
export function lang(): string {
  return (typeof document === 'undefined' ? '' : document.documentElement.lang) || 'en';
}

/** The locale for Intl: English dates stay day-first (en-GB), as before translations. */
export function locale(): string {
  const l = lang();
  return l === 'en' ? 'en-GB' : l;
}

/** %s and %d replaced by the arguments in order, %% by a percent sign. */
export function fmt(s: string, ...args: unknown[]): string {
  let i = 0;
  return s.replace(/%([%sd])/g, (_m, c: string) => (c === '%' ? '%' : String(args[i++] ?? '')));
}

/** A number in the page's language: 2,000 or 2 000; `digits` fixes the decimals. */
export function num(n: number, digits?: number): string {
  return n.toLocaleString(locale(), digits === undefined ? undefined : { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/**
 * A count with its word: plural(n, '%s event', '%s events') is "1 event",
 * "2,000 events" (and "21 событие", "22 события", "25 событий" in Russian).
 * Both forms are literals: extract.ts reads them as one plural entry.
 */
export function plural(n: number, one: string, many: string): string {
  return fmt(N_(n, one, many), num(n));
}

/**
 * A translated sentence with elements in it (a link, a <b>): the text around
 * the placeholders and the arguments, in order, as children for E() or h().
 * fill(_('Install it in %s'), link) is ['Install it in ', link].
 */
export function fill<T>(s: string, ...args: T[]): (string | T)[] {
  let i = 0;
  return s
    .split(/(%[%sd])/)
    .filter(Boolean)
    .map((p) => (p === '%%' ? '%' : p === '%s' || p === '%d' ? args[i++] : p));
}

/** A string the router or a generated list holds (not a literal here): in the page's language when the catalog has it. */
export const known = (s: string): string => _(s);
