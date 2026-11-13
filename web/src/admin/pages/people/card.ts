// A person's card in the People list: the portal's device card (.dev, raised, radius 28, padding 8; a top row and
// field blocks of radius 20) with the parts people/card.ts gives this person's state, nothing else. The head: the
// face (blue ring while online; a decision's tone in «Needs a decision»), the name (a link to their page, its hit
// area stretched over the card), up to three device tiles and «+N» (a dot on those online, warn on a fault or a
// configuration to fetch; each tile names its device in the tooltip and leads to it), ⋯. Under the name the one state
// line in its tone with «· N more», and what the search found them by. Then presence (for how long, the week's hours,
// the live speed with its line while online), traffic (the week and the month beside the week's bars, read a day
// at a time; the limit's bar from 50 %), and the one action as the card's block button. A read-only login: no
// action, no ⋯.

import type { Device, GeoPoint, Pair, Person, Status } from '../../../shared/types';
import { h, type Kid } from '../../../portal/dom';
import { openMenu, type MenuItem } from '../../../portal/ui/menu';
import { once } from '../../../portal/ui/feedback';
import { bars, readBars } from '../../../portal/ui/bars';
import { setText } from '../../../portal/ui/morph';
import { bytes } from '../../../shared/format';
import { fmt, locale, plural } from '../../../shared/i18n';
import { ic } from '../../ui/icons';
import { face } from '../../ui/face';
import { meter } from '../../ui/meter';
import { tip } from '../../../portal/ui/tip';
import { liveLine, type LiveLine } from '../../widgets/live-line';
import { deviceUrl, personUrl } from '../../shell/routes';
import { visit } from '../../shell/visit';
import { routerDay, routerTime } from '../../events/clock';
import { ofLimit, type CardParts } from '../../people/card';
import { deviceLine } from '../../people/diagnosis';
import { litAt, type Match } from '../../people/find';
import type { Presence } from '../../people/presence';
import type { ActCtx } from '../../people/ctx';
import { actButton, pause, runAct } from '../../flows/person-acts';
import { showSetup } from '../../flows/setup';
import { openInvite } from '../../flows/invite';
import { addDevice } from '../../flows/add-device';

const DAY = 86400;
const H = 3600;
const MAX_TILES = 3;

/** What a card is drawn from. */
export interface CardData {
  p: Person;
  parts: CardParts;
  /** Their presence from the log; null while it is read. */
  pres: Presence | null;
  place: GeoPoint | null;
  match: Match | null;
  words: string[];
  /** The card's width (px): how many tiles leave the name its room. */
  width: number;
}

/** What the cards read of the page. */
export interface CardsCtx {
  st(): Status;
  now(): number;
  write: boolean;
  acts: ActCtx;
}

/** A card's live speed: its devices online, where the number and the line go. */
export interface Live {
  ids: string[];
  speed: HTMLElement;
  line: LiveLine;
}

/** `text` with the searched word lit. */
function lit(text: string, ws: string[]): Kid[] {
  const at = litAt(text, ws);
  return at ? [text.slice(0, at[0]), h('mark', { class: 'kt-hl' }, text.slice(at[0], at[0] + at[1])), text.slice(at[0] + at[1])] : [text];
}

/** What a found value is, after it. */
const whatLabel = (w: Match['what']): string =>
  ({ name: _('device'), address: _('address in the tunnel'), hostname: _('name in the network'), ip: _('client IP') })[w];

/** What the search found them by: the device and the value (never cut: the device's name gives way), a link to it. */
function foundLine(m: Match | null, ws: string[]): HTMLElement | null {
  if (!m) return null;
  return h(
    'a',
    {
      class: 'pp-found',
      href: deviceUrl(m.device.id),
      title: `${fmt(_('Open the device %s'), m.device.name)} · ${m.value} · ${whatLabel(m.what)}`,
    },
    ic('search'),
    ...(m.what === 'name'
      ? [h('span', {}, ...lit(m.device.name, ws))]
      : [h('span', { class: 'mono pp-found-v' }, ...lit(m.value, ws)), h('span', {}, m.device.name)]),
    h('span', { class: 'pp-found-w' }, whatLabel(m.what)),
  );
}

/** «06:59» today, else «Tue 21:10» (router time). */
function when(ts: number, now: number, tz?: number): string {
  const day = routerDay(ts, tz);
  if (day === routerDay(now, tz)) return routerTime(ts, tz);
  const wd = new Date(Date.parse(`${day}T12:00:00Z`)).toLocaleDateString(locale(), { weekday: 'short', timeZone: 'UTC' });
  return `${wd} ${routerTime(ts, tz)}`;
}

/** How long, short: «12 min», «3 h», «10 days». */
function howLong(sec: number): string {
  // one unit, short: the line stands beside the speed in half a card and must not wrap
  if (sec >= DAY) return fmt(_('%sd'), Math.floor(sec / DAY));
  if (sec >= H) return fmt(_('%sh'), Math.floor(sec / H));
  return fmt(_('%sm'), Math.max(1, Math.floor(sec / 60)));
}

/** A weekday's short name in the router's time. */
const weekday = (ts: number, tz?: number): string =>
  new Date(Date.parse(`${routerDay(ts, tz)}T12:00:00Z`)).toLocaleDateString(locale(), { weekday: 'short', timeZone: 'UTC' });

/** The devices with a fault or a configuration to fetch first, then the rest: «+N» never hides a warn tile. */
function tileOrder(p: Person, pres: Presence | null): Device[] {
  const list = pres
    ? pres.devices.map((x) => x.d)
    : [...p.devices].sort((a, b) => Number(b.online) - Number(a.online) || b.handshake - a.handshake);
  const warn = (d: Device) => !d.disabled && (!!d.link || (d.config_stale && !!d.handshake));
  return [...list.filter(warn), ...list.filter((d) => !warn(d))];
}

/** The tiles that leave the name about 96 px of a card `width` wide (a write login has ⋯ too), at most three. */
function tileCount(name: string, width: number, write: boolean): number {
  const nameW = Math.min(112, 16 + name.length * 8.6);
  return Math.max(1, Math.min(MAX_TILES, Math.floor((width - 88 - (write ? 44 : 0) - nameW - 26) / 29)));
}

function tiles(c: CardsCtx, d: CardData): HTMLElement {
  const { p } = d;
  const list = tileOrder(p, d.pres);
  const n = tileCount(p.name, d.width, c.write);
  const shown = list.slice(0, list.length > n ? n : list.length);
  const rest = list.slice(shown.length);
  const st = c.st();
  const words = (x: Device) => `${x.name} · ${deviceLine(x, p, { now: c.now(), today: routerDay(c.now(), st.tz), tz: st.tz }).text}`;
  const box = h('span', { class: 'pp-tiles' });
  for (const x of shown) {
    const warn = !x.disabled && (!!x.link || (x.config_stale && !!x.handshake));
    const t = h(
      'a',
      {
        class: `pp-tile${x.online ? ' on' : ''}${x.disabled ? ' off' : ''}${warn ? ' warn' : ''}`,
        href: deviceUrl(x.id),
        'aria-label': words(x),
      },
      ic(x.kind),
    );
    tip(t, () => words(x));
    box.append(t);
  }
  if (rest.length) {
    const more = h(
      'button',
      { type: 'button', class: 'pp-tile more num', 'aria-label': rest.map((x) => x.name).join(', ') },
      `+${rest.length}`,
    );
    tip(more, () => `${rest.map((x) => x.name).join(', ')} · ${fmt(_('%s online'), rest.filter((x) => x.online).length)}`);
    box.append(more);
  }
  return box;
}

/** ⋯: open, the set-up of a device that waits for it, their link, a device, pause or resume. */
function menu(c: CardsCtx, p: Person, from: HTMLElement) {
  const st = c.st();
  const srv = st.servers.find((s) => s.id === p.server);
  const reload = () => void c.acts.reload();
  const mid: MenuItem[] = p.devices
    .filter((x) => x.config_stale && x.handshake && !x.disabled)
    .slice(0, 2)
    .map((x) => ({
      label: fmt(_('Show set-up · %s'), x.name),
      icon: 'qr',
      run: () => void showSetup({ person: p, device: x, now: c.now, done: reload }).then(reload),
    }));
  if (p.has_link)
    mid.push({
      label: p.devices.length ? _('Link') : _('Invite'),
      icon: 'link',
      run: () => void openInvite({ person: p, server: srv?.name ?? '', changed: reload }),
    });
  if (srv)
    mid.push({
      label: _('Add device'),
      icon: 'plus',
      run: () => addDevice({ person: p, server: srv, now: c.now, added: reload, people: st.people, servers: st.servers }),
    });
  openMenu(
    from,
    [
      { label: _('Open'), icon: 'open', run: () => visit(personUrl(p.id)) },
      ...(mid.length ? [null, ...mid] : []),
      null,
      p.paused
        ? { label: _('Resume'), icon: 'play', run: () => void pause(c.acts, p, false) }
        : { label: _('Pause'), icon: 'pause', tone: 'warn', run: () => void pause(c.acts, p, true) },
    ],
    p.name,
  );
}

/** Presence: since when (or how long not) and from where, the week's hours under it, the speed while online. */
function presenceBlock(c: CardsCtx, d: CardData, lives: Live[]): HTMLElement {
  const { p, pres, parts } = d;
  const now = c.now();
  const tz = c.st().tz;
  const city = d.place ? d.place.city || d.place.country || '' : '';
  let speed: HTMLElement | null = null;
  const on = parts.presence === 'online';
  if (on) {
    const n = h('b', { class: 'pp-spd num' });
    const line = liveLine(22);
    speed = h('span', { class: 'pp-speed' }, n, line.el);
    lives.push({ ids: p.devices.filter((x) => x.online).map((x) => x.id), speed: n, line });
  }
  const place = d.place ? [city, d.place.org].filter(Boolean).join(' · ') : '';
  // for how long, as «Offline for …» beside it says (the owner, 2026-11-11: «Online since Tue 07:01» took two
  // lines); since when exactly is the line's title
  const since = on && pres?.since ? fmt(_('Online since %s'), when(pres.since, now, tz)) : '';
  const value = on
    ? h(
        'span',
        { class: 'use-val pp-nowv ok-t', title: [since, place].filter(Boolean).join(' · ') || null },
        pres?.since ? fmt(_('Online for %s'), howLong(now - pres.since)) : _('Online'),
      )
    : h(
        'span',
        { class: 'use-val pp-nowv pp-two', title: place || null },
        h('span', {}, fmt(_('Offline for %s'), howLong(now - p.last_seen))),
        city ? h('span', { class: 'pp-city' }, ` · ${city}`) : null,
      );
  const week = pres ? weekWords(pres.week) : ' ';
  return h('div', { class: 'dev-use pp-now' }, h('div', { class: 'use-txt' }, value, h('span', { class: 'use-lbl pp-sub' }, week)), speed);
}

/** «64 hours in 7 days» (online, under «Online for»). */
function weekWords(sec: number): string {
  if (sec >= H) return plural(Math.round(sec / H), '%s hour in 7 days', '%s hours in 7 days');
  return sec > 0 ? _('under an hour in 7 days') : _('not online in 7 days');
}

/** Traffic: the week and the month beside the week's bars (a day read at a time); the limit's bar from 50 %. */
function trafficBlock(c: CardsCtx, d: CardData): HTMLElement {
  const { p } = d;
  const now = c.now();
  const tz = c.st().tz;
  const week: Pair[] = Array.from({ length: 7 }, (_x, i) =>
    p.devices.reduce<Pair>((a, x) => [a[0] + (x.spark[i]?.[0] ?? 0), a[1] + (x.spark[i]?.[1] ?? 0)], [0, 0]),
  );
  const sum = week.reduce((n, x) => n + x[0] + x[1], 0);
  const lbl = h('span', { class: 'use-lbl' }, _('Last 7 days'));
  const val = h('span', { class: 'use-val num' }, bytes(sum));
  const chart = bars(week, 'bars-week', 34);
  readBars(chart, fmt(_('%s: traffic in the last 7 days'), p.name), (i) => {
    const day = i < 0 ? null : week[i];
    setText(lbl, !day ? _('Last 7 days') : i === week.length - 1 ? _('Today') : weekday(now - (week.length - 1 - i) * DAY, tz));
    setText(val, bytes(day ? day[0] + day[1] : sum));
  });
  // beside the week: what is used of the limit (their limit month, or all time) when it is said here, else the
  // last 30 days
  const of = d.parts.meter === 'of' ? fmt(_('of %s'), bytes(p.quota_limit)) : '';
  const month = of ? p.quota_used : p.month[0] + p.month[1];
  return h(
    'div',
    { class: 'dev-use pp-use' },
    h(
      'div',
      { class: 'pp-use-row' },
      h('div', { class: 'use-txt' }, lbl, val),
      h(
        'div',
        { class: 'use-txt pp-month' },
        h('span', { class: 'use-lbl' }, of ? _('Of the limit') : _('30 days')),
        h(
          'span',
          { class: 'use-val num', title: of ? `${bytes(month)} ${of}` : null },
          bytes(month),
          of ? h('span', { class: 'pp-of' }, ` ${of}`) : null,
        ),
      ),
      chart.el,
    ),
    d.parts.meter === 'bar'
      ? h(
          'div',
          { class: 'pp-lim' },
          h(
            'span',
            { class: 'pp-lim-t num' },
            h('b', {}, ofLimit(p.quota_used, p.quota_limit)),
            h('span', {}, p.quota_period === 'month' ? _('limit for the month') : _('limit for the whole term')),
          ),
          meter(p.quota_limit ? p.quota_used / p.quota_limit : 0),
        )
      : null,
  );
}

/** The card; its live speed, if any, is put in `lives`. */
export function personCard(c: CardsCtx, d: CardData, lives: Live[]): HTMLElement {
  const { p, parts } = d;
  const stat = parts.line
    ? h(
        'span',
        { class: `dev-stat pp-line${parts.tone ? ` ${parts.tone}-t` : ''}`, id: `pp-st-${p.id}`, title: parts.title || parts.line },
        h('span', { class: 'pp-line-t' }, parts.line),
        parts.more.length ? h('span', { class: 'pp-more' }, ` · ${fmt(_('%s more', 'problems'), parts.more.length)}`) : null,
      )
    : null;
  const more = c.write
    ? (h(
        'button',
        { type: 'button', class: 'knob more', 'aria-label': fmt(_('%s: open, link, device, pause'), p.name), 'aria-haspopup': 'menu' },
        ic('more'),
      ) as HTMLButtonElement)
    : null;
  more?.addEventListener('click', () => menu(c, p, more));
  let act: HTMLButtonElement | null = null;
  if (parts.action && c.write) {
    const a = parts.action;
    act = actButton(a, parts.quiet ? 'soft block pp-act' : 'tint block pp-act');
    const b = act;
    b.addEventListener('click', () => void once(b, () => runAct(a, p, c.acts)));
  }
  // the face's ring: blue while online; a decision's tone only in «Needs a decision» (a rollout is no one's alarm)
  const tone = p.online > 0 ? 'ok' : parts.group === 'need' ? parts.tone : '';
  return h(
    'article',
    {
      class: `dev as-link pp-card st-${parts.state} g-${parts.group}${p.state === 'paused' ? ' off' : ''}`,
      'data-id': p.id,
    },
    h(
      'div',
      { class: `dev-top${stat || d.match ? '' : ' one'}` },
      h('span', { class: 'pp-face' }, face(p.name, tone), h('span', { class: 'pk-ck', 'aria-hidden': 'true' }, ic('check'))),
      h(
        'div',
        { class: 'dev-id' },
        h(
          'a',
          { class: 'dev-name dev-a', href: personUrl(p.id), title: p.name, 'aria-describedby': stat ? stat.id : null },
          ...lit(p.name, d.words),
        ),
        parts.tiles ? tiles(c, d) : null,
        stat,
        foundLine(d.match, d.words),
      ),
      more,
    ),
    parts.presence ? h('div', { class: 'pp-r' }, presenceBlock(c, d, lives)) : null,
    parts.traffic ? h('div', { class: 'pp-r' }, trafficBlock(c, d)) : null,
    act ? h('div', { class: 'pp-r foot' }, act) : null,
  );
}
