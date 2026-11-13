// − n + : a count with a floor and a ceiling (a person's device limit), the
// portal's knobs around the number. A press saves at once; the number morphs
// to its new value and back if the router refuses. At the floor the − knob
// stands disabled with the reason in its title. A read-only login sees the
// number.

import { h, ic } from '../../portal/dom';
import { morphText } from '../../portal/ui/morph';
import { fmt } from '../../shared/i18n';

export interface Stepper {
  value: number;
  /** Its name, for a screen reader ("Device limit"). */
  label: string;
  min: number;
  max: number;
  /** Why it goes no lower at the floor. */
  floorWhy?: string;
  /** Save the new value; resolves with whether it took. */
  change(n: number): Promise<boolean>;
}

export function stepper(o: Stepper, write = true): HTMLElement {
  if (!write) return h('b', { class: 'num st-ro' }, String(o.value));
  let n = o.value;
  const num = h('b', { class: 'num', 'aria-live': 'polite' }, String(n));
  const less = h(
    'button',
    { type: 'button', class: 'knob st-b', 'aria-label': fmt(_('Fewer: %s'), o.label) },
    ic('minus'),
  ) as HTMLButtonElement;
  const more = h(
    'button',
    { type: 'button', class: 'knob st-b', 'aria-label': fmt(_('More: %s'), o.label) },
    ic('plus'),
  ) as HTMLButtonElement;
  const sync = () => {
    less.disabled = n <= o.min;
    more.disabled = n >= o.max;
    less.title = n <= o.min && o.floorWhy ? o.floorWhy : '';
  };
  sync();
  const step = async (d: number) => {
    const was = n;
    n = Math.min(o.max, Math.max(o.min, n + d));
    if (n === was) return;
    sync();
    morphText(num, String(n));
    if (await o.change(n).catch(() => false)) return;
    n = was;
    sync();
    morphText(num, String(n));
  };
  less.addEventListener('click', () => void step(-1));
  more.addEventListener('click', () => void step(1));
  return h('span', { class: 'stepper', role: 'group', 'aria-label': o.label }, less, num, more);
}
