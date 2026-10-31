import { describe, expect, it } from 'vitest';
import { BOUNCY, SMOOTH, dismisses, rubber, spring, unrubber } from '../src/portal/motion';

describe('motion', () => {
  it('pulls past an edge with growing resistance, never further than the box', () => {
    expect(rubber(0, 400)).toBe(0);
    expect(rubber(-20, 400)).toBe(0);
    expect(rubber(40, 400)).toBeLessThan(40);
    expect(rubber(40, 400)).toBeGreaterThan(15);
    // Each further step gives less than the one before.
    expect(rubber(200, 400) - rubber(100, 400)).toBeLessThan(rubber(100, 400) - rubber(0, 400));
    expect(rubber(100_000, 400)).toBeLessThan(400);
  });

  it('undoes the rubber: the pull that puts an edge where it stands', () => {
    for (const d of [1, 40, 200, 1000]) expect(unrubber(rubber(d, 400), 400)).toBeCloseTo(d, 6);
    expect(unrubber(0, 400)).toBe(0);
    expect(unrubber(-5, 400)).toBe(0);
  });

  it('dismisses a sheet on a flick down or a pull past a third, not on a flick back up', () => {
    expect(dismisses(12, 0.6, 500)).toBe(true);
    expect(dismisses(200, 0, 500)).toBe(true);
    expect(dismisses(120, 0.1, 500)).toBe(false);
    expect(dismisses(300, -0.5, 500)).toBe(false);
    expect(dismisses(0, 1, 500)).toBe(false);
    expect(dismisses(-40, 1, 500)).toBe(false);
  });

  it('samples springs into linear() that starts at 0 and ends at 1', () => {
    for (const s of [BOUNCY, SMOOTH, spring(520, 24)]) {
      expect(s.easing.startsWith('linear(0, ')).toBe(true);
      expect(s.easing.endsWith(', 1)')).toBe(true);
      expect(s.at(0)).toBe(0);
      expect(s.at(s.duration)).toBe(1);
    }
  });
});
