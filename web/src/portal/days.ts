// The days and hours the access section draws, as plain data: the weeks left
// as a calendar, the admin's hours moved into the visitor's time, the month as
// one bar a day. Pure (no DOM): page/access.ts draws it; dates are the
// router's (`today` from its state), never the browser's calendar.

import { addDays, parseDay } from '../shared/format';

type CellKind = 'past' | 'today' | 'left' | 'end' | 'after';
export interface Cell {
  day: string;
  kind: CellKind;
}

/**
 * The weeks from this one to the one the access ends in, Monday first, one
 * cell a day: gone, today, left, the last day, after it. Null when that would
 * take more than `maxWeeks` (far ends: the number of days says it alone).
 */
export function calendar(today: string, end: string, maxWeeks = 10): Cell[] | null {
  const dow = (d: string) => (parseDay(d).getDay() + 6) % 7;
  const first = addDays(today, -dow(today));
  const last = addDays(end, 6 - dow(end));
  const cells: Cell[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) {
    cells.push({ day: d, kind: d < today ? 'past' : d === today ? 'today' : d < end ? 'left' : d === end ? 'end' : 'after' });
    if (cells.length > maxWeeks * 7) return null;
  }
  return cells;
}

const HM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
/** "08:30" → 510, or null for anything else. */
export function minuteOf(t: string): number | null {
  const m = HM.exec(t.trim());
  return m ? +m[1] * 60 + +m[2] : null;
}
const wrap = (m: number) => ((m % 1440) + 1440) % 1440;
export const clockOf = (m: number) => `${String(Math.floor(wrap(m) / 60)).padStart(2, '0')}:${String(wrap(m) % 60).padStart(2, '0')}`;

export interface Hours {
  /** Start and end, minutes after midnight in the visitor's time. */
  from: number;
  to: number;
  /** In the visitor's time (the router told its offset), or the router's own. */
  yours: boolean;
}

/**
 * The admin's hours ("08:00-22:00", router time) in the visitor's time. The
 * offsets are minutes east of UTC; without the router's offset the hours stay
 * in the router's time. Null when they cannot be read.
 */
export function hoursFor(hours: string, routerOffset: number | undefined, visitorOffset: number): Hours | null {
  const [a, b] = hours.split('-');
  const from = minuteOf(a ?? '');
  const to = minuteOf(b ?? '');
  if (from == null || to == null) return null;
  const shift = routerOffset == null ? 0 : visitorOffset - routerOffset;
  return { from: wrap(from + shift), to: wrap(to + shift), yours: routerOffset != null };
}

/** The window as stretches of the day: one, or two when it runs past midnight. */
export const stretches = (h: Hours): [number, number][] =>
  h.from < h.to
    ? [[h.from, h.to]]
    : [
        [h.from, 1440],
        [0, h.to],
      ];

/** The moment `nowSec` (epoch seconds) as minutes after midnight at `offset` minutes east of UTC. */
export const minuteAt = (nowSec: number, offset: number) => wrap(Math.floor(nowSec / 60) + offset);

/** The days of today's month: how many, and which one today is (1-based). */
export function monthOf(today: string): { days: number; day: number } {
  const d = parseDay(today);
  return { days: new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(), day: d.getDate() };
}
