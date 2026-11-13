// How fast someone uses data lately, and where that leads against their limit,
// on the router's calendar; and that in one line of words, which the admin's
// meter tooltips and the portal's data row show.

import { addDays, bytes, dayDiff, parseDay } from './format';
import { fmt, locale, num } from './i18n';

/** Days the pace looks back over. */
const SPAN = 7;

/**
 * Bytes a day lately: the average of the complete days before today (today is
 * still running), the last 7 at most. `days` are totals, oldest first, today last.
 */
export function paceOf(days: number[]): number {
  const done = days.slice(Math.max(0, days.length - 1 - SPAN), -1);
  return done.length ? done.reduce((a, v) => a + v, 0) / done.length : 0;
}

/** A day against the average of the complete days (today left out): +62 is 62% over it. */
export function vsAverage(days: number[], i: number): number {
  const done = days.slice(0, -1);
  const avg = done.reduce((a, v) => a + v, 0) / Math.max(1, done.length);
  return avg > 0 ? Math.round(((days[i] - avg) / avg) * 100) : 0;
}

export type Forecast =
  /** At this pace the limit fills in `days`, on `on`. */
  | { kind: 'fills'; days: number; on: string }
  /** A limit month that holds until its reset on `on`, with about `reach` used by then. */
  | { kind: 'holds'; on: string; reach: number }
  /** Nothing to say: no limit, already full, or no use lately. */
  | { kind: 'none' };

/**
 * Where the pace leads: when the limit fills, or what is used by the day the
 * limit month ends (`reset`, the router's day; null: a limit for all time, or
 * no limit month running) when that comes first. `today` is the router's day.
 */
export function forecast(used: number, limit: number, pace: number, reset: string | null, today: string): Forecast {
  if (!limit || used >= limit || pace <= 0) return { kind: 'none' };
  const days = Math.ceil((limit - used) / pace);
  const on = addDays(today, days);
  if (reset && dayDiff(on, reset) >= 0) return { kind: 'holds', on: reset, reach: used + pace * Math.max(0, dayDiff(reset, today)) };
  return { kind: 'fills', days, on };
}

/** Where a week at this pace takes them, as a share of the limit (0..100). */
export function weekAhead(used: number, limit: number, pace: number): number {
  return limit ? Math.min(100, ((used + SPAN * pace) / limit) * 100) : 0;
}

/**
 * The pace in words: "2.1 GB a day lately · full in about 2 days, 4 Nov", or when
 * the limit month's reset comes first: "… · about 36 GB by the reset on 14 Dec".
 * Empty when there was no use lately.
 */
export function paceWords(used: number, limit: number, pace: number, reset: string | null, today: string): string {
  if (pace <= 0) return '';
  const base = fmt(_('%s a day lately'), bytes(pace));
  const f = forecast(used, limit, pace, reset, today);
  const on = (d: string) => parseDay(d).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
  if (f.kind === 'fills')
    return `${base} · ${fmt(N_(f.days, 'full in about %s day, %s', 'full in about %s days, %s'), num(f.days), on(f.on))}`;
  if (f.kind === 'holds') return `${base} · ${fmt(_('about %s by the reset on %s'), bytes(f.reach), on(f.on))}`;
  return base;
}
