// What the admin says about one device: its one line (the page head's state),
// and its diagnosis, the chain from what the router decides to what the
// device does (access, server, device, connection, traffic), its first break
// and that break's fix. Every line is something the router knows. Steps after
// the first break wait. The device page shows it brief (briefDiagnosis):
// nothing when every step holds, else what holds in one line, the break in
// full, what follows in one line. Pure: no DOM; a fix is an id the page turns
// into a button.
//
// Order of the access checks is the backend's (core.uc: no_server > server_off
// > paused > expired > quota > active). Link states: the agent's
// watcher (trying: its initiations reach the router and no handshake follows;
// dropped: handshakes, nothing it sends is usable, an outdated configuration;
// shared / unstable: handshakes flapping, from two addresses or one); their
// words are the Log's (events/model.ts linkStateText).

import type { Device, Person, Server } from '../../shared/types';
import { ago, bytes } from '../../shared/format';
import { fmt, locale } from '../../shared/i18n';
import { shortDay } from './lines';
import { linkStateText } from '../events/model';
import { routerTime } from '../events/clock';

type Tone = 'ok' | 'warn' | 'bad' | '';

/**
 * What fixes a break: show its set-up, resume the person, open the person's
 * page (an end date, a limit, no server), open the server (turned off), turn
 * the device on, copy advice for its owner, add a second device.
 */
export type Fix = 'show' | 'resume' | 'person' | 'server' | 'device-on' | 'tell' | 'add-device';

export interface Line {
  text: string;
  tone: Tone;
  /** The reason in full, where there is one. */
  why?: string;
}

/** Which link of the chain a step is (a brief diagnosis' folded lines are 'fine' and 'later'). */
type StepId = 'access' | 'server' | 'device' | 'connection' | 'traffic' | 'fine' | 'later';

export interface Step {
  id: StepId;
  title: string;
  line: string;
  state: 'ok' | 'bad' | 'warn' | 'wait';
  fix?: Fix[];
  /** Advice beside the fix, when part of it is not a button (the device's own network). */
  hint?: string;
}

/** The router's clock: now, today (YYYY-MM-DD) and its offset (minutes east of UTC). */
export interface Clock {
  now: number;
  today: string;
  tz?: number;
}

/** A device's link failing in a named way: its words and what they mean (the Log's). */
export function linkWords(d: Device): { title: string; line: string } {
  return linkStateText(d.link?.state ?? '') ?? { title: _('Connection keeps dropping'), line: '' };
}

/** The device's one line: its state in its colour. */
export function deviceLine(d: Device, p: Person, c: Clock): Line {
  if (d.disabled) return { text: _('Disabled'), tone: '' };
  // a router its owner asked for: it cannot connect before the answer
  if (d.waiting)
    return d.declined
      ? { text: _('Request declined'), tone: '' }
      : {
          text: _('Waits for your answer'),
          tone: 'warn',
          why: _('Its owner added this router on their page: it connects once you accept it.'),
        };
  if (d.config_stale && d.handshake)
    return {
      text: _('Needs a new configuration'),
      tone: 'warn',
      why: _('Its configuration changed after it was set up: the device has the old one.'),
    };
  if (d.online && p.state === 'quota') return { text: _('Online · data limit reached'), tone: 'warn' };
  if (d.link) {
    const w = linkWords(d);
    return { text: w.title, tone: 'warn', why: w.line };
  }
  if (d.online) return { text: _('Online'), tone: 'ok' };
  if (!d.handshake) return { text: _('Not set up yet'), tone: 'warn' };
  return { text: fmt(_('Last seen %s'), ago(d.handshake, c.now)), tone: '' };
}

/** The first step: whether the person's access lets the device in now. */
function accessStep(p: Person): Step {
  const title = _('Access');
  switch (p.state) {
    case 'paused':
      return {
        id: 'access' as const,
        title,
        line: _('Paused'),
        state: 'bad',
        fix: ['resume'],
        hint: _('Devices do not connect while access is paused.'),
      };
    case 'expired':
      return {
        id: 'access' as const,
        title,
        line: fmt(_('Access ended %s'), shortDay(p.expires)),
        state: 'bad',
        fix: ['person'],
        hint: _('Devices do not connect until the end date is moved.'),
      };
    case 'quota':
      return {
        id: 'access' as const,
        title,
        line: _('Data limit reached'),
        state: 'bad',
        fix: ['person'],
        hint: _('Devices stay connected, but only the portal and the router’s DNS open.'),
      };
  }
  const until = p.expires ? fmt(_('Open until %s'), shortDay(p.expires)) : _('Open with no end date');
  return {
    id: 'access' as const,
    title,
    line: p.quota_limit ? `${until} · ${fmt(_('%s of %s'), bytes(p.quota_used), bytes(p.quota_limit))}` : until,
    state: 'ok',
  };
}

function serverStep(srv: Server | undefined, c: Clock): Step {
  const title = _('Server');
  if (!srv) return { id: 'server' as const, title, line: _('No server chosen'), state: 'bad', fix: ['person'] };
  if (!srv.enabled) return { id: 'server' as const, title, line: fmt(_('%s is turned off'), srv.name), state: 'bad', fix: ['server'] };
  return {
    id: 'server' as const,
    title,
    line: srv.reached ? fmt(_('%s is running, last connection %s'), srv.name, ago(srv.reached, c.now)) : fmt(_('%s is running'), srv.name),
    state: 'ok',
  };
}

function deviceStep(d: Device): Step {
  const title = _('Device');
  if (d.disabled) return { id: 'device' as const, title, line: _('Disabled by you'), state: 'bad', fix: ['device-on'] };
  if (d.config_stale) return { id: 'device' as const, title, line: _('Needs a new configuration'), state: 'bad', fix: ['show'] };
  return { id: 'device' as const, title, line: _('Enabled, its configuration is current'), state: 'ok' };
}

function connectionStep(d: Device, c: Clock): Step {
  const title = _('Connection');
  if (!d.handshake) return { id: 'connection' as const, title, line: _('It has never connected'), state: 'bad', fix: ['show'] };
  switch (d.link?.state) {
    case 'trying':
      return {
        id: 'connection' as const,
        title,
        line: fmt(_('Its attempts reach the router since %s, no answer reaches the device'), routerTime(d.link.since, c.tz)),
        state: 'bad',
        // Its configuration is current (the step before holds): what is left is the network it connects from.
        fix: ['tell'],
        hint: _(
          'Its configuration is current, so the network it connects from is in the way. Let it try another: mobile data instead of Wi‑Fi, or the other way round.',
        ),
      };
    case 'shared':
      return {
        id: 'connection' as const,
        title,
        line: linkWords(d).title,
        state: 'bad',
        fix: ['add-device'],
        hint: _('One configuration is on two devices, and they push each other out.'),
      };
    case 'unstable':
      return {
        id: 'connection' as const,
        title,
        line: linkWords(d).title,
        state: 'bad',
        hint: _('Usually it is the device’s network: worth trying another.'),
      };
  }
  return {
    id: 'connection' as const,
    title,
    line: d.online ? fmt(_('Connected, handshake %s'), ago(d.handshake, c.now)) : fmt(_('Last one %s'), ago(d.handshake, c.now)),
    state: 'ok',
  };
}

function trafficStep(d: Device, p: Person): Step {
  const title = _('Traffic');
  if (d.link?.state === 'dropped')
    return { id: 'traffic' as const, title, line: _('The router drops what it sends'), state: 'bad', fix: ['show'] };
  if (!d.online) return { id: 'traffic' as const, title, line: _('Not connected'), state: 'wait' };
  if (p.state === 'quota') return { id: 'traffic' as const, title, line: _('Only the portal and the router’s DNS'), state: 'warn' };
  return { id: 'traffic' as const, title, line: _('Flowing'), state: 'ok' };
}

/** The whole chain; the steps after its first break wait. */
export function diagnose(d: Device, p: Person, srv: Server | undefined, c: Clock): Step[] {
  const steps = [accessStep(p), serverStep(srv, c), deviceStep(d), connectionStep(d, c), trafficStep(d, p)];
  const first = steps.findIndex((s) => s.state === 'bad');
  if (first < 0) return steps;
  return steps.map((s, i) =>
    i <= first ? s : { id: s.id, title: s.title, line: i === first + 1 ? _('Checked once it is fixed') : s.line, state: 'wait' },
  );
}

/** Names in a list, as the page's language joins them ("access, server and device"), the first one capitalised. */
function names(steps: Step[]): string {
  const t = steps.map((s, i) => (i ? s.title.toLocaleLowerCase(locale()) : s.title));
  return new Intl.ListFormat(locale(), { type: 'conjunction' }).format(t);
}

/**
 * The diagnosis as the device page shows it: nothing when every step holds
 * (the way above already says it is connected); else the steps that hold in
 * one line ("Access, server and device: fine"), the first one that does not
 * in full with its fix, and what comes after it in one line.
 */
export function briefDiagnosis(steps: Step[]): Step[] {
  const k = steps.findIndex((s) => s.state !== 'ok');
  if (k < 0) return [];
  const before = steps.slice(0, k);
  const after = steps.slice(k + 1);
  return [
    ...(before.length ? [{ id: 'fine' as const, title: names(before), line: _('Fine'), state: 'ok' as const }] : []),
    steps[k],
    ...(after.length ? [{ id: 'later' as const, title: names(after), line: _('Checked once it is fixed'), state: 'wait' as const }] : []),
  ];
}

/** The advice for a device whose attempts get no answer while its configuration is current, as the admin sends it. */
export const otherNetAdvice = (d: Device): string =>
  fmt(
    _(
      '%s: the VPN does not connect from the network it is on now. Its attempts reach the router, but the answer does not reach the device. The configuration is right, the network is in the way. Try another one: mobile data instead of Wi‑Fi, or the other way round. If that does not help, write to me.',
    ),
    d.name,
  );
