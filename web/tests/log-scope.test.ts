import { describe, expect, it } from 'vitest';
import type { LogEvent } from '../src/shared/types';
import type { ServiceLogEntry } from '../src/admin/api';
import { sessions, type FeedItem } from '../src/admin/events/sessions';
import {
  WHOLE,
  choices,
  inScope,
  logQueryParams,
  narrowed,
  parseLogQuery,
  withFilters,
  type LogQuery,
  type Who,
} from '../src/admin/events/scope';

// 2026-11-09 09:00 at the router (+3 h): 06:00 UTC.
const NOW = Date.UTC(2026, 10, 9, 6, 0) / 1000;
const TZ = 180;
const clock = { now: NOW, tz: TZ };
const HOUR = 3600;

const who = {
  people: [
    {
      id: 'p_lena',
      name: 'Lena',
      server: 's_home',
      devices: [
        { id: 'd_mac', name: 'MacBook' },
        { id: 'd_ipad', name: 'iPad' },
      ],
    },
    { id: 'p_dima', name: 'Dima', server: 's_dacha', devices: [{ id: 'd_xi', name: 'Xiaomi 14' }] },
    { id: 'p_new', name: 'Katya', server: 's_home', devices: [{ id: 'd_none', name: 'Phone' }] },
  ],
  servers: [
    { id: 's_home', name: 'Home' },
    { id: 's_dacha', name: 'Dacha' },
  ],
} as unknown as Who;

const ev = (ago: number, type: string, person?: string, device?: string, extra: Partial<LogEvent> = {}): LogEvent => ({
  ts: NOW - ago,
  type,
  person,
  device,
  ...extra,
});
const sys = (ago: number, extra: Partial<ServiceLogEntry> = {}): ServiceLogEntry => ({
  ts: NOW - ago,
  src: 'awg',
  level: 'info',
  msg: 'up',
  ...extra,
});

/** The feed: today 4 rows, yesterday 3, five days ago 1, ten days ago 1. */
const feed = (): FeedItem[] =>
  sessions(
    [
      ev(1 * HOUR, 'paused', 'p_lena'),
      ev(2 * HOUR, 'device_failing', 'p_dima', 'd_xi'),
      ev(3 * HOUR, 'device_changed', 'p_lena', 'd_mac'),
      // 23:00 the day before at the router
      ev(10 * HOUR, 'device_changed', 'p_lena', 'd_ipad'),
      ev(20 * HOUR, 'device_changed', 'p_dima', 'd_xi'),
      ev(5 * 24 * HOUR, 'device_changed', 'p_lena', 'd_mac'),
      ev(10 * 24 * HOUR, 'device_removed', 'p_gone', 'd_gone', { server: 's_dacha', pname: 'Gone' }),
    ],
    [sys(4 * HOUR, { who: 'Home' }), sys(12 * HOUR, { sid: 's_dacha', who: 'Renamed since' }), sys(13 * HOUR, { who: 'Personal portal' })],
    () => false,
  );

const ask = (patch: Partial<LogQuery>): LogQuery => ({ ...WHOLE, ...patch });
const kept = (q: Partial<LogQuery>) => feed().filter(inScope(ask(q), who, clock));

describe('the log’s address', () => {
  it('reads what it knows and leaves out the rest', () => {
    expect(parseLogQuery('')).toEqual(WHOLE);
    expect(parseLogQuery('kind=problems&day=yesterday&person=p_dima&device=d_xi&server=s_home&q=176.59')).toEqual({
      kind: 'problems',
      day: 'yesterday',
      person: 'p_dima',
      device: 'd_xi',
      server: 's_home',
      q: '176.59',
    });
    expect(parseLogQuery('kind=everything&day=tomorrow&sheet=x')).toEqual(WHOLE);
    expect(parseLogQuery('q=%20two%20words%20').q).toBe('two words');
  });

  it('takes the 7 days by both of their names and writes one', () => {
    expect(parseLogQuery('day=7d').day).toBe('7d');
    expect(parseLogQuery('day=week').day).toBe('7d');
    expect(logQueryParams(parseLogQuery('day=week')).day).toBe('7d');
  });

  it('writes only what narrows the log, and reads it back the same', () => {
    expect(logQueryParams(WHOLE)).toEqual({});
    const q = ask({ kind: 'system', day: 'today', person: 'p_lena', q: 'no route' });
    const params = logQueryParams(q);
    expect(params).toEqual({ kind: 'system', day: 'today', person: 'p_lena', q: 'no route' });
    const query = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString();
    expect(parseLogQuery(query)).toEqual(q);
  });

  it('knows when something narrows it', () => {
    expect(narrowed(WHOLE)).toBe(false);
    for (const patch of [
      { kind: 'people' },
      { day: '7d' },
      { person: 'p' },
      { device: 'd' },
      { server: 's' },
      { q: 'x' },
    ] as Partial<LogQuery>[])
      expect(narrowed(ask(patch))).toBe(true);
  });
});

describe('changing the log’s filters', () => {
  it('keeps a person with a device of theirs', () => {
    expect(withFilters(ask({ person: 'p_lena' }), { device: 'd_mac' }, who.people)).toMatchObject({ person: 'p_lena', device: 'd_mac' });
    expect(withFilters(ask({ device: 'd_mac' }), { person: 'p_lena' }, who.people)).toMatchObject({ person: 'p_lena', device: 'd_mac' });
  });

  it('drops the person when a device of someone else is picked, and the device when another person is', () => {
    expect(withFilters(ask({ person: 'p_lena' }), { device: 'd_xi' }, who.people)).toMatchObject({ person: '', device: 'd_xi' });
    expect(withFilters(ask({ device: 'd_mac' }), { person: 'p_dima' }, who.people)).toMatchObject({ person: 'p_dima', device: '' });
  });

  it('leaves the rest alone', () => {
    const q = ask({ person: 'p_lena', device: 'd_mac', day: 'today', q: 'x' });
    expect(withFilters(q, { day: '' }, who.people)).toEqual({ ...q, day: '' });
    expect(withFilters(q, { person: '' }, who.people)).toEqual({ ...q, person: '' });
    expect(withFilters(q, WHOLE, who.people)).toEqual(WHOLE);
  });
});

describe('the log’s scope', () => {
  it('keeps everything when nothing is asked, whatever the kind and the search', () => {
    expect(kept({})).toHaveLength(10);
    expect(kept({ kind: 'problems', q: 'nothing like it' })).toHaveLength(10);
  });

  it('keeps one person’s rows, or one device’s, without the service lines', () => {
    expect(kept({ person: 'p_lena' }).map((x) => x.ev?.device)).toEqual([undefined, 'd_mac', 'd_ipad', 'd_mac']);
    expect(kept({ device: 'd_xi' })).toHaveLength(2);
    expect(kept({ person: 'p_lena', device: 'd_xi' })).toHaveLength(0);
    expect(kept({ person: 'p_dima' }).some((x) => x.sys)).toBe(false);
  });

  it('reads a row’s server from its person, from the event itself for someone removed, from a service line’s id or name', () => {
    const dacha = kept({ server: 's_dacha' });
    expect(dacha.map((x) => x.ev?.person ?? x.sys?.who)).toEqual(['p_dima', 'Renamed since', 'p_dima', 'p_gone']);
    const home = kept({ server: 's_home' });
    expect(home.filter((x) => x.sys).map((x) => x.sys!.who)).toEqual(['Home']);
    expect(home.filter((x) => x.ev).every((x) => x.ev!.person === 'p_lena')).toBe(true);
    // the portal's line is no server's
    expect([...dacha, ...home]).toHaveLength(9);
  });

  it('tells today from yesterday by the router’s day, and the 7 days by the clock', () => {
    expect(kept({ day: 'today' })).toHaveLength(4);
    // 10 h ago is 23:00 yesterday at the router (and still today in UTC)
    expect(kept({ day: 'yesterday' }).map((x) => NOW - x.ts)).toEqual([10 * HOUR, 12 * HOUR, 13 * HOUR, 20 * HOUR]);
    expect(kept({ day: '7d' })).toHaveLength(9);
    expect(kept({ day: 'yesterday', person: 'p_lena' })).toHaveLength(1);
  });
});

describe('what the log’s chips offer', () => {
  it('lists the people with rows, the most first', () => {
    expect(choices(feed(), WHOLE, who, clock).people).toEqual([
      { id: 'p_lena', n: 4 },
      { id: 'p_dima', n: 2 },
    ]);
  });

  it('counts under the other filters, not under its own', () => {
    const c = choices(feed(), ask({ day: 'yesterday', person: 'p_dima', device: 'd_xi' }), who, clock);
    // another person takes the device off: people are counted without it
    expect(c.people).toEqual([
      { id: 'p_lena', n: 1 },
      { id: 'p_dima', n: 1 },
    ]);
    expect(c.devices).toEqual([{ id: 'd_xi', n: 1 }]);
    expect(c.servers).toEqual([
      { id: 's_home', n: 0 },
      { id: 's_dacha', n: 1 },
    ]);
  });

  it('offers the picked person’s devices only, and everyone’s with nobody picked', () => {
    expect(choices(feed(), ask({ person: 'p_lena' }), who, clock).devices).toEqual([
      { id: 'd_mac', n: 2 },
      { id: 'd_ipad', n: 1 },
    ]);
    expect(choices(feed(), WHOLE, who, clock).devices.map((d) => d.id)).toEqual(['d_mac', 'd_xi', 'd_ipad']);
  });

  it('keeps the picked one in its list with no rows, and when the router no longer has it', () => {
    expect(choices(feed(), ask({ day: 'today', person: 'p_new' }), who, clock).people.map((p) => p.id)).toEqual([
      'p_lena',
      'p_dima',
      'p_new',
    ]);
    const gone = choices(feed(), ask({ person: 'p_gone', device: 'd_gone' }), who, clock);
    expect(gone.people).toContainEqual({ id: 'p_gone', n: 1 });
    expect(gone.devices).toEqual([{ id: 'd_gone', n: 1 }]);
  });

  it('lists every server in the router’s order', () => {
    expect(choices(feed(), WHOLE, who, clock).servers).toEqual([
      { id: 's_home', n: 5 },
      { id: 's_dacha', n: 4 },
    ]);
  });
});
