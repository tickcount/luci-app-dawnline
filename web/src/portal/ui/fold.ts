// A block of a form opens or folds away, as a line of the portal's add form does (portal
// flows/device-form.ts foldLine, with the gap under the block): height, opacity and blur on SMOOTH, from how it shows
// now, so a second pick half-way goes on from there. What is under it travels with its edge.

import { SMOOTH, play } from '../motion';

export function fold(el: HTMLElement, open: boolean, gap = 12) {
  const cs = getComputedStyle(el);
  const from = el.hidden
    ? { h: 0, o: 0, b: 4, m: 0 }
    : {
        h: el.getBoundingClientRect().height,
        o: +cs.opacity,
        b: +(cs.filter.match(/blur\(([\d.]+)px\)/)?.[1] ?? 0),
        m: parseFloat(cs.marginBottom) || 0,
      };
  el.getAnimations().forEach((a) => a.cancel());
  el.hidden = false;
  el.style.overflow = 'hidden';
  const to = open ? { h: el.scrollHeight, o: 1, b: 0, m: gap } : { h: 0, o: 0, b: 4, m: 0 };
  const frame = (v: typeof from) => ({
    height: `${v.h}px`,
    opacity: v.o,
    filter: v.b ? `blur(${v.b}px)` : 'none',
    marginBottom: `${v.m}px`,
  });
  const a = play(el, [frame(from), frame(to)], { duration: SMOOTH.duration, easing: SMOOTH.easing, fill: 'forwards' });
  a.onfinish = () => {
    el.hidden = !open;
    el.style.overflow = '';
    a.cancel();
  };
}
