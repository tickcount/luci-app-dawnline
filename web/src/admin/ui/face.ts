// A person as a face: their initials in a ring, as the map's markers and the
// «Online» tile draw one (.pav); the ring takes a tone (ok while online, warn,
// bad). A note in brackets after the name is not part of it.

import { h } from '../../portal/dom';
import { initials } from '../../shared/format';

export const face = (name: string, tone: '' | 'ok' | 'warn' | 'bad' = ''): HTMLElement =>
  h('span', { class: `pav kt-face${tone ? ` ${tone}` : ''}`, 'aria-hidden': 'true' }, initials(name.replace(/\s*\(.*?\)\s*/g, ' ').trim()));
