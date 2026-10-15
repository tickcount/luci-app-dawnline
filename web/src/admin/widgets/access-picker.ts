// Access choice cards (Add person): internet, home or both.

import type { Person } from '../../shared/types';
import { E } from '../e';
import { icon } from '../../shared/icons';
import { ACCESS_LABEL } from '../../shared/format';

/** Returns the element and a getter. */
export function accessPicker(initial: Person['access'], onChange?: (v: Person['access']) => void) {
  let value = initial;
  const opts: { v: Person['access']; ic: string; text: string }[] = [
    { v: 'internet', ic: 'globe', text: 'Browse the internet through your router. No access to devices at home.' },
    { v: 'lan', ic: 'home', text: 'Reach devices at home (NAS, printer, cameras). Internet stays on their own connection.' },
    { v: 'both', ic: 'shield', text: 'Home devices and the internet, all through your router.' },
  ];
  const el = E(
    'div',
    { class: 'dl-choices' },
    opts.map((o) =>
      E(
        'button',
        {
          type: 'button',
          class: `dl-choice${o.v === value ? ' selected' : ''}`,
          'data-v': o.v,
          click: () => {
            value = o.v;
            el.querySelectorAll('.dl-choice').forEach((c) => c.classList.toggle('selected', (c as HTMLElement).dataset.v === o.v));
            onChange?.(o.v);
          },
        },
        [E('span', { class: 'dl-choice-title' }, [icon(o.ic), ACCESS_LABEL[o.v]]), E('span', { class: 'dl-choice-text' }, o.text)],
      ),
    ),
  );
  return { el, get: () => value };
}
