// A page's entrance (DESIGN.md › Motion › 1. Page intro): its blocks rise one after the other in the order they
// stand on screen, top to bottom and then left to right, each to its own opacity. The portal's first paint runs it
// (main.ts intro), and so does every page of the admin as it opens and every view it swaps in (admin/ui/entrance.ts).

import { EASE_OUT, play } from '../motion';

/** One block's rise, and the wave's first wait and its step (ms). */
const RISE = 520;
const FIRST = 60;
const STEP = 40;
/** What marks a block while it rises: it is let go on, never begun again, and nothing in it rises on its own. */
export const RISING = 'data-rising';

/** A wave under way: every rise in it runs on one clock, so a block that takes another's place goes on from its point. */
export interface Wave {
  /** The timeline's time the wave began at. */
  start: number;
  /** Each block's wait. */
  delays: WeakMap<Element, number>;
  /** The last block's wait, and when the whole wave has risen (timeline ms). */
  last: number;
  end: number;
}

const now = (): number => Number(document.timeline.currentTime ?? performance.now());

/** `el` rises in `wave`, after `delay`: on the wave's clock, so it is as far along as the wave is. */
export function riseIn(wave: Wave, el: Element, delay: number) {
  if (el.hasAttribute(RISING)) return;
  // read before it is touched: it rises to its own opacity (a card the admin disabled is dimmed all the way, not at
  // the end) and keeps a transform of its own
  const cs = getComputedStyle(el);
  const own = cs.transform === 'none' ? '' : cs.transform;
  const a = play(
    el,
    [
      { opacity: 0, transform: `translateY(10px) ${own}`.trim(), filter: 'blur(4px)' },
      { opacity: cs.opacity, transform: own || 'none', filter: 'none' },
    ],
    { duration: RISE, delay, easing: EASE_OUT, fill: 'backwards' },
  );
  a.startTime = wave.start;
  wave.delays.set(el, delay);
  el.setAttribute(RISING, '');
  const done = () => el.removeAttribute(RISING);
  a.addEventListener('finish', done);
  a.addEventListener('cancel', done);
}

/**
 * Let `els` rise in the order they stand on screen. The wave starts at the first one on screen (a page opened deep
 * down starts there, and the blocks above it rise with it); `most`: after this many steps the rest rise with the last.
 */
export function rise(els: Element[], most = Infinity): Wave {
  const blocks = els
    .filter((el) => !el.hasAttribute(RISING))
    .map((el) => ({ el, at: el.getBoundingClientRect() }))
    .sort((a, b) => Math.round(a.at.top) - Math.round(b.at.top) || a.at.left - b.at.left);
  const above = blocks.filter((x) => x.at.bottom <= 0).length;
  const start = now();
  const last = FIRST + Math.min(most, Math.max(0, blocks.length - 1 - above)) * STEP;
  const wave: Wave = { start, delays: new WeakMap(), last, end: start + last + RISE };
  blocks.forEach(({ el }, i) => riseIn(wave, el, FIRST + Math.min(most, Math.max(0, i - above)) * STEP));
  return wave;
}
