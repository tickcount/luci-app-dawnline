// Which rows of the log's feed show: by kind (the track: all, connections,
// people, system, problems) and by the words typed into its search (names,
// addresses, places, what a line says). Pure: no DOM.

import type { Status } from '../../shared/types';
import type { FeedItem } from './sessions';
import { categoryOf, isProblem } from './model';

export type LogKind = 'all' | 'connections' | 'people' | 'system' | 'problems';
export const KINDS: LogKind[] = ['all', 'connections', 'people', 'system', 'problems'];

export function matchesKind(x: FeedItem, k: LogKind): boolean {
  if (k === 'all') return true;
  if (k === 'problems') return isProblem(x);
  if (k === 'system') return !!x.sys;
  return !!x.ev && categoryOf(x.ev.type) === k;
}

/** How many rows of each kind. */
export function kindCounts(items: FeedItem[]): Record<LogKind, number> {
  const n = { all: 0, connections: 0, people: 0, system: 0, problems: 0 };
  for (const x of items) for (const k of KINDS) if (matchesKind(x, k)) n[k]++;
  return n;
}

/**
 * What a row can be found by, lower case: the names of its person and device
 * (as they are now, and as the log kept them), its address, place and details;
 * for a service line its subject, message and details. `said`: the sentence as
 * the page draws it, so what is read can be typed.
 */
export function haystack(x: FeedItem, names: Pick<Status, 'people'>, said = ''): string {
  const parts = [said];
  if (x.ev) {
    const e = x.ev;
    const p = names.people.find((q) => q.id === e.person);
    parts.push(
      p?.name ?? '',
      e.pname ?? '',
      p?.devices.find((d) => d.id === e.device)?.name ?? '',
      e.dname ?? '',
      e.detail ?? '',
      e.where ?? '',
    );
    parts.push(...Object.entries(e.hosts ?? {}).flat());
  }
  if (x.sys) parts.push(x.sys.who ?? '', x.sys.msg, x.sys.detail ?? '', x.sys.kind ?? '', x.sys.note ?? '');
  return parts.join('\n').toLocaleLowerCase();
}

/** Every word of `query` is somewhere in the row's haystack (an empty query matches all). */
export function matchesQuery(hay: string, query: string): boolean {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return words.every((w) => hay.includes(w));
}
