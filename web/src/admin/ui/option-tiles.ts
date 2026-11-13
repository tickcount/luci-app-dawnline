// Option tiles (ui/option-tiles.ts): a choice of two or three whose options are drawn, not described. Each tile is a picture of
// what the option does (a way for a route, meters for a level), its name, at most one sentence, and facts as
// pills. Which one is in use is said by the tile itself, as the portal's reach tiles say «on»: a round mark in its
// corner, its picture in colour, its fill a step up; the others are grey and a step down. No ring (a ring on a box
// of text reads as a focused field) and no word «now» beside the name: the mark is that word. While another choice
// waits to be applied, the waiting one wears the mark in warn and the one still running keeps a dot in an accent
// ring; the page's line under the tiles says the rest («Not applied yet. Now: …»).

import { h, type Kid } from '../../portal/dom';
import { ic } from './icons';

export type OptionState = 'on' | 'next' | 'was' | '';

export interface Option<T extends string> {
  id: T;
  title: string;
  /** In use, picked and waiting, in use while another waits, or neither. */
  state: OptionState;
  /** The picture over the name (a way), beside the mark. */
  picture?: HTMLElement | null;
  /** One sentence at most. */
  text?: string;
  /** What stands under the name: meters, facts, chips. */
  body?: Kid[];
  /** In use but not working. */
  warn?: boolean;
  /** The router cannot run it. */
  off?: boolean;
}

export function optionTiles<T extends string>(o: {
  label: string;
  options: Option<T>[];
  write: boolean;
  pick(id: T): void;
  cls?: string;
}): HTMLElement {
  const tiles = o.options.map((c) => {
    const picked = c.state === 'on' || c.state === 'next';
    const live = o.write && !c.off;
    const mark = h(
      'span',
      { class: 'kt-op-m', 'aria-hidden': 'true' },
      c.state === 'on' && c.warn ? ic('alert') : picked ? ic('check') : c.state === 'was' ? h('i', {}) : null,
    );
    const b = h(
      live ? 'button' : 'div',
      {
        type: live ? 'button' : null,
        role: 'radio',
        'aria-checked': String(picked),
        'aria-disabled': c.off ? 'true' : null,
        tabindex: live ? (picked ? '0' : '-1') : null,
        class: `kt-op-t${c.state ? ` ${c.state}` : ''}${c.warn ? ' warn' : ''}${c.off ? ' off' : ''}${c.picture ? ' pic' : ''}`,
      },
      c.picture ?? null,
      mark,
      h('b', { class: 'kt-op-n' }, c.title),
      c.text ? h('span', { class: 'kt-op-x' }, c.text) : null,
      ...(c.body ?? []),
    );
    // the one in use: a press takes a waiting choice back (the page's own rule), else there is nothing to pick
    if (live) b.addEventListener('click', () => c.state !== 'on' && o.pick(c.id));
    return b;
  });
  const el = h(
    'div',
    { class: `kt-op n${o.options.length}${o.cls ? ` ${o.cls}` : ''}`, role: 'radiogroup', 'aria-label': o.label },
    ...tiles,
  );
  el.addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k)) return;
    e.preventDefault();
    const root = el.getRootNode() as Document | ShadowRoot;
    const i = tiles.indexOf(root.activeElement as HTMLElement);
    tiles[(i + (k === 'ArrowLeft' || k === 'ArrowUp' ? -1 : 1) + tiles.length) % tiles.length]?.focus();
  });
  return el;
}

/** A fact as a pill: a few words, an icon when it is a kind of fact (speed). `warn`: it costs something. */
export const fact = (text: string, icon = '', tone: 'warn' | '' = ''): HTMLElement =>
  h('span', { class: `kt-fact${tone ? ` ${tone}` : ''}` }, icon ? ic(icon) : null, text);

export const facts = (...kids: (HTMLElement | null)[]): HTMLElement => h('span', { class: 'kt-facts' }, ...kids);

/** A caption over a group of facts («Apps»). */
export const factCap = (text: string): HTMLElement => h('span', { class: 'kt-op-cap' }, text);

export interface Stop {
  icon: string;
  label: string;
  /** The stop this option adds to the way. */
  extra?: boolean;
}

/** A way as the portal draws one: stops in their boxes, the dotted line between them, a word under each. */
export function way(stops: Stop[]): HTMLElement {
  const kids: HTMLElement[] = [];
  stops.forEach((s, i) => {
    if (i) kids.push(h('i', { class: 'kt-way-l' }));
    kids.push(
      h(
        'span',
        { class: `kt-way-s${s.extra ? ' extra' : ''}` },
        h('span', { class: 'kt-way-e' }, ic(s.icon)),
        h('span', { class: 'kt-way-w' }, s.label),
      ),
    );
  });
  return h('span', { class: `kt-way n${stops.length}`, 'aria-hidden': 'true' }, ...kids);
}

/** A level of three as pips, with what it means in words: «▮▮▯ Does not look like a VPN». */
export function meter(icon: string, level: 0 | 1 | 2 | 3, text: string, label: string): HTMLElement {
  return h(
    'span',
    { class: 'kt-lvl', role: 'img', 'aria-label': `${label}: ${text}` },
    ic(icon),
    h('span', { class: 'kt-lvl-p' }, ...[1, 2, 3].map((i) => h('i', { class: i <= level ? 'f' : '' }))),
    h('span', { class: 'kt-lvl-t' }, text),
  );
}
