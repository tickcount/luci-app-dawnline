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

/** Why a person's devices cannot connect right now, in two words. */
const STOPPED: Partial<Record<Person['state'], string>> = {
  paused: 'Paused',
  expired: 'Access ended',
  quota: 'Data limit',
  hours: 'Outside hours',
  server_off: 'Server off',
  no_server: 'No server',
};

/**
 * A device's status as coloured text, no dots (only avatars carry one). `now`
 * is the router's clock; `waiting` is the text before the first connection.
 * With the person, a device that cannot come back says why ("Paused",
 * "Data limit") instead of a "Last seen" that reads like it might.
 */
export function deviceStatus(d: Device, now?: number, waiting = 'Not set up yet', p?: Person): HTMLElement {
  const seen = d.handshake ? `Last seen ${ago(d.handshake, now)} · ${new Date(d.handshake * 1000).toLocaleString()}` : '';
  if (d.disabled) return E('span', { class: 'dl-dstat', title: seen }, 'Disabled');
  if (d.online) return E('span', { class: 'dl-dstat ok' }, 'Connected');
  const why = p && STOPPED[p.state];
  if (why) return E('span', { class: 'dl-dstat warn', title: seen || 'Not connected yet' }, why);
  if (!d.handshake) return E('span', { class: 'dl-dstat warn', title: 'Waiting for the first connection' }, waiting);
  return E('span', { class: 'dl-dstat', title: new Date(d.handshake * 1000).toLocaleString() }, `Last seen ${ago(d.handshake, now)}`);
}
