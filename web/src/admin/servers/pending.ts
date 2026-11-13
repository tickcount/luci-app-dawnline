// A server's changes that wait to be applied (Settings: no change of how a
// server works is made on the spot; it is staged, a bar at the page's foot
// counts the changes and the devices that fetch their configuration again
// after them, and «Apply» makes them all: after one question naming them when
// devices fetch again, at once when none does). Here: what a staged change
// is, how a later one of the same kind replaces it, the one server_update
// patch the fields make, the calls that are not fields (the disguise, the
// interfaces' choice, the networks behind routers: a call a router), and
// what applying them means for devices
// (servers/rollout.ts refetchAny). Pure: no DOM.

import type { Person } from '../../shared/types';
import { refetchAny, type Refetch, type Scope } from './rollout';

export type ChangeKind =
  | 'disguise'
  | 'renew'
  | 'address'
  | 'port'
  | 'subnet'
  | 'dns'
  | 'mtu'
  | 'keepalive'
  | 'mesh'
  | 'rule'
  | 'home'
  | 'route'
  | 'wan'
  | 'behind'
  | 'portal_routers'
  | 'portal_nets';

/** What a change of each kind rewrites in devices' configurations. */
const SCOPE: Record<ChangeKind, Scope> = {
  disguise: 'all',
  renew: 'all',
  address: 'all',
  port: 'all',
  subnet: 'all',
  dns: 'dns',
  mtu: 'mtu',
  keepalive: 'keepalive',
  mesh: 'routes',
  // between «everyone» and «in circles» nobody's routes change (rollout.ts meshRewrites)
  rule: 'none',
  home: 'home',
  route: 'none',
  wan: 'none',
  // the networks behind people's routers: only the devices that reach a changed router fetch (Staged.fetch)
  behind: 'none',
  // what people may do on their own pages: no configuration says it
  portal_routers: 'none',
  portal_nets: 'none',
};

/** After these a device with the old configuration cannot connect at all (the others keep working the old way). */
const BREAKS: readonly ChangeKind[] = ['disguise', 'renew', 'address', 'port', 'subnet'];

/** What server_interfaces takes: the home networks (`home`), how internet traffic leaves (`route`), the WAN (`wan`). */
export interface NetPatch {
  auto_lan?: boolean;
  lan_devices?: string[];
  lan_like?: boolean;
  auto_wan?: boolean;
  wan_device?: string;
}

export interface Staged {
  kind: ChangeKind;
  /** The change in a few words, for the bar and the question: «MTU: 1380». */
  label: string;
  /** The new value as its field shows it while it waits. */
  value: string;
  /** For the question of this change alone: its own title (a disguise's) and one more sentence. */
  title?: string;
  more?: string;
  /** For `mesh`: devices kept apart from now on (the router stops them at once). */
  apart?: boolean;
  /** server_update fields: every staged change's go in one call. */
  values?: Record<string, unknown>;
  /** A disguise preset (server_obfuscation; `renew`: the same preset with new values). */
  preset?: string;
  /** A part of the interfaces' choice (server_interfaces): every staged one goes in one call. */
  net?: NetPatch;
  /** The networks behind routers, by device (device_networks, a call a router): each list as it will be. */
  behind?: Record<string, string[]>;
  /** The devices that fetch their configuration again for this change alone, whatever its kind's scope says. */
  fetch?: string[];
}

/** A disguise and its new values are one thing to wait for; so is who sees whom, whichever way it changes. */
const slot = (k: ChangeKind): ChangeKind => (k === 'renew' ? 'disguise' : k === 'rule' ? 'mesh' : k);

/** The devices a change of this kind rewrites now (⟳N on its field). */
export const refetchOf = (kind: ChangeKind, srv: string, people: Person[]): number => refetchAny(people, srv, [SCOPE[kind]]).n;

/**
 * `s` staged: it takes the place of an earlier change of its kind, where that one stood (the home networks' whole
 * choice is one change: its section hands in everything of it that differs from the server's).
 */
export function stage(list: Staged[], s: Staged): Staged[] {
  const i = list.findIndex((x) => slot(x.kind) === slot(s.kind));
  return i < 0 ? [...list, s] : list.map((x, j) => (j === i ? s : x));
}

/** Without the staged change of this kind (its field went back to what the server has). */
export const unstage = (list: Staged[], kind: ChangeKind): Staged[] => list.filter((x) => slot(x.kind) !== slot(kind));

/** The staged change of this kind, if any. */
export const stagedOf = (list: Staged[], kind: ChangeKind): Staged | undefined => list.find((x) => slot(x.kind) === slot(kind));

/** The one server_update patch of every staged field, or null: no field is staged. */
export function fieldsPatch(list: Staged[]): Record<string, unknown> | null {
  const fields = list.filter((x) => x.values);
  return fields.length ? Object.assign({}, ...fields.map((x) => x.values)) : null;
}

/** The one server_interfaces patch of every staged part of that choice, or null: none is staged. */
export function netPatch(list: Staged[]): NetPatch | null {
  const nets = list.filter((x) => x.net);
  return nets.length ? Object.assign({}, ...nets.map((x) => x.net)) : null;
}

export interface Summary {
  changes: number;
  /** The devices that fetch their configuration again after all of them (each counted once). */
  refetch: Refetch;
  /** Those devices stop connecting until they fetch (else they work the old way meanwhile). */
  breaks: boolean;
}

/** What applying the staged changes means for the server's devices. */
export function summary(list: Staged[], people: Person[], srv: string): Summary {
  return {
    changes: list.length,
    refetch: refetchAny(people, srv, [...new Set(list.map((x) => SCOPE[x.kind]))], new Set(list.flatMap((x) => x.fetch ?? []))),
    breaks: list.some((x) => BREAKS.includes(x.kind)),
  };
}
