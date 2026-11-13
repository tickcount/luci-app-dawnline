// Log rows: an activity event as a sentence ("You added device Phone for
// Myata", one translated sentence per event with the names in it), its tile
// and a service log line's (its text comes from the router); the Log's feed
// draws the rows (pages/log/feed.ts).

import type { LogEvent, Status } from '../../shared/types';
import type { ServiceLogEntry } from '../api';
import { E } from '../e';
import { fill, fmt, num } from '../../shared/i18n';
import {
  adminName,
  adminSentence,
  changedText,
  daysOf,
  deviceChangedText,
  eventBy,
  linkStatesText,
  logText,
  noteText,
  plainDetail,
  reasonText,
  sourceName,
} from './model';

/** Where a name in a sentence leads (the pages make people and devices links); none: names in bold. */
export interface NameLinks {
  person(id: string): string;
  device(person: string, device: string): string;
}

export function eventText(st: Pick<Status, 'people'>, e: LogEvent, personId?: string, links?: NameLinks): Node[] {
  const scoped = personId !== undefined && e.person === personId;
  const person = st.people.find((p) => p.id === e.person);
  const who = person?.name ?? e.pname ?? e.person ?? '';
  const known = person?.devices.find((d) => d.id === e.device);
  const dev = known?.name ?? e.dname ?? '';
  const b = (t: string) => E('b', {}, t);
  // A person or device the router still has is a link where links are given; one removed since, its name as it was.
  const pn = (t = who) => (links && person ? E('a', { href: links.person(person.id) }, t) : b(t));
  const dn = (t: string) => (links && person && known ? E('a', { href: links.device(person.id, known.id) }, t) : b(t));
  const m = (t: string) => E('span', { class: 'dl-muted' }, t);
  const mono = (t: string) => E('span', { class: 'dl-mono' }, t);
  /** An address; at home, the name of the device that has it, with the address in brackets. */
  const addr = (ip: string) =>
    e.hosts?.[ip]
      ? [E('span', { class: 'dl-ev-host' }, [E('b', {}, e.hosts[ip]), E('span', { class: 'dl-faint' }, ` (${ip})`)])]
      : [mono(ip)];
  // A sentence in grey around its bold names, people and devices.
  const say = (s: string, ...args: Node[]): Node[] => fill(s, ...args).map((x) => (typeof x === 'string' ? m(x) : x));
  // The admin's own actions start with an accent "You".
  const you = (s: string, ...args: Node[]): Node[] => {
    const w = _('You');
    return s.startsWith(`${w} `) ? [E('span', { class: 'dl-you' }, w), ...say(s.slice(w.length), ...args)] : say(s, ...args);
  };
  // The device with whose it is: "Person · Device", or, with links, the device first, as its own rows say it.
  const wd = scoped
    ? dn(dev || _('a device'))
    : !dev
      ? pn()
      : links
        ? E('span', {}, [dn(dev), E('span', { class: 'ev-sep' }, ' · '), pn()])
        : b(`${who} · ${dev}`);
  const detail = plainDetail(e);
  const devName = dn(detail || dev || _('a device'));
  const by = eventBy(e);
  if (by === 'admin')
    switch (e.type) {
      case 'device_added':
        return scoped ? you(_('You added device %s'), devName) : you(_('You added device %s for %s'), devName, pn());
      case 'device_removed':
        return scoped ? you(_('You removed device %s'), devName) : you(_('You removed device %s from %s'), devName, pn());
      case 'paused':
        return scoped ? you(_('You paused access')) : you(_('You paused person %s'), pn());
      case 'resumed':
        return scoped ? you(_('You resumed access')) : you(_('You resumed person %s'), pn());
      case 'device_changed': {
        const d = dn(dev || _('a device'));
        if (detail.startsWith('renamed from '))
          return [
            ...(scoped ? you(_('You renamed device %s'), d) : you(_('You renamed device %s of %s'), d, pn())),
            m(` · ${fmt(_('was %s'), detail.slice(13))}`),
          ];
        if (detail === 'turned off')
          return scoped ? you(_('You turned off device %s'), d) : you(_('You turned off device %s of %s'), d, pn());
        if (detail === 'turned on') return scoped ? you(_('You turned on device %s'), d) : you(_('You turned on device %s of %s'), d, pn());
        // Its own link options by name ("mtu, keepalive"), as person_changed lists a person's.
        return [
          ...(scoped ? you(_('You changed device %s'), d) : you(_('You changed device %s of %s'), d, pn())),
          ...(detail ? [m(` · ${deviceChangedText(detail)}`)] : []),
        ];
      }
      case 'device_keys':
        return [
          ...(scoped
            ? you(_('You issued new keys for device %s'), devName)
            : you(_('You issued new keys for device %s of %s'), devName, pn())),
          m(` · ${_('it needs its new configuration')}`),
        ];
      case 'link_changed':
        return [
          ...(scoped ? you(_('You issued a new personal link')) : you(_('You issued a new link for person %s'), pn())),
          m(` · ${_('the old link stopped working')}`),
        ];
    }
  switch (e.type) {
    case 'connect':
      return [
        ...(e.detail ? say(_('Device %s connected from %s'), wd, E('span', {}, addr(e.detail))) : say(_('Device %s connected'), wd)),
        ...(e.where ? [m(` · ${e.where}`)] : []),
      ];
    case 'disconnect':
      return say(_('Device %s went offline'), wd);
    case 'roam':
      return say(
        _('Device %s changed network %s'),
        wd,
        E(
          'span',
          {},
          (e.detail ?? '').split(' → ').flatMap((ip, i) => (i ? [m(' → '), ...addr(ip)] : addr(ip))),
        ),
      );
    case 'device_added':
      return by === 'portal'
        ? scoped
          ? say(_('Device %s added on the portal'), devName)
          : say(_('Person %s added device %s on their portal'), pn(), devName)
        : scoped
          ? say(_('Device %s added'), devName)
          : say(_('Person %s added device %s'), pn(), devName);
    case 'device_removed':
      return by === 'portal'
        ? scoped
          ? say(_('Device %s removed on the portal'), devName)
          : say(_('Person %s removed device %s on their portal'), pn(), devName)
        : scoped
          ? say(_('Device %s removed'), devName)
          : say(_('Person %s removed device %s'), pn(), devName);
    case 'device_changed':
      if (detail.startsWith('renamed from '))
        return [
          ...(by === 'portal'
            ? scoped
              ? say(_('Device %s renamed on the portal'), dn(dev || _('a device')))
              : say(_('Person %s renamed device %s on their portal'), pn(), dn(dev || _('a device')))
            : say(_('Device %s renamed'), wd)),
          m(` · ${fmt(_('was %s'), detail.slice(13))}`),
        ];
      if (detail === 'turned off') return say(_('Device %s turned off'), wd);
      if (detail === 'turned on') return say(_('Device %s turned on'), wd);
      // On the portal: LAN Bypass from its ⋯ menu, what it is and LAN Bypass with Reconnect.
      if (by === 'portal')
        return [
          ...(scoped
            ? say(_('Device %s changed on the portal'), dn(dev || _('a device')))
            : say(_('Person %s changed device %s on their portal'), pn(), dn(dev || _('a device')))),
          ...(detail ? [m(` · ${deviceChangedText(detail)}`)] : []),
        ];
      return [...say(_('Device %s changed'), wd), ...(detail ? [m(` · ${deviceChangedText(detail)}`)] : [])];
    case 'device_keys':
      return scoped
        ? say(_('New keys issued for device %s on the portal'), devName)
        : say(_('Person %s issued new keys for device %s on their portal'), pn(), devName);
    case 'person_added':
      return scoped ? you(_('You added this person')) : you(_('You added person %s'), pn(e.detail ?? who));
    case 'person_removed':
      return scoped ? you(_('You removed this person')) : you(_('You removed person %s'), pn(e.detail ?? who));
    case 'person_changed':
      // The detail lists changed fields by their option names (device_limit, quota_gb).
      return [
        ...(scoped ? you(_('You changed settings')) : you(_('You changed person %s'), pn())),
        ...(detail ? [m(` · ${changedText(detail)}`)] : []),
      ];
    case 'expiring': {
      const n = daysOf(e.detail ?? '');
      return n != null
        ? scoped
          ? say(N_(n, 'Access ends in %s day', 'Access ends in %s days'), m(num(n)))
          : say(N_(n, 'Person %s’s access ends in %s day', 'Person %s’s access ends in %s days'), pn(), m(num(n)))
        : scoped
          ? say(_('Access ends in a few days'))
          : say(_('Person %s’s access ends in a few days'), pn());
    }
    case 'paused':
      return e.detail
        ? scoped
          ? say(_('Access paused - %s'), m(reasonText(e.detail)))
          : say(_('Person %s paused - %s'), pn(), m(reasonText(e.detail)))
        : scoped
          ? say(_('Access paused'))
          : say(_('Person %s paused'), pn());
    case 'resumed':
      return e.detail && e.detail !== 'active'
        ? scoped
          ? say(_('Access resumed - %s'), m(reasonText(e.detail)))
          : say(_('Person %s resumed - %s'), pn(), m(reasonText(e.detail)))
        : scoped
          ? say(_('Access resumed'))
          : say(_('Person %s resumed'), pn());
    case 'quota_reached':
      return scoped ? say(_('Data limit reached')) : say(_('Person %s reached the data limit'), pn());
    case 'quota_restored':
      return scoped ? say(_('Data is back after the limit')) : say(_('Person %s has data again after the limit'), pn());
    case 'portal_blocked':
      return say(
        _('%s blocked %s for 15 min after too many wrong codes'),
        E('b', { class: 'dl-sys-src' }, _('Personal portal')),
        e.detail === 'all Cloudflare visitors' ? m(_('all Cloudflare visitors')) : mono(e.detail ?? ''),
      );
    case 'device_failing':
      return [...say(_('Device %s has a connection problem'), wd), ...(e.detail ? [m(` · ${linkStatesText(e.detail)}`)] : [])];
    case 'device_recovered':
      return say(_('Device %s connects normally again'), wd);
    default:
      return [m(`${e.type}${e.detail ? `: ${e.detail}` : ''}`)];
  }
}

/** A service log level as its tile's tooltip says it. */
export function levelLabel(l: ServiceLogEntry['level']): string {
  return { info: _('info'), up: _('up'), down: _('down'), repair: _('repair'), error: _('error') }[l] ?? l;
}

/**
 * The admin's own change: "You changed server Home" as one sentence of the
 * page's language, "You" in the accent; one this page does not know is put
 * together from the router's words as before.
 */
function adminLine(e: ServiceLogEntry): (Node | string)[] {
  const s = adminSentence(e.msg, e.kind, e.who);
  const you = _('You');
  if (!s)
    return [
      E('span', { class: 'dl-you' }, you),
      E('span', { class: 'dl-muted' }, ` ${e.msg} `),
      e.kind ? E('span', { class: 'dl-ev-kind' }, `${e.kind} `) : '',
      e.who ? E('b', {}, e.who) : '',
    ];
  const parts = (s.named ? fill<Node | string>(s.text, E('b', {}, adminName(e.msg, e.who ?? ''))) : [s.text]).map((x) =>
    typeof x === 'string' ? E('span', { class: 'dl-muted' }, x) : x,
  );
  // The accent on "You" where the sentence starts with it.
  const first = parts[0]?.textContent ?? '';
  return first.startsWith(`${you} `)
    ? [E('span', { class: 'dl-you' }, you), E('span', { class: 'dl-muted' }, first.slice(you.length)), ...parts.slice(1)]
    : parts;
}

/** A log line's details: its sentences in the page's language, command output as it is. */
export const detailText = (d: string) =>
  d
    .split('\n')
    .map((l) => logText(l))
    .join('\n');

/** A service log line's sentence: the admin's own change, or the source and what it says (no details). */
export function systemText(e: ServiceLogEntry): (Node | string)[] {
  if (e.by === 'admin') return [...adminLine(e), e.note ? E('span', { class: 'dl-muted' }, ` · ${noteText(e.note)}`) : ''];
  const msg = logText(e.msg);
  return [
    // Servers have names people chose: say it is a server. Services name themselves.
    e.src === 'awg' && e.who && e.who !== 'AmneziaWG' ? E('span', { class: 'dl-ev-kind' }, `${_('Server')} `) : '',
    // A server's name as it is; Dawnline's own subjects ("Access rules") in the page's language.
    E('b', { class: 'dl-sys-src', title: sourceName(e.src) }, e.who ? (e.src === 'awg' ? e.who : logText(e.who)) : sourceName(e.src)),
    // A translation may go on from the subject with a colon ("Home: AmneziaWG isn't running").
    /^[:,]/.test(msg) ? '' : ' ',
    E('span', { class: 'dl-muted' }, msg),
  ];
}
