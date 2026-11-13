import { describe, expect, it } from 'vitest';
import { linkTimeline, summary, timeIn, type TimelineInput } from '../src/admin/events/timeline';
import { briefDiagnosis, deviceLine, diagnose } from '../src/admin/people/diagnosis';
import type { Device, LogEvent, Person, Server } from '../src/shared/types';

// The router at 2026-11-08 12:40 UTC+3 (the stand-in's moment), its offset in minutes.
const NOW = Date.UTC(2026, 10, 8, 9, 40) / 1000;
const TZ = 180;
const H = 3600;
const D = 86400;
/** Router time `hh:mm`, `back` days ago. */
const at = (back: number, hh: number, mm = 0) => Date.UTC(2026, 10, 8 - back, hh - 3, mm) / 1000;

const dev = (o: Partial<Device> = {}): Device => ({
  id: 'd1',
  name: 'Phone',
  kind: 'phone',
  address: '10.8.0.2',
  disabled: false,
  created: NOW - 40 * D,
  created_by: 'admin',
  online: false,
  handshake: 0,
  endpoint: '',
  active: false,
  month: [0, 0],
  total: [0, 0],
  spark: [],
  hostname: 'phone',
  browser_key: false,
  config_stale: false,
  config_issued: 0,
  lan_bypass: true,
  mtu: 0,
  keepalive: null,
  mtu_used: 1280,
  keepalive_used: 25,
  link: null,
  setup: null,
  ...o,
});
const person = (o: Partial<Person> = {}): Person =>
  ({
    id: 'p1',
    name: 'Lena',
    server: 's1',
    access: 'internet',
    device_limit: 3,
    expires: '',
    quota_gb: 0,
    quota_period: 'month',
    quota_used: 0,
    quota_limit: 0,
    bonus_gb: 0,
    dns_mode: 'device',
    paused: false,
    state: 'active',
    month: [0, 0],
    total: [0, 0],
    online: 0,
    last_seen: 0,
    devices: [],
    ...o,
  }) as Person;
const server = { id: 's1', name: 'Home', enabled: true, reached: NOW - 60 } as Server;
const ev = (ts: number, type: string, o: Partial<LogEvent> = {}): LogEvent => ({ ts, type, person: 'p1', device: 'd1', ...o });
const input = (d: Device, p: Person, events: LogEvent[]): TimelineInput => ({ device: d, person: p, server, events, now: NOW, tz: TZ });

describe('linkTimeline', () => {
  it('makes a run of each session, the open one up to now while online', () => {
    const d = dev({ online: true, handshake: NOW - 30 });
    const t = linkTimeline(
      input(d, person(), [
        ev(at(1, 9), 'connect', { where: 'Krasnodar · PJSC Rostelecom' }),
        ev(at(1, 13), 'disconnect'),
        ev(at(0, 7, 5), 'connect', { where: 'Sochi · MTS' }),
      ]),
    );
    expect(t.runs).toEqual([
      { a: at(1, 9), b: at(1, 13), s: 'ok', where: 'Krasnodar · Rostelecom' },
      { a: at(0, 7, 5), b: NOW, s: 'ok', where: 'Sochi · MTS' },
    ]);
    expect(timeIn(t.runs, '24h', NOW)).toBe(NOW - at(0, 7, 5) + (at(1, 13) - NOW + D));
  });

  it('marks a failing link from device_failing until device_recovered, connected or not', () => {
    const d = dev({ handshake: at(2, 12) });
    const t = linkTimeline(
      input(d, person(), [
        ev(at(2, 10), 'connect'),
        ev(at(2, 12), 'disconnect'),
        ev(at(1, 8), 'device_failing', { detail: 'trying' }),
        ev(at(1, 9), 'device_recovered'),
      ]),
    );
    expect(t.runs.map((r) => [r.a, r.b, r.s])).toEqual([
      [at(2, 10), at(2, 12), 'ok'],
      [at(1, 8), at(1, 9), 'warn'],
    ]);
  });

  it('keeps a failure open to now while the link still fails', () => {
    const d = dev({ handshake: at(4, 16), link: { state: 'trying', since: at(0, 8, 40) } });
    const t = linkTimeline(input(d, person(), [ev(at(0, 8, 40), 'device_failing', { detail: 'trying' })]));
    expect(t.runs).toEqual([{ a: at(0, 8, 40), b: NOW, s: 'warn', where: '' }]);
  });

  it('colours connected time past the limit', () => {
    const d = dev({ online: true, handshake: NOW });
    const t = linkTimeline(
      input(d, person({ state: 'quota' }), [ev(at(0, 10), 'connect'), ev(at(0, 11), 'quota_reached', { device: undefined })]),
    );
    expect(t.runs.map((r) => [r.a, r.b, r.s])).toEqual([
      [at(0, 10), at(0, 11), 'ok'],
      [at(0, 11), NOW, 'bad'],
    ]);
  });

  it('ticks where its settings, keys, its person or its server changed', () => {
    const t = linkTimeline({
      ...input(dev(), person(), [
        ev(at(3, 9), 'device_changed', { detail: 'mtu=1400', by: 'admin' }),
        ev(at(2, 9), 'person_changed', { device: undefined, detail: 'expires', by: 'admin' }),
        ev(at(40, 9), 'device_keys'),
      ]),
      system: [
        { ts: at(1, 18, 20), src: 'dawnline', level: 'info', msg: 'changed', by: 'admin', kind: 'server', who: 'Home', note: 'dns' },
        { ts: at(1, 18, 30), src: 'dawnline', level: 'info', msg: 'changed', by: 'admin', kind: 'server', who: 'Other' },
        // renamed since: its id says it is this server; another server once named Home is not
        { ts: at(1, 19), src: 'awg', level: 'info', msg: 'changed', by: 'admin', kind: 'server', who: 'Old name', sid: 's1' },
        { ts: at(1, 20), src: 'awg', level: 'info', msg: 'changed', by: 'admin', kind: 'server', who: 'Home', sid: 's2' },
      ] as TimelineInput['system'],
    });
    expect(t.ticks.map((k) => k.t)).toEqual([at(3, 9), at(2, 9), at(1, 18, 20), at(1, 19)]);
  });
});

describe('summary', () => {
  const day = (d: string) => d.slice(5);
  it('says since when it is online, and how the period went', () => {
    const d = dev({ online: true, handshake: NOW });
    const i = input(d, person(), [ev(at(0, 7, 5), 'connect')]);
    const s = summary(linkTimeline(i), i, '7d', day);
    expect(s).toEqual({ value: 'Online since 07:05', tone: 'ok', sub: 'online 6 hours in the last 7 days · no failures' });
  });

  it('says a failing link in its own words, a day back with its date', () => {
    const d = dev({ handshake: at(4, 16), link: { state: 'trying', since: at(1, 8, 40) } });
    const i = input(d, person(), [ev(at(1, 8, 40), 'device_failing', { detail: 'trying' })]);
    const s = summary(linkTimeline(i), i, '7d', day);
    expect(s.value).toBe('Unable to complete the handshake since 11-07 08:40');
    expect(s.tone).toBe('warn');
  });

  it('says it never connected, or how long it is offline', () => {
    const none = input(dev(), person(), []);
    expect(summary(linkTimeline(none), none, '7d', day).value).toBe('It has not connected yet');
    const off = input(dev({ handshake: NOW - 3 * H }), person(), []);
    expect(summary(linkTimeline(off), off, '7d', day).tone).toBe('');
  });
});

describe('diagnosis', () => {
  const c = { now: NOW, today: '2026-11-08', tz: TZ };
  it('holds all along for a device that works: the brief one says nothing', () => {
    const d = dev({ online: true, handshake: NOW - 30 });
    const steps = diagnose(d, person(), server, c);
    expect(steps.every((s) => s.state === 'ok')).toBe(true);
    expect(briefDiagnosis(steps)).toEqual([]);
    expect(deviceLine(d, person(), c)).toEqual({ text: 'Online', tone: 'ok' });
  });

  it('stops at the first break, with its fix; what follows waits', () => {
    const d = dev({ handshake: NOW - D, link: { state: 'trying', since: at(0, 8, 40) } });
    const steps = diagnose(d, person(), server, c);
    expect(steps.map((s) => s.state)).toEqual(['ok', 'ok', 'ok', 'bad', 'wait']);
    expect(steps[3].fix).toEqual(['tell']);
    expect(steps[3].line).toContain('08:40');
    const brief = briefDiagnosis(steps);
    expect(brief.map((s) => [s.title, s.state])).toEqual([
      ['Access, server and device', 'ok'],
      ['Connection', 'bad'],
      ['Traffic', 'wait'],
    ]);
  });

  it('puts the person and the server before the device', () => {
    expect(diagnose(dev({ disabled: true }), person({ state: 'paused' }), server, c)[0].fix).toEqual(['resume']);
    const off = diagnose(dev(), person(), { ...server, enabled: false }, c);
    expect(off.map((s) => s.state)).toEqual(['ok', 'bad', 'wait', 'wait', 'wait']);
    expect(off[1].fix).toEqual(['server']);
    expect(diagnose(dev(), person(), undefined, c)[1].fix).toEqual(['person']);
  });

  it('asks for the set-up when it never connected or holds an old configuration', () => {
    expect(diagnose(dev(), person(), server, c)[3].fix).toEqual(['show']);
    expect(diagnose(dev({ config_stale: true, handshake: NOW - H }), person(), server, c)[2].fix).toEqual(['show']);
    expect(deviceLine(dev(), person(), c).text).toBe('Not set up yet');
  });
});
