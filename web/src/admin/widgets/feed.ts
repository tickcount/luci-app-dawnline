// The rows of an event feed: one per feed item (events/sessions.ts), in the
// portal's look. A row is the glass of what it is about, one sentence and the
// router's time. A device's session says when it ended or that it is still
// online, its place after it; the device and whose it is lead the sentence
// and are links (the person's and the device's panels). Other events say what the router's log says (events/render.ts
// eventText, names as links); a service log line its subject and message, its
// details folded under it. The Log draws them under day heads (pages/log);
// an object's panel shows its newest five without heads (feedShort) and the
// way to the whole log filtered to it: a view of the Log, not a second home.

import type { LogEvent, Status } from '../../shared/types';
import { h, type Kid } from '../../portal/dom';
import { fmt, locale, plural } from '../../shared/i18n';
import { plainWhere } from '../../shared/org';
import { glass } from '../ui/glass';
import { ic } from '../ui/icons';
import { categoryOf, eventBy, linkStatesText } from '../events/model';
import { detailText, eventText, levelLabel, systemText, type NameLinks } from '../events/render';
import { routerTime } from '../events/clock';
import { sessions, type FeedItem } from '../events/sessions';
import { deviceUrl, logUrl, personUrl } from '../shell/routes';
import type { Tone } from '../../portal/ui/glass';
import { replaces, turn } from '../../portal/ui/carry';
import { unfold } from '../ui/reshape';

export interface FeedContext {
  st: Pick<Status, 'people' | 'servers'>;
  /** The router's UTC offset (minutes). */
  tz?: number;
  links: NameLinks;
  /** The person this log is filtered to: their name is left out of the rows. */
  own?: string;
  /** Service lines with their details unfolded, by key. */
  open: Set<string>;
  /** A line was folded or unfolded: draw again. */
  toggled: () => void;
}

const lineKey = (x: FeedItem) => `${x.sys!.ts}|${x.sys!.msg}`;

/** The device a row is about, as the router has it now. */
const deviceOf = (c: FeedContext, x: FeedItem) => c.st.people.flatMap((p) => p.devices).find((d) => d.id === x.ev?.device);

function iconOf(c: FeedContext, x: FeedItem): Element {
  if (x.sys) {
    const l = x.sys.level;
    const tone: Tone = l === 'error' ? 'red' : l === 'down' || l === 'repair' ? 'orange' : l === 'up' ? 'green' : 'grey';
    // what Dawnline did itself wears its mark
    return glass(x.sys.by === 'admin' ? 'person' : 'dawnline', tone);
  }
  const e = x.ev!;
  if (categoryOf(e.type) === 'problems') return glass('pulse', e.type === 'device_recovered' ? 'green' : 'orange');
  if (eventBy(e) === 'admin') return glass('person');
  const kind = deviceOf(c, x)?.kind ?? e.dkind;
  return glass(e.device ? (kind ?? 'other') : 'person');
}

/** The device and whose it is, as links (a removed one by the name the log kept, quiet). */
function deviceAndOwner(c: FeedContext, x: FeedItem): Kid[] {
  const e = x.ev!;
  const p = c.st.people.find((q) => q.id === e.person);
  const d = p?.devices.find((q) => q.id === e.device);
  const name = (text: string, to: string | null) => (to ? h('a', { href: to }, text) : h('b', {}, text));
  const dev = name(d?.name ?? e.dname ?? _('a device'), p && d ? c.links.device(p.id, d.id) : null);
  if (!e.person || e.person === c.own) return [dev];
  return [dev, h('span', { class: 'ev-sep' }, ' · '), name(p?.name ?? e.pname ?? e.person, p ? c.links.person(p.id) : null)];
}

/** Where it connected from: the place the router looked up, else its address. */
function placeOf(x: FeedItem): Kid {
  const e = x.ev!;
  if (e.where) return h('span', { class: 'ev-where' }, plainWhere(e.where));
  return e.detail ? h('span', { class: 'ev-where mono' }, e.detail) : null;
}

/** A state's title going on after a colon ("Xiaomi 14 · Dima: on two devices at once"). */
const lower = (t: string) => t.charAt(0).toLocaleLowerCase(locale()) + t.slice(1);

/** A session: the device online until its disconnect, or still. */
function sessionText(c: FeedContext, x: FeedItem): Kid[] {
  const at = (x.until ?? 0) > 0 ? fmt(_('online until %s'), routerTime(x.until!, c.tz)) : null;
  // a session that held through quick drops says how many (sessions.ts REJOIN)
  const back = x.rejoins ? h('span', { class: 'ev-rejoin' }, plural(x.rejoins, '%s reconnect', '%s reconnects')) : null;
  return [...deviceAndOwner(c, x), ' ', at ? h('span', {}, at) : h('span', { class: 'ev-now' }, _('online now')), back, placeOf(x)];
}

function sentence(c: FeedContext, x: FeedItem): Kid[] {
  if (x.sys) return systemText(x.sys);
  const e = x.ev!;
  if (e.type === 'connect' && 'until' in x) return sessionText(c, x);
  // A disconnect whose connect is older than the log: the session's end only.
  if (e.type === 'disconnect') return [...deviceAndOwner(c, x), ' ', h('span', {}, fmt(_('online until %s'), routerTime(e.ts, c.tz)))];
  if (e.type === 'device_failing')
    return [
      ...deviceAndOwner(c, x),
      ': ',
      h('span', { class: 'warn-t' }, e.detail ? lower(linkStatesText(e.detail)) : _('a connection problem')),
    ];
  return eventText(c.st, e, c.own, c.links);
}

/** With several servers, which one a person's row happened on. */
function serverOf(c: FeedContext, x: FeedItem): HTMLElement | null {
  if (c.st.servers.length < 2 || !x.ev?.person || x.ev.person === c.own) return null;
  const p = c.st.people.find((q) => q.id === x.ev!.person);
  const srv = p && c.st.servers.find((s) => s.id === p.server);
  return srv ? h('span', { class: 'ev-srv', title: _('Server') }, srv.name) : null;
}

/** One row. */
function row(c: FeedContext, x: FeedItem): HTMLElement {
  const detail = x.sys?.detail;
  const open = !!detail && c.open.has(lineKey(x));
  const text = h('span', { class: 'ev-t' }, ...sentence(c, x));
  // The server goes with the place where there is one (a phone gives the place a line of its own).
  const srv = serverOf(c, x);
  if (srv) (text.querySelector('.ev-where') ?? text).append(srv);
  if (detail) text.append(h('span', { class: 'ev-more', 'aria-hidden': 'true' }, ic('chevron')));
  const pre = detail ? h('pre', { class: 'ev-detail' }, detailText(detail)) : null;
  if (pre && open) text.append(pre);
  const el = h(
    'div',
    {
      class: `ev${detail ? ' has-detail' : ''}${open ? ' open' : ''}`,
      title: x.sys && x.sys.by !== 'admin' ? levelLabel(x.sys.level) : null,
    },
    iconOf(c, x),
    text,
    h('span', { class: 'ev-time num', title: new Date(x.ts * 1000).toLocaleString(locale()) }, routerTime(x.ts, c.tz)),
  );
  if (detail && pre) {
    // A press draws the list again: this row takes the place of the one pressed, and goes on from how that one
    // stood (ui/carry.ts): its details unfold, or are there to fold away, and its chevron turns.
    const was = replaces(`ev:${lineKey(x)}`, el);
    if (was && was.classList.contains('open') !== open) {
      if (!open) text.append(pre);
      pre.hidden = open;
      turn(
        el,
        () => el.classList.toggle('open', !open),
        () => {
          el.classList.toggle('open', open);
          unfold(pre, open);
        },
      );
    }
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-expanded', String(open));
    const flip = () => {
      if (!c.open.delete(lineKey(x))) c.open.add(lineKey(x));
      c.toggled();
    };
    el.addEventListener('click', (ev) => {
      // Selecting text in the details, or a link, is not a fold.
      const t = ev.target as HTMLElement;
      if (!t.closest('pre, a') && !getSelection()?.toString()) flip();
    });
    el.addEventListener('keydown', (ev) => {
      if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === el) {
        ev.preventDefault();
        flip();
      }
    });
  }
  return el;
}

/** A day's rows as one list. */
export const feedRows = (c: FeedContext, items: FeedItem[]): HTMLElement =>
  h(
    'div',
    { class: 'evs' },
    ...items.map((x) => {
      const r = row(c, x);
      // the same event drawn again is the same row: a refill keeps it and slides it down under a new one (ui/reshape.ts)
      r.dataset.key = `${x.ts}|${x.ev?.type ?? x.sys?.msg ?? ''}|${x.ev?.device ?? ''}`;
      return r;
    }),
  );

/** What a row says, as text: what the search matches besides its names and details. */
export const rowText = (c: FeedContext, x: FeedItem): string => h('span', {}, ...sentence(c, x)).textContent ?? '';

/** Rows an object's panel shows. */
const SHORT = 5;

/**
 * The newest events of a person (`own`: their name is not repeated in each sentence) or of one device of theirs
 * (`device`), as the Log's rows without day heads.
 */
export function feedShort(
  st: Status,
  events: LogEvent[],
  o: { own?: string; device?: string; open: Set<string>; toggled: () => void },
): HTMLElement {
  const online = new Set(st.people.flatMap((p) => p.devices.filter((d) => d.online).map((d) => d.id)));
  const items = sessions(o.device ? events.filter((e) => e.device === o.device) : events, [], (id) => online.has(id)).slice(0, SHORT);
  if (!items.length)
    return h(
      'div',
      { class: 'card kt-none' },
      o.device ? _('Nothing about this device in the log yet.') : _('Nothing about them in the log yet.'),
    );
  return h(
    'div',
    { class: 'card flat-list pp-feed' },
    feedRows(
      {
        st,
        tz: st.tz,
        own: o.own,
        links: { person: (id) => personUrl(id), device: (_p, d) => deviceUrl(d) },
        open: o.open,
        toggled: o.toggled,
      },
      items,
    ),
  );
}

/** The pill that leads to the whole log, filtered to a person or a device. */
export const logLink = (o: { person?: string; device?: string }): HTMLElement =>
  h('a', { class: 'pill-link', href: logUrl(o) }, _('Log'), ic('chevron'));
