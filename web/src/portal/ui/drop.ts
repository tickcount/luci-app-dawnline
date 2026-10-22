// What every dropdown shares (the ⋯ menu, the pick pills' popups, the page's code): its look (.drop,
// styles/drop.css: Liquid Glass, a soft even edge, a soft shadow on light only), one open at a time, the same gap to
// its button and margin to the screen's edge, the same way in (a spring out of where it grows from) and out (back
// towards it, from where it stands), and the same ways to shut it: a press outside it and its button, Escape (the
// sheet under it stays; focus goes back to the button), a resize (at once). Each lays out and fills its own.

import { EASE_IN, SOFT, play } from '../motion';

/** From its button, and from the screen's edge. */
export const GAP = 8;
export const EDGE = 12;

let current: ((now?: boolean) => void) | null = null;

/** A dropdown is open (the page holds its repaints meanwhile). */
export const dropOpen = () => !!current;

/** Shut the one open (`now`: at once: a sheet opening, the page drawn again in another language). */
export function closeDrop(now = false) {
  current?.(now);
}

/** Where an element stands now, mid-motion included. */
function standing(el: Element): Keyframe {
  const s = getComputedStyle(el);
  return { opacity: s.opacity, transform: s.transform, filter: s.filter === 'none' ? 'blur(0px)' : s.filter };
}

/** In: a soft spring out of its transform origin (a little over, no wobble). */
export function appear(el: Element) {
  play(
    el,
    [
      { opacity: 0, transform: 'scale(.5)', filter: 'blur(6px)' },
      { opacity: 1, transform: 'none', filter: 'blur(0px)' },
    ],
    { duration: SOFT.duration, easing: SOFT.easing },
  );
}

/** Out: back towards its origin from where it stands, then gone. */
export function vanish(el: Element) {
  const from = standing(el);
  el.getAnimations().forEach((a) => a.cancel());
  play(el, [from, { opacity: 0, transform: 'scale(.7)', filter: 'blur(4px)' }], {
    duration: 110,
    easing: EASE_IN,
    fill: 'forwards',
  }).onfinish = () => el.remove();
}

/**
 * Open `panel` for `button`: another one open shuts at once, and the ways to shut this one are listened for.
 * `shut(now)` does the closing itself; what this returns is to be called first thing in it (it lets go of the
 * listeners, says the button is shut, and is false when the dropdown was shut already).
 */
export function opened(panel: Element, button: HTMLElement, shut: (now?: boolean) => void): () => boolean {
  if (current) current(true);
  const outside = (e: PointerEvent) => {
    const t = e.target as Node;
    if (!panel.contains(t) && !button.contains(t)) shut();
  };
  const esc = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    shut();
    button.focus({ preventScroll: true });
  };
  const resized = () => shut(true);
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', esc, true);
  addEventListener('resize', resized);
  button.setAttribute('aria-expanded', 'true');
  current = shut;
  return () => {
    if (current !== shut) return false;
    current = null;
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', esc, true);
    removeEventListener('resize', resized);
    button.setAttribute('aria-expanded', 'false');
    return true;
  };
}
