// How a row's chips move. The admin's pages stand still and only what was pressed moves
// (portal/motion.ts standStill), and a press here makes the page draw the row again, so the chips pressed are other
// nodes a moment later. As ui/carry.ts does for a control, the new row is handed the one it replaces and each chip
// goes on from where its own stood (DESIGN.md › Motion):
//   stays              glides to its new place (FLIP on SMOOTH) when a neighbour came or went
//   another look       (taken away, brought back, waiting) crosses in place through the blur: the old one out
//                      160 ms EASE_IN, the new one in 280 ms EASE_OUT after 60 ms
//   new                a typed one takes the field's place (it is the same thing, said for good); any other comes
//                      in through the blur from nine tenths on SOFT
//   left               fades where it stood (160 ms EASE_IN, to nine tenths, blurred), the rest close up
// and the row glides to its new height (ui/reshape.ts grown). Less motion asked for: play() keeps the fades only.

import { EASE_IN, EASE_OUT, SMOOTH, SOFT, play } from '../motion';
import { replaces } from './carry';
import { grown } from './grown';

interface Piece {
  x: number;
  y: number;
  w: number;
  h: number;
  look: string;
  el: HTMLElement;
}
export type Stood = Map<string, Piece>;

/** The key of the field a chip is typed in: the chip that comes of it takes its place. */
export const FIELD = '#field';

/** Where each piece of a row stands in it now (a glide under way included: the next one goes on from there). */
export function stood(box: HTMLElement): Stood {
  const b = box.getBoundingClientRect();
  const out: Stood = new Map();
  for (const el of box.children as Iterable<HTMLElement>) {
    const k = el.dataset.k;
    if (!k || el.dataset.ghost) continue;
    const r = el.getBoundingClientRect();
    out.set(k, { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height, look: el.dataset.s ?? '', el });
  }
  return out;
}

const OUT = [
  { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' },
  { opacity: 0, transform: 'scale(0.9)', filter: 'blur(4px)' },
];

/** What stood at `p` goes out where it stood, over whatever takes its place. */
function leave(box: HTMLElement, p: Piece) {
  const g = p.el.cloneNode(true) as HTMLElement;
  g.dataset.ghost = '1';
  g.setAttribute('aria-hidden', 'true');
  g.inert = true;
  Object.assign(g.style, {
    position: 'absolute',
    left: `${p.x}px`,
    top: `${p.y}px`,
    width: `${p.w}px`,
    height: `${p.h}px`,
    margin: '0',
    pointerEvents: 'none',
  });
  box.append(g);
  play(g, OUT, { duration: 160, easing: EASE_IN, fill: 'forwards' }).finished.then(
    () => g.remove(),
    () => g.remove(),
  );
}

/** The row's pieces go to where they stand now from where `was` had them. */
export function settle(box: HTMLElement, was: Stood) {
  const now = stood(box);
  const field = was.get(FIELD);
  for (const [k, p] of now) {
    const old = was.get(k) ?? (k.startsWith('n:') && field && !now.has(FIELD) ? field : undefined);
    if (!old) {
      // nothing to go on from: in through the blur, after what leaves has begun to
      play(
        p.el,
        [
          { opacity: 0, transform: 'scale(0.9)', filter: 'blur(4px)' },
          { opacity: 1, transform: 'scale(1)', filter: 'blur(0px)' },
        ],
        { duration: SOFT.duration, easing: SOFT.easing, delay: was.size ? 60 : 0, fill: 'backwards' },
      );
      continue;
    }
    const dx = old.x - p.x;
    const dy = old.y - p.y;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)
      play(p.el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }], {
        duration: SMOOTH.duration,
        easing: SMOOTH.easing,
      });
    if (old === field) {
      // what was typed, said for good: the same thing in the same place, so only its new look comes up
      play(
        p.el,
        [
          { opacity: 0.5, filter: 'blur(2px)' },
          { opacity: 1, filter: 'blur(0px)' },
        ],
        { duration: 200, easing: EASE_OUT },
      );
    } else if (old.look !== p.look) {
      // another look in the same place: the two cross in the blur
      leave(box, { ...old, x: p.x + dx, y: p.y + dy });
      play(
        p.el,
        [
          { opacity: 0, filter: 'blur(4px)' },
          { opacity: 1, filter: 'blur(0px)' },
        ],
        { duration: 280, easing: EASE_OUT, delay: 60, fill: 'backwards' },
      );
    }
  }
  for (const [k, p] of was) if (!now.has(k) && k !== FIELD && !(k === '#add' && now.has(FIELD))) leave(box, p);
}

/** A row built again by a repaint: its chips go on from where the ones they replace stood, the row to its new height. */
export function carryChips(key: string, box: HTMLElement) {
  const old = replaces(key, box);
  if (!old) return;
  const was = stood(old);
  // the one a value was typed in a moment ago stands for the field it was
  const typed = old.dataset.typed;
  const at = typed ? was.get(typed) : undefined;
  if (typed && at) {
    was.delete(typed);
    was.set(FIELD, at);
  }
  const row0 = old.closest<HTMLElement>('.nb-row, .nb-inconf');
  // as high as the old row showed before what was said under it went (the field's own say(null) hid it a moment ago)
  const h0 = Number(old.dataset.h) || row0?.getBoundingClientRect().height || 0;
  requestAnimationFrame(() => {
    if (!box.isConnected) return;
    settle(box, was);
    const row = box.closest<HTMLElement>('.nb-row, .nb-inconf');
    if (row && h0) glide(row, h0);
    // a network typed and taken: the keyboard goes on from the one that adds the next
    if (typed) box.querySelector<HTMLElement>('.nb-add')?.focus({ preventScroll: true });
  });
}

/** A line of words coming in under the row (how to finish, why not). */
export const said = (line: HTMLElement) => play(line, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: EASE_OUT });

/**
 * `el` goes to the height it has now from `from` (as high as it showed), a glide under way given up for this one;
 * answers the height it goes to. A height read while a glide runs is the glide's own, not the layout's: so the one
 * under way is let go first, and the layout's read then (ui/reshape.ts grown reads before it lets go).
 */
export function glide(el: HTMLElement, from: number): number {
  el.getAnimations().forEach((a) => a.id === 'grown' && a.cancel());
  const to = el.offsetHeight;
  grown(el, from);
  return to;
}

const top = (el: Element) => el.getBoundingClientRect().top;

/**
 * A line under the list comes in: what stands under it (`next`) goes down from where it would stand without the
 * line, on SMOOTH, and the line comes up through the blur in the room that makes (240 ms EASE_OUT after 140).
 */
export function unfoldLine(line: HTMLElement, next: Element) {
  const with_ = top(next);
  line.hidden = true;
  const room = with_ - top(next);
  line.hidden = false;
  if (room < 1) return;
  play(line, [{ marginBottom: `${-room}px` }, { marginBottom: '0px' }], { duration: SMOOTH.duration, easing: SMOOTH.easing });
  play(
    line,
    [
      { opacity: 0, filter: 'blur(4px)' },
      { opacity: 1, filter: 'blur(0px)' },
    ],
    // once most of its room is there (SMOOTH is two thirds over at 140 ms): it never shows across the line below
    { duration: 240, easing: EASE_OUT, delay: 140, fill: 'backwards' },
  );
}

/**
 * Something that is no more (a line under a list, a row of one, a block of a card): its copy stands where it stood,
 * before `next` in `into` (null: at its end), fades there (160 ms EASE_IN) and gives its room up on SMOOTH, so what is
 * under it comes up with it and whatever holds it goes to its new height in step; then it is gone. The room is what
 * `into` is higher by with the copy in it: its gaps and margins are in that, whatever they are.
 */
export function foldLine(old: HTMLElement, into: HTMLElement, next: Element | null) {
  const without = into.getBoundingClientRect().height;
  const g = old.cloneNode(true) as HTMLElement;
  g.setAttribute('aria-hidden', 'true');
  g.inert = true;
  g.classList.remove('nb-wn');
  g.querySelectorAll('[data-k]').forEach((x) => x.removeAttribute('data-k'));
  into.insertBefore(g, next);
  const room = into.getBoundingClientRect().height - without;
  if (room < 1) return g.remove();
  play(g, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: EASE_IN, fill: 'forwards' });
  play(g, [{ marginBottom: '0px' }, { marginBottom: `${-room}px` }], {
    duration: SMOOTH.duration,
    easing: SMOOTH.easing,
    fill: 'forwards',
  }).finished.then(
    () => g.remove(),
    () => g.remove(),
  );
}
