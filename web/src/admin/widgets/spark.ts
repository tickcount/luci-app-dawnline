// A device's last 7 days as small stacked bars (oldest first, the last is
// today; download at the base, upload on top), read day by day with the
// tooltip above the picked one.

import type { Pair } from '../../shared/types';
import { addDays, bytes, isoDay } from '../../shared/format';
import { scrub } from '../../shared/scrub';
import { hideGlide, showGlide } from '../ui/glide';
import { DayStack } from './days';
import { dayName, deviceDayTip } from './readouts';

/** `days` are [rx, tx]; `today` is the router's day (YYYY-MM-DD), so the names follow its calendar. */
export function spark(days: Pair[], width = 120, height = 22, today = isoDay(new Date())): HTMLElement {
  const chart = new DayStack(days, height, 10);
  chart.el.style.width = `${width}px`;
  const dated = days.map(([rx, tx], i) => ({ day: addDays(today, i - (days.length - 1)), rx, tx }));
  scrub(chart.el, chart, {
    count: () => days.length,
    pick: (i) => {
      if (i < 0) return hideGlide(chart.el);
      const [x, y] = chart.anchor(i);
      showGlide(chart.el, x, y, deviceDayTip(dated, i, today));
    },
    label: _('Last 7 days'),
    say: (i) => `${dayName(dated[i].day, today)}: ${bytes(dated[i].rx + dated[i].tx)}`,
  });
  return chart.el;
}
