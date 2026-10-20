import { describe, expect, it } from 'vitest';
import type { Pair } from '../src/shared/types';
import { mirror, sumDays } from '../src/portal/ui/bars';

/** [rx, tx]: what the device sent, what it received. */
const days: Pair[] = [
  [10, 90],
  [40, 60],
  [5, 120],
];

describe('mirrored bars', () => {
  it('splits the height between the two directions around the hairline', () => {
    const m = mirror(days, 64);
    expect(m.top + m.bottom + 3).toBe(64);
  });

  it('fits both peaks on one scale, the tighter one filling its half', () => {
    const m = mirror(days, 64);
    expect(120 * m.scale).toBeLessThanOrEqual(m.top);
    expect(40 * m.scale).toBeLessThanOrEqual(m.bottom);
    expect(Math.max(120 * m.scale - m.top, 40 * m.scale - m.bottom)).toBeCloseTo(0);
  });

  it('keeps 55–80% of the height for downloads, however lopsided the days', () => {
    expect(mirror([[0, 100]], 64).top).toBe(Math.round(61 * 0.8));
    expect(mirror([[100, 1]], 64).top).toBe(Math.round(61 * 0.55));
  });

  it('draws a month without traffic', () => {
    const m = mirror([[0, 0]], 34);
    expect(Number.isFinite(m.scale)).toBe(true);
    expect(m.top).toBeGreaterThan(m.bottom);
  });

  it('adds the days up both ways', () => {
    expect(sumDays(days)).toEqual([55, 270]);
    expect(sumDays([])).toEqual([0, 0]);
  });
});
