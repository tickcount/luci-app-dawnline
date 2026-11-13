// A server's rollout of a new configuration, counted on the client: which
// devices a server change makes fetch their configuration again (⟳N, by what
// the change rewrites: awg.uc allowed_ips, core.uc client_dns, the device's own
// MTU and keep-alive), how many of the devices that hold one have fetched the
// current one (Device.config_issued and config_stale, view.uc), and the
// admin's last change of the server (the service log). Pure: no DOM.
//
// A device counts once it was given a configuration: config_issued, or for
// one given out before the router kept the time, its stale mark or a
// handshake (it connected, so it had one). Only people the tunnel carries
// (active, over their limit) fetch; a paused or ended
// person's devices fetch when they come back.

import type { Device, Person, Server } from '../../shared/types';
import type { ServiceLogEntry } from '../api';
import { changedServer, noteText } from '../events/model';
import { whenAt } from '../events/clock';

/** The states whose devices the tunnel carries (awg.uc peers): the others fetch nothing until they are back. */
const CARRIED = new Set<Person['state']>(['active', 'quota']);

/** The device was given a configuration (it holds one that may be outdated). */
export const issued = (d: Device): boolean => d.config_issued > 0 || d.config_stale || d.handshake > 0;

export interface RolloutItem {
  p: Person;
  d: Device;
}

/** The devices a rollout on this server counts: enabled, given a configuration, of people the tunnel carries. */
export function rolloutItems(people: Person[], srv: string): RolloutItem[] {
  return people
    .filter((p) => p.server === srv && CARRIED.has(p.state))
    .flatMap((p) => p.devices.filter((d) => !d.disabled && issued(d)).map((d) => ({ p, d })));
}

/** How many of them have the current configuration, of how many; null while none waits. */
export function rollout(people: Person[], srv: string): { done: number; of: number } | null {
  const all = rolloutItems(people, srv);
  const done = all.filter((x) => !x.d.config_stale).length;
  return done === all.length ? null : { done, of: all.length };
}

/** What a server change rewrites in devices' configurations. */
export type Scope = 'all' | 'mtu' | 'keepalive' | 'dns' | 'routes' | 'home' | 'none';

/** The devices of a person whose configuration a change of `scope` rewrites. */
function inScope(scope: Scope, p: Person, d: Device): boolean {
  switch (scope) {
    case 'all':
      return true;
    // their own value wins over the server's
    case 'mtu':
      return !d.mtu;
    case 'keepalive':
      return d.keepalive == null;
    // Home-only people ask the router's address (or their own DNS), never the server's list
    case 'dns':
      return p.access !== 'lan';
    // the tunnel network or the router's address in their routes: Home only, or both with LAN Bypass
    case 'routes':
      return p.access === 'lan' || (p.access === 'both' && d.lan_bypass);
    // the home networks in their routes: the same, unless their page picked networks of their own
    case 'home':
      return inScope('routes', p, d) && !p.home_nets?.length;
    // the router's own side (where traffic leaves, which rule keeps circles): no configuration says it
    case 'none':
      return false;
  }
}

export interface Refetch {
  /** Devices that fetch again (they hold a configuration now). */
  n: number;
  /** Of them, of people the tunnel does not carry now: they fetch when they are back. */
  paused: number;
  /** Devices never given one: they just get the new one. */
  fresh: number;
  /** The people the n devices belong to. */
  people: number;
}

/**
 * ⟳N: what changes of these scopes on this server mean for its devices together (a device counts once). `also`:
 * devices that fetch for a reason no scope names (the networks behind a router: only those that reach it).
 */
export function refetchAny(people: Person[], srv: string, scopes: Scope[], also?: ReadonlySet<string>): Refetch {
  const ds = people
    .filter((p) => p.server === srv)
    .flatMap((p) =>
      p.devices.filter((d) => !d.disabled && (also?.has(d.id) || scopes.some((s) => inScope(s, p, d)))).map((d) => ({ p, d })),
    );
  const had = ds.filter(({ d }) => issued(d));
  return {
    n: had.length,
    paused: had.filter(({ p }) => !CARRIED.has(p.state)).length,
    fresh: ds.length - had.length,
    people: new Set(had.map(({ p }) => p.id)).size,
  };
}

/** ⟳N: what a change of `scope` on this server means for its devices. */
export const refetch = (people: Person[], srv: string, scope: Scope = 'all'): Refetch => refetchAny(people, srv, [scope]);

/** Whether a change of who reaches whom rewrites routes: only going from apart to together or back (awg.uc allowed_ips). */
export const meshRewrites = (from: Server['mesh'], to: Server['mesh']): boolean => (from === 'off') !== (to === 'off');

/**
 * The admin's newest change of this server's settings (a rename alone is not one a device fetches), from the service
 * log, newest first or not: its note as the router wrote it and when; null: none in the log.
 */
export function lastChange(log: ServiceLogEntry[], srv: Pick<Server, 'id' | 'name'>): { note: string; ts: number } | null {
  let best: ServiceLogEntry | null = null;
  for (const e of log)
    if (e.msg === 'changed' && e.note && e.note !== 'name' && changedServer(e, srv) && (!best || e.ts > best.ts)) best = e;
  return best ? { note: best.note!, ts: best.ts } : null;
}

/** «DNS · yesterday at 18:20»: the server's last change in the log, in the router's time (the rollout's panel); null: none. */
export function changeLine(log: ServiceLogEntry[], srv: Pick<Server, 'id' | 'name'>, now: number, tz?: number): string | null {
  const ch = lastChange(log, srv);
  if (!ch) return null;
  const what = noteText(ch.note);
  return `${what.charAt(0).toLocaleUpperCase()}${what.slice(1)} · ${whenAt(ch.ts, now, tz)}`;
}
