// Portal motion: the springs and curves every animation runs on, the one way
// to start an animation from script, and the pure decisions behind a sheet
// pulled down. What moves and when lives with each piece (ui/, page/, flows/);
// one-shot CSS keyframes live in the stylesheets.
//
// Springs are physical (stiffness, damping) and sampled into CSS `linear()`, so
// a transition in CSS and an animation from script follow the same curve:
// BOUNCY is the skiper103 accordion (about 11% overshoot), SMOOTH the skiper21
// tab pill (critically damped). Reduced motion keeps fades and drops travel.

/** Asked once and kept (it answers as the setting changes): play() asks on every animation. */
const REDUCE = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

/** The visitor asked for less motion: fades only, nothing travels. */
export const calm = (): boolean => !!REDUCE?.matches;

/** Past this many px² a blur is a large layer's, drawn anew on every frame: it fades without. */
const BIG_BLUR = 30_000;

/**
 * A large element's frames without their blur (a fold, an accordion's body, a sheet): opacity, movement and size
 * go on as they were. Letters, icons and small things keep theirs.
 */
function lean(el: Element, frames: Keyframe[]): Keyframe[] {
  if (!frames.some((f) => 'filter' in f)) return frames;
  const r = el.getBoundingClientRect();
  if (r.width * r.height < BIG_BLUR) return frames;
  return frames.map(({ filter: _f, ...f }) => f);
}

export interface Spring {
  /** Until it settles within 0.15% of the end. */
  duration: number;
  /** The curve as CSS `linear()`. */
  easing: string;
  /** Progress at `ms` (overshoots past 1 on a bouncy spring). */
  at(ms: number): number;
}

/** A spring of stiffness `k` and damping `c` (mass 1), sampled into 64 steps. */
export function spring(k: number, c: number, m = 1): Spring {
  const w0 = Math.sqrt(k / m);
  const z = c / (2 * Math.sqrt(k * m));
  const x = (t: number): number => {
    if (z < 0.999) {
      const wd = w0 * Math.sqrt(1 - z * z);
      return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t));
    }
    if (z <= 1.001) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
    const r = Math.sqrt(z * z - 1);
    const s1 = -w0 * (z - r);
    const s2 = -w0 * (z + r);
    return 1 - (s2 * Math.exp(s1 * t) - s1 * Math.exp(s2 * t)) / (s2 - s1);
  };
  let end = 0;
  for (let t = 0; t < 3; t += 0.004) if (Math.abs(1 - x(t)) > 0.0015) end = t;
  end += 0.004;
  // Cut where it is within 0.15% of the end, the spring still has that much to go: on a large travel (a row
  // folding 500 px) a step of a pixel in the last frame. What is left is spread over the way instead, most of
  // it near the end, so the curve arrives at 1 exactly and smoothly; overshoot and timing stay as they are.
  const rest = 1 - x(end);
  const y = (t: number) => x(t) + rest * (t / end) ** 3;
  const pts: number[] = [];
  for (let i = 0; i <= 64; i++) pts.push(+y((end * i) / 64).toFixed(4));
  pts[64] = 1;
  const duration = Math.round(end * 1000);
  return { duration, easing: `linear(${pts.join(', ')})`, at: (ms) => (ms >= duration ? 1 : y(ms / 1000)) };
}

/** The accordion, the toast, a card that pops in. */
export const BOUNCY = spring(300, 20);
/** Pills, widths and heights: no overshoot. */
export const SMOOTH = spring(300, 35);
/** Small things that pop: a check, a mark turning in. */
export const POP = spring(520, 24);
/** The leading edge of a stretching pill: faster than SMOOTH, no overshoot. */
export const LEAD = spring(520, 46);
/** The dropdowns, a dialog on a computer and the accordions: POP made softer (about 4% over, 90% there at ~140 ms). */
export const SOFT = spring(380, 28);
/** What follows the pointer (a menu's highlight): there in about 130 ms, no overshoot. */
const QUICK = spring(900, 60);
/** A highlight gliding from row to row: quick, with a touch of give (about 2% over). */
const GLIDE = spring(640, 40);

export const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';
export const EASE_IN = 'cubic-bezier(0.55, 0, 1, 0.45)';
export const DRAWER = 'cubic-bezier(0.32, 0.72, 0, 1)';

/** The springs as CSS variables, for transitions written in the stylesheets. */
export function publishSprings(root: HTMLElement) {
  root.style.setProperty('--spring-bouncy', BOUNCY.easing);
  root.style.setProperty('--spring-bouncy-dur', `${BOUNCY.duration}ms`);
  root.style.setProperty('--spring-smooth', SMOOTH.easing);
  root.style.setProperty('--spring-smooth-dur', `${SMOOTH.duration}ms`);
  root.style.setProperty('--spring-soft', SOFT.easing);
  root.style.setProperty('--spring-soft-dur', `${SOFT.duration}ms`);
  root.style.setProperty('--spring-quick', QUICK.easing);
  root.style.setProperty('--spring-quick-dur', `${QUICK.duration}ms`);
  root.style.setProperty('--spring-glide', GLIDE.easing);
  root.style.setProperty('--spring-glide-dur', `${GLIDE.duration}ms`);
}

/**
 * Start an animation. With reduced motion, an animation that fades keeps only
 * its fade (short); one that only moves or resizes jumps to its end.
 */
export function play(el: Element, frames: Keyframe[], o: KeyframeAnimationOptions): Animation {
  if (!calm()) return el.animate(lean(el, frames), o);
  if (frames.some((f) => 'opacity' in f))
    return el.animate(
      frames.map((f) => ('opacity' in f ? { opacity: f.opacity } : {})),
      { duration: Math.min(Number(o.duration ?? 200), 160), easing: 'ease-out', fill: o.fill },
    );
  return el.animate(frames, { ...o, duration: 0, delay: 0 });
}

/** Distance past an edge → how far it actually goes: resistance grows with the pull. */
export function rubber(dist: number, dim: number): number {
  return dist <= 0 || dim <= 0 ? 0 : (1 - 1 / ((dist * 0.55) / dim + 1)) * dim;
}

/** How far a pull goes for an edge to stand `d` past it: rubber() undone (a sheet taken while it settles back). */
export function unrubber(d: number, dim: number): number {
  return d <= 0 || dim <= 0 ? 0 : (d * dim) / (0.55 * Math.max(1, dim - d));
}

/**
 * Does a pulled sheet go away? A flick down (px/ms, as Vaul) or a pull past a
 * third of its height does; a flick back up keeps it, however far it went.
 */
export function dismisses(dy: number, velocity: number, height: number): boolean {
  if (dy <= 0 || velocity < -0.1) return false;
  return velocity > 0.4 || dy > height / 3;
}
