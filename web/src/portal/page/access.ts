// "Your access", set by the admin: one accordion of three rows. What the
// access reaches (home and internet as two tiles, and the names devices at
// home reach this person's devices by); the data, as a ring in the head and
// the month day by day inside; and until when, as the days left over a
// calendar of the weeks, with the admin's hours as a bar of the day.

import type { Person } from '../../shared/types';
import { ACCESS_LABEL, byDeviceState, bytes, date, daysLeft, endsSoon, parseDay } from '../../shared/format';
import { h, ic, markup } from '../dom';
import { calendar, clockOf, hoursFor, minuteAt, monthOf, stretches } from '../days';
import { now, today, type State } from '../state';
import { accordion, type Accordion } from '../ui/accordion';
import { copy } from '../ui/feedback';
import { glass } from '../ui/glass';
import { morphChanged, setText, textsOf } from '../ui/morph';
import { reachableFromHome } from './devices';

const desc = (text: string) => h('p', { class: 'desc' }, text);
/** A share of a length, as a CSS percentage. */
const pc = (part: number, whole: number) => `${((part / whole) * 100).toFixed(2)}%`;

/** What the access reaches, as two tiles: the home network and the internet, each in or out. */
function reachTiles(access: Person['access']): HTMLElement {
  const tile = (on: boolean, icon: string, name: string, sub: string) =>
    h(
      'div',
      { class: `reach-tile${on ? '' : ' off'}` },
      glass(icon, on ? 'blue' : 'grey', 'gi rt-ic'),
      h('b', {}, name),
      h('span', { class: 'rt-sub' }, on ? sub : 'Not included'),
      h('span', { class: 'rt-mark', 'aria-label': on ? 'Included' : 'Not included' }, ic(on ? 'check' : 'minus')),
    );
  return h(
    'div',
    { class: 'reach2' },
    tile(access !== 'internet', 'home', 'Home network', 'Devices at home'),
    tile(access !== 'lan', 'globe', 'Internet', 'Through the router'),
  );
}

/** How other devices at home reach this person's devices: once, here, only where the router lets them through. */
function namesAtHome(p: Person, mesh: boolean): Node[] {
  const named = byDeviceState(p.devices).filter((d) => d.hostname && reachableFromHome(p, d));
  if (!named.length) return [];
  const first = named[0].hostname;
  const dot0 = first.indexOf('.');
  const domain = dot0 > 0 ? first.slice(dot0) : '';
  return [
    h(
      'span',
      { class: 'lbl-s' },
      mesh ? 'Devices at home and on this VPN reach yours as ' : 'Other devices at home reach yours as ',
      h('span', { class: 'mono' }, `name${domain}`),
    ),
    h(
      'div',
      { class: 'names' },
      named.map((d) => {
        const dot = d.hostname.indexOf('.');
        return h(
          'button',
          {
            type: 'button',
            class: 'namechip',
            title: d.name,
            'aria-label': `Copy ${d.hostname}`,
            onclick: (ev: Event) => copy(d.hostname, 'Address copied', ev.currentTarget),
          },
          h('span', {}, dot > 0 ? [d.hostname.slice(0, dot), h('span', { class: 'faint' }, d.hostname.slice(dot))] : d.hostname),
          ic('copy'),
        );
      }),
    ),
  ];
}

/** Used against the limit, as a small ring (its colour: fine, nearly full, full). */
function ring(pct: number): Element {
  const c = 2 * Math.PI * 6;
  const tone = pct >= 100 ? ' bad' : pct >= 90 ? ' warn' : '';
  return markup(
    `<svg class="ring" viewBox="0 0 16 16" aria-hidden="true"><circle class="trk" cx="8" cy="8" r="6" fill="none" stroke-width="2.4"/>` +
      `<circle class="arc${tone}" cx="8" cy="8" r="6" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="${((c * pct) / 100).toFixed(2)} ${c.toFixed(2)}"/></svg>`,
  );
}

function meter(pct: number): HTMLElement {
  const i = h('i', { class: pct >= 100 ? 'bad' : pct >= 90 ? 'warn' : '' });
  i.style.width = `${pct.toFixed(1)}%`;
  return h('div', { class: 'meter' }, i);
}

/** The month as one bar a day (today in blue, days to come faint), and the total under it. */
function month(p: Person, used: number, pct: number): HTMLElement {
  const { days, day } = monthOf(today());
  const series = p.month_days ?? [];
  const max = Math.max(1, ...series);
  const short = (d: number) =>
    parseDay(`${today().slice(0, 8)}${String(d).padStart(2, '0')}`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  // The total, and a bar under the pointer in its place, at once: no morph while the pointer moves.
  const total = h('b', { class: 'num', 'data-t': 'm-used' }, bytes(used));
  const tail = h('span', {}, ' used');
  const read = h('span', { class: 'mread' }, total, tail);
  const bars = h('div', { class: 'mbars' });
  for (let i = 0; i < days; i++) {
    if (i >= day) {
      bars.appendChild(h('i', { class: 'future' }));
      continue;
    }
    const v = series[i] ?? 0;
    const b = h('i', { class: i === day - 1 ? 'today' : '' });
    b.style.height = `${Math.max(3, Math.round((v / max) * 64))}px`;
    b.addEventListener('pointerenter', () => {
      setText(total, bytes(v));
      setText(tail, ` on ${short(i + 1)}`);
    });
    b.addEventListener('pointerleave', () => {
      setText(total, bytes(used));
      setText(tail, ' used');
    });
    bars.appendChild(b);
  }
  // "Today" under its bar; the month's ends step aside when it comes close.
  const td = h('span', { class: 'td' }, 'Today');
  td.style.left = pc(day - 0.5, days);
  const axis = h(
    'div',
    { class: 'month-axis' },
    h('span', { class: day <= 4 ? 'hide' : '' }, short(1)),
    td,
    h('span', { class: day >= days - 3 ? 'hide' : '' }, short(days)),
  );
  return h(
    'div',
    { class: 'month' },
    bars,
    axis,
    h(
      'div',
      { class: 'month-read' },
      read,
      h(
        'span',
        { class: `num${p.state === 'quota' ? ' bad-t' : ''}`, 'data-t': 'm-left' },
        p.quota_limit ? `${bytes(Math.max(0, p.quota_limit - used))} left` : 'No limit',
      ),
    ),
    p.quota_limit ? meter(pct) : null,
  );
}

/** The days left as a number over a calendar of the weeks to the end (the last day ringed). */
function untilCal(p: Person, left: number): HTMLElement {
  const day = (d: string) => parseDay(d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const cells = calendar(today(), p.expires);
  const cal = cells
    ? h(
        'div',
        { class: 'cal', 'aria-hidden': 'true' },
        h(
          'div',
          { class: 'cal-h' },
          ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x) => h('span', {}, x)),
        ),
        h(
          'div',
          { class: 'cal-g' },
          cells.map((c, i) => {
            const el = h('i', { class: c.kind, title: day(c.day) });
            el.style.setProperty('--i', String(i));
            return el;
          }),
        ),
      )
    : null;
  return h(
    'div',
    { class: `until${endsSoon(p, left) ? ' soon' : ''}` },
    h(
      'div',
      { class: 'until-num' },
      h('b', { class: 'num' }, String(left)),
      h('span', {}, `${left === 1 ? 'day' : 'days'} left`),
      h('span', { class: 'until-sub' }, `Ends ${day(p.expires)}`),
    ),
    cal,
  );
}

/** The day as 24 hours in the visitor's time: the admin's window filled, now marked. */
function hoursBar(hours: string, tzOffset: number | undefined): HTMLElement | null {
  const visitor = -new Date().getTimezoneOffset();
  const hw = hoursFor(hours, tzOffset, visitor);
  if (!hw) return null;
  // The router's clock, read in the visitor's zone (or the router's, without its offset).
  const at = minuteAt(now(), hw.yours ? visitor : (tzOffset ?? visitor));
  const segs = stretches(hw);
  const inside = segs.some(([a, b]) => at >= a && at < b);
  const bar = h('div', { class: 'hours-bar' });
  for (const [a, b] of segs) {
    const i = h('i');
    i.style.left = pc(a, 1440);
    i.style.width = pc(b - a, 1440);
    bar.appendChild(i);
  }
  const mark = h('span', { class: `hours-now${inside ? '' : ' out'}`, title: `Now, ${clockOf(at)}` });
  mark.style.left = pc(at, 1440);
  bar.appendChild(mark);
  return h(
    'div',
    { class: 'hours' },
    h(
      'div',
      { class: 'hours-top' },
      h('span', {}, hw.yours ? 'Hours, your time' : 'Hours, router time'),
      h('b', { class: 'num' }, `${clockOf(hw.from)}–${clockOf(hw.to)}`),
    ),
    bar,
    h(
      'div',
      { class: 'hours-axis' },
      ['00', '06', '12', '18', '24'].map((x) => h('span', {}, x)),
    ),
  );
}

/** The access accordion for this state; `open`: the row to keep open (a repaint), else the data. */
export function accessAccordion(st: State, open = 1): Accordion {
  const p = st.person;
  const used = p.quota_used || p.month[0] + p.month[1];
  const pct = p.quota_limit ? Math.min(100, (used / p.quota_limit) * 100) : 0;
  // A total over the whole access only with a limit; otherwise it is this month's count.
  const total = p.quota_period === 'total' && !!p.quota_gb;
  const left = daysLeft(p.expires, today());
  const untilVal = p.expires
    ? h(
        'span',
        { class: 'until-val' },
        h('span', { class: 'num', 'data-t': 'until-date' }, date(p.expires).replace(/ \d{4}$/, '')),
        left != null
          ? h(
              'span',
              { class: `num ${left < 0 ? 'bad-t' : endsSoon(p, left) ? 'warn-t' : 'ok-t'}`, 'data-t': 'until-left' },
              left >= 0 ? `${left} day${left === 1 ? '' : 's'}` : 'ended',
            )
          : null,
      )
    : h('span', {}, 'No end date');
  const untilBody = [
    !p.expires ? null : left != null && left < 0 ? desc(`It ended on ${date(p.expires)}.`) : untilCal(p, left ?? 0),
    p.hours ? hoursBar(p.hours, st.tz_offset) : null,
  ];
  return accordion(
    [
      {
        icon: glass(p.access === 'internet' ? 'globe' : p.access === 'lan' ? 'home' : 'shield'),
        title: ACCESS_LABEL[p.access],
        body: [reachTiles(p.access), ...namesAtHome(p, !!st.server.device_mesh)],
      },
      {
        icon: glass('chart'),
        title: total ? 'Data used' : 'Data this month',
        val: h(
          'span',
          { class: 'data-val' },
          p.quota_limit ? ring(pct) : null,
          h(
            'span',
            { class: 'num', 'data-t': 'data-val' },
            `${bytes(used)}${p.quota_limit ? ` / ${bytes(p.quota_limit)}` : ' · no limit'}`,
          ),
        ),
        valHide: true,
        body: [
          total ? desc(`${bytes(used)} of ${bytes(p.quota_limit)} in total.`) : month(p, used, pct),
          desc(
            !p.quota_limit
              ? 'No data limit. The count starts again on the 1st.'
              : total
                ? 'A total for your whole access, it does not reset.'
                : 'Resets on the 1st.',
          ),
        ],
      },
      // No end date and no hours: nothing to open, the row just says so.
      { icon: glass('calendar'), title: 'Access until', val: untilVal, valHide: !!p.expires && (left ?? 0) >= 0, body: untilBody },
    ],
    { open },
  );
}

/** The section, built once; `fillAccess` puts the accordion in. */
export function accessSection(): HTMLElement {
  return h(
    'section',
    { class: 'access', id: 'access', 'aria-label': 'Your access' },
    h('div', { class: 'sec-head' }, h('h2', {}, 'Your access')),
    h('div', { class: 'acc-slot' }),
  );
}

let shown: Accordion | null = null;
/** The accordion for this state, the same row open as before. */
export function fillAccess(section: HTMLElement, st: State) {
  const acc = accessAccordion(st, shown ? shown.openIndex() : 1);
  // The values it showed: what changed morphs from it.
  const said = textsOf(section);
  section.querySelector('.acc-slot')!.replaceChildren(acc.el);
  if (shown) morphChanged(section, said);
  shown = acc;
}
