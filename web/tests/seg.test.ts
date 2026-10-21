import { describe, expect, it } from 'vitest';
import { labelFade } from '../src/portal/ui/seg';

describe('picker names on a pick', () => {
  it('blurs the picked name in a beat after the pill, and folds a shown one whole', () => {
    expect(labelFade({ width: 0, full: 90, opacity: 0 }, true)).toEqual({ duration: 280, delay: 70 });
    expect(labelFade({ width: 90, full: 90, opacity: 1 }, false)).toEqual({ duration: 220, delay: 0 });
  });

  it('runs only what is left of a fade turned back half-way', () => {
    // Picked again while it was folding away: it comes back from 40% at once.
    const back = labelFade({ width: 36, full: 90, opacity: 0.4 }, true);
    expect(back.duration).toBeCloseTo(168);
    expect(back.delay).toBeCloseTo(42);
    // Left while it was still coming in: it folds from the wider of its width and its opacity.
    expect(labelFade({ width: 45, full: 90, opacity: 0.2 }, false).duration).toBeCloseTo(110);
    expect(labelFade({ width: 9, full: 90, opacity: 0.7 }, false).duration).toBeCloseTo(154);
  });

  it('leaves a folded name alone and a shown one picked again as it is', () => {
    expect(labelFade({ width: 0, full: 90, opacity: 0 }, false).duration).toBe(0);
    expect(labelFade({ width: 0.4, full: 90, opacity: 0.001 }, false).duration).toBe(0);
    expect(labelFade({ width: 90, full: 90, opacity: 1 }, true)).toEqual({ duration: 0, delay: 0 });
  });

  it('keeps to its bounds when the readings are off (no width to measure, opacity past 1)', () => {
    expect(labelFade({ width: 30, full: 0, opacity: 0 }, false).duration).toBe(0);
    expect(labelFade({ width: 200, full: 90, opacity: 0 }, false).duration).toBe(220);
    expect(labelFade({ width: 0, full: 90, opacity: 1.2 }, true).duration).toBe(0);
  });
});
