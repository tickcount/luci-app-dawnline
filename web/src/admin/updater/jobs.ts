// Updater jobs in words: which component a job is about, its versions, its
// timer and what a finished check found. Pure (no DOM, no RPC).

import type { UpdateJob, UpdatesStatus } from '../api';
import { fmt, plural } from '../../shared/i18n';

/** A component's name in words; undefined for "all" and unknown ones. */
export function componentName(comp: string): string | undefined {
  if (comp === 'app') return 'Dawnline';
  if (comp === 'amneziawg') return 'AmneziaWG';
  return comp === 'packages' || comp === 'pkgs' ? _('System packages') : undefined;
}

/** "app@0.3.1" → "app"; "check:amneziawg" → "amneziawg"; "check" → "all"; "pkgs:a,b" → "pkgs". */
export function jobComponent(what: string): string {
  const w = what.startsWith('check') ? what.slice(6) || 'all' : what;
  return w.split(/[:@ ]/)[0];
}

/** The component of a job that is already running (Components follows it). */
export function runningComponent(job: Pick<UpdateJob, 'action' | 'component'>): string {
  return jobComponent(job.action === 'check' ? `check:${job.component ?? ''}` : (job.component ?? ''));
}

export function mmss(s: number) {
  s = Math.max(0, Math.floor(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function verText(job: Pick<UpdateJob, 'from' | 'to'> | null, fallback: string) {
  if (!job?.from && !job?.to) return fallback;
  if (job.from && job.to && job.from !== job.to) return `${job.from} → ${job.to}`;
  return job.to ?? job.from ?? fallback;
}

export interface Verdict {
  tone: 'acc' | 'ok' | 'warn';
  text: string;
  /** One component with an update: the version on offer. */
  update?: string;
}

/** What a finished check found, for the modal and its toast. */
export function checkVerdict(st: Pick<UpdatesStatus, 'check'>, comp: string): Verdict {
  const all = st.check?.components ?? {};
  const list = comp === 'all' ? ['app', 'amneziawg', 'packages'] : [comp];
  const found: string[] = [];
  let update: string | undefined;
  for (const k of list) {
    const c = all[k];
    if (!c) continue;
    if (c.error) return { tone: 'warn', text: c.error };
    if (k === 'packages' && c.updates) found.push(plural(c.updates, '%s system package', '%s system packages'));
    else if (k !== 'packages' && c.update && c.installed && c.latest) {
      found.push(`${componentName(k)} ${c.latest}`);
      if (comp !== 'all') update = c.latest;
    }
  }
  if (found.length) return { tone: 'acc', text: fmt(_('Update available: %s'), found.join(', ')), update };
  const one = list.length === 1 ? all[list[0]] : null;
  if (one?.status === 'dev') return { tone: 'acc', text: fmt(_('Installed version is newer than the release (%s)'), one.latest) };
  if (one?.note) return { tone: 'warn', text: one.note };
  return { tone: 'ok', text: list.length > 1 ? _('Everything is up to date') : _('Latest version is installed') };
}

/**
 * Whether a job seen in updates_status is the one this click started: the
 * known id, else a job other than the one before the click that is running
 * or started at or after `since` (router time taken before starting).
 */
export function isOurJob(
  j: Pick<UpdateJob, 'id' | 'state' | 'started'>,
  id: string | undefined,
  prevId: string | undefined,
  since: number,
) {
  if (id) return j.id === id;
  if (prevId && j.id === prevId) return false;
  return j.state === 'running' || (since > 0 && j.started >= since);
}
