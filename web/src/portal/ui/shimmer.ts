// A light sweeping across a field's words while they are on their way to the router (a device's name being
// saved), as an assistant's "thinking" line does: a copy of the words laid exactly over the input's dims, and a
// band with a bell-shaped falloff crosses it again and again with a rest between. Stopping holds the band where it
// is and fades the words back to their colour around it; only then does the copy go, so the input's own words
// (or what takes their place) show with nothing changing. The band is the words' own colour over a muted base
// (styles/controls.css, `.shim`). With less motion asked for it only dims and comes back.

import { h } from '../dom';
import { calm } from '../motion';

/** A cubic-bezier easing as a function of progress (0..1). */
function bezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const at = (a: number, b: number, t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return (x) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (at(x1, x2, mid) < x) lo = mid;
      else hi = mid;
    }
    return at(y1, y2, (lo + hi) / 2);
  };
}
const STANDARD = bezier(0.2, 0, 0, 1);
const linear = (x: number) => x;

/** One value that moves; a new move of it stops the old one first. */
class Value {
  v: number;
  private stop: (() => void) | null = null;
  constructor(
    v: number,
    private paint: () => void,
  ) {
    this.v = v;
  }
  /** To `to` over `ms` (after `delay`), from where it is: true once there, false if stopped first. */
  to(to: number, ms: number, ease: (x: number) => number, delay = 0): Promise<boolean> {
    this.halt();
    return new Promise((done) => {
      let t0 = 0;
      let from = this.v;
      const step = (now: number) => {
        if (!t0) {
          t0 = now + delay;
          from = this.v;
        }
        const k = ms <= 0 ? 1 : Math.min(1, Math.max(0, (now - t0) / ms));
        if (now >= t0) {
          this.v = from + (to - from) * ease(k);
          this.paint();
        }
        if (k < 1) raf = requestAnimationFrame(step);
        else {
          this.stop = null;
          done(true);
        }
      };
      let raf = requestAnimationFrame(step);
      this.stop = () => {
        cancelAnimationFrame(raf);
        this.stop = null;
        done(false);
      };
    });
  }
  halt() {
    this.stop?.();
  }
}

/** Half the band's width in em, and its falloff as [offset, strength]. */
const BAND = 2.2;
const FALLOFF = [
  [-1, 0],
  [-0.5, 0.5],
  [-0.2, 0.9],
  [0, 1],
  [0.2, 0.9],
  [0.5, 0.5],
  [1, 0],
] as const;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** The band at sweep `t` (0: left of the words, 1: right of them) over a base `settle` of the way to solid. */
function image(t: number, settle: number): string {
  const base = `color-mix(in oklab, var(--shim-high) ${pct(settle)}, var(--shim-base))`;
  const stops = FALLOFF.map(
    ([o, k]) =>
      `color-mix(in oklab, var(--shim-high) ${pct(k)}, ${base}) calc(${(t * 100).toFixed(2)}% + ${((2 * t - 1 + o) * BAND).toFixed(3)}em)`,
  );
  return `linear-gradient(90deg, ${base}, ${stops.join(', ')}, ${base})`;
}

/** The input's font, for a copy of its words that has to sit exactly on them. */
const FONT = ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'fontFeatureSettings', 'fontVariationSettings'] as const;

/** Seconds for one sweep across the words, and the rest between sweeps (a share of it). */
const SWEEP = 1.8;
const REST = 0.32;
/** How long the words take to fade back to their colour once the answer is in, in ms. */
const SETTLE = 480;

/**
 * Start the shimmer over `input` (inside `field`, which it marks `.saving`). Returns the stop, which resolves
 * once the words are solid again and the copy is gone.
 */
export function shimmer(field: HTMLElement, input: HTMLInputElement): () => Promise<void> {
  const cs = getComputedStyle(input);
  // The copy sits in a box the input's size and is clipped to it, scrolled as the input is: a name longer than
  // the field shows the same part, never more.
  const copy = h('span', { class: 'shim' }, input.value);
  const clip = h('span', { class: 'shim-clip', 'aria-hidden': 'true' }, copy);
  for (const k of FONT) copy.style[k] = cs[k];
  Object.assign(clip.style, {
    left: `${input.offsetLeft}px`,
    top: `${input.offsetTop}px`,
    width: `${input.clientWidth}px`,
    height: `${input.offsetHeight}px`,
  });
  Object.assign(copy.style, { left: `${-input.scrollLeft}px`, lineHeight: `${input.offsetHeight}px` });
  const still = calm();
  const paint = () => (copy.style.backgroundImage = image(sweep.v, settle.v));
  // Solid at first, exactly the input's words: the swap shows nothing, then it dims.
  const sweep = new Value(0, paint);
  const settle = new Value(1, paint);
  paint();
  field.append(clip);
  field.classList.add('saving');
  field.setAttribute('aria-busy', 'true');

  let running = !still;
  const pass = async (delay: number) => {
    if (!running) return;
    if (sweep.v >= 1) sweep.v = 0;
    if (await sweep.to(1, SWEEP * 1000 * (1 - sweep.v), linear, delay * 1000)) void pass(SWEEP * REST);
  };
  void pass(0.12);
  void settle.to(0, still ? 0 : 240, STANDARD);

  return async () => {
    // The band stops where it is and the words fade back to their colour around it: nothing races off.
    running = false;
    sweep.halt();
    await settle.to(1, still ? 0 : SETTLE, STANDARD);
    field.classList.remove('saving');
    field.removeAttribute('aria-busy');
    clip.remove();
  };
}
