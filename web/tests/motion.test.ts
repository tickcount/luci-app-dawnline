import { describe, expect, it } from 'vitest';
import { dismisses, morphMs, rubber } from '../src/portal/motion';

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

  it('dismisses a sheet on a flick down or a pull past a third, not on a flick back up', () => {
    expect(dismisses(12, 0.6, 500)).toBe(true);
    expect(dismisses(200, 0, 500)).toBe(true);
    expect(dismisses(120, 0.1, 500)).toBe(false);
    expect(dismisses(300, -0.5, 500)).toBe(false);
    expect(dismisses(0, 1, 500)).toBe(false);
    expect(dismisses(-40, 1, 500)).toBe(false);
  });

  it('times a height change by its distance, inside 220–380 ms', () => {
    expect(morphMs(0)).toBe(220);
    expect(morphMs(200)).toBe(270);
    expect(morphMs(2000)).toBe(380);
  });
});
