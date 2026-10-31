import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonthsClamped,
  date,
  dayDiff,
  daysLeft,
  deviceNameFits,
  endsIn,
  endsSoon,
  fitName,
  fmtDay,
  kb,
  shiftDay,
  validDeviceName,
} from '../src/shared/format';
import { plural } from '../src/shared/i18n';

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
  it('warns by the person’s own window, never with 0', () => {
    expect(endsSoon({ expire_warn: 3 }, 1)).toBe(true);
    expect(endsSoon({ expire_warn: 3 }, 3)).toBe(true);
    expect(endsSoon({ expire_warn: 3 }, 4)).toBe(false);
    expect(endsSoon({ expire_warn: 0 }, 1)).toBe(false);
    expect(endsSoon({ expire_warn: 3 }, -1)).toBe(false);
    expect(endsSoon({ expire_warn: 3 }, null)).toBe(false);
  });
  it('says when access ends', () => {
    expect(endsIn(1)).toBe('ends today');
    expect(endsIn(2)).toBe('ends tomorrow');
    expect(endsIn(7)).toBe('ends in 7 days');
  });

  it('shows a router day as that day in any time zone', () => {
    expect(fmtDay('2026-10-01')).toBe('1 Oct 2026');
    expect(date('2026-10-01')).toBe('1 Oct 2026');
    expect(date('')).toBe('');
  });
});

describe('numbers', () => {
  it('pluralises and sizes', () => {
    expect(plural(1, '%s event', '%s events')).toBe('1 event');
    expect(plural(2000, '%s address', '%s addresses')).toBe('2,000 addresses');
    expect(kb(512)).toBe('512 B');
    expect(kb(1536)).toBe('1.5 KB');
    expect(kb(3 * 1048576)).toBe('3.0 MB');
  });
});

describe('device names', () => {
  it('take letters of any language, digits, spaces and - _ . up to the limit', () => {
    expect(validDeviceName('Kitchen iPad')).toBe(true);
    expect(validDeviceName('my-pc_2.home')).toBe(true);
    expect(validDeviceName('Мой ноутбук')).toBe(true);
    expect(validDeviceName('Ordinateur de Zoé')).toBe(true);
    expect(validDeviceName('客厅电视')).toBe(true);
    expect(validDeviceName('99999999999999999999')).toBe(true);
    expect(validDeviceName('999999999999999999999')).toBe(false);
    expect(validDeviceName('ЙЦУКЕНГШЩЗХЪФЫВАПРОЛ')).toBe(true);
    expect(validDeviceName('ЙЦУКЕНГШЩЗХЪФЫВАПРОЛД')).toBe(false);
    expect(validDeviceName('  Kitchen iPad  ')).toBe(true);
    expect(validDeviceName("Bob's iPhone")).toBe(false);
    expect(validDeviceName('$(reboot)')).toBe(false);
    expect(validDeviceName('Phone 📱')).toBe(false);
    expect(validDeviceName('Офис™')).toBe(false);
    expect(validDeviceName('«Дом»')).toBe(false);
    expect(validDeviceName('a\u200bb')).toBe(false);
    expect(validDeviceName('')).toBe(false);
    expect(validDeviceName('   ')).toBe(false);
    // As it is typed: empty is fine (a submit says so), a space at the end too.
    expect(deviceNameFits('')).toBe(true);
    expect(deviceNameFits('Kitchen ')).toBe(true);
    expect(deviceNameFits('Kitchen!')).toBe(false);
  });

  it('strips a made-up name of what the router refuses and cuts it to fit, the number too', () => {
    expect(fitName('Phone')).toBe('Phone');
    expect(fitName('Phone', ' 2')).toBe('Phone 2');
    expect(fitName('Galaxy S24+')).toBe('Galaxy S24');
    expect(fitName('Samsung Galaxy S24 Ultra')).toBe('Samsung Galaxy S24 U');
    expect(fitName('Pixel 9 Pro (XL)', ' 2')).toBe('Pixel 9 Pro XL 2');
    expect(fitName('Компьютер с Windows', ' 2')).toBe('Компьютер с Window 2');
    // Not left ending in a space before the number.
    expect(fitName('Living room TV ab xy', ' 2')).toBe('Living room TV ab 2');
    expect(validDeviceName(fitName('Redmi Note 13 Pro+ 5G', ' 12'))).toBe(true);
  });
});
