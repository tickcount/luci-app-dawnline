// Traffic by day, both ways: what a device received rises above a hairline and
// what it sent hangs below, on one scale, so a day of uploads shows as itself
// rather than as a cap on the downloads. The hairline sits where the two
// directions' peaks share the height. Beside the bars, "↓ 3.9 GB  ↑ 819 MB".
// A day is the router's [rx, tx]: rx came from the device (its upload), tx went
// to it (its download).

import type { Pair } from '../../shared/types';
import { bytes } from '../../shared/format';
import { h, ic } from '../dom';
import { setText } from './morph';

/** Between the halves, the hairline in the middle of it. */
const GAP = 3;

/** Days added up: what came and what went over all of them. */
export const sumDays = (days: Pair[]): Pair => days.reduce<Pair>((a, [rx, tx]) => [a[0] + rx, a[1] + tx], [0, 0]);

/**
 * Where the hairline sits and how many px a byte is: each direction's peak gets
 * its share of the height, the downloads keeping 55–80% of it, so a quiet
 * upload still shows and a busy one does not flatten the rest.
 */
export function mirror(days: Pair[], height: number): { top: number; bottom: number; scale: number } {
  const down = Math.max(1, ...days.map((d) => d[1]));
  const up = Math.max(1, ...days.map((d) => d[0]));
  const top = Math.round((height - GAP) * Math.min(0.8, Math.max(0.55, down / (down + up))));
  const bottom = height - GAP - top;
  return { top, bottom, scale: Math.min(top / down, bottom / up) };
}

export interface Bars {
  el: HTMLElement;
  /** A column a day, for what the pointer reads off them. */
  cols: HTMLElement[];
}

/** A column a day, today last (in accent); `future`: the days still to come, flat on the hairline. */
export function bars(days: Pair[], cls: string, height: number, future = 0): Bars {
  const { top, bottom, scale } = mirror(days, height);
  const half = (side: string, px: number, v: number, what: string) => {
    const bar = h('i', { class: what });
    bar.style.height = `${Math.max(2, Math.round(v * scale))}px`;
    const el = h('div', { class: `half ${side}` }, bar);
    el.style.height = `${px}px`;
    return el;
  };
  const el = h('div', { class: `bars ${cls}`, 'aria-hidden': 'true' });
  el.style.height = `${height}px`;
  const cols = days.map(([rx, tx], i) =>
    el.appendChild(
      h('div', { class: `col${i === days.length - 1 ? ' today' : ''}` }, half('top', top, tx, 'dn'), half('bottom', bottom, rx, 'up')),
    ),
  );
  for (let i = 0; i < future; i++) el.appendChild(h('div', { class: 'col future' }, h('i'))).style.paddingTop = `${top - 2}px`;
  el.appendChild(h('span', { class: 'axis' })).style.top = `${top + 1}px`;
  return { el, cols };
}

export interface UpDown {
  el: HTMLElement;
  /** Show these, at once (a repaint morphs them by their keys). */
  set(day: Pair): void;
}

/** "↓ 3.9 GB  ↑ 819 MB"; `key` names the two numbers for the repaint's morph. */
export function upDown(key: string): UpDown {
  const side = (cls: string, name: string, num: HTMLElement) =>
    h('span', { class: cls, title: name }, ic('arrow'), h('span', { class: 'offscreen' }, name), num);
  const dn = h('span', { class: 'num', 'data-t': `${key}:dn` });
  const up = h('span', { class: 'num', 'data-t': `${key}:up` });
  return {
    el: h('span', { class: 'ud' }, side('ud-dn', _('Downloaded'), dn), side('ud-up', _('Uploaded'), up)),
    set([rx, tx]) {
      setText(dn, bytes(tx));
      setText(up, bytes(rx));
    },
  };
}
