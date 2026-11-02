// The chart tooltip: one card anchored above a point of a chart (not under the
// pointer, see tooltip.ts for that), gliding from one point to the next while a
// chart is read (shared/scrub.ts). Its numbers swap at once; only the card moves.
// It hides when the page navigates, on scrolling, and when its owner lets go.

import { E } from '../e';
import { onNavigate } from './nav';

let card: HTMLElement | null = null;
let owner: object | null = null;
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Show `kids` above page point (x, y) for `who`; the same owner's next point glides there. */
export function showGlide(who: object, x: number, y: number, kids: (Node | string)[]): void {
  card ??= document.body.appendChild(E('div', { class: 'dl-tip dl-tip-float dl-root dl-glide' }));
  card.replaceChildren(...kids.map((k) => (typeof k === 'string' ? document.createTextNode(k) : k)));
  card.style.display = '';
  // Kept inside the window: measured with its new content, before it moves.
  const w = card.offsetWidth;
  const cx = Math.min(innerWidth - 8 - w / 2, Math.max(8 + w / 2, x));
  card.classList.toggle('glides', owner === who && !still());
  card.style.transform = `translate(${cx}px, ${y - 10}px) translate(-50%, -100%)`;
  card.classList.add('on');
  owner = who;
}

/** Hide the card (only if `who` owns it, when given). */
export function hideGlide(who?: object): void {
  if (!card || (who && who !== owner)) return;
  card.classList.remove('on', 'glides');
  card.style.display = 'none';
  owner = null;
}

/**
 * A tooltip for a piece that is one value (a meter): above `anchor` (the piece's
 * top centre by default) while the pointer is on it, after a tap (until a tap
 * elsewhere), or while it has focus.
 */
export function pointTip(el: HTMLElement, content: () => (Node | string)[], anchor?: () => [number, number]): void {
  const at = (): [number, number] => {
    if (anchor) return anchor();
    const r = el.getBoundingClientRect();
    return [r.left + r.width / 2, r.top];
  };
  let shown = false;
  const show = () => {
    shown = true;
    const [x, y] = at();
    showGlide(el, x, y, content());
    document.addEventListener('pointerdown', away, true);
  };
  const hide = () => {
    shown = false;
    hideGlide(el);
    document.removeEventListener('pointerdown', away, true);
  };
  const away = (ev: PointerEvent) => !el.contains(ev.target as Node) && hide();
  el.tabIndex = 0;
  el.addEventListener('pointerenter', (ev) => ev.pointerType === 'mouse' && show());
  el.addEventListener('pointerleave', (ev) => ev.pointerType === 'mouse' && hide());
  el.addEventListener('pointerup', (ev) => ev.pointerType !== 'mouse' && (shown ? hide() : show()));
  el.addEventListener('focus', show);
  el.addEventListener('blur', hide);
}

onNavigate(() => hideGlide());
window.addEventListener('scroll', () => owner && hideGlide(), { capture: true, passive: true });
