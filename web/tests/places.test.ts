import { describe, expect, it } from 'vitest';
import { moment, msAt, placeKey, replayStays, shares, stays, stretches, ticks, timeline, visits } from '../src/admin/places/model';
import type { GeoPoint, LogEvent } from '../src/shared/types';

const D = 'd_1';
const ev = (ts: number, type: string, detail?: string, device = D): LogEvent => ({ ts, type, detail, device, person: 'p' });
const pt = (ip: string, city: string, lat: number, lon: number, device = D): GeoPoint => ({
  person: 'p',
  device,
  ip,
  ts: 0,
  online: false,
  lat,
  lon,
  city,
  country: 'Russia',
  cc: 'RU',
  asn: 1,
  org: `${city} ISP`,
});
const HOME = pt('37.78.36.76', 'Krasnodar', 45.04, 38.98);
const MOBILE = pt('85.249.175.96', 'Novocherkassk', 47.42, 40.09);

describe('stretches', () => {
  it('follows connects, roams and disconnects', () => {
    const list = stretches(
      [
        ev(100, 'connect', HOME.ip),
        ev(200, 'roam', `${HOME.ip} → ${MOBILE.ip}`),
        ev(300, 'disconnect'),
        ev(400, 'connect', HOME.ip),
        ev(150, 'connect', 'x', 'other'),
      ],
      D,
      1000,
      true,
    );
    expect(list).toEqual([
      { ip: HOME.ip, from: 100, to: 200, live: false },
      { ip: MOBILE.ip, from: 200, to: 300, live: false },
      { ip: HOME.ip, from: 400, to: 1000, live: true },
    ]);
  });

  it('ends an open stretch at the last handshake when the device is offline', () => {
    expect(stretches([ev(100, 'connect', HOME.ip)], D, 1000, false, 600)).toEqual([{ ip: HOME.ip, from: 100, to: 600, live: false }]);
    expect(stretches([ev(100, 'connect', HOME.ip)], D, 1000, false)).toEqual([]);
  });

  it('closes a stretch at a connect the log saw without a disconnect, and sorts by time', () => {
    expect(stretches([ev(300, 'connect', MOBILE.ip), ev(100, 'connect', HOME.ip)], D, 400, false, 350)).toEqual([
      { ip: HOME.ip, from: 100, to: 300, live: false },
      { ip: MOBILE.ip, from: 300, to: 350, live: false },
    ]);
  });

  it('is empty without connections in the log', () => {
    expect(stretches([ev(100, 'device_added', 'Phone')], D, 1000, true)).toEqual([]);
  });
});

describe('visits and stays', () => {
  const s = stretches(
    [
      ev(0, 'connect', HOME.ip),
      ev(3600, 'roam', `${HOME.ip} → ${MOBILE.ip}`),
      ev(3900, 'roam', `${MOBILE.ip} → ${HOME.ip}`), // 5 min on mobile data
      ev(7200, 'roam', `${HOME.ip} → ${MOBILE.ip}`),
      ev(18000, 'roam', `${MOBILE.ip} → 10.0.0.9`), // not located: left out
      ev(19000, 'roam', `10.0.0.9 → ${HOME.ip}`),
    ],
    D,
    20000,
    true,
  );
  const v = visits(s, [HOME, MOBILE, pt(HOME.ip, 'Elsewhere', 1, 1, 'other')], D, 1800);

  it('keeps located addresses at their place, clipped to the range', () => {
    expect(v.map((x) => [x.key, x.from, x.to])).toEqual([
      ['Krasnodar|RU', 1800, 3600],
      ['Novocherkassk|RU', 3600, 3900],
      ['Krasnodar|RU', 3900, 7200],
      ['Novocherkassk|RU', 7200, 18000],
      ['Krasnodar|RU', 19000, 20000],
    ]);
    expect(v[0].point.city).toBe('Krasnodar');
  });

  it('shares the time by place', () => {
    const sh = shares(v);
    expect(sh.get('Krasnodar|RU')! + sh.get('Novocherkassk|RU')!).toBeCloseTo(1);
    expect(sh.get('Novocherkassk|RU')).toBeCloseTo(11100 / 17200);
  });

  it('folds short visits into the stay around them', () => {
    const st = stays(v);
    expect(st.map((x) => [x.key, x.from, x.to, x.short, x.live])).toEqual([
      ['Krasnodar|RU', 1800, 7200, 1, false],
      ['Novocherkassk|RU', 7200, 18000, 0, false],
      ['Krasnodar|RU', 19000, 20000, 0, true],
    ]);
  });

  it('folds for a replay only as far as needed', () => {
    expect(replayStays(v).length).toBe(5); // few moves: every one
    expect(replayStays(v, 2).map((x) => x.key)).toEqual(['Krasnodar|RU', 'Novocherkassk|RU', 'Krasnodar|RU']);
  });

  it('keys places like the map: the city, or rounded coordinates', () => {
    expect(placeKey(HOME)).toBe('Krasnodar|RU');
    expect(placeKey({ city: '', lat: 45.0449, lon: 38.981, cc: 'RU' })).toBe('45.0,39.0|RU');
  });
});

describe('replay', () => {
  const st = stays(
    visits(stretches([ev(0, 'connect', HOME.ip), ev(36000, 'roam', `${HOME.ip} → ${MOBILE.ip}`)], D, 40000, true), [HOME, MOBILE], D, 0),
  );
  const { steps, total } = timeline(st, 1000);

  it('plays a move before each stay but the first, stays held within bounds', () => {
    expect(steps.map((s) => s.kind)).toEqual(['stay', 'move', 'stay']);
    expect(steps[0].ms).toBe(450); // 10 h
    expect(steps[2].ms).toBe(350); // an hour: the shortest hold
    expect(total).toBe(450 + 1000 + 350);
  });

  it('finds the moment for a time and back', () => {
    expect(moment(st, steps, 0).t).toBe(0);
    expect(moment(st, steps, 500)).toMatchObject({ i: 1, t: 36000 });
    expect(moment(st, steps, total).t).toBe(40000);
    const ms = msAt(st, steps, 38000);
    expect(moment(st, steps, ms).t).toBeCloseTo(38000, -1);
  });
});

describe('ticks', () => {
  const now = Date.UTC(2026, 9, 18, 21, 0) / 1000;
  it('labels days for a week, inside the strip', () => {
    const t = ticks('7d', now);
    expect(t.length).toBeGreaterThanOrEqual(6);
    expect(t.every(([f]) => f > 0 && f < 1)).toBe(true);
    expect(t.map(([f]) => f)).toEqual(t.map(([f]) => f).sort((a, b) => a - b));
  });
  it('labels every six hours for a day', () => {
    const t = ticks('24h', now);
    expect(t.length).toBeGreaterThanOrEqual(3);
    expect(t.every(([, l]) => /^\d\d:00$/.test(l))).toBe(true);
  });
});
