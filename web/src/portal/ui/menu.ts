// The ⋯ menu: a small panel under (or over) its button, items with an icon,
// a highlight that glides after the pointer and takes the item's colour
// (orange for Reconnect, red for Remove). A choice among options (the
// language) marks the current one with a check instead of icons. One at a
// time; it closes on a press outside, on scroll, on Escape and when its button
// is pressed again.

import { h, ic } from '../dom';
import { EASE_IN, POP, play } from '../motion';

export interface MenuItem {
  label: string;
  /** An action's icon; an option (`checked` set) shows a check in its place, on the current one only. */
  icon?: string;
  checked?: boolean;
  tone?: 'warn' | 'bad';
  run: () => unknown;
}

let menuEl: HTMLElement | null = null;
/** The button the open menu belongs to: pressing it again closes the menu. */
let anchorEl: HTMLElement | null = null;

export const menuOpen = () => !!menuEl;

/** `now`: gone at once (Escape, or another menu opening). */
export function closeMenu(now = false) {
  const m = menuEl;
  if (!m) return;
  menuEl = null;
  anchorEl?.setAttribute('aria-expanded', 'false');
  anchorEl = null;
  if (now) {
    m.remove();
    return;
  }
  // From where it stands: one closed while it still pops in (a scroll, a second press) goes from there.
  const s = getComputedStyle(m);
  const a = play(
    m,
    [
      { opacity: s.opacity, transform: s.transform, filter: s.filter },
      { opacity: 0, transform: 'scale(.96)', filter: 'blur(3px)' },
    ],
    {
      duration: 120,
      easing: EASE_IN,
      fill: 'forwards',
    },
  );
  m.getAnimations().forEach((x) => x !== a && x.cancel());
  a.onfinish = () => m.remove();
}

/** `items`: null is a separator, kept only between items. */
export function openMenu(anchor: HTMLElement, all: (MenuItem | null)[]) {
  if (anchorEl === anchor && menuEl) return closeMenu();
  closeMenu(true);
  const items = all.filter((it, i) => it || (i > 0 && all[i - 1] && all.slice(i + 1).some(Boolean)));
  const hl = h('span', { class: 'menu-hl' });
  const m = h('div', { class: 'menu', role: 'menu' }, hl);
  for (const it of items) {
    if (!it) {
      m.appendChild(h('div', { class: 'menu-sep' }));
      continue;
    }
    const b = h(
      'button',
      {
        type: 'button',
        role: it.checked === undefined ? 'menuitem' : 'menuitemradio',
        'aria-checked': it.checked === undefined ? null : String(it.checked),
        class: `mi ${it.tone ?? ''}`,
        onclick: () => {
          closeMenu();
          it.run();
        },
      },
      it.checked === undefined ? ic(it.icon ?? '') : ic('check', it.checked ? 'i' : 'i off'),
      h('span', {}, it.label),
    );
    // The highlight comes in where the pointer is, then glides from item to item. Whether it shows is read off the
    // screen: one still fading out (the pointer left and came back) turns back and glides from where it stands;
    // only one gone altogether is placed at once.
    b.addEventListener('pointerenter', () => {
      const seen = +getComputedStyle(hl).opacity > 0.01;
      hl.className = `menu-hl${seen ? ' moving' : ''} ${it.tone ?? ''}`;
      hl.style.transform = `translateY(${b.offsetTop - 6}px)`;
      hl.style.opacity = '1';
    });
    m.appendChild(b);
  }
  m.addEventListener('pointerleave', () => (hl.style.opacity = '0'));
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const w = m.offsetWidth;
  const mh = m.offsetHeight;
  // Under the button, or over it where the screen ends: it grows out of the button either way.
  const below = r.bottom + 8 + mh < innerHeight - 8;
  m.style.left = `${Math.max(12, Math.min(r.right - w, innerWidth - w - 12))}px`;
  m.style.top = `${below ? r.bottom + 8 : r.top - 8 - mh}px`;
  m.style.transformOrigin = `${below ? 'top' : 'bottom'} right`;
  play(
    m,
    [
      { opacity: 0, transform: 'scale(.9)', filter: 'blur(4px)' },
      { opacity: 1, transform: 'none', filter: 'none' },
    ],
    {
      duration: POP.duration,
      easing: POP.easing,
    },
  );
  menuEl = m;
  anchorEl = anchor;
  anchor.setAttribute('aria-expanded', 'true');
}

document.addEventListener('pointerdown', (e) => {
  const t = e.target as Element;
  if (menuEl && !menuEl.contains(t) && !anchorEl?.contains(t)) closeMenu();
});
addEventListener('scroll', () => closeMenu(), { passive: true });
