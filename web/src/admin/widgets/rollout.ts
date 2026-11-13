// The rollout of a new configuration, open on the page: how many devices of
// a server have fetched it, the change it follows and when, one cell a device
// (done first, waiting after; a meter past 60 devices), who has not fetched it
// yet (each a link to its device's panel, with a knob that copies its
// person's portal link, where they fetch it) and the way to People filtered
// to them. Settings shows the whole strip while anyone waits; Overview's
// server cards use its cells in their own short form. Read-only logins get no
// link knobs (a portal link hands out a configuration). Nobody waits: nothing
// is shown. No «Remind everyone» (the owner removed it, 2026-11-11): a person
// is reminded with their own link, from their row.

import type { Server, Status } from '../../shared/types';
import { api, type ServiceLogEntry } from '../api';
import { h } from '../../portal/dom';
import { ago } from '../../shared/format';
import { fmt, plural } from '../../shared/i18n';
import { glass } from '../ui/glass';
import { ic } from '../ui/icons';
import { copyText } from '../ui/files';
import { deviceUrl, peopleUrl } from '../shell/routes';
import { changeLine, rolloutItems, type RolloutItem } from '../servers/rollout';

/** Rows shown before «and N more». */
const ROWS = 6;
/** More devices than this: the strip is a meter (cells under 3 px stop reading as cells). */
const CELLS = 60;

export interface RolloutCtx {
  st: Pick<Status, 'people' | 'tz'>;
  srv: Server;
  log: ServiceLogEntry[];
  now: number;
  /** This login may hand out portal links. */
  write: boolean;
}

const first = (name: string) => name.split(' ')[0];

/** One cell a device, those that fetched first; past 60 devices one meter. */
export function rolloutCells(all: RolloutItem[]): HTMLElement {
  const done = all.filter((i) => !i.d.config_stale);
  const says = fmt(_('Fetched: %s of %s'), done.length, all.length);
  if (all.length > CELLS) {
    const fill = h('i', {});
    fill.style.width = `${(done.length / all.length) * 100}%`;
    return h('div', { class: 'ro-meter', role: 'img', 'aria-label': says }, fill);
  }
  return h(
    'div',
    { class: 'ro-strip', role: 'img', 'aria-label': says },
    ...[...done, ...all.filter((i) => i.d.config_stale)].map((it) =>
      h('i', { class: `ro-c${it.d.config_stale ? '' : ' done'}`, title: `${it.d.name} · ${first(it.p.name)}` }),
    ),
  );
}

/** A device that still waits: a link to its panel, with the knob that copies its person's portal link. */
function waitingRow(c: RolloutCtx, it: RolloutItem): HTMLElement {
  const who = first(it.p.name);
  const k = c.write
    ? h(
        'button',
        {
          type: 'button',
          class: 'knob ro-k',
          'aria-label': fmt(_('Copy the portal link: %s'), who),
          title: fmt(_('Portal link · %s'), who),
        },
        ic('link'),
      )
    : null;
  k?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    void api.personLinks(it.p.id).then((r) => (r.link ? copyText(r.link, fmt(_('Portal link · %s copied'), who)) : false));
  });
  return h(
    'a',
    { class: 'ro-i', href: deviceUrl(it.d.id) },
    glass(it.d.kind, 'grey'),
    h(
      'span',
      { class: 'ro-it' },
      h('b', {}, `${it.d.name} · ${who}`),
      h(
        'span',
        {},
        it.d.online
          ? _('Online now, on the old configuration')
          : it.d.handshake
            ? fmt(_('Last seen %s'), ago(it.d.handshake, c.now))
            : _('No connections yet'),
      ),
    ),
    k,
  );
}

/** The whole strip as a section of a page (`data-id="rollout"`), or null: nobody waits. */
export function rolloutStrip(c: RolloutCtx): HTMLElement | null {
  const all = rolloutItems(c.st.people, c.srv.id);
  const waiting = all.filter((i) => i.d.config_stale);
  if (!waiting.length) return null;
  const done = all.length - waiting.length;
  const change = changeLine(c.log, c.srv, c.now, c.st.tz);
  const rest = waiting.length - ROWS;
  return h(
    'section',
    { class: 'card roo', 'data-id': 'rollout', 'aria-label': _('New configuration') },
    h(
      'div',
      { class: 'roo-h' },
      h('span', { class: 'roo-ic', 'aria-hidden': 'true' }, ic('refresh')),
      h(
        'div',
        { class: 'roo-t' },
        h('h2', { class: 'num roo-n', tabindex: '-1' }, fmt(_('New configuration: %s of %s'), done, all.length)),
        h('span', {}, change ?? _('Devices fetch it by their own portal link')),
      ),
      h(
        'div',
        { class: 'roo-a' },
        h('a', { class: 'pill-link', href: peopleUrl(c.srv.id, 'config') }, h('span', {}, _('All in People')), ic('chevron')),
      ),
    ),
    rolloutCells(all),
    h('span', { class: 'ro-lbl' }, `${_('Not fetched yet')} · ${waiting.length}`),
    h('div', { class: 'roo-list' }, ...waiting.slice(0, ROWS).map((it) => waitingRow(c, it))),
    rest > 0 ? h('span', { class: 'ro-more' }, plural(rest, 'And %s more device', 'And %s more devices')) : null,
  );
}
