// A measure with its limit: how much of how much, the limit changed where it
// stands (the end of the value line), the bar under it (accent; warn from
// 90 %, bad from 100 %), a line under the bar. Events and days of the log,
// days of the traffic history, addresses of a tunnel network. And a value
// that takes one of a few (the router's own steps): the value with a pencil,
// its choices in a list under it (ui/list-drop.ts), the current one checked.

import { h, type Kid } from '../../portal/dom';
import { fmt } from '../../shared/i18n';
import { ic } from './icons';
import { openList } from './list-drop';

export interface Measure {
  label: string;
  /** Used, as shown («1 284»). */
  used: string;
  /** The limit: a word, or its control (valuePick, an inline value). */
  of: Kid;
  /** Between the two: «of» unless said («limit»). */
  ofWord?: string;
  /** After the limit: «events». */
  unit?: string;
  /** 0..1 of the limit used; null: no limit, no bar. */
  part: number | null;
  /** For a screen reader: «1 284 of 5 000 events». */
  says: string;
  sub?: Kid;
  /** At the block's end: its action. */
  act?: Kid;
  /** After the label: what it is measured in, a ⟳ mark. */
  mark?: Kid;
}

export function measure(o: Measure): HTMLElement {
  const tone = o.part == null ? '' : o.part >= 1 ? ' bad' : o.part >= 0.9 ? ' warn' : '';
  const fill = h('i', {});
  if (o.part != null) fill.style.width = `${Math.max(0, Math.min(1, o.part)) * 100}%`;
  const bar =
    o.part == null
      ? null
      : h(
          'div',
          {
            class: `kt-lm-bar${tone}`,
            role: 'meter',
            'aria-valuemin': 0,
            'aria-valuemax': 100,
            'aria-valuenow': Math.round(Math.min(1, o.part) * 100),
            'aria-valuetext': o.says,
            'aria-label': o.label,
          },
          fill,
        );
  return h(
    'div',
    { class: 'kt-lm' },
    h(
      'div',
      { class: 'kt-lm-top' },
      h('span', { class: 'kt-lm-l' }, o.label),
      o.mark ?? null,
      o.act ? h('span', { class: 'kt-lm-act' }, o.act) : null,
    ),
    h(
      'div',
      { class: 'kt-lm-val' },
      h('b', { class: 'num' }, o.used),
      h('span', { class: 'kt-lm-of' }, o.ofWord ?? _('of', 'measure')),
      o.of,
      o.unit ? h('span', { class: 'kt-lm-of' }, o.unit) : null,
    ),
    bar,
    o.sub ? h('p', { class: 'kt-lm-sub' }, o.sub) : null,
  );
}

export interface Pick<T extends string> {
  /** What it sets, for a screen reader and the list's name. */
  label: string;
  /** The value as shown. */
  value: string;
  options: { id: T; label: string; sub?: string }[];
  on: T;
  pick(id: T): void;
  write: boolean;
  /** As a quiet pill (a setting in a line of words) instead of a value with a pencil. */
  pill?: boolean;
}

export function valuePick<T extends string>(o: Pick<T>): HTMLElement {
  if (!o.write) return h('b', { class: 'num kt-vpk-still' }, o.value);
  const b = h(
    'button',
    {
      type: 'button',
      class: o.pill ? 'kt-vpk pill' : 'kt-vpk',
      'aria-haspopup': 'listbox',
      'aria-expanded': 'false',
      'aria-label': fmt('%s: %s. %s', o.label, o.value, _('Change')),
      title: _('Change'),
    },
    h('b', { class: 'num' }, o.value),
    ic(o.pill ? 'chevron' : 'edit', o.pill ? 'i kt-vpk-chev' : 'i kt-vpk-ic'),
  );
  b.addEventListener('click', () =>
    openList(
      b,
      o.options.map((x) => ({ id: x.id, label: x.label, sub: x.sub, on: x.id === o.on })),
      o.label,
      (id) => id !== o.on && o.pick(id as T),
    ),
  );
  return b;
}
