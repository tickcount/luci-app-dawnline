// A button held busy while the router answers: its content blurs away and an
// orb comes up through the blur in its place, then the other way round. The orb
// is B4 Converge from aicss.dev's Orbs (controls.css draws it). Each change starts
// from where the last one stands, so an answer that lands mid-change turns back
// without a jump.

import { h } from '../dom';
import { EASE_IN, EASE_OUT, play } from '../motion';

const SHOWN: Keyframe = { opacity: 1, filter: 'blur(0px)', transform: 'none' };
const GONE: Keyframe = { opacity: 0, filter: 'blur(5px)', transform: 'scale(.86)' };
const ORB_GONE: Keyframe = { opacity: 0, filter: 'blur(5px)', transform: 'scale(.6)' };
/** Out quick, in a little later and slower: the two cross in the blur. */
const OUT = { duration: 180, easing: EASE_IN, fill: 'forwards' } as const;
const IN = { duration: 340, delay: 70, easing: EASE_OUT, fill: 'backwards' } as const;
/** Until the orb is all the way in: a quicker answer waits for it, so the orb never just flickers. */
export const BUSY_IN = IN.delay + IN.duration;

const runs = new WeakMap<HTMLElement, Animation[]>();

/** Where an element stands now, mid-animation included. */
function now(el: Element): Keyframe {
  const s = getComputedStyle(el);
  return { opacity: s.opacity, filter: s.filter === 'none' ? 'blur(0px)' : s.filter, transform: s.transform };
}

/** What gives way: the button's own elements (a bare word goes into a span first). */
function content(btn: HTMLElement): Element[] {
  for (const n of [...btn.childNodes])
    if (n.nodeType === Node.TEXT_NODE && n.textContent?.trim()) n.replaceWith(h('span', {}, n.textContent));
  return [...btn.children].filter((c) => !c.classList.contains('orb'));
}

/** The new change takes over: the old one stops once the new one is in place (nothing paints between). */
function hand(btn: HTMLElement, next: Animation[]) {
  const old = runs.get(btn) ?? [];
  runs.set(btn, next);
  old.forEach((a) => a.cancel());
}

export function busyOn(btn: HTMLElement) {
  const parts = content(btn);
  const from = parts.map(now);
  // An orb still on its way out (pressed again right after an answer) turns back from where it stands, at once.
  const was = btn.querySelector<HTMLElement>(':scope > .orb');
  const orb = was ?? h('span', { class: 'orb', 'aria-hidden': 'true' }, h('i'), h('i'));
  if (!was) btn.append(orb);
  btn.classList.add('busy');
  btn.setAttribute('aria-busy', 'true');
  hand(btn, [
    ...parts.map((p, i) => play(p, [from[i], GONE], OUT)),
    play(orb, [was ? now(was) : ORB_GONE, SHOWN], was ? { ...IN, delay: 0 } : IN),
  ]);
}

export function busyOff(btn: HTMLElement) {
  const orb = btn.querySelector(':scope > .orb');
  const parts = content(btn);
  const next = [...(orb ? [play(orb, [now(orb), ORB_GONE], OUT)] : []), ...parts.map((p) => play(p, [now(p), SHOWN], IN))];
  hand(btn, next);
  btn.removeAttribute('aria-busy');
  Promise.all(next.map((a) => a.finished)).then(
    () => {
      if (runs.get(btn) !== next) return; // busy again meanwhile
      runs.delete(btn);
      next.forEach((a) => a.cancel());
      orb?.remove();
      btn.classList.remove('busy');
    },
    () => {},
  );
}
