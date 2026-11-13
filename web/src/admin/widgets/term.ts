// A person's term (from the portal's «Access until» block, page/access.ts): how many days are left as a display
// number beside a calendar of the weeks to the end (today in the accent, the last day ringed; a far end one cell
// a week, so the block never stands half empty after an extension); under it the end date moved in one tap (each
// said with Undo: flows/person-acts.ts setEnd). When the date comes access stops, as a pause does, until the date
// is moved: that is all an end date does, so there is nothing to choose. With no end date there is no block: the part's head says so, and the moves are the card.
// The moves keep their places whatever the term is: the two extensions in one row, each saying where it leads as
// its own second line (no tooltip, which would land on the chip under it), the date and «No end date» in the next
// row. A row with one chip gives it the row, so a change never sends one chip across another. A read-only login
// sees the block.

import { h } from '../../portal/dom';
import { calendar, weeks } from '../../portal/days';
import { daysLeft, endsSoon, parseDay } from '../../shared/format';
import { fmt, locale, num, plural } from '../../shared/i18n';
import { setEnd } from '../flows/person-acts';
import { monthOn, monthsOn, personLine, shortDay } from '../people/lines';
import type { PersonCtx } from '../people/ctx';

const day = (d: string) => parseDay(d).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' });

/** The block (with an end date): the days left beside the calendar of the weeks. */
function untilBlock(c: PersonCtx): HTMLElement {
  const p = c.p;
  const left = daysLeft(p.expires, c.today) ?? 0;
  const over = left < 0;
  const soon = endsSoon(left);
  const weekdays = Array.from({ length: 7 }, (_x, i) => new Date(2024, 0, 1 + i, 12).toLocaleDateString(locale(), { weekday: 'narrow' }));
  const cells = over ? null : calendar(c.today, p.expires);
  // a far end: the same cells, one a week
  const far = over || cells ? null : weeks(c.today, p.expires);
  const cal = cells
    ? h(
        'div',
        {
          class: 'cal',
          // the days and the weeks are two pictures: one never morphs into the other cell by cell (a change of
          // scale crosses whole: the old one fades where it stood, the new one comes in)
          'data-key': 'days',
          role: 'img',
          'aria-label': `${plural(left, '%s day left', '%s days left')}, ${fmt(_('until %s'), day(p.expires))}`,
        },
        h('div', { class: 'cal-h' }, ...weekdays.map((x) => h('span', {}, x))),
        h('div', { class: 'cal-g' }, ...cells.map((x) => h('i', { class: x.kind, title: day(x.day) }))),
      )
    : far
      ? h(
          'div',
          {
            class: 'cal weeks',
            'data-key': 'weeks',
            role: 'img',
            'aria-label': `${plural(left, '%s day left', '%s days left')}, ${fmt(_('until %s'), day(p.expires))}`,
          },
          h('div', { class: 'cal-h' }, h('span', {}, _('weeks'))),
          h('div', { class: 'cal-g' }, ...far.map((x) => h('i', { class: x.kind, title: fmt(_('week of %s'), day(x.day)) }))),
        )
      : null;
  return h(
    'div',
    { class: `until kt-until${soon ? ' soon' : ''}${over ? ' over' : ''}` },
    h(
      'div',
      { class: 'until-num' },
      h('b', { class: 'num' }, num(Math.abs(left))),
      h('span', {}, over ? N_(-left, 'day since it ended', 'days since it ended') : N_(left, 'day left', 'days left')),
      h('span', { class: 'until-sub' }, fmt(over ? _('ended %s') : _('until %s'), day(p.expires))),
    ),
    cal,
  );
}

/** «Date»: the system's date picker over a chip; the date picked is set in one tap. */
function dateChip(c: PersonCtx): HTMLElement {
  const input = h('input', { type: 'date', class: 'date-hidden', tabindex: '-1', 'aria-hidden': 'true', min: c.today }) as HTMLInputElement;
  if (c.p.expires) input.value = c.p.expires;
  input.addEventListener('change', () => {
    if (input.value && input.value !== c.p.expires) void setEnd(c.acts, c.p, input.value);
  });
  const b = h('button', { type: 'button', class: 'chipb act' }, _('Date'));
  b.addEventListener('click', () => {
    // Focused first: a background repaint leaves a block holding the focus (and its open picker) alone.
    input.focus({ preventScroll: true });
    try {
      input.showPicker();
    } catch {
      /* focused is the best this browser offers */
    }
  });
  return h('span', { class: 'datechip', 'data-key': 'date' }, b, input);
}

export function termBlock(c: PersonCtx): HTMLElement {
  const p = c.p;
  // no end date: the head says so, the card is the moves alone
  const block = p.expires ? untilBlock(c) : null;
  if (!c.write) return h('div', { class: 'card kt-term' }, block);
  // a move: its name, and where it leads as its second line
  const move = (key: string, label: string, to: string | null, run: () => void) =>
    h(
      'button',
      { type: 'button', class: `chipb act kt-mv${to ? ' two' : ''}`, 'data-key': key, onclick: run },
      h('span', { class: 'kt-mv-l' }, label),
      to ? h('span', { class: 'kt-mv-to num' }, to) : null,
    );
  const row = (key: string, ...kids: (HTMLElement | null)[]) => {
    const k = kids.filter((x): x is HTMLElement => !!x);
    return k.length ? h('div', { class: 'kt-ext-r', 'data-key': key }, ...k) : null;
  };
  // the month on is the head's one action when the end is near or passed: one place per action
  const headExtends = personLine(p, { today: c.today, now: c.now() }).act?.id === 'extend';
  const m1 = monthOn(p, c.today);
  const m3 = monthsOn(p, c.today, 3);
  const until = (d: string) => fmt(_('until %s'), shortDay(d));
  const moves = h(
    'div',
    { class: 'kt-ext' },
    row(
      'add',
      headExtends ? null : move('m1', plural(1, '+%s month', '+%s months'), until(m1), () => void setEnd(c.acts, p, m1)),
      move('m3', plural(3, '+%s month', '+%s months'), until(m3), () => void setEnd(c.acts, p, m3)),
    ),
    row('set', dateChip(c), p.expires ? move('none', _('No end date'), null, () => void setEnd(c.acts, p, '')) : null),
  );
  return h('div', { class: 'card kt-term' }, block, moves);
}
