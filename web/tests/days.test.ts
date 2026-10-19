import { describe, expect, it } from 'vitest';
import { calendar, clockOf, hoursFor, minuteAt, minuteOf, monthOf, stretches } from '../src/portal/days';

describe('days', () => {
  it('lays the weeks to the end out Monday first, one cell a day', () => {
    // Mon 19 Oct 2026 to Fri 23 Oct: one week.
    const c = calendar('2026-10-19', '2026-10-23')!;
    expect(c).toHaveLength(7);
    expect(c.map((x) => x.kind)).toEqual(['today', 'left', 'left', 'left', 'end', 'after', 'after']);
    // From a Wednesday: Monday and Tuesday are gone.
    const w = calendar('2026-10-21', '2026-10-21')!;
    expect(w.map((x) => x.kind).slice(0, 3)).toEqual(['past', 'past', 'today']);
    expect(w[2].day).toBe('2026-10-21');
  });

  it('gives up on a calendar past ten weeks', () => {
    expect(calendar('2026-10-19', '2026-12-27')).not.toBeNull();
    expect(calendar('2026-10-19', '2027-03-01')).toBeNull();
  });

  it('reads and writes clock times', () => {
    expect(minuteOf('08:30')).toBe(510);
    expect(minuteOf('8:05')).toBe(485);
    expect(minuteOf('24:00')).toBeNull();
    expect(clockOf(510)).toBe('08:30');
    expect(clockOf(-30)).toBe('23:30');
    expect(clockOf(1440 + 60)).toBe('01:00');
  });

  it('moves the hours into the visitor’s time', () => {
    // Router on UTC+3, visitor on UTC+1: two hours earlier.
    expect(hoursFor('08:00-23:00', 180, 60)).toEqual({ from: 360, to: 1260, yours: true });
    // Without the router's offset: its own time, as set.
    expect(hoursFor('08:00-23:00', undefined, 60)).toEqual({ from: 480, to: 1380, yours: false });
    expect(hoursFor('nonsense', 0, 0)).toBeNull();
  });

  it('splits a window over midnight into two stretches', () => {
    expect(stretches({ from: 480, to: 1380, yours: true })).toEqual([[480, 1380]]);
    expect(stretches({ from: 1320, to: 360, yours: true })).toEqual([
      [1320, 1440],
      [0, 360],
    ]);
  });

  it('finds the minute of the day and the days of the month', () => {
    // 2026-10-19 12:00 UTC is 15:00 on UTC+3.
    expect(minuteAt(Date.UTC(2026, 9, 19, 12) / 1000, 180)).toBe(900);
    expect(monthOf('2026-10-19')).toEqual({ days: 31, day: 19 });
    expect(monthOf('2028-02-03')).toEqual({ days: 29, day: 3 });
  });
});
