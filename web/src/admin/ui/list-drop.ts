// A list of choices under its button: the portal's dropdown (ui/drop.ts: the
// glass, the spring out of its button, the one gliding highlight, Escape and
// a press outside), laid out as its ⋯ menu, with what a list of choices needs
// and a menu does not: the picked one checked, and a long list (people,
// devices, a page's sections) scrolling inside the glass instead of running
// past the screen.

import { h } from '../../portal/dom';
import { appear, EDGE, GAP, opened, vanish } from '../../portal/ui/drop';
import { glide } from '../../portal/ui/glide';
import { layer } from '../../portal/ui/layer';
import { ic } from './icons';

export interface ListItem {
  id: string;
  label: string;
  sub?: string;
  on?: boolean;
  /** A line icon in the check's place (a person, a device kind, a section). */
  icon?: string;
  tone?: 'warn' | 'bad';
}

/** `items`: null between groups (a thin line, as the ⋯ menu's); `o.max`: how tall the list may grow before it scrolls. */
export function openList(
  anchor: HTMLElement,
  items: (ListItem | null)[],
  title: string,
  pick: (id: string) => void,
  o: { max?: number; role?: 'menu' } = {},
) {
  if (anchor.getAttribute('aria-expanded') === 'true') return;
  const rows: HTMLElement[] = [];
  const row = (it: ListItem) => {
    const b = h(
      'button',
      {
        type: 'button',
        role: o.role === 'menu' ? 'menuitem' : 'option',
        'aria-selected': o.role === 'menu' ? null : String(!!it.on),
        'aria-current': o.role === 'menu' && it.on ? 'location' : null,
        class: `mi${it.on ? ' picked' : ''}${it.tone ? ` ${it.tone}` : ''}`,
        onclick: () => {
          close();
          pick(it.id);
        },
      },
      it.on ? ic('check') : it.icon ? ic(it.icon) : h('span', { class: 'i kt-ld-none', 'aria-hidden': 'true' }),
      h('span', { class: 'mi-b' }, h('span', { class: 'mi-l' }, it.label), it.sub ? h('span', { class: 'mi-s' }, it.sub) : null),
    );
    rows.push(b);
    return b;
  };
  const groups: ListItem[][] = [[]];
  for (const it of items) {
    if (it) groups[groups.length - 1].push(it);
    else if (groups[groups.length - 1].length) groups.push([]);
  }
  const inner = h(
    'div',
    { class: 'kt-ld-in' },
    ...groups.flatMap((g, i) => [
      i ? h('div', { class: 'pop-sep', 'aria-hidden': 'true' }, h('span')) : null,
      h('div', { class: 'pop-grp' }, ...g.map(row)),
    ]),
  );
  const body = h('div', { class: 'pop-body kt-ld-body' }, inner);
  const pop = h('div', { class: 'pop drop kt-ld', role: o.role ?? 'listbox', 'aria-label': title }, body);
  layer().append(pop);
  const k = anchor.getBoundingClientRect();
  const w = Math.min(Math.max(pop.offsetWidth, k.width, 248), 320, innerWidth - EDGE * 2);
  pop.style.width = `${w}px`;
  const room = Math.max(innerHeight - k.bottom - GAP - EDGE, k.top - GAP - EDGE);
  body.style.maxHeight = `${Math.max(160, Math.min(room, o.max ?? 420))}px`;
  const ht = pop.offsetHeight;
  const mid = k.left + k.width / 2;
  const left = Math.max(EDGE, Math.min(k.left, innerWidth - EDGE - w));
  const below = k.bottom + GAP + ht <= innerHeight - EDGE || k.top - GAP - ht < EDGE;
  const top = below ? k.bottom + GAP : k.top - GAP - ht;
  Object.assign(pop.style, {
    left: `${left + scrollX}px`,
    top: `${top + scrollY}px`,
    transformOrigin: `${Math.max(0, mid - left)}px ${below ? 0 : ht}px`,
  });
  appear(pop);
  const release = opened(pop, anchor, close);
  glide(inner, rows);
  rows.find((r) => r.classList.contains('picked'))?.scrollIntoView({ block: 'nearest' });
  const keys = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const root = pop.getRootNode() as Document | ShadowRoot;
    const i = rows.indexOf(root.activeElement as HTMLElement);
    const j = i < 0 ? (e.key === 'ArrowDown' ? 0 : rows.length - 1) : i + (e.key === 'ArrowDown' ? 1 : -1);
    rows[Math.max(0, Math.min(rows.length - 1, j))]?.focus();
  };
  document.addEventListener('keydown', keys, true);
  function close(instant = false) {
    if (!release()) return;
    document.removeEventListener('keydown', keys, true);
    if (instant || !anchor.isConnected) pop.remove();
    else vanish(pop);
  }
}
