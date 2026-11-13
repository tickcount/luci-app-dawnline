// The Log's feed: days as groups, each a head that stays in sight while its rows scroll, over a raised card of the
// feed's rows (widgets/feed.ts draws them; here the time is their first column and the server a quiet word at a
// row's end, styles/shadow/log.css `lg-*`). Under them «Show more»; and what stands in the feed's place when
// nothing shows: no entry fits the filters (with the way to take them off), or the log is empty.

import { h } from '../../../portal/dom';
import { fmt, num } from '../../../shared/i18n';
import { dayTitle } from '../../events/clock';
import { byDay, type FeedItem } from '../../events/sessions';
import { emptyState } from '../../ui/empty';
import { secHead } from '../../ui/page-head';
import { feedRows, type FeedContext } from '../../widgets/feed';

/** The rows under their days' heads; `today`: the router's day now. */
export function dayGroups(c: FeedContext, items: FeedItem[], today: string): HTMLElement[] {
  return byDay(items, c.tz).map((g) => {
    const rows = feedRows(c, g.items);
    // the server leaves the sentence: one column at the rows' end
    for (const s of rows.querySelectorAll<HTMLElement>('.ev-srv')) {
      s.classList.add('lg-srv');
      s.closest('.ev')?.append(s);
    }
    const head = secHead(dayTitle(g.day, today), num(g.items.length));
    head.classList.add('lg-dh');
    return h('section', { class: 'grp lg-day', 'data-key': g.day }, head, h('div', { class: 'card flat-list' }, rows));
  });
}

/** «Show 300 more of 1,240»: `rest` rows are not drawn yet, `page` come with a press. */
export function moreRow(rest: number, page: number, more: () => void): HTMLElement {
  const b = h(
    'button',
    { type: 'button', class: 'btn soft' },
    h('span', {}, fmt(_('Show %s more of %s'), num(Math.min(page, rest)), num(rest))),
  );
  b.addEventListener('click', more);
  return h('div', { class: 'more-row' }, b);
}

/** Nothing to show. `any`: the log has entries, none of them fits (`text`: the search, when that is why). */
export function nothing(o: { any: boolean; text: string; reset: () => void }): HTMLElement {
  if (!o.any) return emptyState({ icon: 'log', title: _('The log is empty.'), text: _('Entries appear when someone connects.') });
  const b = h('button', { type: 'button', class: 'btn soft sm' }, h('span', {}, _('Reset the filters')));
  b.addEventListener('click', o.reset);
  return emptyState({
    icon: 'log',
    title: o.text ? fmt(_('Nothing matches “%s”.'), o.text) : _('No such entries'),
    text: _('No log entry fits these filters.'),
    action: b,
  });
}
