// A choice of a few (the concept's §3a) inside an open accordion row: a row
// "name · value ⌄"; pressed, its options unfold under it as chips (the picked
// one ringed) and the value steps aside; a chip picks. Height and opacity
// unfold on SMOOTH from where they stand, so a second press half-way turns
// back from there. `multi` lets several be on (home networks, services).
// Each row says itself how a pick saves: it resolves with whether it took,
// and the chips follow only then (a question in a sheet may say no). A
// read-only login gets the value as a still row (ui/edit-rows.ts stillRow).

import { h, ic } from '../../portal/dom';
import { unfold } from './reshape';
import { morphText } from '../../portal/ui/morph';
import { reMark, stillRow } from './edit-rows';

interface Choice<T extends string> {
  id: T;
  label: string;
  /** Its title: what it means. */
  title?: string;
}

export interface ChoiceRow<T extends string> {
  title: string;
  /** As the row shows it shut. */
  value: string;
  options: Choice<T>[];
  /** The picked one (or, with `multi`, the ones that are on). */
  on: T[];
  multi?: boolean;
  /** ⟳N: devices that fetch their configuration again after a pick. */
  re?: number;
  /** A line under the chips while open. */
  note?: string;
  open?: boolean;
  /** Save a pick (the ids on after it); resolves with what the row shows now, or null when it did not take. */
  pick(on: T[]): Promise<string | null>;
}

/** Unfold or fold `crow`'s chips from where they stand. */
function fold(crow: HTMLElement, open: boolean) {
  const box = crow.querySelector<HTMLElement>(':scope > .crow-body');
  if (!box) return;
  crow.classList.toggle('open', open);
  crow.querySelector('.crow-h')?.setAttribute('aria-expanded', String(open));
  unfold(box, open);
}

export function choiceRow<T extends string>(o: ChoiceRow<T>, write = true): HTMLElement {
  if (!write) return stillRow(o.title, o.value);
  const b = h('b', { class: o.value.length > 16 ? 'long' : '' }, o.value);
  const head = h(
    'button',
    { type: 'button', class: 'crow-h', 'aria-expanded': String(!!o.open) },
    h('span', { class: 'crow-t' }, o.title),
    reMark(o.re ?? 0),
    b,
    ic('chevron', 'i crow-chev'),
  );
  let on = new Set(o.on);
  let busy = false;
  const chips = o.options.map((c) => {
    const chip = h(
      'button',
      { type: 'button', class: `chipb${on.has(c.id) ? ' on' : ''}`, 'aria-pressed': String(on.has(c.id)), title: c.title ?? null },
      c.label,
    );
    chip.addEventListener('click', async () => {
      if (busy) return;
      const next = new Set(on);
      if (o.multi) {
        if (!next.delete(c.id)) next.add(c.id);
      } else {
        if (next.has(c.id)) return;
        next.clear();
        next.add(c.id);
      }
      busy = true;
      chip.classList.add('busy');
      const shown = await o.pick([...next]).catch(() => null);
      busy = false;
      chip.classList.remove('busy');
      if (shown == null) return;
      on = next;
      chips.forEach((x, i) => {
        const yes = on.has(o.options[i].id);
        x.classList.toggle('on', yes);
        x.setAttribute('aria-pressed', String(yes));
      });
      if (shown !== b.textContent) morphText(b, shown);
    });
    return chip;
  });
  const body = h(
    'div',
    { class: 'crow-body', hidden: !o.open },
    h('div', { class: 'chips' }, ...chips),
    o.note ? h('p', { class: 'crow-note' }, o.note) : null,
  );
  const row = h('div', { class: `crow${o.open ? ' open' : ''}` }, head, body);
  head.addEventListener('click', () => fold(row, !row.classList.contains('open')));
  return row;
}
