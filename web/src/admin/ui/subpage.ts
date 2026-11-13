// A list and the page of one thing in it, in the same place: opening a person or a device gives the page the whole
// column, and the list waits under it, with the page's head and bar, its scroll and its filters kept. Back returns
// the list where it was left and rings the item that was opened for a moment, so the eye finds its place. The
// opening is the page's (its address, pushState); this only swaps what is shown and moves the eye.
//
// Motion: a page that opens, and the list that comes back, come in as a page does (ui/entrance.ts); a first load
// comes in with its page, and Escape brings the list back at once. The item opened from: a 1.5 px accent ring
// inside it, fading over 1.8 s.

import { h } from '../../portal/dom';
import { play } from '../../portal/motion';
import { enter } from './entrance';
import { ic } from './icons';
import { onNavigate } from './nav';
import { putChildren } from '../../portal/ui/put';

/** What scrolls the page: Outline's #maincontent, else the window's own element. */
export function scroller(): HTMLElement {
  const m = document.getElementById('maincontent');
  return m && /auto|scroll/.test(getComputedStyle(m).overflowY) ? m : (document.scrollingElement as HTMLElement);
}

export interface Subpage {
  el: HTMLElement;
  list: HTMLElement;
  /**
   * `page` in the list's place (null: the list again). `how`: a pick moves, Back and a first load do not slide in.
   * `from`: the list's item the page is about (it is ringed when the list comes back).
   */
  show(page: HTMLElement | null, how: 'load' | 'pick' | 'back', from?: string): void;
}

/** `root`: the page's own element, marked `has-sub` while a page stands in the list's place. */
export function subpage(root: HTMLElement): Subpage {
  const list = h('div', { class: 'kt-list' });
  const side = h('div', { class: 'kt-sub' });
  const el = h('div', { class: 'kt-md' }, list, side);
  let open = false;
  let listTop = 0;
  let opened = '';
  // what sticks in the list (the map of the map view) is placed from the scroller's content edge: Outline's
  // #maincontent has a padding above it
  const measure = () => {
    const sc = scroller();
    el.style.setProperty('--md-top', `${sc === document.scrollingElement ? 0 : -(parseFloat(getComputedStyle(sc).paddingTop) || 0)}px`);
  };
  requestAnimationFrame(measure);
  addEventListener('resize', measure, { passive: true });
  const off = onNavigate(() => {
    off();
    removeEventListener('resize', measure);
  });
  /** The list where it was left; the item opened from ringed (scrolled to the middle when it is out of sight). */
  const back = (how: 'load' | 'pick' | 'back') => {
    const id = opened;
    opened = '';
    requestAnimationFrame(() => {
      scroller().scrollTop = listTop;
      if (how === 'load') return;
      enter(list);
      const item = id ? list.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`) : null;
      if (!item) return;
      const r = item.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) item.scrollIntoView({ block: 'center' });
      play(item, [{ boxShadow: 'inset 0 0 0 1.5px var(--accent)' }, { boxShadow: 'inset 0 0 0 1.5px transparent' }], {
        duration: 1800,
        easing: 'ease-out',
      });
    });
  };
  return {
    el,
    list,
    show(page, how, from) {
      const was = open;
      open = !!page;
      if (page && !was) {
        listTop = scroller().scrollTop;
        opened = from ?? '';
      } else if (page && from && !opened) opened = from;
      putChildren(side, page ? [page] : []);
      el.classList.toggle('open', open);
      root.classList.toggle('has-sub', open);
      if (!page) {
        if (was) back(how);
        return;
      }
      if (how === 'load') return;
      // a page of its own: from its top, where its blocks are measured to come in
      scroller().scrollTop = 0;
      enter(page);
    },
  };
}

/** What a page has above its head: the way back (to the list, or from a device to its person) and × to the list. */
export function pageBar(o: { back: string; to: string; close: () => void }): HTMLElement {
  const x = h(
    'button',
    { type: 'button', class: 'knob kt-px', 'aria-label': _('Back to the list'), title: _('Back to the list · Esc') },
    ic('x'),
  );
  x.addEventListener('click', o.close);
  return h(
    'div',
    { class: 'kt-pbar' },
    h('nav', { class: 'back' }, h('a', { class: 'back-a', href: o.to }, ic('chevron'), h('span', {}, o.back))),
    x,
  );
}
