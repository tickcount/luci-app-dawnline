// Overview › Waiting for a decision: the first people of People's «Needs a
// decision» group (overview/model.ts waitRows: the same people in the same
// order, five rows, three on a phone), each a row: the face in the state's
// tone, the name, their card's state line, and beside the link their card's
// one action (people/card.ts; flows/person-acts.ts: done at once and said in
// a toast with Undo, or its sheet). The head counts everyone who waits; «N more» leads to People
// filtered to them. Nobody waits: the empty state says so. A read-only login
// gets the rows without the actions.

import type { Person } from '../../../shared/types';
import { h } from '../../../portal/dom';
import { once } from '../../../portal/ui/feedback';
import { fmt, num } from '../../../shared/i18n';
import { ic } from '../../ui/icons';
import { face } from '../../ui/face';
import { emptyState } from '../../ui/empty';
import { secHead } from '../../ui/page-head';
import { peopleAt, personUrl } from '../../shell/routes';
import { cardParts } from '../../people/card';
import { actButton, runAct } from '../../flows/person-acts';
import { waitRows } from '../../overview/model';
import type { OverviewCtx } from './ctx';

/** Their card's parts (the server's name is in its words). */
const partsOf = (c: OverviewCtx, p: Person) =>
  cardParts(
    p,
    c.st.servers.find((s) => s.id === p.server),
    c.today(),
  );

function row(c: OverviewCtx, p: Person): HTMLElement {
  const parts = partsOf(c, p);
  const text = parts.line ?? '';
  return h(
    'div',
    { class: 'orow', 'data-id': p.id },
    h(
      'a',
      { class: 'orow-a', href: personUrl(p.id), 'aria-label': `${p.name}: ${text}` },
      face(p.name, parts.tone),
      h(
        'span',
        { class: 'orow-t' },
        h('b', { title: p.name }, p.name),
        h('span', { class: `orow-l${parts.tone ? ` ${parts.tone}-t` : ''}`, title: parts.title || null }, text),
      ),
    ),
    h('span', { class: 'act-slot' }, c.write && parts.action ? actButton(parts.action) : null),
  );
}

/** The section's head and its rows; `narrow`: the page is a phone's width. */
export function waitList(c: OverviewCtx, narrow: boolean): HTMLElement[] {
  const w = waitRows(c.st.people, c.today(), narrow);
  if (!w.total)
    return [
      secHead(_('Waiting for a decision')),
      emptyState({
        icon: 'people',
        title: _('Nobody waits for a decision'),
        text: _('Everyone’s terms, limits and connections are in order.'),
      }),
    ];
  return [
    secHead(
      _('Waiting for a decision'),
      num(w.total),
      w.more > 0
        ? h('a', { class: 'pill-link', href: peopleAt({ group: 'need' }) }, fmt(_('%s more'), num(w.more)), ic('chevron'))
        : undefined,
    ),
    h('div', { class: 'olist ov-waitlist' }, ...w.rows.map((p) => row(c, p))),
  ];
}

/**
 * A person's one action, from any row of `box` (a button beside the row's link), as the People table runs it;
 * `ctx`: the page's newest answer.
 */
export function waitActions(box: HTMLElement, ctx: () => OverviewCtx) {
  box.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.act-slot .btn[data-act]');
    const c = ctx();
    const p = c.st.people.find((x) => x.id === b?.closest<HTMLElement>('.orow')?.dataset.id);
    if (!b || !p) return;
    const act = partsOf(c, p).action;
    if (act)
      void once(b, () =>
        runAct(act, p, { st: () => ctx().st, today: () => ctx().today().today, now: () => ctx().now(), reload: () => ctx().reload() }),
      );
  });
}
