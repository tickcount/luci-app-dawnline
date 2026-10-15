import { describe, expect, it } from 'vitest';
import { addDays, addMonthsClamped, date, dayDiff, daysLeft, fmtDay, kb, plural, shiftDay, todayOf } from '../src/shared/format';

describe('months', () => {
  it('clamps the day to the end of the month', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonthsClamped('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonthsClamped('2026-08-31', 1)).toBe('2026-09-30');
    expect(addMonthsClamped('2026-10-15', 3)).toBe('2027-01-15');
    expect(addMonthsClamped('2024-02-29', 12)).toBe('2025-02-28');
  });
  it('shifts an end date by steps, from today when there is none', () => {
    expect(shiftDay('2026-01-31', 'month', 1, '2026-01-01')).toBe('2026-02-28');
    expect(shiftDay('', 'week', 1, '2026-10-16')).toBe('2026-10-23');
    expect(shiftDay('2026-12-31', 'day', 1, '2026-10-16')).toBe('2027-01-01');
    expect(shiftDay('2024-02-29', 'year', 1, '2026-10-16')).toBe('2025-02-28');
    expect(shiftDay('2026-10-01', 'custom', -1, '2026-10-16', 30)).toBe('2026-09-01');
  });
});

describe('router days', () => {
  it('counts days between calendar days, across DST changes', () => {
    expect(dayDiff('2026-10-20', '2026-10-14')).toBe(6);
    expect(dayDiff('2026-03-30', '2026-03-28')).toBe(2);
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
  });
  it('counts days left against the router day', () => {
    expect(daysLeft('2026-10-14', '2026-10-14')).toBe(1);
    expect(daysLeft('2026-10-20', '2026-10-14')).toBe(7);
    expect(daysLeft('2026-10-13', '2026-10-14')).toBe(-1);
    expect(daysLeft('', '2026-10-14')).toBeNull();
  });
  it('takes today from a series', () => {
    expect(todayOf([{ day: '2026-10-15' }, { day: '2026-10-16' }])).toBe('2026-10-16');
  });
  it('shows a router day as that day in any time zone', () => {
    expect(fmtDay('2026-10-01')).toBe('1 Oct 2026');
    expect(date('2026-10-01')).toBe('1 Oct 2026');
    expect(date('')).toBe('');
  });
});

describe('numbers', () => {
  it('pluralises and sizes', () => {
    expect(plural(1, 'event')).toBe('1 event');
    expect(plural(2000, 'address', 'addresses')).toBe('2,000 addresses');
    expect(kb(512)).toBe('512 B');
    expect(kb(1536)).toBe('1.5 KB');
    expect(kb(3 * 1048576)).toBe('3.0 MB');
  });
});
