// The notices over the People list: what stops many people at once is said once, not on each of their cards. A
// server that is turned off and has people: «Server Dacha is turned off · 1 person without access · Turn on». A
// rollout: «New configuration · 4 people have not fetched it yet · Who waits» (the last narrows
// the list to them, the «Waiting for a new configuration» chip). Their cards say only a quiet line (the server) or
// a warn tile (the rollout). On a phone two or more notices fold into one line («Server Dacha is turned off · New
// configuration for 4») that unfolds on a tap: they would take a screen before the list begins.

import { refill, unfold } from '../../ui/reshape';
import type { Status } from '../../../shared/types';
import { h } from '../../../portal/dom';
import { once } from '../../../portal/ui/feedback';
import { fmt, plural } from '../../../shared/i18n';
import { glass } from '../../ui/glass';
import { ic } from '../../ui/icons';
import { waitsForConfig } from '../../people/roster';
import type { ActCtx } from '../../people/ctx';
import { serverOn } from '../../flows/person-acts';

export interface NoticeCtx {
  write: boolean;
  acts: ActCtx;
  /** Narrow the list to the people the rollout waits on. */
  waiting(): void;
}

/** The notices (their words for the folded line beside each), for the people the page has. */
function notices(st: Status, c: NoticeCtx): { el: HTMLElement; short: string }[] {
  const out: { el: HTMLElement; short: string }[] = [];
  for (const s of st.servers) {
    if (s.enabled) continue;
    const n = st.people.filter((p) => p.server === s.id).length;
    if (!n) continue;
    const on = c.write
      ? (h('button', { type: 'button', class: 'btn tint sm' }, ic('play'), h('span', {}, _('Turn on'))) as HTMLButtonElement)
      : null;
    on?.addEventListener('click', () => void once(on, () => serverOn(c.acts, s)));
    const title = fmt(_('Server %s is turned off'), s.name);
    out.push({
      short: title,
      el: h(
        'div',
        { class: 'notice warn pp-notice', role: 'status' },
        glass('server', 'orange'),
        h('div', { class: 't' }, h('b', {}, title), h('span', {}, plural(n, '%s person without access', '%s people without access'))),
        on ? h('span', { class: 'pp-notice-acts' }, on) : null,
      ),
    });
  }
  const who = st.people.filter(waitsForConfig).length;
  if (who) {
    const list = h('button', { type: 'button', class: 'btn soft sm' }, h('span', {}, _('Who waits')));
    list.addEventListener('click', () => c.waiting());
    out.push({
      short: plural(who, 'New configuration for %s', 'New configuration for %s'),
      el: h(
        'div',
        { class: 'notice warn pp-notice', role: 'status' },
        glass('refresh', 'orange'),
        h(
          'div',
          { class: 't' },
          h('b', {}, _('New configuration')),
          h('span', {}, plural(who, '%s person has not fetched it yet', '%s people have not fetched it yet')),
        ),
        h('span', { class: 'pp-notice-acts' }, list),
      ),
    });
  }
  return out;
}

/** The notices over the list, in `box` (emptied when there are none); `open`: a phone's fold stays unfolded. */
export function paintNotices(box: HTMLElement, st: Status, c: NoticeCtx) {
  const ns = notices(st, c);
  const key = JSON.stringify(ns.map((n) => n.el.textContent));
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  const open = box.classList.contains('open');
  box.classList.toggle('many', ns.length > 1);
  // notices that come or go unfold and fold (ui/reshape.ts)
  if (!ns.length) return void refill(box, []);
  const fold = h(
    'button',
    { type: 'button', class: 'pp-nfold', 'aria-expanded': String(open) },
    glass('pulse', 'orange'),
    h('span', { class: 'pp-nfold-t' }, ns.map((n) => n.short).join('\u00a0· ')),
    ic('chevron', 'i pp-nfold-c'),
  );
  const list = h('div', { class: 'pp-nlist' }, ...ns.map((n) => n.el));
  // shown by a class the stylesheet reads only on a phone (wider, the notices always stand): it unfolds and folds
  // as an accordion's row does (ui/reshape.ts)
  box.classList.toggle('shows', open);
  fold.addEventListener('click', () => {
    const now = !box.classList.contains('open');
    box.classList.toggle('open', now);
    fold.setAttribute('aria-expanded', String(now));
    if (getComputedStyle(fold).display === 'none') return void box.classList.toggle('shows', now);
    unfold(list, now, { is: () => box.classList.contains('shows'), set: (v) => box.classList.toggle('shows', v) });
  });
  refill(box, [fold, list]);
}
