// The red line under a name field (Add a device, Rename): why the name is refused, the router's word or the
// field's own as it is typed (shared/name-guard.ts). It comes and goes without the sheet snapping: in, it rises in
// as the sheet glides open; out, it blurs away first, then the sheet glides shut. Either way it turns back from
// where it stands on screen. A view already swapped out (the answer came late) changes alone: the sheet's height is
// the new view's. Another reason while it shows: its words change in place.

import { h } from '../dom';
import { EASE_IN, EASE_OUT, play } from '../motion';
import { morphText, setText, textOf } from './morph';
import { glide, showing } from './sheet';

/** Away and shown. */
const GONE: Keyframe = { opacity: 0, transform: 'translateY(-4px)', filter: 'blur(4px)' };
const SHOWN: Keyframe = { opacity: 1, transform: 'none', filter: 'none' };

export interface BadLine {
  el: HTMLElement;
  say: (msg: string) => void;
  unsay: () => void;
}

export function badLine(): BadLine {
  const err = h('p', { class: 'hint bad-t', hidden: true });
  const reflow = (change: () => void) => (showing(err) ? glide(change) : change());
  let fade: Animation | null = null;
  let hiding = 0;
  const now = (): Keyframe => {
    const s = getComputedStyle(err);
    return { opacity: s.opacity, transform: s.transform, filter: s.filter };
  };
  // The new fade takes over from the old one once it is in place (nothing paints between).
  const fadeTo = (from: Keyframe, to: Keyframe, o: KeyframeAnimationOptions) => {
    const was = fade;
    fade = play(err, [from, to], o);
    was?.cancel();
  };
  const say = (msg: string) => {
    if (err.hidden) {
      reflow(() => {
        setText(err, msg);
        err.hidden = false;
      });
      return fadeTo(GONE, SHOWN, { duration: 220, easing: EASE_OUT });
    }
    // Already showing: its words change in place. On its way out, it comes back from where it stands as they do.
    const from = hiding ? now() : null;
    morphText(err, msg);
    if (!from) return;
    clearTimeout(hiding);
    hiding = 0;
    fadeTo(from, SHOWN, { duration: 220, easing: EASE_OUT });
  };
  const unsay = () => {
    if (err.hidden || hiding) return;
    const from = now();
    // A morph under way ends where it was going: its end would cancel the fade.
    setText(err, textOf(err));
    fadeTo(from, GONE, { duration: 180, easing: EASE_IN, fill: 'forwards' });
    hiding = window.setTimeout(() => {
      hiding = 0;
      reflow(() => {
        err.hidden = true;
        fade?.cancel();
        fade = null;
      });
    }, 170);
  };
  return { el: err, say, unsay };
}
