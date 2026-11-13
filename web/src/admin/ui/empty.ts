// The empty state of a list, a table or a panel (after the portal's first
// card): a grey glass, a title, one balanced line that names the reason, one
// button. Two kinds: nothing yet (the button makes the first one, accent) and
// nothing found (the button takes the filters off, soft).

import { h } from '../../portal/dom';
import { glass } from './glass';

export function emptyState(o: { icon: string; title: string; text?: string; action?: HTMLElement | null }): HTMLElement {
  return h(
    'div',
    { class: 'card kt-empty' },
    glass(o.icon, 'grey'),
    h('b', {}, o.title),
    o.text ? h('span', {}, o.text) : null,
    o.action ?? null,
  );
}
