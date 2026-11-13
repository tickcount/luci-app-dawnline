// The pages' toast: the portal's (ui/feedback.ts, DESIGN.md Toast and
// Motion 7: one at a time in the bottom slot, in on BOUNCY, out on EASE_IN, a
// new one replacing the shown one from where it stands), in the layer. The
// admin adds an undo (owner decision): a reversible one-tap action asks
// nothing and says what it did with Undo beside the words; such a toast stays
// 5 s instead of 2.4 and holds while the pointer or the focus is on it. The
// admin's other toasts (ui/toast.ts notify: the router not answering, an
// update under the page) come here too, and stay as long as they ask.

import type { Child } from '../luci.d';
import type { Tone } from '../ui/toast';
import { h, ic } from '../../portal/dom';
import { BOUNCY, EASE_IN, play } from '../../portal/motion';
import { layer } from '../../portal/ui/layer';

let slot: HTMLElement | null = null;
let shown: HTMLElement | null = null;
let timer = 0;

function leave(t: HTMLElement, to: Keyframe, ms: number) {
  const s = getComputedStyle(t);
  // what is left of its way: one still coming in leaves sooner
  const a = play(t, [{ opacity: s.opacity, transform: s.transform, filter: s.filter }, to], {
    duration: ms * +s.opacity,
    easing: EASE_IN,
    fill: 'forwards',
  });
  t.getAnimations().forEach((x) => x !== a && x.cancel());
  a.onfinish = () => t.remove();
}

/** The words of a message as text (a toast says sentences; nodes from older callers are read for theirs). */
const words = (m: Child): string =>
  m == null || m === false ? '' : Array.isArray(m) ? m.map(words).join('') : m instanceof Node ? (m.textContent ?? '') : String(m);

export interface SayOptions {
  bad?: boolean;
  /** How long it stays (ms); 2.4 s by default, 5 s with an undo. */
  ms?: number;
  /** Undo: the button beside the words runs it, and the toast then says `undone`. */
  undo?: () => void;
  undone?: string;
}

/** A toast in the layer (with `undo`: a reversible one-tap action said with its Undo). */
export function say(msg: string, o: SayOptions = {}) {
  if (!slot?.isConnected) slot = layer().appendChild(h('div', { class: 'toasts dl-toasts', role: 'status', 'aria-live': 'polite' }));
  if (shown) leave(shown, { opacity: 0, transform: 'scale(.96)', filter: 'blur(4px)' }, 140);
  const undo = o.undo
    ? h(
        'button',
        {
          type: 'button',
          class: 'toast-undo',
          onclick: () => {
            o.undo!();
            say(o.undone ?? _('Undone'));
          },
        },
        _('Undo'),
      )
    : null;
  const t = h(
    'div',
    { class: `toast${o.bad ? ' bad' : ''}${undo ? ' has-undo' : ''}` },
    ic(o.bad ? 'alert' : 'check'),
    h('span', {}, msg),
    undo,
  );
  slot.appendChild(t);
  shown = t;
  play(
    t,
    [
      { opacity: 0, transform: 'translateY(18px) scale(.9)', filter: 'blur(6px)' },
      { opacity: 1, transform: 'none', filter: 'none' },
    ],
    { duration: BOUNCY.duration, easing: BOUNCY.easing },
  );
  const away = () => {
    if (shown !== t) return;
    shown = null;
    leave(t, { opacity: 0, transform: 'translateY(6px) scale(.96)', filter: 'blur(4px)' }, 180);
  };
  const arm = (ms: number) => {
    if (shown !== t) return;
    clearTimeout(timer);
    timer = window.setTimeout(away, ms);
  };
  clearTimeout(timer);
  arm(o.ms ?? (undo ? 5000 : 2400));
  if (!undo) return;
  // Its Undo never runs out under the pointer or the focus: the toast stays while either is on it, and goes 2 s
  // after both have left (WCAG 2.2.1).
  let over = false;
  let focused = false;
  const hold = () => shown === t && clearTimeout(timer);
  const free = () => !over && !focused && arm(2000);
  t.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse') return;
    over = true;
    hold();
  });
  t.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse') return;
    over = false;
    free();
  });
  t.addEventListener('focusin', () => {
    focused = true;
    hold();
  });
  t.addEventListener('focusout', (e) => {
    focused = t.contains(e.relatedTarget as Node | null);
    free();
  });
}

/** ui/toast.ts notify(): errors and warnings in the bad tone, as long as they ask (errors 8 s). */
export function sayNotice(message: Child, tone: Tone, timeout: number) {
  const bad = tone === 'error' || tone === 'warning';
  say(words(message), { bad, ms: timeout || (tone === 'error' ? 8000 : tone === 'warning' ? 5000 : 2600) });
}
