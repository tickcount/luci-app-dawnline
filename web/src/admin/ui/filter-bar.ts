// The filter bar of a list: its search (the portal's field with `/`: the key
// reaches it, Escape empties it), what the page puts beside it (a view switch,
// «Select»), and under them the filters as chips with the count of what is
// shown. A chip is offered (knob, a plus and its name, how many it would
// leave) or active (accent-soft, the accent's words; × takes it off); one that
// picks from several opens a menu. «Reset» stands at the chips' end while
// anything narrows the list. On a phone the chips are one row that scrolls
// sideways. The page keeps every filter in its address.

import { h } from '../../portal/dom';
import { fmt, num } from '../../shared/i18n';
import { ic } from './icons';
import { onNavigate } from './nav';
import { morphText, textOf } from '../../portal/ui/morph';
import { refill } from './reshape';

export interface ChipOpts {
  label: string;
  /** How many the filter leaves (beside its name). */
  n?: number;
  on: boolean;
  /** It picks from several: a press opens the page's menu from the chip ('list': a list of choices, ui/list-drop.ts). */
  menu?: boolean | 'list';
  press: (from: HTMLElement) => void;
  /** × on an active chip (default: `press`). */
  off?: () => void;
  cls?: string;
}

export function filterChip(o: ChipOpts): HTMLElement {
  const body = h(
    'button',
    {
      type: 'button',
      class: 'kt-fb',
      'aria-pressed': o.menu ? null : String(o.on),
      'aria-haspopup': o.menu === 'list' ? 'listbox' : o.menu ? 'menu' : null,
    },
    o.on ? null : ic(o.menu ? 'chevron' : 'plus', `i${o.menu ? ' kt-drop' : ''}`),
    h('span', {}, o.label),
    o.n != null ? h('span', { class: 'kt-fn num' }, num(o.n)) : null,
  );
  body.addEventListener('click', () => o.press(body));
  const x = o.on
    ? h(
        'button',
        { type: 'button', class: 'kt-fx', 'aria-label': fmt(_('Remove the filter: %s'), o.label), title: _('Remove the filter') },
        ic('x'),
      )
    : null;
  x?.addEventListener('click', () => (o.off ?? (() => o.press(body)))());
  return h('span', { class: `kt-fchip${o.on ? ' on' : ''}${o.cls ? ` ${o.cls}` : ''}` }, body, x);
}

export interface Search {
  el: HTMLElement;
  value(): string;
  clear(): void;
}

/**
 * The search field; `typed` on every change. `/` anywhere on the page reaches it while `page` is in the document.
 * `value`: what it holds from the start (a search the address came with).
 */
export function searchField(o: {
  placeholder: string;
  label: string;
  page: HTMLElement;
  value?: string;
  typed: (v: string) => void;
}): Search {
  const input = h('input', {
    type: 'search',
    value: o.value || null,
    placeholder: o.placeholder,
    'aria-label': o.label,
    autocomplete: 'off',
    spellcheck: 'false',
    autocapitalize: 'none',
    enterkeyhint: 'search',
  }) as HTMLInputElement;
  const el = h('label', { class: `field srch${o.value ? ' typed' : ''}` }, ic('search'), input, h('kbd', { class: 'k' }, '/'));
  const typed = () => {
    el.classList.toggle('typed', !!input.value);
    o.typed(input.value);
  };
  input.addEventListener('input', typed);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !input.value) return;
    // Escape empties the search first; it is not the page's (a panel stays open)
    e.preventDefault();
    e.stopPropagation();
    input.value = '';
    typed();
  });
  const slash = (e: KeyboardEvent) => {
    const t = e.composedPath()[0] as HTMLElement | undefined;
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || !o.page.isConnected) return;
    if (t && (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable)) return;
    e.preventDefault();
    input.focus();
  };
  document.addEventListener('keydown', slash);
  const off = onNavigate(() => {
    document.removeEventListener('keydown', slash);
    off();
  });
  return {
    el,
    value: () => input.value,
    clear() {
      input.value = '';
      el.classList.remove('typed');
    },
  };
}

export interface FilterBar {
  el: HTMLElement;
  /** The chips again; `reset`: something narrows the list (its way off stands at their end). */
  chips(kids: (HTMLElement | null)[], reset?: (() => void) | null): void;
  /** «12 of 24», or nothing when the list is whole. */
  count(shown: number, of: number, whole: boolean): void;
}

/** The bar: `top` is its first row (the search and the page's own controls), `lead` stands before the chips. */
export function filterBar(o: { top: (HTMLElement | null)[]; lead?: HTMLElement }): FilterBar {
  const chips = h('div', { class: 'kt-chips' });
  const count = h('span', { class: 'kt-count num', 'aria-live': 'polite' });
  const el = h(
    'div',
    { class: 'kt-bar' },
    h('div', { class: 'bar kt-bar1' }, ...o.top),
    h('div', { class: 'kt-bar2' }, o.lead ?? null, chips, count),
  );
  return {
    el,
    chips(kids, reset) {
      const all = kids.filter((k): k is HTMLElement => !!k);
      if (reset) {
        const b = h('button', { type: 'button', class: 'kt-reset' }, _('Reset'));
        b.addEventListener('click', reset);
        all.push(b);
      }
      // the chips and their counts change in place, Reset blurs in and fades out (ui/reshape.ts)
      refill(chips, all);
    },
    count(shown, of, whole) {
      const t = whole ? '' : fmt(_('%s of %s'), num(shown), num(of));
      if (textOf(count) !== t) morphText(count, t);
    },
  };
}
