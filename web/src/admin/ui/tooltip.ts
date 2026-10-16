// One floating tooltip that follows the pointer (small charts, meters, round
// buttons). It hides when its anchor leaves the page or is hidden (a repaint
// replaced it, another section is shown), on scrolling, on a tap or click
// elsewhere (touch screens have no mouseleave) and when the page navigates
// away, so it never lingers on <body>.

import { E } from '../e';
import { onNavigate } from './nav';

let floating: HTMLElement | null = null;
let anchor: HTMLElement | null = null;
let watch = 0;

export function hideTip() {
  if (floating) floating.style.display = 'none';
  anchor = null;
  clearInterval(watch);
  watch = 0;
}

export function attachTip(el: HTMLElement, content: () => (Node | string)[]) {
  const show = (ev: MouseEvent) => {
    floating ??= document.body.appendChild(E('div', { class: 'dl-tip dl-tip-float dl-root' }));
    floating.replaceChildren(...content().map((c) => (typeof c === 'string' ? document.createTextNode(c) : c)));
    floating.style.display = '';
    floating.style.left = `${ev.clientX}px`;
    floating.style.top = `${ev.clientY - 10}px`;
    anchor = el;
    // No mouseleave comes from an element that was removed or hidden under the pointer.
    watch ||= window.setInterval(() => {
      if (!anchor?.isConnected || !anchor.getClientRects().length) hideTip();
    }, 400);
  };
  el.addEventListener('mouseenter', show);
  el.addEventListener('mousemove', show);
  el.addEventListener('mouseleave', hideTip);
}

onNavigate(hideTip);
window.addEventListener('scroll', () => anchor && hideTip(), { capture: true, passive: true });
document.addEventListener(
  'pointerdown',
  (ev) => {
    if (anchor && !anchor.contains(ev.target as Node)) hideTip();
  },
  true,
);
