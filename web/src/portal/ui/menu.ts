// The ⋯ menu: an iOS 26-style menu under its button (over it where the screen
// ends): Liquid Glass (the page blurred behind), a soft even edge.
// Laid out as iOS 26's: rows (an icon, the label and a line under it where the
// item has one: the address it copies), a thin line between groups; Reconnect
// orange, Remove red. The dropdowns' highlight glides from row to row. It springs out from the
// button's side and drops back towards it. Shut by a
// press outside, Escape, its button again or a choice. One at a time.

import { h, ic } from '../dom';
import { appear, closeDrop, EDGE, GAP, opened, vanish } from './drop';
import { glide } from './glide';

export interface MenuItem {
  label: string;
  /** Its line icon. */
  icon: string;
  /** Under the label: what it acts on (the address it copies). */
  sub?: string;
  tone?: 'warn' | 'bad';
  run: () => unknown;
}

/** `all`: null between groups (kept only between items); `title`: what it acts on (the device), for a screen reader. */
export function openMenu(anchor: HTMLElement, all: (MenuItem | null)[], title: string) {
  // Its button again: it shuts.
  if (anchor.getAttribute('aria-expanded') === 'true') return closeDrop();
  const groups: MenuItem[][] = [[]];
  for (const it of all) {
    if (it) groups[groups.length - 1].push(it);
    else if (groups[groups.length - 1].length) groups.push([]);
  }
  if (!groups[groups.length - 1].length) groups.pop();

  const rows: HTMLElement[] = [];
  const item = (it: MenuItem, cls: string, ...kids: (Node | null)[]) => {
    const b = h(
      'button',
      {
        type: 'button',
        role: 'menuitem',
        class: `${cls}${it.tone ? ` ${it.tone}` : ''}`,
        onclick: () => {
          close();
          it.run();
        },
      },
      ...kids,
    );
    rows.push(b);
    return b;
  };
  const sections: HTMLElement[] = [
    ...groups.map((g) =>
      h(
        'div',
        { class: 'pop-grp' },
        ...g.map((it) =>
          item(
            it,
            'mi',
            ic(it.icon),
            h('span', { class: 'mi-b' }, h('span', { class: 'mi-l' }, it.label), it.sub ? h('span', { class: 'mi-s' }, it.sub) : null),
          ),
        ),
      ),
    ),
  ];
  // A thin line between sections (iOS's, inset; the rows themselves sit in a 16 px inset).
  const body = h(
    'div',
    { class: 'pop-body' },
    ...sections.flatMap((sec, i) => (i ? [h('div', { class: 'pop-sep', 'aria-hidden': 'true' }, h('span')), sec] : [sec])),
  );
  const pop = h('div', { class: 'pop drop', role: 'menu', 'aria-label': title }, body);
  document.body.append(pop);

  // Under the button where it fits, else over it; centred on it, inside the screen's edge, growing from its side.
  const k = anchor.getBoundingClientRect();
  const w = Math.min(pop.offsetWidth, innerWidth - EDGE * 2);
  pop.style.width = `${w}px`;
  const ht = pop.offsetHeight;
  const mid = k.left + k.width / 2;
  const left = Math.max(EDGE, Math.min(mid - w / 2, innerWidth - EDGE - w));
  const below = k.bottom + GAP + ht <= innerHeight - EDGE || k.top - GAP - ht < EDGE;
  const top = below ? k.bottom + GAP : k.top - GAP - ht;
  Object.assign(pop.style, {
    left: `${left + scrollX}px`,
    top: `${top + scrollY}px`,
    transformOrigin: `${mid - left}px ${below ? 0 : ht}px`,
  });

  appear(pop);
  const release = opened(pop, anchor, close);

  // The dropdowns' one highlight for the rows (ui/glide.ts).
  glide(body, rows);

  // Arrows move through the rows (the rest of the keys and presses are the dropdown's: ui/drop.ts).
  const keys = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = rows.indexOf(document.activeElement as HTMLElement);
    const j = i < 0 ? (e.key === 'ArrowDown' ? 0 : rows.length - 1) : i + (e.key === 'ArrowDown' ? 1 : -1);
    rows[Math.max(0, Math.min(rows.length - 1, j))]?.focus({ preventScroll: true });
  };
  document.addEventListener('keydown', keys, true);

  function close(instant = false) {
    if (!release()) return;
    document.removeEventListener('keydown', keys, true);
    if (instant || !anchor.isConnected) pop.remove();
    else vanish(pop);
  }
}
