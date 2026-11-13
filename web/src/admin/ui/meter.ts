// The portal's meter (page/access.ts): a share of a limit as a thin bar, the
// accent, warn from 90 %, bad at the limit.

import { h } from '../../portal/dom';

export function meter(p: number): HTMLElement {
  const i = h('i', { class: p >= 1 ? 'bad' : p >= 0.9 ? 'warn' : '' });
  i.style.width = `${Math.min(100, Math.max(2, p * 100)).toFixed(1)}%`;
  return h('span', { class: 'meter pc-meter' }, i);
}
