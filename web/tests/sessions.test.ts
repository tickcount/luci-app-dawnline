import { describe, expect, it } from 'vitest';
import type { LogEvent, Status } from '../src/shared/types';
import type { ServiceLogEntry } from '../src/admin/api';
import { byDay, sessions } from '../src/admin/events/sessions';
import { dayBefore, dayTitle, routerDay, routerTime } from '../src/admin/events/clock';
import { haystack, kindCounts, matchesKind, matchesQuery } from '../src/admin/events/find';

const ev = (ts: number, type: string, device?: string, extra: Partial<LogEvent> = {}): LogEvent => ({
  ts,
  type,
  device,
  person: 'p1',
  ...extra,
});
const sys = (ts: number, level: ServiceLogEntry['level'], msg = 'up'): ServiceLogEntry => ({ ts, src: 'awg', level, msg, who: 'Home' });

describe('sessions', () => {
  it('folds a connect and its disconnect into one row, newest first', () => {
    const rows = sessions([ev(100, 'connect', 'd1'), ev(200, 'disconnect', 'd1'), ev(150, 'paused')]);
    expect(rows.map((r) => [r.ts, r.ev!.type, r.until])).toEqual([
      [150, 'paused', undefined],
      [100, 'connect', 200],
    ]);
  });

  it('keeps a session open while the device is online, and says nothing of its end when it is not', () => {
    expect(sessions([ev(100, 'connect', 'd1')])[0].until).toBeNull();
    expect('until' in sessions([ev(100, 'connect', 'd1')], [], () => false)[0]).toBe(false);
  });

  it('pairs each device with its own disconnect, in time order whatever the input order', () => {
    const rows = sessions([ev(300, 'disconnect', 'd2'), ev(250, 'disconnect', 'd1'), ev(100, 'connect', 'd1'), ev(120, 'connect', 'd2')]);
    expect(rows.map((r) => [r.ev!.device, r.ts, r.until])).toEqual([
      ['d2', 120, 300],
      ['d1', 100, 250],
    ]);
  });

  it('leaves a connect whose end was never logged as a plain event', () => {
    const rows = sessions([ev(100, 'connect', 'd1'), ev(200, 'connect', 'd1'), ev(300, 'disconnect', 'd1')]);
    expect(rows.map((r) => [r.ts, r.until])).toEqual([
      [200, 300],
      [100, undefined],
    ]);
    expect('until' in rows[1]).toBe(false);
  });

  it('keeps a disconnect with no connect before it (the log was cut) as its own row', () => {
    expect(sessions([ev(100, 'disconnect', 'd1')]).map((r) => r.ev!.type)).toEqual(['disconnect']);
  });

  it('puts the service log beside the events', () => {
    const rows = sessions([ev(100, 'connect', 'd1')], [sys(150, 'down'), sys(50, 'info')]);
    expect(rows.map((r) => r.ts)).toEqual([150, 100, 50]);
    expect(rows[0].sys?.level).toBe('down');
  });
});

describe('router clock', () => {
  // 2026-11-08 21:30 UTC: the 9th already at +3 h.
  const ts = Date.UTC(2026, 10, 8, 21, 30) / 1000;

  it('reads days and times in the router time zone', () => {
    expect(routerDay(ts, 180)).toBe('2026-11-09');
    expect(routerTime(ts, 180)).toBe('00:30');
    expect(routerDay(ts, 0)).toBe('2026-11-08');
    expect(routerTime(ts, -300)).toBe('16:30');
  });

  it('groups rows by the day they began on', () => {
    const rows = sessions([ev(ts - 3600, 'connect', 'd1'), ev(ts + 60, 'disconnect', 'd1'), ev(ts + 120, 'paused')]);
    expect(byDay(rows, 180).map((d) => [d.day, d.items.length])).toEqual([
      ['2026-11-09', 1],
      ['2026-11-08', 1],
    ]);
  });

  it('names days', () => {
    expect(dayBefore('2026-03-01')).toBe('2026-02-28');
    expect(dayTitle('2026-11-09', '2026-11-09')).toBe('Today');
    expect(dayTitle('2026-11-08', '2026-11-09')).toBe('Yesterday');
    expect(dayTitle('2026-11-06', '2026-11-09')).toMatch(/6/);
    expect(dayTitle('2025-12-31', '2026-01-02')).toMatch(/2025/);
  });
});

describe('finding rows', () => {
  const names = {
    people: [{ id: 'p1', name: 'Dima', devices: [{ id: 'd1', name: 'Xiaomi 14' }] }],
  } as unknown as Pick<Status, 'people'>;

  it('counts and filters by kind', () => {
    const rows = sessions([ev(1, 'connect', 'd1'), ev(2, 'paused'), ev(3, 'device_failing', 'd1')], [sys(4, 'error'), sys(5, 'info')]);
    expect(kindCounts(rows)).toEqual({ all: 5, connections: 1, people: 1, system: 2, problems: 2 });
    expect(rows.filter((r) => matchesKind(r, 'problems')).map((r) => r.ts)).toEqual([4, 3]);
  });

  it('finds a row by names now and then, its address, place and words', () => {
    const row = sessions([ev(1, 'connect', 'd1', { detail: '91.203.14.7', where: 'Krasnodar · Rostelecom', pname: 'Dmitry' })])[0];
    const hay = haystack(row, names, 'Xiaomi 14 · Dima online now');
    for (const q of ['dima', 'XIAOMI', '91.203', 'krasnodar', 'dmitry', 'online now', 'dima xiaomi'])
      expect(matchesQuery(hay, q)).toBe(true);
    expect(matchesQuery(hay, 'lena')).toBe(false);
    expect(matchesQuery(hay, '  ')).toBe(true);
    const line = haystack(
      sessions([], [{ ts: 1, src: 'awg', level: 'down', msg: 'stopped', who: 'Home', detail: 'wg0: no route' }])[0],
      names,
    );
    expect(matchesQuery(line, 'home no route')).toBe(true);
  });
});

describe('quick reconnects', () => {
  const at = (m: number) => 1_000_000 + m * 60;
  const ev = (type: string, m: number, where = 'Krasnodar · Rostelecom'): LogEvent => ({
    ts: at(m),
    type,
    device: 'd1',
    person: 'p1',
    where,
  });

  it('folds a device back within 15 minutes from the same place into one session', () => {
    const out = sessions([
      ev('connect', 0),
      ev('disconnect', 30),
      ev('connect', 40),
      ev('disconnect', 70),
      ev('connect', 80),
      ev('disconnect', 95),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].ts).toBe(at(0));
    expect(out[0].until).toBe(at(95));
    expect(out[0].rejoins).toBe(2);
  });

  it('keeps a session still open when the last return has no end', () => {
    const out = sessions([ev('connect', 0), ev('disconnect', 30), ev('connect', 35)]);
    expect(out).toHaveLength(1);
    expect(out[0].until).toBeNull();
    expect(out[0].rejoins).toBe(1);
  });

  it('starts a new session after a longer gap or from another place', () => {
    expect(sessions([ev('connect', 0), ev('disconnect', 30), ev('connect', 60)])).toHaveLength(2);
    expect(sessions([ev('connect', 0), ev('disconnect', 30), ev('connect', 35, 'Sochi · MTS')])).toHaveLength(2);
  });
});
