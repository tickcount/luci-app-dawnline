// A section of a page with a rail (ui/rail.ts): its head (a glass in the
// state's tone, the title, a quiet aside, one action at the end) over its
// parts, all of them open. The frame of Settings instead of an accordion
// row: nothing here folds. The body's parts are raised cards (radius 24,
// padding 8: inner blocks 16), a caption over a part, a quiet line under it.

import { h, type Kid } from '../../portal/dom';
import type { Tone } from '../../portal/ui/glass';
import { glass } from './glass';

export interface SectionOpts {
  /** Its name in the address and on the rail (`data-id`). */
  id: string;
  icon: string;
  title: string;
  tone?: Tone;
  /** After the title, quiet: a state in a few words, a ⟳ mark. */
  aside?: Kid;
  /** At the head's end: one action. */
  end?: Kid;
  danger?: boolean;
}

export function section(o: SectionOpts, ...body: Kid[]): HTMLElement {
  return h(
    'section',
    { class: `kt-sx${o.danger ? ' danger' : ''}`, 'data-id': o.id, 'aria-labelledby': `sxh-${o.id}` },
    h(
      'header',
      { class: 'kt-sx-h' },
      h('span', { class: 'kt-sx-ic' }, glass(o.icon, o.tone ?? 'grey')),
      h('h2', { id: `sxh-${o.id}`, tabindex: '-1' }, o.title),
      o.aside ? h('span', { class: 'kt-sx-aside' }, o.aside) : null,
      o.end ? h('span', { class: 'kt-sx-end' }, o.end) : null,
    ),
    h('div', { class: 'kt-sx-b' }, ...body),
  );
}

/** A raised card of a section: its blocks stacked 8 apart. */
export const card = (...kids: Kid[]): HTMLElement => h('div', { class: 'card kt-sx-card' }, ...kids);

/** A quiet caption over a part of a card, with what belongs at its end (a ⟳ mark, a button). */
export const cap = (text: Kid, ...end: Kid[]): HTMLElement =>
  h(
    'div',
    { class: 'kt-sx-cap' },
    h('span', { class: 'kt-sx-cap-t' }, text),
    end.some(Boolean) ? h('span', { class: 'kt-sx-cap-e' }, ...end) : null,
  );

/** A line under a block: Meta 13/18, quiet (or in a tone: ok, warn, bad). */
export const note = (text: Kid, tone = ''): HTMLElement => h('p', { class: `kt-sx-note${tone ? ` ${tone}-t` : ''}` }, text);
