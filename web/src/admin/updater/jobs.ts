// Updater jobs in words: which component a job is about, its versions, its
// timer and what a finished check found. Pure (no DOM, no RPC).

import type { UpdateJob, UpdatesStatus } from '../api';
import { fmt, plural } from '../../shared/i18n';
import { routerSaid } from '../failure';

/** A component's name in words; undefined for "all" and unknown ones. */
function componentName(comp: string): string | undefined {
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

/** A job found running, as its sheet's title: what it does to which component. */
export function jobTitle(job: Pick<UpdateJob, 'action' | 'component'>): string {
  const comp = runningComponent(job);
  if (job.action === 'check')
    return comp === 'app'
      ? _('Checking Dawnline')
      : comp === 'amneziawg'
        ? _('Checking AmneziaWG')
        : comp === 'packages' || comp === 'pkgs'
          ? _('Checking system packages')
          : _('Checking all components');
  const what = job.component ?? '';
  if (what === 'app:nolang') return _('Removing the Russian translation');
  if (what.startsWith('app:lang:')) return _('Adding the Russian translation');
  if (comp === 'app') return _('Updating Dawnline');
  if (comp === 'amneziawg') return _('Updating AmneziaWG');
  return comp === 'pkgs' ? _('Updating system packages') : _('Updating components');
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

/** A job's picture: the mark of the component it is about, the updates' own for all of them. */
export function jobIcon(comp: string): string {
  if (comp === 'app') return 'dawnline';
  if (comp === 'amneziawg') return 'amneziawg';
  return comp === 'packages' || comp === 'pkgs' ? 'openwrt' : 'update';
}

/** One component after a check: where it stands, in a few words (`mono`: they are versions). */
export interface Found {
  icon: string;
  name: string;
  /** new: a newer one is out; ok: nothing newer; bad: its check failed; quiet: something else to say. */
  tone: 'new' | 'ok' | 'bad' | 'quiet';
  line: string;
  mono?: boolean;
}

export interface Verdict {
  /** The worst of the rows: a failed check, else an update, else all fine. */
  tone: 'bad' | 'new' | 'ok';
  title: string;
  rows: Found[];
  /** One component was checked and has an update: the version on offer. */
  update?: string;
}

/** What a finished check found: a row a component, and the whole of it in a title. */
export function checkVerdict(st: Pick<UpdatesStatus, 'check'>, comp: string): Verdict {
  const all = st.check?.components ?? {};
  const list = comp === 'all' ? ['app', 'amneziawg', 'packages'] : [comp];
  const rows: Found[] = [];
  let update: string | undefined;
  for (const k of list) {
    const c = all[k];
    if (!c) continue;
    const row = (tone: Found['tone'], line: string, mono = false) =>
      rows.push({ icon: jobIcon(k), name: componentName(k) ?? k, tone, line, mono });
    if (c.error) row('bad', routerSaid(c.error) ?? '');
    else if (k === 'packages') row(c.updates ? 'new' : 'ok', c.updates ? plural(c.updates, '%s update', '%s updates') : _('Up to date'));
    else if (c.update && c.installed && c.latest) {
      row('new', `${c.installed} → ${c.latest}`, true);
      if (comp !== 'all') update = c.latest;
    } else if (c.status === 'dev') row('ok', fmt(_('Newer than the release (%s)'), c.latest ?? ''));
    else if (c.note) row('quiet', c.note);
    else if (!c.installed) row('quiet', _('Not installed'));
    else row('ok', c.installed, true);
  }
  const found = rows.filter((r) => r.tone === 'new').length;
  if (rows.some((r) => r.tone === 'bad'))
    return { tone: 'bad', title: rows.length > 1 ? _('Not everything was checked') : _('The check failed'), rows };
  if (found) return { tone: 'new', title: N_(found, 'There is an update', 'There are updates'), rows, update };
  return { tone: 'ok', title: rows.length > 1 ? _('Everything is up to date') : _('Latest version is installed'), rows };
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

/** A step of a job: done, under way, or where it failed. */
export interface Step {
  title: string;
  state: 'ok' | 'run' | 'bad';
}

/**
 * The phases a job went through, as its steps: `seen` with `phase` added when it is a new one (the updater says
 * each step once and repeats it on every status; "Finished" is the end, not a step).
 */
export function addPhase(seen: string[], phase: string | null | undefined, finished: string): string[] {
  const p = (phase ?? '').trim();
  if (!p || p === finished || seen[seen.length - 1] === p) return seen;
  return [...seen, p];
}

/** A job's steps on a track: those it went through done, the last one under way while it runs (or where it failed). */
export function phaseSteps(seen: string[], state: UpdateJob['state']): Step[] {
  return seen.map((title, i) => ({
    title,
    state: i < seen.length - 1 || state === 'done' ? 'ok' : state === 'failed' ? 'bad' : 'run',
  }));
}
