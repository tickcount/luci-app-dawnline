import { describe, expect, it } from 'vitest';
import { glideStep, places, type FieldText, type Glide } from '../src/portal/ui/caret';

/** Frame by frame from `x` toward `t` until it rests: where it was after each frame. */
const run = (x: number, t: number, frames = 1): number[] => {
  const g: Glide = { x, v: 0, t };
  const out: number[] = [];
  for (let i = 0; i < 200 && glideStep(g, frames); i++) out.push(g.x);
  out.push(g.x);
  return out;
};

describe('caret glide', () => {
  it('settles exactly on its target in either direction', () => {
    expect(run(0, 100).at(-1)).toBe(100);
    expect(run(100, 0).at(-1)).toBe(0);
  });

  it('takes a late frame as up to 2.5 frames, and is simply there after a long gap', () => {
    const one: Glide = { x: 0, v: 0, t: 100 };
    glideStep(one, 2.5);
    const late: Glide = { x: 0, v: 0, t: 100 };
    glideStep(late, 6);
    expect(late.x).toBeCloseTo(one.x, 9);
    const gone: Glide = { x: 0, v: 3, t: 100 };
    expect(glideStep(gone, 60)).toBe(false);
    expect(gone).toEqual({ x: 100, v: 0, t: 100 });
  });

  it('rests at once where it already is', () => {
    const g: Glide = { x: 42, v: 0, t: 42 };
    expect(glideStep(g, 1)).toBe(false);
    expect(g.x).toBe(42);
  });
});

/** A font of 10 px a letter, in an input 16 px from the field's edge and 200 px wide. */
const mono = (s: string) => s.length * 10;
const field = (o: Partial<FieldText>): FieldText => ({
  value: 'Pixel 9',
  start: 0,
  end: 0,
  backward: false,
  left: 16,
  width: 200,
  scroll: 0,
  ...o,
});

describe('caret places', () => {
  it('puts a caret after the text before it', () => {
    expect(places(field({ start: 0, end: 0 }), mono)).toEqual({ caret: 16, start: 16, end: 16, range: false });
    expect(places(field({ start: 5, end: 5 }), mono)).toEqual({ caret: 66, start: 66, end: 66, range: false });
    expect(places(field({ start: 7, end: 7 }), mono).caret).toBe(86);
  });

  it('gives a selection both ends, the caret at the end it was made toward', () => {
    expect(places(field({ start: 1, end: 5 }), mono)).toEqual({ caret: 66, start: 26, end: 66, range: true });
    expect(places(field({ start: 1, end: 5, backward: true }), mono)).toEqual({ caret: 26, start: 26, end: 66, range: true });
  });

  it('follows the text as the input scrolls it', () => {
    const long = 'Living room television';
    // 220 px of text in 200 px: scrolled to its end, the caret stands on the input's right edge.
    expect(places(field({ value: long, start: 22, end: 22, scroll: 20 }), mono).caret).toBe(216);
    expect(places(field({ value: long, start: 12, end: 12, scroll: 20 }), mono).caret).toBe(116);
  });

  it('stops a selection at the input edges, so the wash never runs under the go button', () => {
    const long = 'Living room television';
    expect(places(field({ value: long, start: 0, end: 22 }), mono)).toEqual({ caret: 216, start: 16, end: 216, range: true });
    expect(places(field({ value: long, start: 0, end: 22, scroll: 20 }), mono)).toEqual({ caret: 216, start: 16, end: 216, range: true });
  });
});
