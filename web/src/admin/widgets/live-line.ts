// The live line under a speed (the concept's kit/chart.ts liveLine): the last
// two minutes the meter keeps, a point a second, sliding left as each new
// second comes. It sits inside its tile; the values are eased over 3 s (a
// second's noise reads as a tremor at this size), the curve is the admin's
// monotone one (ui/plot.ts smooth), the zone under it fades to nothing as the
// day chart's does, and both ends fade out (no dot: the number above says
// now). Its range follows the minute slowly (a third of the way each second),
// so a new peak never rescales the whole line in one step.
//
// Motion: one frame loop while the box is on screen and the tab is visible. The path is drawn one step past the
// box's left edge (the box clips) and slides left at a step a second, linear; a second that comes early or late
// carries the slide on from where it stands (it never jumps back or ahead). The range glides to the minute's too
// (SMOOTH-like, ~500 ms), so a new peak or a quiet minute reshapes the line, never in one step. The slide moves an
// HTML wrapper (a transform the compositor runs); the path is redrawn only while the range moves. With reduced
// motion it just redraws. Off screen the values still follow, so coming back shows the minute as it is.

import { h } from '../../portal/dom';
import { EASE_OUT, calm } from '../../portal/motion';
import { smooth } from '../ui/plot';

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag: string, a: Record<string, string | number> = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(a)) e.setAttribute(k, String(v));
  return e;
};

let ids = 0;

export interface LiveLine {
  el: HTMLElement;
  /** The meter's values, oldest first, one a second. */
  push(vals: number[]): void;
}

/** The line shows this many seconds across its tile. */
const SECONDS = 60;

export function liveLine(hgt: number): LiveLine {
  const id = `ll${++ids}`;
  const box = h('div', { class: 'll-box', 'aria-hidden': 'true' });
  box.style.height = `${hgt}px`;
  const svg = svgEl('svg', { class: 'll' });
  const grad = svgEl('linearGradient', { id: `${id}z`, x1: 0, y1: 0, x2: 0, y2: 1 });
  grad.append(svgEl('stop', { offset: 0, class: 'lc-z0' }), svgEl('stop', { offset: 1, class: 'lc-z1' }));
  const defs = svgEl('defs');
  defs.append(grad);
  const zone = svgEl('path', { fill: `url(#${id}z)` });
  const line = svgEl('path', { class: 'll-line' });
  svg.append(defs, zone, line);
  const wrap = h('div', { class: 'll-slide' });
  wrap.append(svg);
  box.append(wrap);
  let seen = true;
  let vals: number[] = [];
  let W = 0;
  let step = 0;
  // the range as drawn, and where it heads
  let hi = 0;
  let lo = 0;
  let tHi = 0;
  let tLo = 0;
  // the slide: px still to go, as of `at`
  let left = 0;
  let at = 0;
  let last = 0;
  let frame = 0;
  const draw = () => {
    const n = vals.length;
    const span = Math.max(hi - lo, hi * 0.15, 1e-9);
    const yy = (v: number) => hgt - 4 - ((v - lo) / span) * (hgt - 10);
    // the newest point at the tile's right edge, each older one a step to its left
    const xx = (i: number) => W - (n - 1 - i) * step;
    const d = smooth(vals.map((v, i) => [xx(i), yy(v)] as [number, number]));
    line.setAttribute('d', d);
    zone.setAttribute('d', `${d} L${xx(n - 1).toFixed(1)} ${hgt} L${xx(0).toFixed(1)} ${hgt} Z`);
  };
  // A step a second, evenly: the line glides, as a minute passing does (the owner, 2026-11-12: «должен быть за 60
  // секунд», after a short eased move per second read as not smooth). It moves only for a second that came.
  const offset = (t: number) => Math.max(0, left - (step * (t - at)) / 1000);
  const tick = (t: number) => {
    frame = 0;
    if (!seen || document.hidden || !box.isConnected) return;
    const dt = Math.min(100, t - (last || t));
    last = t;
    // the range glides: most of the way in ~250 ms, settled in ~500
    const k = 1 - Math.exp(-dt / 120);
    const moving = Math.abs(tHi - hi) > (tHi || 1) * 0.002 || Math.abs(tLo - lo) > (tHi || 1) * 0.002;
    if (moving) {
      hi += (tHi - hi) * k;
      lo += (tLo - lo) * k;
      draw();
    } else if (hi !== tHi || lo !== tLo) {
      hi = tHi;
      lo = tLo;
      draw();
    }
    const o = offset(t);
    wrap.style.transform = o > 0.01 ? `translateX(${o.toFixed(2)}px)` : '';
    if (o > 0.01 || moving) frame = requestAnimationFrame(tick);
  };
  const run = () => {
    if (!frame && !calm()) {
      last = 0;
      frame = requestAnimationFrame(tick);
    }
  };
  new IntersectionObserver(([e]) => {
    seen = e.isIntersecting;
    if (seen) run();
  }).observe(box);
  return {
    el: box,
    push(raw) {
      const w = Math.round(box.getBoundingClientRect().width);
      if (!w || raw.length < 2) return;
      // eased over 3 s: each point the mean of itself and the two before it; the newest minute of them
      const next = raw.map((_v, i) => (raw[i] + raw[Math.max(0, i - 1)] + raw[Math.max(0, i - 2)]) / 3).slice(-(SECONDS + 1));
      const now = performance.now();
      // where the slide stands now; a new second moves the path a step left, so it starts a step further right
      const o = W === w && vals.length ? offset(now) : 0;
      // the same seconds again (the tile was drawn again, no new point came): nothing moves
      if (W === w && vals.length === next.length && vals.every((v, i) => v === next[i])) return;
      const first = !vals.length;
      const fresh = first || W !== w;
      W = w;
      vals = next;
      svg.setAttribute('viewBox', `0 0 ${W} ${hgt}`);
      svg.setAttribute('width', String(W));
      svg.setAttribute('height', String(hgt));
      // A minute across the tile, whatever is kept of it yet: a second is always the same step, so every new one
      // moves the line by that step, from its first second on (a line still filling its window stands empty at
      // the left, it is not stretched).
      step = W / (SECONDS - 1);
      // the minute's range, with air above and below
      tHi = Math.max(1, ...vals);
      tLo = Math.min(...vals);
      if (fresh || calm()) {
        hi = tHi;
        lo = tLo;
      }
      draw();
      if (calm()) return;
      // its first second: the line comes in, it does not strike
      if (first) svg.animate({ opacity: [0, 1] }, { duration: 300, easing: EASE_OUT });
      // a whole step at most ahead of its place: a late second does not pile up
      left = fresh ? 0 : Math.min(o + step, step * 1.5);
      at = now;
      // where it stood, in the very frame the new path is drawn (a frame later it was seen a step ahead)
      wrap.style.transform = left > 0.01 ? `translateX(${left.toFixed(2)}px)` : '';
      run();
    },
  };
}
