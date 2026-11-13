// A person's changes that wait to be applied on their page: what they reach
// (access, whose DNS, which home networks and services, their circle), their
// limit and how it is counted, and how many devices they may have. None is
// made by one press: each waits, the page shows the person as they would be,
// the dock at the window's foot counts the changes, and «Apply» makes them in
// ONE person_update (asked first when devices fetch their configuration
// again). A name and a note are saved as typed, and the one-tap actions
// (pause, extend, more data this month) keep their Undo.
// Pure: no DOM.

import type { Person } from '../../shared/types';
import type { PersonPatch } from '../api';
import { refetchCount } from './refetch';

const KEYS = ['access', 'dns_mode', 'home_nets', 'services', 'circle', 'quota_gb', 'quota_period', 'device_limit'] as const;
type Key = (typeof KEYS)[number];

/** What waits: the fields of person_update that are settings. */
export type Draft = Pick<PersonPatch, Key>;

/** The page's parts a waiting change belongs to. */
export type DraftPart = 'reach' | 'limit' | 'devices';

const PART: Record<Key, DraftPart> = {
  access: 'reach',
  dns_mode: 'reach',
  home_nets: 'reach',
  services: 'reach',
  circle: 'reach',
  quota_gb: 'limit',
  quota_period: 'limit',
  device_limit: 'devices',
};

const GIB = 1073741824;
const set = (a: string[] | undefined) => [...(a ?? [])].sort().join('\n');

/** Whether a value asked for is what the person has already. */
function own(p: Person, k: Key, v: Draft[Key]): boolean {
  switch (k) {
    case 'home_nets':
      return set(v as string[]) === set(p.home_nets);
    case 'services':
      return set(v as string[]) === set(p.services);
    case 'circle':
      return (v ?? '') === (p.circle ?? '');
    case 'quota_gb':
      return Number(v || 0) === (p.quota_gb || 0);
    case 'device_limit':
      return Number(v) === p.device_limit;
    default:
      return v === p[k];
  }
}

/** A patch split into what waits and what is saved at once. */
export function split(patch: PersonPatch): { waits: Draft; now: PersonPatch } {
  const waits: Record<string, unknown> = {};
  const now: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (v !== undefined) ((KEYS as readonly string[]).includes(k) ? waits : now)[k] = v;
  return { waits: waits as Draft, now: now as PersonPatch };
}

/** `draft` with `patch` over it, without what the person has already (a value put back stops waiting). */
export function stageDraft(draft: Draft, p: Person, patch: Draft): Draft {
  const next: Record<string, unknown> = { ...draft, ...patch };
  for (const k of KEYS) if (k in next && own(p, k, next[k] as Draft[Key])) delete next[k];
  return next as Draft;
}

export const draftCount = (d: Draft): number => Object.keys(d).length;

/** The parts of the page that have something waiting. */
export const draftParts = (d: Draft): Set<DraftPart> => new Set((Object.keys(d) as Key[]).map((k) => PART[k]));

/** The person as their page shows them while `d` waits (what the router counts, a state, stays as it is until then). */
export function preview(p: Person, d: Draft): Person {
  if (!draftCount(d)) return p;
  const q: Person = { ...p };
  if (d.access) q.access = d.access as Person['access'];
  if (d.dns_mode) q.dns_mode = d.dns_mode as Person['dns_mode'];
  if (d.home_nets) q.home_nets = d.home_nets;
  if (d.services) q.services = d.services;
  if (d.circle != null) q.circle = d.circle;
  if (d.device_limit != null) q.device_limit = Number(d.device_limit);
  if (d.quota_period) {
    q.quota_period = d.quota_period as Person['quota_period'];
    const of = q.quota_period === 'month' ? p.quota_month : p.total;
    q.quota_used = of[0] + of[1];
  }
  if (d.quota_gb != null) {
    // this month's extra, when the router counts one, stays on top of the new limit
    const extra = p.quota_gb > 0 ? Math.max(0, p.quota_limit - p.quota_gb * GIB) : 0;
    q.quota_gb = Number(d.quota_gb || 0);
    q.quota_limit = q.quota_gb > 0 ? q.quota_gb * GIB + extra : 0;
  }
  return q;
}

/** How many of their devices fetch their configuration again once `d` is applied (each counted once). */
export function draftRefetch(p: Person, d: Draft): number {
  const access = (d.access as Person['access'] | undefined) ?? p.access;
  const after: Person = { ...p, access };
  return Math.max(
    d.access ? refetchCount(p, { access }) : 0,
    d.dns_mode ? refetchCount(after, { dns_mode: d.dns_mode as Person['dns_mode'] }) : 0,
    d.home_nets ? refetchCount(after, { home_nets: d.home_nets }) : 0,
  );
}
