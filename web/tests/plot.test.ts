import { describe, expect, it } from 'vitest';
import { smooth } from '../src/admin/ui/plot';

/** Every y a path's points and control points reach. */
const ys = (d: string) => [...d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => Number(m[2]));

describe('smooth line', () => {
  it('never overshoots its points, so a quiet stretch stays flat', () => {
    const pts: [number, number][] = [
      [0, 40],
      [10, 40],
      [20, 2],
      [30, 40],
      [40, 40],
    ];
    const y = ys(smooth(pts));
    expect(Math.min(...y)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...y)).toBeLessThanOrEqual(40);
  });

  it('draws one point as a move and nothing as nothing', () => {
    expect(smooth([[3, 4]])).toBe('M3.0,4.0');
    expect(smooth([])).toBe('');
  });
});
