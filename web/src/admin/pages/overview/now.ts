// Overview's "now" card (the concept's card.now): three tiles over the 30-day
// line. Online: the devices online and how many people they are, their faces
// (the map markers' initials) leading to People. Speed now: the router's speed
// to the devices and from them, who moves most this second (the two biggest,
// links to their pages), and the live line of the last two minutes. Today:
// what moved since midnight, this month's total, and today by the router's
// hour as bars (the hours to come empty). Then the last 30 days as a line, the
// 30 before dashed under it; a day read under the pointer, a tap or the arrows
// is said at the foot, where at rest stand who moved most this month.
//
// Motion: the speed's words are put in place at once the first time (nothing
// blinks on load), then morph every third second (a morph each second keeps
// the letters moving most of the time); the line slides each second. A read
// day swaps at once (a readout never morphs). The chart's entrance plays once:
// the page draws it again only when its days change.

import { tip } from '../../../portal/ui/tip';
import type { DayUsage, Person } from '../../../shared/types';
import { h } from '../../../portal/dom';
import { morphText, setText, textOf } from '../../../portal/ui/morph';
import { refill } from '../../ui/reshape';
import { rateOf, bytes, initials } from '../../../shared/format';
import { fmt, plural } from '../../../shared/i18n';
import { peopleUrl, personUrl } from '../../shell/routes';
import { drawChart, lineChart } from '../../widgets/line-chart';
import { liveLine } from '../../widgets/live-line';
import { shortDay } from '../../people/lines';
import { hourBars, topMonth } from '../../overview/model';
import type { OverviewCtx } from './ctx';
import { putChildren } from '../../../portal/ui/put';

/** Days on the line; the status brings twice as many, the period before drawn under it. */
export const DAYS = 30;
/** Faces in the Online tile before "+N". */
const FACES = 6;

const sum = (d: DayUsage) => d.rx + d.tx;
const first = (p: Person) => p.name.trim().split(/\s+/)[0] ?? p.name;

/** The speed as the tile says it: down to the devices, up from them, the busiest people now, the last two minutes. */
export interface Speed {
  down: number;
  up: number;
  top: { p: Person; v: number }[];
  /** Bytes/s to the devices, a second each, oldest first (empty: none yet). */
  line: number[];
  /** Why there is no speed (the meter failing, nothing running), said in the tile instead. */
  why?: string;
}

export interface NowCard {
  el: HTMLElement;
  /** The speed tile: the meter runs only while it is on screen. */
  tile: HTMLElement;
  /** A fresh status: the counts, faces and today's bars in place; the chart again when its days changed. */
  update(c: OverviewCtx): void;
  /**
   * `atOnce`: say it now, not at the words' next turn (they change every third second). True when the speed's
   * words were said this time: what else says a speed of the same meter (a server's «Now») changes with them.
   */
  speed(s: Speed, atOnce?: boolean): boolean;
}

function onlineTile(c: OverviewCtx): (HTMLElement | null)[] {
  const on = c.st.people.filter((p) => p.online > 0);
  const devices = c.st.people.reduce((n, p) => n + p.online, 0);
  const faces = on.length
    ? h(
        'a',
        { class: 'st-faces', href: peopleUrl(), 'aria-label': fmt(_('Online now: %s'), on.map((p) => p.name).join(', ')) },
        ...on.slice(0, FACES).map((p) => h('span', { class: 'pav on', title: p.name }, initials(p.name))),
        on.length > FACES ? h('span', { class: 'pav more num' }, `+${on.length - FACES}`) : null,
      )
    : null;
  return [
    h('span', { class: 'use-lbl' }, _('Online')),
    h('b', { class: 'num' }, plural(devices, '%s device', '%s devices')),
    h('span', { class: 'stat-sub' }, on.length ? plural(on.length, 'across %s person', 'across %s people') : _('nobody is connected')),
    faces,
  ];
}

function todayTile(c: OverviewCtx): (HTMLElement | null)[] {
  const t = c.st.totals;
  const hours = c.st.hours;
  // the router's hour now: the last bar's; the others count back from it
  const hourNow = Math.floor(((((c.now() + (c.st.tz ?? 0) * 60) % 86400) + 86400) % 86400) / 3600);
  const bars = hours?.length
    ? h(
        'div',
        { class: 'hbars', role: 'img', 'aria-label': _('The last 24 hours by the hour') },
        ...hourBars(hours).map((b, i) => {
          const hour = (((hourNow - (hours.length - 1 - i)) % 24) + 24) % 24;
          const bar = h('i', { class: b.share === null ? 'later' : i === hours.length - 1 ? 'now' : '' });
          bar.style.height = `${b.share === null ? 3 : Math.max(3, Math.round(b.share * 26))}px`;
          // the hour's whole column answers the pointer, not the bar alone: a quiet hour's bar is three px tall
          const col = h('span', { class: 'hb' }, bar);
          if (b.share !== null) tip(col, () => `${String(hour).padStart(2, '0')}:00 · ${bytes(b.bytes)}`);
          return col;
        }),
      )
    : null;
  return [
    // what the bars add up to: the last 24 hours, not the day since midnight (two bars at one in the morning)
    h('span', { class: 'use-lbl' }, _('Last 24 hours')),
    h('b', { class: 'num' }, bytes(hours?.length ? hours.reduce((n, v) => n + v[0] + v[1], 0) : t.today[0] + t.today[1])),
    h('span', { class: 'stat-sub' }, fmt(_('%s in 30 days'), bytes(t.month[0] + t.month[1]))),
    bars,
  ];
}

/** Who moved most in the last 30 days, at the chart's foot while no day is read. */
function topLine(c: OverviewCtx): HTMLElement | null {
  const top = topMonth(c.st.people);
  if (!top.length) return null;
  return h(
    'span',
    { class: 'now-top' },
    _('Most in 30 days:'),
    ' ',
    ...top.flatMap((x, i) => [
      i ? ', ' : '',
      h('span', { class: 'nb' }, h('a', { href: personUrl(x.p.id), title: x.p.name }, first(x.p)), ` ${bytes(x.bytes)}`),
    ]),
  );
}

function chart(c: OverviewCtx, readout: HTMLElement): HTMLElement | null {
  const all = c.st.series;
  const days = all.slice(-DAYS);
  if (days.length < 2) return null;
  const before = all.slice(-2 * DAYS, -DAYS);
  const past = before.length === days.length && before.some((d) => sum(d) > 0) ? before.map(sum) : null;
  const el = lineChart(
    days.map(sum),
    120,
    [shortDay(days[0].day), _('today')],
    _('Traffic by day: the arrows pick a day'),
    (i) => {
      const d = days[i];
      // the day read stands where who moved most this month stood (overview.css)
      readout.textContent = i < 0 || !d ? '' : `${shortDay(d.day)} · ${bytes(sum(d))}${i === days.length - 1 ? ` · ${_('today')}` : ''}`;
    },
    past,
  );
  el.dataset.past = past ? '1' : '';
  return el;
}

export function nowCard(c0: OverviewCtx): NowCard {
  const online = h('div', { class: 'stat' });
  const today = h('div', { class: 'stat' });
  const down = h('b', { class: 'num' }, '—');
  const up = h('span', { class: 'stat-sub' }, ' ');
  const line = liveLine(36);
  const tile = h(
    'div',
    { class: 'stat has-extra' },
    h('span', { class: 'use-lbl' }, _('Speed now')),
    down,
    up,
    h('div', { class: 'll-wrap' }, line.el),
  );
  const chartBox = h('div', { class: 'now-chart' });
  const readout = h('span', { class: 'lc-read num' });
  const keys = h('span', { class: 'now-keys' });
  const topBox = h('span', { class: 'now-topbox' });
  const foot = h('div', { class: 'now-foot' }, keys, readout, topBox);
  const el = h('section', { class: 'card now' }, h('div', { class: 'stats' }, online, tile, today), chartBox, foot);
  let dayKey = '';
  let beat = 0;
  let said = '';
  const update = (c: OverviewCtx) => {
    // their parts change in place (ui/reshape.ts)
    refill(
      online,
      onlineTile(c).filter((x): x is HTMLElement => !!x),
    );
    refill(
      today,
      todayTile(c).filter((x): x is HTMLElement => !!x),
    );
    online.classList.toggle('has-extra', !!online.querySelector('.st-faces'));
    today.classList.toggle('has-extra', !!today.querySelector('.hbars'));
    refill(
      topBox,
      [topLine(c)].filter((x): x is HTMLElement => !!x),
    );
    const k = JSON.stringify(c.st.series.slice(-2 * DAYS));
    if (k === dayKey) return;
    dayKey = k;
    readout.textContent = '';
    const ch = chart(c, readout);
    // put in whole and drawn at once, never morphed: a morph keeps the old plot's node, which has the new markup
    // (no drawing yet) and its old width, so nothing ever drew in it again until the window was resized
    putChildren(chartBox, ch ? [ch] : []);
    if (ch) drawChart(ch);

    foot.hidden = !ch;
    refill(keys, [
      h('span', { class: 'lc-key' }, h('i', { class: 'lg live' }), fmt(_('%s days'), DAYS)),
      ...(ch?.dataset.past ? [h('span', { class: 'lc-key' }, h('i', { class: 'lg past' }), fmt(_('Previous %s'), DAYS))] : []),
    ]);
  };
  update(c0);
  return {
    el,
    tile,
    update,
    speed(s, atOnce = false) {
      if (s.line.length > 1) line.push(s.line);
      // said plainly the first time, then every change morphs (the speed's words, the reason there is none)
      const put = ++beat === 1 ? setText : (el: HTMLElement, t: string) => textOf(el) !== t && morphText(el, t);
      if (s.why) {
        put(down, '—');
        put(up, s.why);
        said = 'why';
        return false;
      }
      // the words every third second (and at once when they first come)
      if (!atOnce && beat % 3 !== 1 && said === 'speed') return false;
      put(down, `↓ ${rateOf(s.down)}`);
      put(up, fmt(_('↑ %s from devices'), rateOf(s.up)));
      said = 'speed';
      return true;
    },
  };
}
