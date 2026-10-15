// One floating tooltip that follows the pointer (small charts, meters, round
// buttons). It hides when its anchor leaves the page (a repaint replaced it)
// or the page navigates away, so it never lingers on <body>.

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
    // No mouseleave comes from an element that was removed under the pointer.
    watch ||= window.setInterval(() => {
      if (!anchor?.isConnected) hideTip();
    }, 400);
  };
  el.addEventListener('mouseenter', show);
  el.addEventListener('mousemove', show);
  el.addEventListener('mouseleave', hideTip);
}

onNavigate(hideTip);
