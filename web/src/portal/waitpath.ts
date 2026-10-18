// The set-up sheets' "waiting for the first connection" card: the way from
// the device (its icon; the sheet's title names it) to the home server, a light
// running along its dots while the page waits; the dots fill green when it connects.
// It only draws and switches its states; main.ts (watchFirstConnection)
// decides when, and what leaves around it. A live region: the changes are read out.

import type { Kind } from '../shared/types';
import { h, ic } from './dom';
import { grow, replay } from './motion';

export interface Way {
  el: HTMLElement;
  /** The first connection arrived. */
  connected(): void;
  /** The page stopped asking (ten minutes): say so instead of waiting on forever. */
  gaveUp(): void;
}

export function waitPath(kind: Kind): Way {
  const title = h('span', { class: 'strong s' }, 'Waiting for the connection');
  // Nothing to add while it waits: the line comes with "You're all set" or the give-up.
  const sub = h('span', { class: 'faint s' });
  // The router end: the server's icon, as on the admin's map.
  const home = h('span', { class: 'way-end home' }, ic('server'));
  const el = h(
    'div',
    { class: 'way', role: 'status', 'aria-live': 'polite' },
    h(
      'div',
      { class: 'way-row' },
      h('span', { class: 'way-end' }, ic(kind)),
      h('span', { class: 'way-track' }, h('span', { class: 'way-glow' }, h('i')), h('span', { class: 'way-fill' })),
      home,
    ),
    h('div', { class: 'way-text' }, title, sub),
  );
  const say = (t: string, s: string) => {
    if (title.textContent !== t) {
      title.textContent = t;
      replay(title, 'swap');
    }
    if (sub.textContent === s) return;
    // The line under the title only appears now: it opens rather than pushing the card.
    const opens = !sub.textContent;
    sub.textContent = s;
    if (opens) grow(sub);
    else replay(sub, 'swap');
  };
  return {
    el,
    connected: () => {
      el.classList.add('done');
      say('Connected', 'You’re all set.');
    },
    gaveUp: () => {
      el.classList.add('stopped');
      say('No connection yet', 'Close this and open it again to keep checking.');
    },
  };
}
