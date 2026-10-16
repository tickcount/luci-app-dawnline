// Small status marks: pills, a person's state and access, a device's status.

import type { Device, Person } from '../../shared/types';
import { E } from '../e';
import { icon } from '../../shared/icons';
import { ACCESS_LABEL, STATE_LABEL, ago } from '../../shared/format';
import { attachTip } from './tooltip';

export function pill(tone: string, text: string, title?: string): HTMLElement {
  return E('span', { class: `dl-pill ${tone}`, title: title ?? null }, text);
}

export function stateTone(p: Person): string {
  if (p.state === 'active') return 'ok';
  if (p.state === 'quota' || p.state === 'expired') return 'bad';
  return 'warn';
}

/**
 * The person's own state: a turned-off server hides why they would be off
 * anyway, but the admin's pause still shows ('server_off' itself is the server
 * page's to say).
 */
function ownState(p: Person): Person['state'] {
  return p.state === 'server_off' && p.paused ? 'paused' : p.state;
}

/** Nothing while active (or while only their server is off); otherwise the state as text, as the server page's "Turned off". */
export function statePill(p: Person): HTMLElement | '' {
  const s = ownState(p);
  if (s === 'active' || s === 'server_off') return '';
  return pill(stateTone({ ...p, state: s }), STATE_LABEL[s]);
}

/** What the person can reach, as icons: home network, internet, or both. */
export function accessBadge(p: Person): HTMLElement {
  const kinds = p.access === 'both' ? ['lan', 'inet'] : p.access === 'lan' ? ['lan'] : ['inet'];
  const el = E(
    'span',
    { class: 'dl-access', 'aria-label': ACCESS_LABEL[p.access] },
    kinds.map((k) => E('span', { class: `dl-ibadge ${k}` }, icon(k === 'lan' ? 'home' : 'globe'))),
  );
  attachTip(el, () => [
    E('div', { class: 'dl-tip-title' }, ACCESS_LABEL[p.access]),
    p.access === 'lan' && p.services?.length
      ? E('div', { class: 'dl-muted' }, `${p.services.length} home service${p.services.length === 1 ? '' : 's'} only`)
      : '',
  ]);
  return el;
}

/**
 * A device's status as coloured text, no dots (only avatars carry one). `now`
 * is the router's clock; `waiting` is the text before the first connection.
 */
export function deviceStatus(d: Device, now?: number, waiting = 'Not set up yet'): HTMLElement {
  if (d.disabled) return E('span', { class: 'dl-dstat' }, 'Disabled');
  if (d.online) return E('span', { class: 'dl-dstat ok' }, 'Connected');
  if (!d.handshake) return E('span', { class: 'dl-dstat warn', title: 'Waiting for the first connection' }, waiting);
  return E('span', { class: 'dl-dstat' }, `Last seen ${ago(d.handshake, now)}`);
}
