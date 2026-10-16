import { describe, expect, it } from 'vitest';
import { arc, devicePlaces, separate, type MapData } from '../src/admin/map';

describe('arc (mapcn buildArcCoordinates)', () => {
  it('runs from one point to the other in 64 steps', () => {
    const pts = arc([-0.1276, 51.5074], [-74.006, 40.7128]);
    expect(pts).toHaveLength(65);
    expect(pts[0]).toEqual([-0.1276, 51.5074]);
    expect(pts[64][0]).toBeCloseTo(-74.006);
    expect(pts[64][1]).toBeCloseTo(40.7128);
  });

  it('bends to the left of travel by a fifth of the distance', () => {
    // Due east 10°: the control point sits 2° north of the middle, the curve's peak half of that.
    const mid = arc([0, 0], [10, 0])[32];
    expect(mid[0]).toBeCloseTo(5);
    expect(mid[1]).toBeCloseTo(1);
  });

  it('takes the short way across the antimeridian', () => {
    const pts = arc([139.69, 35.69], [-122.42, 37.77]);
    expect(pts[pts.length - 1][0]).toBeCloseTo(237.58);
    expect(Math.max(...pts.map((p) => Math.abs(p[0] - 139.69)))).toBeLessThan(100);
  });

  it('is a single point pair when both ends meet', () => {
    expect(arc([10, 10], [10, 10])).toEqual([
      [10, 10],
      [10, 10],
    ]);
  });
});

describe('devicePlaces', () => {
  const pt = (city: string, ts: number, online = false, device = 'lap') => ({
    person: 'my',
    device,
    ip: `ip-${city}-${ts}`,
    ts,
    online,
    lat: 0,
    lon: 0,
    city,
    country: '',
    cc: 'RU',
    asn: 0,
    org: '',
  });
  const now = 100 * 86400;
  const data = (points: ReturnType<typeof pt>[]): MapData => ({
    geo: { enabled: true, home: null, points } as unknown as MapData['geo'],
    people: [],
    now,
    person: 'my',
    device: 'lap',
  });

  it('puts the live place first and numbers the rest newest first, one per city', () => {
    const list = devicePlaces(
      data([
        pt('Kazan', now - 25 * 86400),
        pt('Moscow', now - 7 * 86400),
        pt('Moscow', now - 9 * 86400),
        pt('Sochi', now - 86400),
        pt('Krasnodar', now, true),
        pt('Berlin', now - 86400, false, 'phone'),
      ]),
      '30d',
    );
    expect(list.map((x) => [x.city, x.n])).toEqual([
      ['Krasnodar', 0],
      ['Sochi', 1],
      ['Moscow', 2],
      ['Kazan', 3],
    ]);
  });

  it('keeps to the period', () => {
    expect(devicePlaces(data([pt('Kazan', now - 25 * 86400), pt('Sochi', now - 86400)]), '7d').map((x) => x.city)).toEqual(['Sochi']);
  });
});

describe('separate', () => {
  it('leaves markers that do not touch alone', () => {
    expect(
      separate([
        { x: 0, y: 0, r: 10 },
        { x: 100, y: 0, r: 10 },
      ]),
    ).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });
  it('moves only the free one away from a fixed one, just clear', () => {
    const [s, p] = separate([
      { x: 0, y: 0, r: 20, fixed: true },
      { x: 30, y: 0, r: 14 },
    ]);
    expect(s).toEqual([0, 0]);
    expect(p[0]).toBeCloseTo(20 + 14 + 6 - 30);
    expect(p[1]).toBeCloseTo(0);
  });
  it('fades to nothing as markers part (no jump)', () => {
    const at = (x: number) =>
      separate([
        { x: 0, y: 0, r: 20, fixed: true },
        { x, y: 0, r: 14 },
      ])[1][0];
    expect(at(39)).toBeCloseTo(1);
    expect(at(39.9)).toBeCloseTo(0.1);
    expect(at(40)).toBe(0);
  });
  it('splits two free markers half each and parts ones on the same spot', () => {
    const [a, b] = separate(
      [
        { x: 0, y: 0, r: 10 },
        { x: 10, y: 0, r: 10 },
      ],
      0,
    );
    expect(a[0]).toBeCloseTo(-5);
    expect(b[0]).toBeCloseTo(5);
    const same = separate(
      [
        { x: 0, y: 0, r: 10 },
        { x: 0, y: 0, r: 10 },
        { x: 0, y: 0, r: 10 },
      ],
      0,
    );
    for (let i = 0; i < 3; i++)
      for (let j = i + 1; j < 3; j++) expect(Math.hypot(same[i][0] - same[j][0], same[i][1] - same[j][1])).toBeGreaterThan(19);
  });
});
