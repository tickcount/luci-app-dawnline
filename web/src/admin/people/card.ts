// A person's card on People: which parts it has in which state (the concept's docs/ia2/10-people-cards.md, the
// lead's decision with its amendments). The card answers three questions: who, does everything work for them, what
// to do about it. A part is there only when, in this state, it is true now and changes what the admin knows or
// does; a state is said once. The group a person stands in comes from here too, so People's chips and group heads
// and Overview's «Waiting for a decision» count the same people. Pure: no DOM (pages/people/card.ts draws what this
// returns; tests/card.test.ts checks every row of the matrix).
//
// Parts: the head (face, name, device tiles, ⋯) · the state line under the name (one, in its tone; «· N more» when
// there is more than one problem) · presence («Online for 2 d» / «Offline for 3 h · Krasnodar» over the week's
// hours, the live speed while online) · traffic (7 days, the month, the week's bars; the limit's bar from 50 %, below
// that «of 100 GB» after the month) · the one action.
//
// The problems' order is the backend's for what stops a person (core.uc: no_server > server_off > paused > expired >
// quota), then what asks for a decision. A device waiting for a new configuration is a rollout, the person's to
// fetch: no group, no line, only its tile in warn and the notice over the list.

import type { Device, Person, Server } from '../../shared/types';
import { bytes, daysLeft, endsSoon } from '../../shared/format';
import { fmt, plural } from '../../shared/i18n';
import { asksNow, asksOf, routerAsks, wishOf } from '../servers/behind';
import { bonusLabel, monthOn, personLine, share, shortDay, type Act, type Today } from './lines';

type CardState =
  | 'no_server'
  | 'server_off'
  | 'paused'
  | 'expired'
  | 'quota'
  | 'device'
  | 'soon'
  | 'almost'
  | 'no_devices'
  | 'never'
  | 'away'
  | 'online'
  | 'offline';

/** Problems in the order the card says them (the first is its line and its button). */
const ORDER: CardState[] = ['no_server', 'server_off', 'paused', 'expired', 'quota', 'device', 'soon', 'almost'];

export type Group = 'need' | 'online' | 'rest' | 'paused';
export const GROUPS: Group[] = ['need', 'online', 'rest', 'paused'];

/** A group's head on People. */
export const groupTitle = (g: Group): string =>
  ({ need: _('Needs a decision'), online: _('Online'), rest: _('Everyone else'), paused: _('Paused') })[g];
type Tone = '' | 'warn' | 'bad';

export interface CardParts {
  state: CardState;
  /** The state line (null: none, presence says it). A «·» keeps to the word before it (a no-break space). */
  line: string | null;
  tone: Tone;
  /** The full words, for the line's title: every problem, each with its reason. */
  title: string;
  /** The other problems, said after the line as «· N more». */
  more: string[];
  /** Presence: online (with the live speed), offline, or none. */
  presence: 'online' | 'offline' | null;
  traffic: boolean;
  /** The limit in the traffic block: its bar (from 50 %), «of 100 GB» after the month, or nothing. */
  meter: 'bar' | 'of' | null;
  /** The device tiles in the head. */
  tiles: boolean;
  /** The one action; `quiet`: a soft button (resume, a link), not the tint of a decision. */
  action: Act | null;
  quiet: boolean;
  group: Group;
  /** Within «Needs a decision»: lower first. */
  rank: number;
  /** Their enabled devices that wait for a new configuration (a rollout): tiles in warn, «Show set-up» in ⋯. */
  stale: string[];
}

/** What the card says that is not in Person: when they were paused (the log), where they were last (status.geo). */
export interface CardFacts {
  pausedAt?: string;
  city?: string;
}

const GB = 2 ** 30;
const DAY = 86400;
/** Not seen for longer than this: «long away», one line. */
const AWAY_DAYS = 7;

/** A whole number without its «,0»: «50 GB», not «50.0 GB». */
const whole = (x: string): string => x.replace(/[,.]0(?=\s)/, '');

/** «50.3 of 50 GB»: the unit once when both sides share it. */
export function ofLimit(used: number, limit: number): string {
  const u = whole(bytes(used));
  const l = whole(bytes(limit));
  const unit = (x: string) => x.replace(/^[\d\s,.  ]+/, '');
  return fmt(_('%s of %s'), unit(u) === unit(l) ? u.slice(0, u.length - unit(u).length).trim() : u, l);
}

const extend = (p: Person, today: string): Act => ({
  id: 'extend',
  label: fmt(_('Extend to %s'), shortDay(monthOn(p, today))),
  icon: 'calendar',
});

/** Data until the limit month ends: 10 GB more than used, in tens (people/lines.ts); a limit for the whole term is changed. */
function bonus(p: Person): Act {
  if (p.quota_period !== 'month') return { id: 'limit', label: _('Change the limit'), icon: 'chart' };
  const gb = Math.ceil(Math.max(0, p.quota_used - p.quota_limit) / GB / 10) * 10 + 10;
  return { id: 'bonus', gb, label: bonusLabel(gb, p), icon: 'plus' };
}

interface Problem {
  state: CardState;
  text: string;
  tone: Tone;
  /** The reason in full, for the title. */
  why?: string;
  act: Act | null;
  quiet?: boolean;
}

/** A device's link failing in a named way, in the card's words, and what fixes it. */
function deviceProblem(d: Device): Problem {
  const state = d.link!.state;
  const text =
    state === 'trying'
      ? fmt(_('%s does not connect'), d.name)
      : state === 'shared'
        ? fmt(_('%s is on two devices at once'), d.name)
        : state === 'dropped'
          ? fmt(_('%s: nothing gets through'), d.name)
          : fmt(_('%s: the connection keeps dropping'), d.name);
  // Trying with a current configuration: the network is in the way, not the set-up (people/diagnosis.ts says the same).
  const act: Act | null =
    state === 'dropped' || (state === 'trying' && d.config_stale)
      ? { id: 'show', device: d.id, label: fmt(_('Set-up · %s'), d.name), icon: 'qr' }
      : state === 'trying'
        ? { id: 'tell', device: d.id, label: fmt(_('Advice · %s'), d.name), icon: 'copy' }
        : null;
  return { state: 'device', text, tone: 'warn', act };
}

/** Every problem `p` has now, the most important first. */
function problems(p: Person, server: Server | undefined, t: Today, f: CardFacts): Problem[] {
  const out: Problem[] = [];
  const line = personLine(p, t);
  const left = daysLeft(p.expires, t.today);
  if (p.state === 'no_server') out.push({ state: 'no_server', text: _('No server'), tone: 'bad', why: line.why, act: line.act ?? null });
  if (p.state === 'server_off')
    out.push({
      state: 'server_off',
      text: server ? fmt(_('Server %s is turned off'), server.name) : _('Server turned off'),
      tone: '',
      why: line.why,
      act: null,
    });
  if (p.state === 'paused')
    out.push({
      state: 'paused',
      text: f.pausedAt ? fmt(_('Paused since %s'), shortDay(f.pausedAt)) : _('Paused'),
      tone: '',
      why: line.why,
      act: line.act ?? null,
      quiet: true,
    });
  if (p.state === 'expired')
    out.push({
      state: 'expired',
      text: fmt(_('Access ended %s'), shortDay(p.expires)),
      tone: 'bad',
      why: line.why,
      act: extend(p, t.today),
    });
  if (p.state === 'quota')
    out.push({
      state: 'quota',
      text: `${p.quota_period === 'month' ? _('Limit reached') : _('Term limit reached')} · ${ofLimit(p.quota_used, p.quota_limit)}`,
      tone: 'bad',
      why: line.why,
      act: bonus(p),
    });
  for (const d of p.devices) if (d.link && !d.disabled) out.push(deviceProblem(d));
  // What they asked for on their own page waits for the admin's answer: a router (with its networks), or a network
  // behind one they have. A decision like any other: its line, and its button, which leads to where it is answered
  // (the device's dialog).
  for (const d of p.devices) {
    if (d.disabled || !asksNow(d)) continue;
    const act: Act = { id: 'answer', device: d.id, label: _('Answer'), icon: 'router' };
    if (routerAsks(d)) {
      const nets = wishOf(d);
      out.push({
        state: 'device',
        text: fmt(_('Asks for the router %s'), d.name),
        tone: 'warn',
        why: nets.length ? fmt(_('With the networks behind it: %s'), nets.join(', ')) : undefined,
        act,
      });
    } else
      out.push({
        state: 'device',
        text: fmt(
          N_(asksOf(d).length, 'Asks for the network %s behind %s', 'Asks for the networks %s behind %s'),
          asksOf(d).join(', '),
          d.name,
        ),
        tone: 'warn',
        act,
      });
  }
  // the end date near: its last days (shared/format.ts WARN_DAYS); daysLeft counts the last day itself, so 1 is
  // «today is the last day»
  if (p.state !== 'expired' && p.state !== 'paused' && left !== null && endsSoon(left))
    out.push({
      state: 'soon',
      text: `${fmt(_('Access until %s'), shortDay(p.expires))} · ${left === 1 ? _('last day') : plural(left, '%s day', '%s days')}`,
      tone: 'warn',
      act: extend(p, t.today),
    });
  if (p.state !== 'quota' && p.quota_limit && share(p) >= 0.9)
    out.push({
      state: 'almost',
      text: `${_('Limit nearly reached')} · ${ofLimit(p.quota_used, p.quota_limit)}`,
      tone: 'warn',
      act: bonus(p),
    });
  return out;
}

/** A line that may wrap breaks after its «·», never before: the dot stays with the words it follows. */
const keepDots = (x: string | null): string | null => (x ? x.replace(/ · /g, ' · ') : x);

/** The parts of `p`'s card now; `server`: theirs (its name in «Server … is turned off»). */
export function cardParts(p: Person, server: Server | undefined, t: Today, f: CardFacts = {}): CardParts {
  const r = parts(p, server, t, f);
  return { ...r, line: keepDots(r.line) };
}

function parts(p: Person, server: Server | undefined, t: Today, f: CardFacts): CardParts {
  const ps = problems(p, server, t, f);
  const stale = p.devices.filter((d) => d.config_stale && d.handshake && !d.disabled && !d.link).map((d) => d.id);
  const base = (o: Partial<CardParts> & Pick<CardParts, 'state' | 'group'>): CardParts => ({
    stale,
    line: null,
    tone: '',
    title: '',
    more: [],
    presence: null,
    traffic: false,
    meter: null,
    tiles: p.devices.length > 0,
    action: null,
    quiet: false,
    rank: 99,
    ...o,
  });
  const meter = (): CardParts['meter'] => (p.quota_limit ? (share(p) >= 0.5 ? 'bar' : 'of') : null);
  if (ps.length) {
    const [top, ...rest] = ps;
    return base({
      state: top.state,
      group: top.state === 'server_off' ? 'rest' : top.state === 'paused' ? 'paused' : 'need',
      line: top.text,
      tone: top.tone,
      title: ps.map((x) => (x.why ? `${x.text}. ${x.why}` : x.text)).join('\n'),
      more: rest.map((x) => x.text),
      action: top.act,
      quiet: !!top.quiet,
      // without a server they have no devices to show; the rest keep their tiles (the faults are on them)
      tiles: top.state !== 'no_server' && p.devices.length > 0,
      rank: ORDER.indexOf(top.state),
    });
  }
  if (!p.devices.length) {
    const line = personLine(p, t);
    return base({ state: 'no_devices', group: 'rest', line: _('No devices yet'), title: _('No devices yet'), action: line.act ?? null });
  }
  if (!p.devices.some((d) => d.handshake))
    return base({
      state: 'never',
      group: 'rest',
      line: _('Not connected yet'),
      title: _('Their set-up was given out, but no device has connected yet.'),
      action: { id: 'invite', label: p.has_link ? _('Link') : _('Invite'), icon: 'link' },
      quiet: !!p.has_link,
    });
  const online = p.online > 0;
  if (online) return base({ state: 'online', group: 'online', presence: 'online', traffic: true, meter: meter() });
  const away = Math.floor((t.now - p.last_seen) / DAY);
  if (away > AWAY_DAYS) {
    // Long away: the line says for how long and where they were last, in presence's place (no week of hours to
    // show). Their traffic stands as everyone's does, the week and the 30 days (the owner, 2026-11-12: «офлайн
    // устройство должно показывать last 7 days 30 days как в онлайн устройствах»); it used to be squeezed into the
    // line («· 9.4 MB in 30 days») on a card of one line.
    const days = plural(away, '%s day', '%s days');
    return base({
      state: 'away',
      group: 'rest',
      line: f.city ? `${fmt(_('Not connected for %s'), days)} · ${f.city}` : fmt(_('Not connected for %s'), days),
      title: f.city ? fmt(_('Last seen in %s'), f.city) : '',
      traffic: true,
      meter: meter(),
    });
  }
  return base({ state: 'offline', group: 'rest', presence: 'offline', traffic: true, meter: meter() });
}

/** The group `p` stands in (its server's name does not matter for that). */
export const groupOf = (p: Person, t: Today): Group => cardParts(p, undefined, t).group;

/** What a person's place in their group is read from: their parts, the speed now, the week, when paused. */
export interface Ranked {
  p: Person;
  parts: CardParts;
  /** Bytes/s to their devices now (0 offline). */
  speed: number;
  /** Their traffic over the last 7 days. */
  week: number;
  /** The router's day they were paused ('' unknown). */
  pausedAt: string;
}

/**
 * In order of attention: the groups in their order, and within each: a decision by its weight, the end date nearer
 * first; online by the speed now, then the week; everyone else by when they were last online, the long away and
 * those never connected at the end; paused by the day they were paused.
 */
export function byAttention(list: Ranked[], today: string): Ranked[] {
  const left = (x: Ranked) => daysLeft(x.p.expires, today) ?? 1e6;
  const late = (x: Ranked) => Number(x.parts.state === 'away' || x.parts.state === 'never' || x.parts.state === 'no_devices');
  const within: Record<Group, (a: Ranked, b: Ranked) => number> = {
    need: (a, b) => a.parts.rank - b.parts.rank || left(a) - left(b),
    online: (a, b) => b.speed - a.speed || b.week - a.week,
    rest: (a, b) => late(a) - late(b) || b.p.last_seen - a.p.last_seen,
    paused: (a, b) => (a.pausedAt || '9999').localeCompare(b.pausedAt || '9999'),
  };
  return [...list].sort(
    (a, b) =>
      GROUPS.indexOf(a.parts.group) - GROUPS.indexOf(b.parts.group) || within[a.parts.group](a, b) || a.p.name.localeCompare(b.p.name),
  );
}
