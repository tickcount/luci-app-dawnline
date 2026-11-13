// "Your access", set by the admin: one accordion of three rows. What the
// access reaches (home and internet as two tiles, and the names devices at
// home reach this person's devices by); the data, as a ring in the head and
// the month day by day inside; and until when, as the days left over a
// calendar of the weeks. A repaint keeps the rows on the page and changes
// what they hold in place.

import type { Pair, Person } from '../../shared/types';
import { accessLabel, addDays, bytes, date, daysLeft, endsSoon, parseDay, until } from '../../shared/format';
import { paceOf, paceWords, vsAverage } from '../../shared/pace';
import { fmt, locale, num, plural } from '../../shared/i18n';
import { h, ic, markup } from '../dom';
import { calendar } from '../days';
import { SMOOTH, play } from '../motion';
import { now, today, type State } from '../state';
import { accordion, regrow, type Accordion } from '../ui/accordion';
import { bars, readBars, upDown } from '../ui/bars';
import { glass } from '../ui/glass';
import { morphChanged, morphInto, setText, textOf, textsOf } from '../ui/morph';
import { holdFoot } from './frame';
import { putChildren } from '../ui/put';

const desc = (text: string) => h('p', { class: 'desc' }, text);
/** A router day (YYYY-MM-DD) as "13 Oct", without the year. */
const dayMonth = (d: string) => parseDay(d).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });

/** What the access reaches, as two tiles: the home network and the internet, each in or out. */
function reachTiles(access: Person['access']): HTMLElement {
  const tile = (on: boolean, icon: string, name: string, sub: string) =>
    h(
      'div',
      { class: `reach-tile${on ? '' : ' off'}` },
      glass(icon, on ? 'blue' : 'grey', 'gi rt-ic'),
      h('b', {}, name),
      h('span', { class: 'rt-sub' }, on ? sub : _('Not included')),
      h('span', { class: 'rt-mark', 'aria-label': on ? _('Included') : _('Not included') }, ic(on ? 'check' : 'minus')),
    );
  return h(
    'div',
    { class: 'reach2' },
    tile(access !== 'internet', 'home', _('Home network'), _('Devices at home')),
    tile(access !== 'lan', 'globe', _('Internet'), _('Through the router')),
  );
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

/**
 * When a monthly limit starts again. The month is yours, not the calendar's: it began with your first connection
 * and ends a month later; the next one begins when you connect again.
 */
function resetWords(p: Person): string {
  if (!p.quota_resets) return _('Your month begins when you next connect.');
  return fmt(
    _('Resets on %s, in %s. Your month began with your first connection.'),
    dayMonth(p.quota_reset_day),
    until(p.quota_resets - now()),
  );
}

/** How many days the chart shows: the last 30, today included (not the calendar month). */
const SPAN_DAYS = 30;

/** The last 30 days a day at a time, down and up (today in blue, last), what came and went under it. */
function month(p: Person, used: number, pct: number): HTMLElement {
  const series = Array.from(
    { length: SPAN_DAYS },
    (_x, i): Pair => p.month_days?.[i - (SPAN_DAYS - (p.month_days?.length ?? 0))] ?? [0, 0],
  );
  const short = (i: number) => dayMonth(addDays(today(), i - (SPAN_DAYS - 1)));
  // The 30 days' down and up; a day under the pointer puts its own in their place and its date where "left" stands,
  // at once: no morph while the pointer moves.
  const read = upDown('m');
  const left = p.quota_limit ? fmt(_('%s left'), bytes(Math.max(0, p.quota_limit - used))) : _('No limit');
  const side = h('span', { class: 'num', 'data-t': 'm-left' }, left);
  const totals = series.map(([rx, tx]) => rx + tx);
  // A picked day says its date and how it compares with the other days ("21 Oct · +62%").
  const against = (i: number) => {
    if (i === totals.length - 1) return _('so far');
    const v = vsAverage(totals, i);
    return Math.abs(v) < 5 ? _('about average') : v > 0 ? `+${num(v)}%` : `−${num(-v)}%`;
  };
  const say = (i: number) => {
    read.set(i >= 0 ? series[i] : p.month);
    setText(side, i >= 0 ? `${short(i)} · ${against(i)}` : left);
    side.classList.toggle('bad-t', i < 0 && p.state === 'quota');
  };
  say(-1);
  const chart = bars(series, 'bars-month', 64);
  readBars(chart, _('Your data in the last 30 days'), say);
  // the axis: the first day's date at one end, «Today» under the last bar at the other
  const axis = h('div', { class: 'month-axis' }, h('span', {}, short(0)), h('span', { class: 'td' }, _('Today')));
  // With a limit not yet reached: the pace lately (the devices' last 7 days, so the month's first days have one
  // too) and when the limit fills at it, orange within a week.
  const pace = paceOf(
    Array.from({ length: 7 }, (_x, k) => p.devices.reduce((a, d) => a + (d.spark[k]?.[0] ?? 0) + (d.spark[k]?.[1] ?? 0), 0)),
  );
  const words =
    p.quota_limit && used < p.quota_limit
      ? paceWords(used, p.quota_limit, pace, p.quota_period === 'month' ? p.quota_reset_day || null : null, today())
      : '';
  const soon = pace > 0 && (p.quota_limit - used) / pace <= 7;
  return h(
    'div',
    { class: 'month' },
    chart.el,
    axis,
    h('div', { class: 'month-read' }, read.el, side),
    p.quota_limit ? meter(pct) : null,
    words ? h('div', { class: `month-pace${soon ? ' warn-t' : ''}` }, words) : null,
  );
}

/** The days left as a number over a calendar of the weeks to the end (the last day ringed). */
function untilCal(p: Person, left: number): HTMLElement {
  const day = (d: string) => parseDay(d).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' });
  // The weekdays' initials, Monday first (1 Jan 2024 was a Monday).
  const weekdays = Array.from({ length: 7 }, (_x, i) => new Date(2024, 0, 1 + i, 12).toLocaleDateString(locale(), { weekday: 'narrow' }));
  const cells = calendar(today(), p.expires);
  const cal = cells
    ? h(
        'div',
        { class: 'cal', 'aria-hidden': 'true' },
        h(
          'div',
          { class: 'cal-h' },
          weekdays.map((x) => h('span', {}, x)),
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
    { class: `until${endsSoon(left) ? ' soon' : ''}` },
    h(
      'div',
      { class: 'until-num' },
      h('b', { class: 'num' }, num(left)),
      h('span', {}, N_(left, 'day left', 'days left')),
      h('span', { class: 'until-sub' }, fmt(_('Ends %s'), day(p.expires))),
    ),
    cal,
  );
}

/** The access accordion for this state; `open`: the row to keep open (a repaint), else the data. */
function accessAccordion(st: State, open = 1): Accordion {
  const p = st.person;
  // Of a limit: what its period has counted (your limit month, or all time); with none: the last 30 days.
  const used = p.quota_limit ? p.quota_used : p.month[0] + p.month[1];
  const pct = p.quota_limit ? Math.min(100, (used / p.quota_limit) * 100) : 0;
  // A total over the whole access only with a limit.
  const total = p.quota_period === 'total' && !!p.quota_gb;
  const left = daysLeft(p.expires, today());
  const untilVal = p.expires
    ? h(
        'span',
        { class: 'until-val' },
        h('span', { class: 'num', 'data-t': 'until-date' }, dayMonth(p.expires)),
        left != null
          ? h(
              'span',
              { class: `num ${left < 0 ? 'bad-t' : endsSoon(left) ? 'warn-t' : 'ok-t'}`, 'data-t': 'until-left' },
              left >= 0 ? plural(left, '%s day', '%s days') : _('ended'),
            )
          : null,
      )
    : h('span', {}, _('No end date'));
  const untilBody = [
    !p.expires ? null : left != null && left < 0 ? desc(fmt(_('It ended on %s.'), date(p.expires))) : untilCal(p, left ?? 0),
  ];
  return accordion(
    [
      {
        icon: glass(p.access === 'internet' ? 'globe' : p.access === 'lan' ? 'home' : 'both'),
        title: accessLabel(p.access),
        // (a device's own address is copied from its ⋯ menu, and a router's networks stand in its own sheet)
        body: [reachTiles(p.access)],
      },
      {
        icon: glass('chart'),
        // of a limit: all time, or your month (yours, not the calendar's); with none: the last 30 days
        title: total ? _('Data used') : p.quota_limit ? _('Data this month') : _('Data in 30 days'),
        val: h(
          'span',
          { class: 'data-val' },
          p.quota_limit ? ring(pct) : null,
          h(
            'span',
            { class: 'num', 'data-t': 'data-val' },
            `${bytes(used)} ${p.quota_limit ? `/ ${bytes(p.quota_limit)}` : `· ${_('no limit')}`}`,
          ),
        ),
        valHide: true,
        body: [
          total ? desc(fmt(_('%s of %s in total.'), bytes(used), bytes(p.quota_limit))) : month(p, used, pct),
          desc(!p.quota_limit ? _('No data limit.') : total ? _('A total for your whole access, it does not reset.') : resetWords(p)),
        ],
      },
      // No end date: nothing to open, the row just says so.
      { icon: glass('calendar'), title: _('Access until'), val: untilVal, valHide: !!p.expires && (left ?? 0) >= 0, body: untilBody },
    ],
    { open, hold: holdFoot },
  );
}

/** The section, built once; `fillAccess` puts the accordion in. */
export function accessSection(): HTMLElement {
  return h(
    'section',
    { class: 'access', id: 'access', 'aria-label': _('Your access') },
    h('div', { class: 'sec-head' }, h('h2', {}, _('Your access'))),
    h('div', { class: 'acc-slot' }),
  );
}

/**
 * Markup to compare: each keyed value as the words it says (one still morphing, those it turns into), less the ids
 * each glass icon makes up (the same icon twice is the same).
 */
function plain(el: Element, inner = false): string {
  const c = el.cloneNode(true) as Element;
  const keyed = el.querySelectorAll<HTMLElement>('[data-t]');
  c.querySelectorAll<HTMLElement>('[data-t]').forEach((k, i) => {
    k.textContent = textOf(keyed[i]);
    k.classList.remove('mt', 'mt-ib');
  });
  return (inner ? c.innerHTML : c.outerHTML).replace(/\bgl\d+/g, 'gl');
}

/**
 * The rows on the page take the new rows' content in place, so what moves in
 * them goes on (a row opening or folding, the calendar's days coming in, a
 * value still morphing into the same words): keyed values in a head take their
 * new words (they morph afterwards, morphChanged), a head swaps only the parts
 * that changed (its click stays the row's own), and a body takes its new
 * content (`refillBody`). Rows of another shape (an end date set or taken
 * away) can't: null. Returns what came in whole.
 */
function refill(acc: HTMLElement, next: HTMLElement): Element[] | null {
  const rows = [...acc.children] as HTMLElement[];
  const news = [...next.children] as HTMLElement[];
  if (rows.length !== news.length || rows.some((r, i) => r.classList.contains('still') !== news[i].classList.contains('still')))
    return null;
  const fresh: Element[] = [];
  rows.forEach((r, i) => {
    const [head, body] = [...r.children] as HTMLElement[];
    const [nh, nb] = [...news[i].children] as HTMLElement[];
    for (const el of head.querySelectorAll<HTMLElement>('[data-t]')) {
      const n = nh.querySelector(`[data-t="${el.dataset.t}"]`);
      if (n && textOf(el) !== n.textContent) setText(el, n.textContent ?? '');
    }
    if (head.children.length !== nh.children.length) head.replaceChildren(...nh.childNodes);
    else
      [...nh.children].forEach((y, k) => {
        const x = head.children[k];
        if (plain(x) === plain(y)) return;
        // The same box (the value that hides while the row is open) keeps its own fade and takes the new content.
        if (x.tagName === y.tagName && x.className === y.className) x.replaceChildren(...y.childNodes);
        else x.replaceWith(y);
      });
    fresh.push(...refillBody(r, body, nb));
  });
  return fresh;
}

/** Open bodies whose days are still coming in, with what each shows once they are in. */
const waiting = new WeakMap<HTMLElement, HTMLElement>();

/**
 * A row's body takes the new one's content: shut, at once; open or still
 * closing, where it stands (morphInto: a crossing piece keeps its old words as
 * it fades) while the row glides to its new height. The calendar's days still
 * coming in finish their cascade first: the body changes once they are in, to
 * what the last repaint brought. Returns what came in whole.
 */
function refillBody(r: HTMLElement, body: HTMLElement, nb: HTMLElement): Element[] {
  if (waiting.has(body)) {
    waiting.set(body, nb);
    return [];
  }
  if (plain(body, true) === plain(nb, true)) return [];
  if (!r.classList.contains('open') && !r.classList.contains('closing')) {
    putChildren(body, [...nb.childNodes]);
    return [];
  }
  const days = [...body.querySelectorAll('.cal-g i')].flatMap((c) => c.getAnimations());
  if (days.length) {
    waiting.set(body, nb);
    void Promise.all(days.map((a) => a.finished.catch(() => undefined))).then(() => {
      const n = waiting.get(body)!;
      waiting.delete(body);
      if (!r.isConnected) return;
      const said = textsOf(body);
      morphChanged(body, said, refillBody(r, body, n));
    });
    return [];
  }
  // Its days came in when it opened: what comes now is the change alone.
  r.classList.remove('opened');
  const h0 = r.getBoundingClientRect().height;
  const moving = r.getAnimations().length > 0;
  const came = morphInto(body, [...nb.childNodes]);
  // Opening or folding still: that glide heads for the new height instead.
  if (moving) regrow(body);
  else {
    const h1 = r.getBoundingClientRect().height;
    if (Math.abs(h1 - h0) > 0.5)
      play(r, [{ height: `${h0}px` }, { height: `${h1}px` }], { duration: SMOOTH.duration, easing: SMOOTH.easing });
  }
  return came;
}

let shown: Accordion | null = null;
/** The accordion for this state, the same row open as before: the rows on the page stay when they can (`refill`). */
export function fillAccess(section: HTMLElement, st: State) {
  const slot = section.querySelector('.acc-slot') as HTMLElement;
  const acc = accessAccordion(st, shown ? shown.openIndex() : 1);
  // The values it showed: what changed morphs from it.
  const said = textsOf(section);
  const had = !!shown;
  const fresh = shown && slot.contains(shown.el) ? refill(shown.el, acc.el) : null;
  if (!fresh) {
    slot.replaceChildren(acc.el);
    shown = acc;
  }
  if (had) morphChanged(section, said, fresh ?? []);
}
