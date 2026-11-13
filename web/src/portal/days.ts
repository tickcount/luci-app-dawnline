// The days the access section draws, as plain data: the weeks left as a
// calendar. Pure (no DOM): page/access.ts draws it; dates are the router's
// (`today` from its state), never the browser's calendar.

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

/**
 * A far end, one cell a week instead of a day: from this week to the one access ends in (this week, the weeks
 * left, the last one). Null past `maxWeeks` (the number of days says it alone). `day` is the week's Monday.
 */
export function weeks(today: string, end: string, maxWeeks = 28): Cell[] | null {
  const dow = (d: string) => (parseDay(d).getDay() + 6) % 7;
  const first = addDays(today, -dow(today));
  const last = addDays(end, -dow(end));
  const cells: Cell[] = [];
  for (let d = first; d <= last; d = addDays(d, 7)) {
    cells.push({ day: d, kind: d === first ? 'today' : d === last ? 'end' : 'left' });
    if (cells.length > maxWeeks) return null;
  }
  return cells;
}
