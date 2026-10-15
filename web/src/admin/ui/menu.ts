// A small dropdown under its button; closes on pick, outside click, Escape,
// scrolling or navigation. A second click on the same button closes it.

import { E } from '../e';
import { onNavigate } from './nav';
import { run } from './toast';

export interface MenuItem {
  label: string;
  icon?: Node;
  danger?: boolean;
  warn?: boolean;
  run: () => unknown;
}

type OpenMenu = HTMLElement & { dlAnchor?: HTMLElement; dlClose?: () => void };

export function dropdown(anchor: HTMLElement, items: (MenuItem | null)[]) {
  const prev = document.querySelector('.dl-dd') as OpenMenu | null;
  if (prev) {
    prev.dlClose ? prev.dlClose() : prev.remove();
    if (prev.dlAnchor === anchor) return;
  }
  const menu: OpenMenu = E(
    'div',
    { class: 'dl-dd dl-root', role: 'menu' },
    items.map((it) =>
      it
        ? E(
            'button',
            {
              type: 'button',
              role: 'menuitem',
              class: it.danger ? 'danger' : it.warn ? 'warn' : '',
              click: () => {
                close();
                run(it.run);
              },
            },
            [it.icon ?? '', E('span', {}, it.label)],
          )
        : E('hr'),
    ),
  );
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth,
    h = menu.offsetHeight;
  // Open upwards when the menu would run off the bottom of the screen.
  menu.style.top = `${r.bottom + 6 + h > window.innerHeight - 8 && r.top - 6 - h > 8 ? r.top - 6 - h : r.bottom + 6}px`;
  menu.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
  const onDoc = (ev: Event) => {
    if (!menu.contains(ev.target as Node) && !anchor.contains(ev.target as Node)) close();
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') close();
  };
  const offNav = onNavigate(close);
  menu.dlAnchor = anchor;
  menu.dlClose = close;
  function close() {
    menu.remove();
    offNav();
    document.removeEventListener('mousedown', onDoc, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', close, true);
  }
  setTimeout(() => {
    document.addEventListener('mousedown', onDoc, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', close, true);
  });
  (menu.querySelector('button') as HTMLElement | null)?.focus({ preventScroll: true });
}
