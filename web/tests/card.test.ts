import { describe, expect, it } from 'vitest';
import { byAttention, cardParts, groupOf, ofLimit, type CardFacts, type CardParts, type Ranked } from '../src/admin/people/card';
import { byPerson, midnight, presence, timeIn } from '../src/admin/people/presence';
import type { Device, LogEvent, Person, Server } from '../src/shared/types';

// The matrix of a person's card (the concept's docs/ia2/10-people-cards.md with its amendments), a row a state:
// what the card must have. The router at 2026-11-07 14:00 UTC+3.
const NOW = Date.UTC(2026, 10, 7, 11, 0) / 1000;
const T = { today: '2026-11-07', now: NOW };
const H = 3600;
const DAY = 86400;
const GB = 2 ** 30;

const dev = (o: Partial<Device> = {}): Device =>
  ({
    id: 'd1',
    name: 'iPhone',
    kind: 'phone',
    address: '10.8.0.2',
    disabled: false,
    online: false,
    handshake: NOW - 3 * H,
    endpoint: '91.1.2.3:51820',
    config_stale: false,
    lan_bypass: false,
    link: null,
    spark: [],
    month: [0, 0],
    total: [0, 0],
    ...o,
  }) as Device;
const person = (o: Partial<Person> = {}): Person =>
  ({
    id: 'p',
    name: 'Test',
    server: 's',
    access: 'internet',
    device_limit: 3,
    expires: '',
    quota_gb: 0,
    quota_period: 'month',
    quota_used: 0,
    quota_limit: 0,
    // their limit month began on 19 Oct with their first traffic: it ends on 19 Nov, not on the 1st
    quota_month: [0, 0],
    quota_resets: NOW + 12 * DAY,
    quota_reset_day: '2026-11-19',
    bonus_gb: 0,
    dns_mode: 'device',
    paused: false,
    state: 'active',
    month: [1 * GB, 9 * GB],
    total: [0, 0],
    online: 0,
    last_seen: NOW - 3 * H,
    devices: [dev()],
    has_link: true,
    ...o,
  }) as Person;
const on = { id: 's', name: 'Home', enabled: true } as Server;
const off = { id: 's', name: 'Dacha', enabled: false } as Server;

interface Row {
  name: string;
  p: Person;
  srv?: Server;
  facts?: CardFacts;
  want: Partial<Pick<CardParts, 'state' | 'group' | 'presence' | 'traffic' | 'meter' | 'tiles' | 'quiet'>> & {
    line: RegExp | null;
    action: RegExp | null;
  };
}

const rows: Row[] = [
  {
    name: 'no server',
    p: person({ state: 'no_server', server: '' }),
    want: {
      state: 'no_server',
      group: 'need',
      line: /^No server$/,
      presence: null,
      traffic: false,
      tiles: false,
      action: /^Choose a server$/,
      quiet: false,
    },
  },
  {
    name: 'server turned off',
    p: person({ state: 'server_off' }),
    srv: off,
    want: {
      state: 'server_off',
      group: 'rest',
      line: /^Server Dacha is turned off$/,
      presence: null,
      traffic: false,
      tiles: true,
      action: null,
    },
  },
  {
    name: 'paused',
    p: person({ state: 'paused', paused: true }),
    srv: on,
    facts: { pausedAt: '2026-11-03' },
    want: {
      state: 'paused',
      group: 'paused',
      line: /^Paused since 3 Nov$/,
      presence: null,
      traffic: false,
      tiles: true,
      action: /^Resume$/,
      quiet: true,
    },
  },
  {
    name: 'access ended',
    p: person({ state: 'expired', expires: '2026-11-03' }),
    srv: on,
    want: { state: 'expired', group: 'need', line: /^Access ended 3 Nov$/, presence: null, traffic: false, action: /^Extend to 7 Dec$/ },
  },
  {
    name: 'limit reached',
    p: person({ state: 'quota', quota_gb: 50, quota_limit: 50 * GB, quota_used: 50.3 * GB }),
    srv: on,
    want: {
      state: 'quota',
      group: 'need',
      line: /^Limit reached · 50\.3 of 50 GB$/,
      presence: null,
      traffic: false,
      action: /^\+20 GB until 19 Nov$/,
    },
  },
  {
    name: 'a term limit reached',
    p: person({ state: 'quota', quota_period: 'total', quota_gb: 5, quota_limit: 5 * GB, quota_used: 9 * GB }),
    srv: on,
    want: { state: 'quota', group: 'need', line: /^Term limit reached · 9 of 5 GB$/, action: /^Change the limit$/ },
  },
  {
    name: 'a device fails',
    p: person({ devices: [dev({ name: 'ThinkPad', link: { state: 'trying', since: NOW - H } as Device['link'] })] }),
    srv: on,
    want: {
      state: 'device',
      group: 'need',
      line: /^ThinkPad does not connect$/,
      presence: null,
      traffic: false,
      tiles: true,
      action: /^Advice · ThinkPad$/,
    },
  },
  {
    name: 'a new configuration (a rollout, not a decision)',
    p: person({ devices: [dev({ name: 'Laptop', config_stale: true })] }),
    srv: on,
    want: { state: 'offline', group: 'rest', line: null, presence: 'offline', traffic: true, tiles: true, action: null },
  },
  {
    name: 'a new configuration and the end near',
    p: person({ expires: '2026-11-09', devices: [dev({ name: 'Laptop', config_stale: true })] }),
    srv: on,
    want: { state: 'soon', group: 'need', line: /^Access until 9 Nov · 3 days$/, action: /^Extend to 9 Dec$/ },
  },
  {
    name: 'the end near',
    p: person({ expires: '2026-11-09' }),
    srv: on,
    want: {
      state: 'soon',
      group: 'need',
      line: /^Access until 9 Nov · 3 days$/,
      presence: null,
      traffic: false,
      action: /^Extend to 9 Dec$/,
    },
  },
  {
    name: 'the last day',
    p: person({ expires: '2026-11-07' }),
    srv: on,
    want: { state: 'soon', group: 'need', line: /^Access until 7 Nov · last day$/, action: /^Extend to 7 Dec$/ },
  },
  {
    name: 'the limit nearly reached',
    p: person({ quota_gb: 50, quota_limit: 50 * GB, quota_used: 46 * GB }),
    srv: on,
    want: {
      state: 'almost',
      group: 'need',
      line: /^Limit nearly reached · 46 of 50 GB$/,
      presence: null,
      traffic: false,
      action: /^\+10 GB until 19 Nov$/,
    },
  },
  {
    name: 'no devices',
    p: person({ devices: [], last_seen: 0, month: [0, 0] }),
    srv: on,
    want: {
      state: 'no_devices',
      group: 'rest',
      line: /^No devices yet$/,
      presence: null,
      traffic: false,
      tiles: false,
      action: /^Invite$/,
    },
  },
  {
    name: 'online',
    p: person({ online: 1, last_seen: NOW - 20, devices: [dev({ online: true })] }),
    srv: on,
    want: { state: 'online', group: 'online', line: null, presence: 'online', traffic: true, meter: null, tiles: true, action: null },
  },
  {
    name: 'online, a limit used 9 %',
    p: person({ online: 1, devices: [dev({ online: true })], quota_gb: 100, quota_limit: 100 * GB, quota_used: 9 * GB }),
    srv: on,
    want: { state: 'online', group: 'online', line: null, presence: 'online', traffic: true, meter: 'of', action: null },
  },
  {
    name: 'offline, a limit used 60 %',
    p: person({ quota_gb: 100, quota_limit: 100 * GB, quota_used: 60 * GB }),
    srv: on,
    want: { state: 'offline', group: 'rest', line: null, presence: 'offline', traffic: true, meter: 'bar', action: null },
  },
  {
    name: 'offline for up to 7 days',
    p: person(),
    srv: on,
    want: { state: 'offline', group: 'rest', line: null, presence: 'offline', traffic: true, meter: null, action: null },
  },
  {
    name: 'long away, traffic in the last 30 days',
    p: person({ last_seen: NOW - 12 * DAY }),
    srv: on,
    facts: { city: 'Moscow' },
    want: {
      state: 'away',
      group: 'rest',
      line: /^Not connected for 12 days · Moscow$/,
      presence: null,
      traffic: true,
      action: null,
    },
  },
  {
    name: 'long away, nothing this month',
    p: person({ last_seen: NOW - 21 * DAY, month: [0, 0] }),
    srv: on,
    facts: { city: 'Moscow' },
    want: { state: 'away', group: 'rest', line: /^Not connected for 21 days · Moscow$/, presence: null, traffic: true, action: null },
  },
  {
    name: 'never connected, a link',
    p: person({ last_seen: 0, month: [0, 0], devices: [dev({ handshake: 0 })] }),
    srv: on,
    want: { state: 'never', group: 'rest', line: /^Not connected yet$/, presence: null, traffic: false, action: /^Link$/, quiet: true },
  },
  {
    name: 'never connected, no link',
    p: person({ last_seen: 0, has_link: false, month: [0, 0], devices: [dev({ handshake: 0 })] }),
    srv: on,
    want: { state: 'never', group: 'rest', line: /^Not connected yet$/, action: /^Invite$/, quiet: false },
  },
];

describe('the card matrix', () => {
  it.each(rows.map((r) => [r.name, r] as const))('%s', (_n, r) => {
    const c = cardParts(r.p, r.srv, T, r.facts);
    // the line keeps its «·» with the word before it (a no-break space): read with plain spaces
    const line = c.line?.replace(/ /g, ' ') ?? null;
    const { line: wantLine, action, ...rest } = r.want;
    expect(c).toMatchObject(rest);
    if (wantLine) expect(line).toMatch(wantLine);
    else expect(line).toBeNull();
    if (action) expect(c.action?.label ?? '').toMatch(action);
    else expect(c.action).toBeNull();
  });

  it('says the first problem, counts the others, and keeps a rollout out of it', () => {
    const p = person({
      expires: '2026-11-09',
      devices: [
        dev({ name: 'ThinkPad', link: { state: 'trying', since: NOW - H } as Device['link'] }),
        dev({ id: 'd2', config_stale: true }),
      ],
    });
    const c = cardParts(p, on, T);
    expect(c.state).toBe('device');
    expect(c.more).toEqual(['Access until 9 Nov · 3 days']);
    expect(c.title).toContain('ThinkPad does not connect');
    expect(c.stale).toEqual(['d2']);
  });

  it('keeps a dot with the word before it', () => {
    expect(cardParts(person({ expires: '2026-11-09' }), on, T).line).toBe('Access until 9 Nov · 3 days');
  });

  it('says a limit with its unit once', () => {
    expect(ofLimit(50.3 * GB, 50 * GB)).toBe('50.3 of 50 GB');
    expect(ofLimit(512 * 2 ** 20, 50 * GB)).toBe('512 MB of 50 GB');
  });

  it('groups by the matrix: the chip, the heads and Overview count one way', () => {
    expect(groupOf(person({ devices: [dev({ config_stale: true })] }), T)).toBe('rest');
    expect(groupOf(person({ state: 'server_off' }), T)).toBe('rest');
    expect(groupOf(person({ state: 'paused', paused: true }), T)).toBe('paused');
    expect(groupOf(person({ expires: '2026-11-09' }), T)).toBe('need');
  });
});

describe('the order of attention', () => {
  const ranked = (p: Person, o: Partial<Ranked> = {}): Ranked => ({ p, parts: cardParts(p, on, T), speed: 0, week: 0, pausedAt: '', ...o });
  it('puts the groups in order, and each in its own', () => {
    const list = [
      ranked(person({ id: 'away', last_seen: NOW - 20 * DAY })),
      ranked(person({ id: 'slow', online: 1, devices: [dev({ online: true })] }), { speed: 10 }),
      ranked(person({ id: 'soon', expires: '2026-11-09' })),
      ranked(person({ id: 'off', last_seen: NOW - 2 * H })),
      ranked(person({ id: 'p2', state: 'paused', paused: true }), { pausedAt: '2026-11-05' }),
      ranked(person({ id: 'p1', state: 'paused', paused: true }), { pausedAt: '2026-11-01' }),
      ranked(person({ id: 'fast', online: 1, devices: [dev({ online: true })] }), { speed: 99 }),
      ranked(person({ id: 'ended', state: 'expired', expires: '2026-11-01' })),
      ranked(person({ id: 'never', last_seen: 0, devices: [dev({ handshake: 0 })] })),
    ];
    expect(byAttention(list, T.today).map((x) => x.p.id)).toEqual(['ended', 'soon', 'fast', 'slow', 'off', 'away', 'never', 'p1', 'p2']);
  });
});

describe('presence from the log', () => {
  const ev = (ts: number, type: string, device = 'd1'): LogEvent => ({ ts, type, person: 'p', device, where: 'Krasnodar · MTS' });
  it('says since when they are online and their hours this week', () => {
    const p = person({ online: 1, devices: [dev({ online: true, handshake: NOW - 10 })] });
    const log = [ev(NOW - 2 * DAY, 'connect'), ev(NOW - 2 * DAY + 5 * H, 'disconnect'), ev(NOW - 3 * H, 'connect')];
    const pr = presence(p, on, log, NOW, 180);
    expect(pr.since).toBe(NOW - 3 * H);
    expect(Math.round(pr.week / H)).toBe(8);
    expect(pr.devices.map((x) => x.d.id)).toEqual(['d1']);
  });
  it('is offline without an open stretch', () => {
    const pr = presence(person(), on, [ev(NOW - 5 * H, 'connect'), ev(NOW - 3 * H, 'disconnect')], NOW, 180);
    expect(pr.since).toBe(0);
    expect(Math.round(pr.week / H)).toBe(2);
  });
  it('sorts the log by person and counts time in a window', () => {
    const m = byPerson([ev(1, 'connect'), { ts: 2, type: 'x' }, { ...ev(3, 'connect'), person: 'q' }]);
    expect([...m.keys()]).toEqual(['p', 'q']);
    expect(timeIn([{ a: 0, b: 10 }], 5, 20)).toBe(5);
    expect(midnight(Date.UTC(2026, 10, 7, 23, 0) / 1000, 180)).toBe(Date.UTC(2026, 10, 7, 21, 0) / 1000);
  });
});
