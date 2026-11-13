// A block that is another height than it stood at goes there in one glide, so what is under it travels with its
// edge (the admin's blocks whose content lands a moment late, a row of chips drawn again: ui/chips-motion.ts).

import { SMOOTH, calm, play } from '../motion';

/**
 * What `el` holds landed a moment after it stood (a block of a panel whose log has just been read) and it is another
 * height now: it goes there from `h0`, the height it had, on SMOOTH, what it holds clipped on the way. So what is
 * under it travels with its edge, in step, and whatever it stands in (a dialog) follows by itself. Nothing fades and
 * nothing is moved apart from it: a block brought into focus whole blinked, and one slid over to its new place
 * crossed what had just landed there (the owner, 2026-11-12: «появляются со странным фейдом и накладываются друг на
 * друга»). With less motion it is there at once. `h0`: its `offsetHeight` before the change.
 */
export function grown(el: HTMLElement, h0: number) {
  // heights as the layout has them (offsetHeight), never as they show: a dialog still opening is drawn at nine
  // tenths, and a height read off the screen there sent the block to nine tenths of its own, which it made up for
  // in one step when the glide let go
  const h1 = el.offsetHeight;
  if (calm() || !el.getClientRects().length || Math.abs(h1 - h0) < 1) return;
  el.getAnimations().forEach((a) => a.id === 'grown' && a.cancel());
  play(
    el,
    [
      { height: `${h0}px`, overflow: 'clip' },
      { height: `${h1}px`, overflow: 'clip' },
    ],
    { duration: SMOOTH.duration, easing: SMOOTH.easing },
  ).id = 'grown';
}
