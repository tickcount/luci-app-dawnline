import { describe, expect, it } from 'vitest';
import { labelFade } from '../src/portal/ui/seg';

describe('picker names on a pick', () => {
  it('shortens a fade interrupted part-way', () => {
    // Picked again while it was folding away: it comes back from 40% at once.
    const opening = labelFade({ width: 0, full: 90, opacity: 0 }, true);
    const closing = labelFade({ width: 90, full: 90, opacity: 1 }, false);
    const back = labelFade({ width: 36, full: 90, opacity: 0.4 }, true);
    expect(back.duration).toBeGreaterThan(0);
    expect(back.duration).toBeLessThan(opening.duration);
    expect(back.delay).toBeLessThanOrEqual(opening.delay);
    // Interrupted while opening: either width or opacity can keep the closing fade active.
    expect(labelFade({ width: 45, full: 90, opacity: 0.2 }, false).duration).toBeLessThan(closing.duration);
    expect(labelFade({ width: 9, full: 90, opacity: 0.7 }, false).duration).toBeLessThan(closing.duration);
  });

  it('leaves a folded name alone and a shown one picked again as it is', () => {
    expect(labelFade({ width: 0, full: 90, opacity: 0 }, false).duration).toBe(0);
    expect(labelFade({ width: 0.4, full: 90, opacity: 0.001 }, false).duration).toBe(0);
    expect(labelFade({ width: 90, full: 90, opacity: 1 }, true)).toEqual({ duration: 0, delay: 0 });
  });

  it('keeps to its bounds when the readings are off (no width to measure, opacity past 1)', () => {
    expect(labelFade({ width: 30, full: 0, opacity: 0 }, false).duration).toBe(0);
    expect(labelFade({ width: 200, full: 90, opacity: 0 }, false)).toEqual(labelFade({ width: 90, full: 90, opacity: 0 }, false));
    expect(labelFade({ width: 0, full: 90, opacity: 1.2 }, true).duration).toBe(0);
  });
});
