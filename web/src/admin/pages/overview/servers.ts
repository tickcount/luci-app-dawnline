// Overview › Servers: a card a server, the door to its page. Its row: the
// server as its page's head names it (its name; whether it runs,
// servers/state.ts, and the address devices connect to in one line under
// it), then its figures as named cells that stand in the same columns on
// every card: People, who of them waits for a decision (only while someone
// on some server does), the speed to the devices now and what moved today
// (overview/model.ts serverNumbers). One that is off has «Turn on» beside
// them: done at once and said in a toast with Undo.
// Under a server whose devices wait for a new configuration, its rollout in
// short: the count, the change it follows, a cell a device (widgets/rollout.ts
// rolloutCells), the first who still wait as chips that lead to their
// devices' panels, and the rest in People filtered to them. The whole rollout,
// with the portal-link knobs, is in Settings. A read-only login gets no
// «Turn on».

import type { Server } from '../../../shared/types';
import { h } from '../../../portal/dom';
import { once } from '../../../portal/ui/feedback';
import { rateOf, bytes } from '../../../shared/format';
import { fmt, num, plural } from '../../../shared/i18n';
import { api } from '../../api';
import { glass } from '../../ui/glass';
import { ic } from '../../ui/icons';
import { secHead } from '../../ui/page-head';
import { fill, rows } from '../../state/regions';
import { errorText, notify } from '../../ui/toast';
import { say } from '../../shell/toast';
import { deviceUrl, peopleUrl, serverUrl } from '../../shell/routes';
import { movePerson } from '../../flows/move-person';
import { compList, compRow } from '../../ui/comp-row';
import { newServer } from '../../flows/new-server';
import { serverState } from '../../servers/state';
import { changeLine, rollout, rolloutItems } from '../../servers/rollout';
import { rolloutCells } from '../../widgets/rollout';
import { serverNumbers, stillWaiting, waiting } from '../../overview/model';
import type { OverviewCtx } from './ctx';
import { putChildren } from '../../../portal/ui/put';

const first = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** Turn a server on or off; false when the router refused (said in a toast). */
async function setEnabled(s: Server, on: boolean): Promise<boolean> {
  try {
    await api.serverUpdate(s.id, { enabled: on ? '1' : '0' });
    return true;
  } catch (e) {
    notify(errorText(e), 'error', 10000);
    return false;
  }
}

/** «Turn on» for a server that is off: one tap, undone from its toast (nothing is cut off by turning it on). */
function turnOn(c: OverviewCtx, s: Server): HTMLElement {
  const b = h('button', { type: 'button', class: 'btn tint sm' }, ic('play'), h('span', {}, _('Turn on'))) as HTMLButtonElement;
  b.addEventListener('click', () =>
    once(b, async () => {
      if (!(await setEnabled(s, true))) return;
      say(fmt(_('Server %s turned on'), s.name), {
        undo: () => void setEnabled(s, false).then((ok) => void (ok && c.reload())),
        undone: fmt(_('Server %s turned off again'), s.name),
      });
      await c.reload();
    }),
  );
  return b;
}

/** The rollout in short, under the server's row; null: none of its devices waits. */
function rolloutShort(c: OverviewCtx, s: Server): HTMLElement | null {
  const st = c.st;
  const r = rollout(st.people, s.id);
  if (!r) return null;
  const all = rolloutItems(st.people, s.id);
  const w = stillWaiting(all);
  const change = changeLine(c.sl?.log ?? [], s, c.now(), st.tz);
  return h(
    'div',
    { class: 'ov-roll' },
    h(
      'div',
      { class: 'ov-roll-h' },
      ic('refresh'),
      h('b', { class: 'num' }, fmt(_('New configuration: %s of %s'), r.done, r.of)),
      change ? h('span', { class: 'ov-roll-ch' }, change) : null,
    ),
    rolloutCells(all),
    h(
      'div',
      { class: 'ov-roll-f' },
      h(
        'div',
        { class: 'ov-waiters' },
        h('span', { class: 'ov-lbl' }, _('Waiting:')),
        ...w.named.map((x) =>
          h(
            'a',
            { class: 'kt-chip', href: deviceUrl(x.d.id), title: `${x.d.name} · ${x.p.name}` },
            ic(x.d.kind),
            h('span', {}, `${x.d.name} · ${first(x.p.name)}`),
          ),
        ),
        w.more
          ? h(
              'a',
              { class: 'kt-chip more', href: peopleUrl(s.id, 'config') },
              h('span', {}, fmt(_('and %s more'), num(w.more))),
              ic('chevron'),
            )
          : null,
      ),
    ),
  );
}

/** A figure of the row: its name over it (`tone`: the value's, when it asks for attention). */
const fig = (label: string, value: string | null, tone = '', key?: string): HTMLElement =>
  h(
    'span',
    { class: 'ov-fig' },
    h('span', { class: 'ov-fig-l' }, label),
    value === null
      ? h('b', { class: 'ov-none', 'aria-label': _('none') }, '—')
      : h('b', { class: `num${tone ? ` ${tone}-t` : ''}`, 'data-t': key ?? null }, value),
  );

/** The key of a server's «Now» on its card: the page says its speed there as the meter reads it (index.ts). */
export const NOW_KEY = 'now:';

/** How many people of a server wait for a decision. */
const waitingOn = (c: OverviewCtx, s: Server): number =>
  waiting(
    c.st.people.filter((x) => x.server === s.id),
    c.today(),
  ).length;

function serverCard(c: OverviewCtx, s: Server): HTMLElement {
  const st = c.st;
  // the cells stand in the same columns on every card: «Waiting» has its column while anyone on any server waits
  const anyWait = st.servers.some((x) => waitingOn(c, x) > 0);
  const line = serverState(s);
  const n = serverNumbers(s, st, c.today().today);
  // its speed as the meter has it this moment, once it answers; before that the router's last minute
  const live = s.enabled && s.up ? c.speedOf(s.id) : null;
  const down = live ?? n.down;
  // the card is the door to the server's own page: its Overview, people, places and settings
  const to = serverUrl(s.id);
  // who on it waits for a decision: counted here, listed on its page
  const wait = waitingOn(c, s);
  const row = h(
    'div',
    { class: 'orow ov-srow' },
    h(
      'a',
      { class: 'orow-a', href: to },
      glass('server', s.enabled && s.up ? 'blue' : 'grey'),
      h(
        'span',
        { class: 'orow-t' },
        h('b', { title: s.name }, s.name),
        // as the server's page head says it: its state, then where devices connect
        h(
          'span',
          { class: 'orow-l ov-sline' },
          h('span', { class: `${line.tone}-t`, 'data-live': '' }, line.text),
          h('span', { class: 'ov-addr mono', title: _('Address for devices') }, `${s.endpoint || _('no address')}:${s.port}`),
        ),
      ),
    ),
    // «Turn on» stands between the name and the figures, so the figures keep their columns on every card
    c.write && !s.enabled ? h('span', { class: 'act-slot ov-on' }, turnOn(c, s)) : null,
    // the figures lead to the server as the name does (the keyboard has the name's link)
    h(
      'a',
      { class: 'ov-figs', href: to, tabindex: '-1' },
      fig(_('People'), num(n.people)),
      anyWait ? fig(_('Waiting for a decision'), wait ? num(wait) : null, 'warn') : null,
      fig(_('Now', 'speed'), down === null ? null : `↓ ${rateOf(down)}`, '', NOW_KEY + s.id),
      fig(_('Today'), n.today === null ? null : bytes(n.today)),
    ),
    h('a', { class: 'orow-go', href: to, tabindex: '-1', 'aria-hidden': 'true' }, ic('chevron')),
  );
  return h('div', { class: 'ov-server' }, row, rolloutShort(c, s));
}

/**
 * The section's head (with the way to add a server) and a card a server; under them the people no server holds
 * (theirs was removed): the one thing of people Overview keeps, each with the way to choose them a server.
 * Put into `box` once; each part then follows what it reads (state/regions.ts): the head the servers' count,
 * a card its own server and what it counts of its people.
 */
export function serversSection(c: OverviewCtx, box: HTMLElement): void {
  const head = h('div', { class: 'ov-srv-h' });
  const cards = h('div', { class: 'ov-servers' });
  const lost = h('div', { class: 'ov-srv-lost' });
  putChildren(box, [head, cards, lost]);
  const add = c.write
    ? h(
        'button',
        { type: 'button', class: 'btn soft sm', onclick: () => newServer(() => api.setupDefaults(), true) },
        ic('plus'),
        h('span', {}, _('Add server')),
      )
    : null;
  fill(head, () => secHead(_('Servers'), num(c.st.servers.length), add));
  rows(
    cards,
    () => c.st.servers,
    (s) => s.id,
    (s) => serverCard(c, s),
  );
  // people no server holds (theirs was removed): the one thing of people Overview keeps
  fill(lost, () => {
    const servers = c.st.servers;
    const none = c.st.people.filter((x) => !servers.some((s) => s.id === x.server));
    return none.length
      ? h(
          'div',
          { class: 'ov-lost' },
          secHead(_('No server'), num(none.length)),
          compList(
            ...none.map((x) =>
              compRow({
                icon: 'person',
                tone: 'red',
                title: x.name,
                line: fmt(_('%s: no server, no access'), plural(x.devices.length, '%s device', '%s devices')),
                lineTone: 'bad',
                acts: [
                  c.write
                    ? h(
                        'button',
                        {
                          type: 'button',
                          class: 'btn tint sm',
                          onclick: () => movePerson({ person: x, st: c.st, moved: () => void c.reload() }),
                        },
                        ic('terminal'),
                        h('span', {}, _('Choose a server')),
                      )
                    : null,
                ],
              }),
            ),
          ),
        )
      : null;
  });
}
