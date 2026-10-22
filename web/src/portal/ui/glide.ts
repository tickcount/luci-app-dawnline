// The dropdowns' highlight (ui/drop.ts: the ⋯ menu's rows, a pick pill's segments): one for all of a dropdown's
// items, under their icons and words, the glass's solid highlight, the same for every item. It comes in on the item
// the pointer (the keyboard, or a finger sliding over from a pick pill) reaches, glides from item to item on GLIDE
// taking each one's place, size and corners, presses in with it, and fades where the pointer leaves (or goes back to
// the item it rests on: a pick pill's picked segment).

import { h } from '../dom';

export interface Glide {
  /** Light this item (null: none). */
  light(item: HTMLElement | null): void;
}

/**
 * `host`: what holds the items and the highlight, positioned. `rest`: the item the highlight rests on (a pick pill's
 * picked segment): it starts there, and goes back there rather than fading when the pointer leaves.
 */
export function glide(host: HTMLElement, items: HTMLElement[], rest: HTMLElement | null = null): Glide {
  const hl = h('span', { class: 'drop-hl', 'aria-hidden': 'true' });
  host.prepend(hl);
  let hot: HTMLElement | null = null;
  const light = (item: HTMLElement | null) => {
    if (item === hot) return;
    hot?.classList.remove('hot');
    hot = item;
    if (!item) return void (hl.style.opacity = '0');
    item.classList.add('hot');
    // Gone altogether, it is placed at once and fades in there; still showing, it glides from where it stands.
    hl.classList.toggle('moving', +getComputedStyle(hl).opacity > 0.01);
    Object.assign(hl.style, {
      translate: `${item.offsetLeft}px ${item.offsetTop}px`,
      width: `${item.offsetWidth}px`,
      height: `${item.offsetHeight}px`,
      borderRadius: getComputedStyle(item).borderRadius,
      opacity: '1',
    });
  };
  for (const it of items) {
    it.addEventListener('pointerenter', () => light(it));
    it.addEventListener('focus', () => it.matches(':focus-visible') && light(it));
    it.addEventListener('pointerdown', () => {
      hl.classList.add('down');
      document.addEventListener('pointerup', () => hl.classList.remove('down'), { once: true, capture: true });
    });
  }
  host.addEventListener('pointerleave', () => light(rest));
  light(rest);
  return { light: (item) => light(item ?? rest) };
}
