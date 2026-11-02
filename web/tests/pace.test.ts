import { describe, expect, it } from 'vitest';
import { forecast, paceOf, vsAverage, weekAhead } from '../src/shared/pace';

const GB = 1024 ** 3;

describe('pace', () => {
  it('averages the complete days before today, the last 7 at most', () => {
    // Ten days, today (999) left out: the 7 before it are 1..7.
    expect(paceOf([50, 50, 1, 2, 3, 4, 5, 6, 7, 999])).toBe(4);
    expect(paceOf([3, 5, 100])).toBe(4);
    expect(paceOf([100])).toBe(0);
    expect(paceOf([])).toBe(0);
  });

  it('compares a day with the average, today left out', () => {
    expect(vsAverage([10, 10, 10, 20, 0], 3)).toBe(60);
    expect(vsAverage([10, 30, 5], 0)).toBe(-50);
    expect(vsAverage([0, 0, 5], 2)).toBe(0);
  });

  it('says when a limit fills at this pace', () => {
    expect(forecast(46 * GB, 50 * GB, 2 * GB, false, '2026-11-02')).toEqual({ kind: 'fills', days: 2, on: '2026-11-04' });
    // A monthly limit filling before the 1st is the same.
    expect(forecast(40 * GB, 50 * GB, 1 * GB, true, '2026-11-15')).toEqual({ kind: 'fills', days: 10, on: '2026-11-25' });
  });

  it('says what a monthly limit reaches by the reset when that comes first', () => {
    const f = forecast(12 * GB, 100 * GB, 1 * GB, true, '2026-11-02');
    expect(f).toEqual({ kind: 'holds', on: '2026-12-01', reach: 41 * GB });
  });

  it('has nothing to say without a limit, when full or idle', () => {
    expect(forecast(5, 0, 1, true, '2026-11-02').kind).toBe('none');
    expect(forecast(10, 10, 1, true, '2026-11-02').kind).toBe('none');
    expect(forecast(1, 10, 0, true, '2026-11-02').kind).toBe('none');
  });

  it('takes a week ahead, capped at the limit', () => {
    expect(weekAhead(10, 100, 1)).toBe(17);
    expect(weekAhead(90, 100, 5)).toBe(100);
    expect(weekAhead(5, 0, 1)).toBe(0);
  });
});
