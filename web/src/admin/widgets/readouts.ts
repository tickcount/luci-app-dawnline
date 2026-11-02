// What a picked point says: a day of traffic in a chart's tooltip (ui/glide.ts:
// its name, its total against the average, the down/up split as a strip, the
// busiest of the span), and when a second of the live speed was, for the tile's
// head. Content only; anchoring and gliding are the tooltip's, sums shared/pace.ts.

import { E } from '../e';
import { addDays, bytes, parseDay } from '../../shared/format';
import { fmt, locale, num } from '../../shared/i18n';
import { vsAverage } from '../../shared/pace';

/** "Today", "Yesterday", "Sat 31 Oct", on the router's calendar (`today`). */
export function dayName(day: string, today: string): string {
  if (day === today) return _('Today');
  if (day === addDays(today, -1)) return _('Yesterday');
  return parseDay(day).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' });
}

/** A day against the average of the others: "+62% vs average", "about average"; today is "so far". */
function againstAverage(totals: number[], i: number): string {
  if (i === totals.length - 1) return _('so far');
  const p = vsAverage(totals, i);
  if (Math.abs(p) < 5) return _('about average');
  return p > 0 ? fmt(_('+%s%% vs average'), num(p)) : fmt(_('−%s%% vs average'), num(-p));
}

/** Down and up as one strip: download the live blue, upload the past grey. */
function split(tx: number, rx: number): HTMLElement {
  const dn = E('i', { class: 'dn' }),
    up = E('i', { class: 'up' });
  dn.style.flexGrow = String(tx);
  up.style.flexGrow = String(rx);
  return E('div', { class: 'dl-glide-split' }, rx || tx ? [dn, up] : []);
}

/** "↓ 8.3 GB  ↑ 1.1 GB". */
export const downUp = (tx: number, rx: number) => [
  E('span', { class: 'dl-dn' }, '↓'),
  ` ${bytes(tx)}  `,
  E('span', { class: 'dl-up' }, '↑'),
  ` ${bytes(rx)}`,
];

/** Day i of `days` ([rx, tx], today last): its name and how it compares, its total, the split. */
export function dayTip(days: { day: string; rx: number; tx: number }[], i: number, today: string): (Node | string)[] {
  const totals = days.map((d) => d.rx + d.tx);
  const d = days[i];
  return [
    E('div', { class: 'dl-glide-head' }, [E('b', {}, dayName(d.day, today)), E('span', { class: 'dl-faint' }, againstAverage(totals, i))]),
    E('div', { class: 'dl-glide-big' }, bytes(totals[i])),
    split(d.tx, d.rx),
    E('div', { class: 'dl-muted dl-mono' }, downUp(d.tx, d.rx)),
    totals[i] > 0 && totals[i] === Math.max(...totals)
      ? E('div', { class: 'dl-glide-note' }, fmt(_('The busiest of the %s days'), num(days.length)))
      : '',
  ];
}

/** A device's day: its name, what it moved or that it was not used, and on how many days of the span it was. */
export function deviceDayTip(days: { day: string; rx: number; tx: number }[], i: number, today: string): (Node | string)[] {
  const d = days[i],
    v = d.rx + d.tx;
  const used = days.filter((x) => x.rx + x.tx > 0).length;
  return [
    E('div', { class: 'dl-glide-head' }, [
      E('b', {}, dayName(d.day, today)),
      E('span', { class: 'dl-faint' }, v ? bytes(v) : _('Not used')),
    ]),
    v ? split(d.tx, d.rx) : '',
    E(
      'div',
      { class: 'dl-glide-note' },
      fmt(N_(days.length, 'Used on %s of %s day', 'Used on %s of %s days'), num(used), num(days.length)),
    ),
  ];
}

/** When a second was against the newest: "now", "12 s ago", "1 min 40 s ago". */
export function secondsAgo(s: number): string {
  if (s < 1) return _('now');
  return s < 60 ? fmt(_('%s s ago'), num(s)) : fmt(_('%s min %s s ago'), num(Math.floor(s / 60)), num(s % 60));
}

/** A second's time on the clock, with seconds. */
export const timeOf = (ts: number) =>
  new Date(ts * 1000).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });
