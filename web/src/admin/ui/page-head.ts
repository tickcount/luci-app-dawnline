// The head of a page: the object's glass, its name, quiet facts after dots,
// its actions on the right (DESIGN.md page head, admin: names the object, not
// the place); a round knob; a section's and a block's head.

import { h, type Kid } from '../../portal/dom';
import { ic } from './icons';
import { refill } from './reshape';

/** One fact after its dot; `cls`: its tone (warn-t), `title`: more about it. */
export const fact = (content: Kid, o: { cls?: string; title?: string } = {}): HTMLElement =>
  h(
    'span',
    { class: `ph-f${o.cls ? ` ${o.cls}` : ''}`, title: o.title ?? null },
    h('span', { class: 'ph-sep', 'aria-hidden': 'true' }, '·'),
    h('span', { class: 'ph-fact' }, content),
  );

/** The head; its facts line (.ph-sub) may be filled again later (setFacts). */
export function pageHead(o: { icon: Element; title: string; facts?: Kid[]; acts?: Kid[] }): HTMLElement {
  return h(
    'header',
    { class: 'ph' },
    h('div', { class: 'ph-ic' }, o.icon),
    h(
      'div',
      { class: 'ph-t' },
      h('h1', { class: 'ph-title' }, o.title),
      h('div', { class: 'ph-sub' }, ...(o.facts ?? []).filter((f) => f != null && f !== false && f !== '').map((f) => fact(f))),
    ),
    o.acts?.length ? h('div', { class: 'ph-acts' }, ...o.acts) : null,
  );
}

/** Put new facts in a head's facts line: they change in place (ui/reshape.ts). */
export function setFacts(head: HTMLElement, facts: (HTMLElement | null)[]) {
  const sub = head.querySelector<HTMLElement>('.ph-sub');
  if (sub)
    refill(
      sub,
      facts.filter((f): f is HTMLElement => !!f),
    );
}

/** A round icon button; `label` is its name and tooltip. */
export const knob = (icon: string, label: string): HTMLButtonElement =>
  h('button', { type: 'button', class: 'knob', 'aria-label': label, title: label }, ic(icon)) as HTMLButtonElement;

/** A section head (the portal's .sec-head): its title, a faint aside and a control at its end. */
export const secHead = (title: string, aside?: string, end?: Kid): HTMLElement =>
  h(
    'div',
    { class: 'sec-head' },
    h('h2', {}, title),
    aside ? h('span', { class: 'aside num' }, aside) : null,
    end ? h('span', { class: 'sh-end' }, end) : null,
  );

/** A block's head inside a panel: a section head whose aside may hold a mark or a count, a control at its end. */
export const blockHead = (title: string, aside?: Kid, end?: Kid): HTMLElement =>
  h(
    'div',
    { class: 'sec-head kt-bh' },
    h('h2', {}, title),
    aside ? h('span', { class: 'aside num' }, aside) : null,
    end ? h('span', { class: 'sh-end' }, end) : null,
  );
