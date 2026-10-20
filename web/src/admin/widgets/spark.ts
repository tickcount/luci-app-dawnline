// Tiny daily sparkline (oldest first, the last bar is today) with per-day tooltips.

import { E } from '../e';
import { addDays, bytes, isoDay, parseDay } from '../../shared/format';
import { attachTip } from '../ui/tooltip';
import { locale } from '../../shared/i18n';

/** `today` is the router's day (YYYY-MM-DD), so the labels follow its calendar. */
export function spark(values: number[], width = 120, height = 26, today = isoDay(new Date())): HTMLElement {
  const max = Math.max(1, ...values);
  const el = E('div', { class: 'dl-spark' });
  el.style.width = `${width}px`;
  el.style.height = `${height}px`;
  values.forEach((v, i) => {
    const b = E('i');
    b.style.height = `${Math.max(6, (v / max) * 100)}%`;
    if (!v) b.classList.add('zero');
    // The day's column carries the tooltip: it answers above a short bar and between two bars.
    const col = E('span', {}, [b]);
    const back = values.length - 1 - i;
    attachTip(col, () => [
      E(
        'div',
        { class: 'dl-tip-title' },
        back === 0
          ? _('Today')
          : back === 1
            ? _('Yesterday')
            : parseDay(addDays(today, -back)).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' }),
      ),
      E('div', { class: 'dl-muted' }, bytes(v)),
    ]);
    el.appendChild(col);
  });
  return el;
}
