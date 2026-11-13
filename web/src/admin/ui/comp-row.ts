// A row of a list of things with a state, in the form of the Updates block's
// component row (a glass, a name, a state line, its actions in sight): home
// services, circles, the portal's addresses and certificate, backups. The
// rows stand on the field and touch (the admin's .checks / .chk).

import { h, type Kid } from '../../portal/dom';
import type { Tone } from '../../portal/ui/glass';
import { glass } from './glass';

export interface CompRow {
  icon?: string;
  tone?: Tone;
  /** In the glass's place (a circle's colour dot). */
  lead?: Kid;
  title: Kid;
  line?: Kid;
  /** The line is mono (a file, an address). */
  mono?: boolean;
  lineTone?: 'warn' | 'bad' | '';
  acts?: Kid[];
  cls?: string;
}

export const compRow = (o: CompRow): HTMLElement =>
  h(
    'div',
    { class: `chk kt-cr${o.cls ? ` ${o.cls}` : ''}` },
    o.lead ?? glass(o.icon ?? 'other', o.tone ?? 'grey'),
    h(
      'span',
      { class: 'chk-t' },
      h('b', {}, o.title),
      o.line ? h('span', { class: `${o.mono ? 'mono-s' : ''}${o.lineTone ? ` ${o.lineTone}-t` : ''}` }, o.line) : null,
    ),
    ...(o.acts ?? []),
  );

export const compList = (...rows: Kid[]): HTMLElement => h('div', { class: 'checks' }, ...rows);
