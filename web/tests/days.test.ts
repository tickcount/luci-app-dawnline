import { describe, expect, it } from 'vitest';
import { calendar, weeks } from '../src/portal/days';

describe('days', () => {
  it('lays a far end out one cell a week, to the week it ends in', () => {
    // Wed 21 Oct 2026 to Mon 8 Feb 2027: this week, fifteen between, the last one.
    const w = weeks('2026-10-21', '2027-02-08')!;
    expect(w).toHaveLength(17);
    expect(w[0]).toEqual({ day: '2026-10-19', kind: 'today' });
    expect(w[16]).toEqual({ day: '2027-02-08', kind: 'end' });
    expect(w.slice(1, 16).every((x) => x.kind === 'left')).toBe(true);
    // past 28 weeks the number of days says it alone
    expect(weeks('2026-10-21', '2027-10-21')).toBeNull();
  });
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
});
