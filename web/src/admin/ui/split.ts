// A map with its inspector, one stage (People › Map). From 840 px of the column the
// map and the inspector stand side by side in one card as high as the window leaves
// under the page's head (440–860 px), so the page itself stops there: the map takes
// the wheel, the inspector's body scrolls inside, its edges fading only where more is
// hidden past them. Narrower, the map stands over the inspector and its body goes on
// with the page. The inspector is the map's text alternative, so a link before the
// map takes the keyboard past its markers straight to it.

import { h } from '../../portal/dom';
import { scroller } from './subpage';
import { onNavigate } from './nav';

export interface Stage {
  el: HTMLElement;
  /** What scrolls inside the inspector (its levels are put in it). */
  body: HTMLElement;
  /** Bring `row` into the body's sight, scrolling the body alone (not the page) while it scrolls on its own. */
  reveal(row: Element): void;
  /** The body's scroll, kept while another level stands in it, and put back. */
  scroll: { get(): number; set(y: number): void };
  /** Measure the stage's height again (the page's head above it changed). */
  fit(): void;
}

export function stage(o: { map: HTMLElement; head: HTMLElement; skip: string }): Stage {
  const body = h('div', { class: 'kt-stage-body', tabindex: '-1' });
  const skip = h('a', { class: 'skip', href: '#' }, o.skip);
  skip.addEventListener('click', (e) => {
    e.preventDefault();
    (body.querySelector<HTMLElement>('a, button') ?? body).focus();
  });
  const el = h(
    'div',
    { class: 'card kt-stage' },
    skip,
    h('div', { class: 'kt-stage-map' }, o.map),
    h('div', { class: 'kt-stage-side', role: 'region', 'aria-label': o.skip }, o.head, body),
  );
  // the edges fade only where rows are hidden past them (the places close-up's rows do the same)
  const edge = () => {
    const inside = body.scrollHeight > body.clientHeight + 1;
    body.classList.toggle('more-up', inside && body.scrollTop > 1);
    body.classList.toggle('more-down', inside && body.scrollTop + body.clientHeight < body.scrollHeight - 1);
  };
  body.addEventListener('scroll', edge, { passive: true });
  const ro = new ResizeObserver(edge);
  ro.observe(body);
  const mo = new MutationObserver(() => requestAnimationFrame(edge));
  mo.observe(body, { childList: true, subtree: true });
  // as high as the window leaves under what stands above it, the page scrolled to its top
  const fit = () => {
    if (!el.isConnected) return;
    const sc = scroller();
    const top = el.getBoundingClientRect().top + sc.scrollTop - (sc === document.scrollingElement ? 0 : sc.getBoundingClientRect().top);
    const room = (sc === document.scrollingElement ? innerHeight : sc.clientHeight) - top - 24;
    el.style.setProperty('--stage-h', `${Math.round(Math.min(860, Math.max(440, room)))}px`);
  };
  addEventListener('resize', fit, { passive: true });
  const off = onNavigate(() => {
    off();
    removeEventListener('resize', fit);
    ro.disconnect();
    mo.disconnect();
  });
  return {
    el,
    body,
    reveal(row) {
      if (body.scrollHeight <= body.clientHeight + 1) return;
      const r = row.getBoundingClientRect();
      const b = body.getBoundingClientRect();
      const d = r.top < b.top ? r.top - b.top - 12 : r.bottom > b.bottom ? r.bottom - b.bottom + 12 : 0;
      if (d) body.scrollBy({ top: d, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    },
    scroll: {
      get: () => body.scrollTop,
      set: (y) => {
        body.scrollTop = y;
        edge();
      },
    },
    fit,
  };
}
