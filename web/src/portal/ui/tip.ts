// A tooltip over a small thing that has no words of its own (a device's tile on a person's card): the toast's
// colours, a pill of one line, in the layer so no card or scroller clips it. Above what it names, or under it
// (`below`: where a heading stands over the thing); on the other side when the window has no room. A mouse shows
// it on hover, the keyboard on focus; a finger's first tap on a link shows it and the second, while it is said,
// follows the link (or says it again: a thing that only says); a control that acts (`acts`) is pressed at once (no
// tooltip under a finger, the keyboard's focus says it) and a press puts the tooltip away.
// One tooltip for the whole page: it moves to whatever asks for it (a second one under the pointer shows at once).
//
// Motion, as the portal's tooltip of the connection keys (DESIGN.md › Sheet, Tooltip): it comes up out of a blur
// toward what it names (`in, y∓3, s.96, b3 → 0`, 220 EASE_OUT) and fades where it stands (120 ease-out); from one
// thing to the next it glides over from where it stands (SMOOTH) and its words morph. While said it keeps to its
// thing as the page moves it, and fades where it stands when a repaint takes the thing away: it never jumps. Each
// move starts from how it shows. Reduced motion keeps the fades.

import { h } from '../dom';
import { layer } from './layer';
import { EASE_OUT, SMOOTH, play } from '../motion';
import { morphText, setText, textOf } from './morph';

/**
 * The pages a tooltip leaves with: the admin's change inside one document, so it hands in its own hook at start
 * (admin/ui/nav.ts onNavigate: `fn` is run when the page is left; the answer takes that back). The portal has one
 * page and leaves none.
 */
let onLeave: (fn: () => void) => () => void = () => () => undefined;
/** The portal says whole sentences in it (a status cut short on its card): there it takes a second line. */
let wraps = false;
export const tipsWrap = () => void (wraps = true);
export const tipsLeaveWith = (hook: typeof onLeave) => void (onLeave = hook);

let pill: HTMLElement | null = null;
let owner: HTMLElement | null = null;
/** Its glide from one thing to the next (`translate`), apart from how it shows (opacity, scale, blur). */
let glide: Animation | null = null;

/** Where the pill stands for `at`: over it, or under it (`below`, or no room over it); whether it is under. */
function place(at: HTMLElement, below: boolean): boolean {
  const a = at.getBoundingClientRect();
  const w = pill!.offsetWidth;
  const left = Math.max(8, Math.min(innerWidth - w - 8, a.left + a.width / 2 - w / 2));
  const ph = pill!.offsetHeight;
  const over = a.top - ph - 6;
  const under = a.bottom + 6;
  const down = below ? under + ph <= innerHeight - 8 || over < 8 : over < 8;
  pill!.style.left = `${left}px`;
  pill!.style.top = `${down ? under : over}px`;
  pill!.style.transformOrigin = `${a.left + a.width / 2 - left}px ${down ? '0' : '100%'}`;
  return down;
}

/** How it shows now (mid-fade included), to go on from. */
function now(): Keyframe {
  const s = getComputedStyle(pill!);
  return { opacity: s.opacity, transform: s.transform, filter: s.filter === 'none' ? 'blur(0px)' : s.filter };
}

/** Its next fade takes over from where the last one stands; the last one stops once it is in place. */
function fade(frames: Keyframe[], o: KeyframeAnimationOptions) {
  const old = pill!.getAnimations().filter((a) => a.id === 'tip');
  play(pill!, frames, o).id = 'tip';
  old.forEach((a) => a.cancel());
}

let frame = 0;
/**
 * While it is said, the pill keeps to its thing: it follows it when the page moves it (a block unfolding above),
 * and goes when a repaint takes the thing away (no pointer leaves a thing that is gone, so nothing else would).
 */
function follow(below: boolean) {
  cancelAnimationFrame(frame);
  const step = () => {
    const at = owner;
    if (!at || !pill?.classList.contains('on')) return;
    if (!at.isConnected || !at.getClientRects().length) return hide(at);
    place(at, below);
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
}

function show(at: HTMLElement, text: string, below: boolean) {
  // a thing with nothing to say right now (words that fit their place) shows none
  if (!text) return;
  if (!pill) {
    pill = h('span', { class: wraps ? 'kt-tip lines' : 'kt-tip', role: 'tooltip' });
    layer().append(pill);
    const off = onLeave(() => {
      off();
      pill?.remove();
      pill = owner = glide = null;
    });
  }
  // still showing (from the thing before, or fading from this one): it glides over from where it stands
  const shows = +getComputedStyle(pill).opacity > 0;
  const was = pill.getBoundingClientRect();
  owner = at;
  if (shows && textOf(pill) !== text) morphText(pill, text);
  else if (!shows) setText(pill, text);
  glide?.cancel();
  const down = place(at, below);
  pill.classList.add('on');
  if (shows) {
    const r = pill.getBoundingClientRect();
    const dx = was.left + was.width / 2 - (r.left + r.width / 2);
    const dy = was.top - r.top;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)
      glide = play(pill, [{ translate: `${dx}px ${dy}px` }, { translate: '0px 0px' }], {
        duration: SMOOTH.duration,
        easing: SMOOTH.easing,
      });
    fade([now(), { opacity: 1, transform: 'none', filter: 'blur(0px)' }], { duration: SMOOTH.duration, easing: SMOOTH.easing });
  } else
    fade(
      [
        { opacity: 0, transform: `translateY(${down ? -3 : 3}px) scale(.96)`, filter: 'blur(3px)' },
        { opacity: 1, transform: 'none', filter: 'blur(0px)' },
      ],
      { duration: 220, easing: EASE_OUT },
    );
  follow(below);
}

function hide(at: HTMLElement) {
  if (owner !== at || !pill) return;
  owner = null;
  cancelAnimationFrame(frame);
  // it fades where it stands, mid-glide or still coming up
  const from = now();
  pill.classList.remove('on');
  fade([from, { ...from, opacity: 0 }], { duration: 120, easing: 'ease-out' });
}

/** `el` says `text()` in the tooltip (made when asked: it may change); `below`: under it; `acts`: a press acts. */
export function tip(el: HTMLElement, text: () => string, o: { below?: boolean; acts?: boolean } = {}) {
  const below = !!o.below;
  el.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && show(el, text(), below));
  el.addEventListener('pointerleave', (e) => e.pointerType === 'mouse' && hide(el));
  el.addEventListener('blur', () => hide(el));
  if (o.acts) {
    // the page a press changes is drawn without the tooltip
    el.addEventListener('focus', () => el.matches(':focus-visible') && show(el, text(), below));
    el.addEventListener('pointerdown', () => hide(el));
    return;
  }
  el.addEventListener('focus', () => show(el, text(), below));
  // a finger: the first tap says it, a second one while it is said follows the link
  let finger = false;
  let told = 0;
  el.addEventListener('pointerdown', (e) => (finger = e.pointerType !== 'mouse'));
  el.addEventListener('click', (e) => {
    if (!finger || !text() || (owner === el && Date.now() - told < 2400)) return;
    e.preventDefault();
    e.stopPropagation();
    told = Date.now();
    show(el, text(), below);
    setTimeout(() => {
      if (Date.now() - told >= 2400) hide(el);
    }, 2400);
  });
}
