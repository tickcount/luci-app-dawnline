// A right-hand panel over the page (the device drawer). One at a time; closes
// with its button, a click outside, Escape or a navigation.

import { E } from '../e';
import { icon } from '../../shared/icons';
import { onNavigate } from './nav';

export interface Drawer {
  close: () => void;
  panel: HTMLElement;
}

let current: Drawer | null = null;

export function drawer(title: Node, body: Node, foot: Node | null, onClose: () => void): Drawer {
  current?.close();
  const panel = E('aside', { class: 'dl-drawer', role: 'dialog', 'aria-modal': 'true' }, [
    E('div', { class: 'dl-drawer-head' }, [
      title,
      E('button', { type: 'button', class: 'dl-drawer-x', 'aria-label': 'Close', click: () => close() }, icon('x')),
    ]),
    E('div', { class: 'dl-drawer-body' }, body),
    foot ? E('div', { class: 'dl-drawer-foot' }, foot) : '',
  ]);
  const overlay = E(
    'div',
    {
      class: 'dl-drawer-overlay dl-root',
      click: (ev: Event) => {
        if (ev.target === overlay) close();
      },
    },
    panel,
  );
  const onKey = (ev: KeyboardEvent) => {
    // LuCI keeps an empty .modal in the page; the body class says whether one is open.
    if (ev.key === 'Escape' && !document.body.classList.contains('modal-overlay-active')) close();
  };
  let closed = false;
  const offNav = onNavigate(() => close());
  function close() {
    if (closed) return;
    closed = true;
    offNav();
    document.removeEventListener('keydown', onKey);
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 220);
    if (current === handle) current = null;
    onClose();
  }
  const handle: Drawer = { close, panel };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  current = handle;
  return handle;
}
