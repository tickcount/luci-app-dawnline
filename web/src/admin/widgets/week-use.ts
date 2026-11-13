// The last 7 days of traffic, read a day at a time: «Last 7 days» over what was downloaded and uploaded in them,
// beside the days as the portal's bars (received above the hairline, sent below). A day under the pointer (or
// picked by a tap, or with ← → on the bars) puts its own name and numbers in the sum's place: «Today», «3 days
// ago». One part for every place a week is shown (a device's card on its person's page, the Traffic card of a
// device and of a person), so it reads and answers the same everywhere (the owner, 2026-11-12: «в девайсе трафик
// last 7 days должен работать по такому же принципу как в карточке устройства в персоне, и при наведении на бары»).

import { h } from '../../portal/dom';
import { bars, readBars, sumDays, upDown } from '../../portal/ui/bars';
import { setText } from '../../portal/ui/morph';
import { fmt } from '../../shared/i18n';
import type { Pair } from '../../shared/types';

export interface WeekUse {
  el: HTMLElement;
  /** Other days (a repaint): the sum follows, the bars are drawn again when a day changed. */
  set(spark: Pair[]): void;
}

/** `key`: names its two numbers for a repaint's morph; `name`: whose week it is, for a screen reader. */
export function weekUse(key: string, name: string, spark0: Pair[]): WeekUse {
  const lbl = h('span', { class: 'use-lbl' }, _('Last 7 days'));
  const val = upDown(key);
  let spark = spark0;
  let drawn = '';
  /** The day read now (-1: none, the sum shows). */
  let at = -1;
  let chart: HTMLElement = h('span');
  const el = h('div', { class: 'dev-use' }, h('div', { class: 'use-txt' }, lbl, h('span', { class: 'use-val' }, val.el)), chart);
  const say = () => {
    const n = spark.length;
    setText(lbl, at < 0 || at >= n ? _('Last 7 days') : at === n - 1 ? _('Today') : fmt(_('%s days ago'), n - 1 - at));
    val.set(at < 0 || at >= n ? sumDays(spark) : spark[at]);
  };
  const set = (next: Pair[]) => {
    spark = next;
    const k = JSON.stringify(next);
    if (k !== drawn) {
      drawn = k;
      // other days: other bars, and whatever day was being read is let go
      at = -1;
      const b = bars(next, 'bars-week', 34);
      readBars(b, fmt(_('%s, last 7 days'), name), (i) => {
        at = i;
        say();
      });
      chart.replaceWith(b.el);
      chart = b.el;
    }
    say();
  };
  set(spark0);
  return { el, set };
}
