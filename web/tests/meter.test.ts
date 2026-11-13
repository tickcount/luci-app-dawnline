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

  it("adds every server up for the router, and one person's devices for them", () => {
    const m = new LiveMeter();
    m.take({ meter: meter(points(1001, 1004)) }, 0);
    expect(m.speed(null, 0).pts).toEqual([
      [1001, 1001, 2002],
      [1002, 1003, 2005],
      [1003, 1003, 2006],
      [1004, 1005, 2009],
    ]);
    m.take({ meter: meter([{ ts: 1005, servers: { a: [9, 9] }, dev: { d1: [3, 4], d2: [1, 1], d3: [7, 7] } }], 1006) }, 1000);
    // the mean of the newest three seconds: theirs moved nothing in the two before
    expect(m.speed(null, 1000, ['d1', 'd2'])).toMatchObject({ rx: 1, tx: 2 });
  });

  it('says the mean of the seconds its words stand for: no zero between two bursts', () => {
    const m = new LiveMeter();
    const at = (ts: number, tx: number): MeterPoint => ({ ts, servers: { a: [0, tx] }, dev: tx ? { d1: [0, tx] } : {} });
    m.take({ meter: meter([at(1001, 9000), at(1002, 300), at(1003, 0)], 1004) }, 0);
    expect(m.speed('a', 0, ['d1']).tx).toBe(3100);
    // nothing in all three: a zero that is one
    m.take({ meter: meter([at(1004, 0), at(1005, 0)], 1006) }, 1000);
    expect(m.speed('a', 1000, ['d1']).tx).toBe(0);
  });

  it('reads the speed now from a fresh point only', () => {
    const m = new LiveMeter();
    m.take({ meter: meter(points(1001, 1010), 1011) }, 0);
    expect(m.speed('a', 0)).toMatchObject({ rx: 1009, tx: 2018, error: null });
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
    expect(m.speed('a', 2000)).toMatchObject({ rx: 409, tx: 818 });
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

describe('live meter, a person', () => {
  it('adds up their devices; a device left out of a second moved nothing', () => {
    const m = new LiveMeter();
    const pts: MeterPoint[] = [
      { ts: 1001, servers: { a: [30, 60] }, dev: { d1: [10, 20], d2: [20, 40] } },
      { ts: 1002, servers: { a: [5, 5] }, dev: { d3: [5, 5] } },
      // Server a was not read this second: no point for anyone on it.
      { ts: 1003, servers: {} },
      { ts: 1004, servers: { a: [7, 9] }, dev: { d1: [7, 9] } },
    ];
    m.take({ meter: meter(pts) }, 0);
    const s = m.speed('a', 0, ['d1', 'd2']);
    expect(s.pts).toEqual([
      [1001, 30, 60],
      [1002, 0, 0],
      [1004, 7, 9],
    ]);
    // 1002 and 1004: the seconds read among the newest three
    expect(s).toMatchObject({ rx: 4, tx: 5 });
    expect(m.speed('a', 0, []).pts.map((p) => p[1])).toEqual([0, 0, 0]);
  });
});
