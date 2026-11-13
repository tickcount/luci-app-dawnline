// What the admin says about a person in the head of their page: one phrase in
// its state's colour and, where one fixes it on the spot, the one action that
// names its result. Also the dates and amounts those actions set (a month on,
// the extra data that gets them going again). Their card on People, its group
// and its order are people/card.ts. Pure: no DOM; an action is an id the page
// turns into a button.
//
// Order of the access checks is the backend's (core.uc: no_server >
// server_off > paused > expired > quota > active); a device's link
// trouble uses the Log's words (events/model.ts linkStateText).

import type { Device, Person } from '../../shared/types';
import { addMonthsClamped, ago, daysLeft, endsSoon, parseDay } from '../../shared/format';
import { fmt, locale, num, plural } from '../../shared/i18n';
import { linkStateText } from '../events/model';

type Tone = 'ok' | 'warn' | 'bad' | '';

/**
 * What fixes a person's state at once: extend the end date, add data this
 * month, change a limit for the whole term, choose a server, turn the server
 * on, invite, resume (with `extend`: one that ended, extended too), show a
 * device's set-up, copy advice for a device's network, add a device.
 */
type ActId = 'extend' | 'bonus' | 'limit' | 'server' | 'enable' | 'invite' | 'resume' | 'show' | 'tell' | 'add-device' | 'answer';

export interface Act {
  id: ActId;
  label: string;
  icon: string;
  /** The device it is about (show, tell, answer). */
  device?: string;
  /** resume: extended by a month too (the end date has passed). */
  extend?: boolean;
  /** bonus: GB added this month. */
  gb?: number;
}

export interface Line {
  text: string;
  tone: Tone;
  /** The reason in full: under the phrase where there is room, else in its title. */
  why?: string;
  act?: Act;
}

/** The router's day and clock the words are about. */
export interface Today {
  today: string;
  now: number;
}

const GB = 2 ** 30;

/** "3 Nov" (a router day, no year). */
export const shortDay = (day: string): string => parseDay(day).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });

/** A month on from the later of today and the end date (31 Jan → 28 Feb). */
export function monthOn(p: Pick<Person, 'expires'>, today: string): string {
  return addMonthsClamped(p.expires && p.expires >= today ? p.expires : today, 1);
}

/** Three months on, the same way. */
export const monthsOn = (p: Pick<Person, 'expires'>, today: string, n: number): string =>
  addMonthsClamped(p.expires && p.expires >= today ? p.expires : today, n);

/**
 * Extra data on top of a limit: it lasts until the limit month ends, and the button says that day («+20 GB until
 * 14 Dec»; no day while no limit month runs).
 */
export const bonusLabel = (gb: number, p: Pick<Person, 'quota_reset_day'>): string =>
  p.quota_reset_day ? fmt(_('+%s GB until %s'), num(gb), shortDay(p.quota_reset_day)) : fmt(_('+%s GB'), num(gb));

/** The share of the limit used (0 without a limit). */
export const share = (p: Pick<Person, 'quota_limit' | 'quota_used'>): number => (p.quota_limit ? p.quota_used / p.quota_limit : 0);

/** Whole GB to add until the reset so the person has 10 GB more than they used: 10, 20, … */
const bonusFor = (p: Pick<Person, 'quota_limit' | 'quota_used'>): number =>
  Math.ceil(Math.max(0, p.quota_used - p.quota_limit) / GB / 10) * 10 + 10;

const extendAct = (p: Person, today: string): Act => ({
  id: 'extend',
  label: fmt(_('Extend to %s'), shortDay(monthOn(p, today))),
  icon: 'calendar',
});

/** The line of a person stopped by something of their own or their server's; null when they can connect. */
function stopped(p: Person, t: Today, over: boolean): Line | null {
  switch (p.state) {
    case 'no_server':
      return {
        text: _('No server'),
        tone: 'bad',
        why: _('Their devices have nowhere to connect until a server is chosen.'),
        act: { id: 'server', label: _('Choose a server'), icon: 'terminal' },
      };
    case 'server_off':
      return {
        text: _('Server turned off'),
        tone: 'warn',
        why: _('Devices do not connect while the server is turned off.'),
        act: { id: 'enable', label: _('Turn the server on'), icon: 'play' },
      };
    case 'paused':
      return over
        ? {
            text: _('Paused · access ended'),
            tone: '',
            why: fmt(_('Access ended %s: resumed without a new end date, it ends again at once.'), shortDay(p.expires)),
            act: { id: 'resume', extend: true, label: _('Extend and resume'), icon: 'play' },
          }
        : {
            text: _('Paused'),
            tone: '',
            why: _('Devices do not connect while access is paused.'),
            act: { id: 'resume', label: _('Resume'), icon: 'play' },
          };
    case 'expired':
      return {
        text: fmt(_('Access ended %s'), shortDay(p.expires)),
        tone: 'bad',
        why: _('Devices do not connect until the end date is moved.'),
        act: extendAct(p, t.today),
      };
    case 'quota': {
      if (p.quota_period !== 'month')
        return {
          text: _('Data limit reached'),
          tone: 'bad',
          why: _('The limit is for the whole term: raise it to give access back.'),
          act: { id: 'limit', label: _('Change the limit'), icon: 'chart' },
        };
      const gb = bonusFor(p);
      return {
        text: _('Data limit reached'),
        tone: 'bad',
        why: _('Devices stay connected, but only the portal and the router’s DNS open.'),
        act: { id: 'bonus', gb, label: bonusLabel(gb, p), icon: 'plus' },
      };
    }
  }
  return null;
}

/** A device whose link fails in a named way, and what fixes it. */
function brokenLine(d: Device): Line {
  const w = linkStateText(d.link?.state ?? '') ?? { title: _('Connection keeps dropping'), line: '' };
  const state = d.link?.state;
  // Trying with a current configuration: the network is in the way, not the set-up (diagnose() says the same).
  const act: Act | undefined =
    state === 'dropped' || (state === 'trying' && d.config_stale)
      ? { id: 'show', device: d.id, label: fmt(_('Set-up · %s'), d.name), icon: 'qr' }
      : state === 'trying'
        ? { id: 'tell', device: d.id, label: fmt(_('Advice · %s'), d.name), icon: 'copy' }
        : undefined;
  return { text: fmt(_('%s: %s'), d.name, w.title.toLocaleLowerCase(locale())), tone: 'warn', why: w.line || undefined, act };
}

/** The person's one phrase, coloured by state, and the one action that fixes it on the spot. */
export function personLine(p: Person, t: Today, portal = !!p.has_link): Line {
  const left = daysLeft(p.expires, t.today);
  const over = left !== null && left < 0;
  const stop = stopped(p, t, over);
  if (stop) return stop;
  if (left !== null && endsSoon(left))
    return {
      text: `${fmt(_('Access until %s'), shortDay(p.expires))} · ${plural(left, '%s day left', '%s days left')}`,
      tone: 'warn',
      act: extendAct(p, t.today),
    };
  if (p.quota_limit && share(p) >= 0.9) return { text: fmt(_('%s%% of the data limit'), num(Math.floor(share(p) * 100))), tone: 'warn' };
  if (!p.devices.length)
    return {
      text: _('No devices yet'),
      tone: '',
      act: portal ? { id: 'invite', label: _('Invite'), icon: 'link' } : { id: 'add-device', label: _('Add device'), icon: 'plus' },
    };
  const broken = p.devices.find((d) => d.link && !d.disabled);
  if (broken) return brokenLine(broken);
  const stale = p.devices.filter((d) => d.config_stale && d.handshake && !d.disabled);
  if (stale.length)
    // Not the admin's decision: the person fetches it. One device: its set-up at hand.
    return {
      text:
        stale.length > 1
          ? plural(stale.length, 'A new configuration is needed: %s device', 'A new configuration is needed: %s devices')
          : fmt(_('%s: needs a new configuration'), stale[0].name),
      tone: 'warn',
      act: stale.length === 1 ? { id: 'show', device: stale[0].id, label: fmt(_('Set-up · %s'), stale[0].name), icon: 'qr' } : undefined,
    };
  if (p.online)
    return { text: p.online > 1 ? fmt(_('Online · %s'), plural(p.online, '%s device', '%s devices')) : _('Online'), tone: 'ok' };
  if (!p.last_seen) return { text: _('No connections yet'), tone: '' };
  return { text: fmt(_('Last seen %s'), ago(p.last_seen, t.now)), tone: '' };
}

/** People with a device online now. */
export const peopleOnline = (ps: Person[]): number => ps.filter((p) => p.online > 0).length;
