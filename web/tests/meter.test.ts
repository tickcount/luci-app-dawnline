import { describe, expect, it } from 'vitest';
import { LiveMeter } from '../src/admin/state/meter';
import type { Meter, MeterPoint } from '../src/admin/api';

/** Points at ts from..to, one a second; server `a` at [ts, 2·ts], `b` only on even seconds. */
const points = (from: number, to: number): MeterPoint[] =>
  Array.from({ length: to - from + 1 }, (_x, i): MeterPoint => {
    const ts = from + i;
    return { ts, servers: ts % 2 ? { a: [ts, 2 * ts] } : { a: [ts, 2 * ts], b: [1, 1] } };
  });
const meter = (pts: MeterPoint[], now = pts.length ? pts[pts.length - 1].ts + 1 : 0): Meter => ({
  now,
  want: 10,
  keep: 120,
  ts: pts.length ? pts[pts.length - 1].ts : 0,
  points: pts,
});

describe('live meter', () => {
  it('asks for everything first, then for what it lacks', () => {
    const m = new LiveMeter();
    expect(m.since(0)).toBe(0);
    m.take({ meter: meter(points(1001, 1010)) }, 10_000);
    expect(m.since(11_000)).toBe(1010);
    // An answer that repeats what is kept adds nothing twice.
    m.take({ meter: meter(points(1005, 1012)) }, 11_000);
    const s = m.speed('a', 11_500);
    expect(s.pts.map((p) => p[0])).toEqual(Array.from({ length: 12 }, (_x, i) => 1001 + i));
    expect(s.pts[0]).toEqual([1001, 1001, 2002]);
  });

  it('keeps two minutes, the newest point on the right edge', () => {
    const m = new LiveMeter();
    m.take({ meter: meter(points(1001, 1200)) }, 0);
    const s = m.speed('a', 0);
    expect(s.pts).toHaveLength(120);
    expect(s.pts[0][0]).toBe(1081);
    expect(s.xs[0]).toBe(0);
    expect(s.xs[119]).toBe(1);
    expect(s.xs[60]).toBeCloseTo(60 / 119);
  });

  it('gives a server only its own seconds, placed against the newest point of all', () => {
    const m = new LiveMeter();
    m.take({ meter: meter(points(1001, 1011)) }, 0);
    const s = m.speed('b', 0);
    expect(s.pts.map((p) => p[0])).toEqual([1002, 1004, 1006, 1008, 1010]);
    expect(s.xs[s.xs.length - 1]).toBeCloseTo(1 - 1 / 119);
    expect(m.speed('nope', 0).pts).toEqual([]);
  });

  it('reads the speed now from a fresh point only', () => {
    const m = new LiveMeter();
    m.take({ meter: meter(points(1001, 1010), 1011) }, 0);
    expect(m.speed('a', 0)).toMatchObject({ rx: 1010, tx: 2020, error: null });
    // The agent stopped: its last point stays behind the router's clock.
    m.take({ meter: meter([], 1030) }, 1000);
    expect(m.speed('a', 1000)).toMatchObject({ rx: 0, tx: 0 });
    expect(m.speed('a', 1000).pts).toHaveLength(10);
  });

  it('starts over when what it kept is no longer live', () => {
    const m = new LiveMeter();
    m.take({ meter: meter(points(1001, 1010)) }, 0);
    expect(m.speed('a', 6000).pts).toEqual([]);
    expect(m.since(6000)).toBe(0);
    // The watcher freed its ring meanwhile: the next look starts from what it has now.
    m.take({ meter: meter(points(1100, 1102)) }, 6000);
    expect(m.speed('a', 6000).pts.map((p) => p[0])).toEqual([1100, 1101, 1102]);
  });

  it('starts over when the router clock goes back', () => {
    const m = new LiveMeter();
    m.take({ meter: meter(points(1001, 1010)) }, 0);
    // Stepped back 600 s: the router kept only its newer points, all before what the page has.
    m.take({ meter: { ...meter([], 411), ts: 410 } }, 1000);
    expect(m.since(1000)).toBe(0);
    expect(m.speed('a', 1000)).toMatchObject({ pts: [], rx: 0, tx: 0 });
    m.take({ meter: meter(points(405, 410), 411) }, 2000);
    expect(m.speed('a', 2000)).toMatchObject({ rx: 410, tx: 820 });
  });

  it('never takes a point dated after the router clock for the speed now', () => {
    const m = new LiveMeter();
    m.take({ meter: meter(points(1001, 1010), 900) }, 0);
    expect(m.speed('a', 0)).toMatchObject({ rx: 0, tx: 0 });
  });

  it('waits without words a moment before saying it is collecting', () => {
    const m = new LiveMeter();
    expect(m.speed('a', 0).early).toBe(true);
    // The first call of a look finds nothing written out yet.
    m.take({ meter: meter([], 1000) }, 0);
    m.take({ meter: meter([], 1001) }, 1000);
    expect(m.speed('a', 1000).early).toBe(true);
    m.take({ meter: meter([], 1002) }, 2000);
    expect(m.speed('a', 2000).early).toBe(false);
    m.take({ meter: meter(points(1001, 1003)) }, 3000);
    expect(m.speed('a', 3000).early).toBe(false);
    // A server with no seconds of its own while others have some: collecting, not early.
    expect(m.speed('nope', 3000)).toMatchObject({ pts: [], early: false });
  });

  it('says it cannot read the meter only after a few failures in a row', () => {
    const m = new LiveMeter();
    m.take({ meter: meter(points(1001, 1010)) }, 0);
    m.take({ error: 'Access denied' }, 1000);
    m.take({ error: 'Access denied' }, 2000);
    expect(m.speed('a', 2000)).toMatchObject({ error: null });
    expect(m.speed('a', 2000).pts).toHaveLength(10);
    m.take({ error: 'Access denied' }, 3000);
    expect(m.speed('a', 3000).error).toBe('Access denied');
    m.take({ meter: meter(points(1011, 1013)) }, 4000);
    expect(m.speed('a', 4000).error).toBeNull();
  });
});
