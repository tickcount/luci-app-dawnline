// The router's clock for the log: days and times in the router's time zone
// (status.tz, minutes east of UTC), not the browser's (code-standards: time
// and dates come from the router). A router too old to send its offset reads
// in the browser's. Pure: no DOM.

import { ago, fmtDay, parseDay } from '../../shared/format';
import { fmt, locale } from '../../shared/i18n';

/** The offset to use at `ts` (minutes): the router's, else the browser's at that moment. */
const offsetAt = (ts: number, tz?: number): number => tz ?? -new Date(ts * 1000).getTimezoneOffset();

/** The router's day of `ts`: YYYY-MM-DD. */
export const routerDay = (ts: number, tz?: number): string => new Date((ts + offsetAt(ts, tz) * 60) * 1000).toISOString().slice(0, 10);

/** The router's time of day of `ts`: HH:MM (24 h: the log's column lines up in every language). */
export const routerTime = (ts: number, tz?: number): string => new Date((ts + offsetAt(ts, tz) * 60) * 1000).toISOString().slice(11, 16);

/** The day before a YYYY-MM-DD. */
export const dayBefore = (day: string): string => new Date(Date.parse(`${day}T12:00:00Z`) - 86400_000).toISOString().slice(0, 10);

/** A day's heading: Today, Yesterday, else "6 Nov" ("6 Nov 2025" in another year). */
export function dayTitle(day: string, today: string): string {
  if (day === today) return _('Today');
  if (day === dayBefore(today)) return _('Yesterday');
  if (day.slice(0, 4) !== today.slice(0, 4)) return fmtDay(day);
  return parseDay(day).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
}

/** The router's day and time of `ts`: "8 Nov, 12:40" (the year too when it is another). */
export function routerDate(ts: number, tz: number | undefined, now = ts): string {
  const day = routerDay(ts, tz);
  const d = parseDay(day).toLocaleDateString(locale(), {
    day: 'numeric',
    month: 'short',
    year: day.slice(0, 4) === routerDay(now, tz).slice(0, 4) ? undefined : 'numeric',
  });
  return fmt(_('%s, %s'), d, routerTime(ts, tz));
}

/** When `ts` was, near: "today at 17:40", "yesterday at 17:40", "6 Nov at 17:40" (within 30 days), else "2 months ago". */
export function whenAt(ts: number, now: number, tz?: number): string {
  const today = routerDay(now, tz);
  const day = routerDay(ts, tz);
  const at = routerTime(ts, tz);
  if (day === today) return fmt(_('today at %s'), at);
  if (day === dayBefore(today)) return fmt(_('yesterday at %s'), at);
  if (now - ts < 30 * 86400) return fmt(_('%s at %s'), parseDay(day).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }), at);
  return ago(ts, now);
}

/** The router's offset as a zone: "UTC+3", "UTC+5:30", "UTC−4", "UTC". */
export function zoneLabel(tz: number): string {
  if (!tz) return 'UTC';
  const a = Math.abs(tz);
  return `UTC${tz > 0 ? '+' : '−'}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, '0')}` : ''}`;
}
