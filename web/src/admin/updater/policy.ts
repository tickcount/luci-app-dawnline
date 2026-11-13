// Settings → automatic updates as the System page's choice rows say them:
// how often it checks ("Off" is a choice of the same row), and whether and
// when it installs. Each choice maps to the settings it saves, and back from
// the policy the router reports. Pure.

import type { UpdatePolicy } from '../api';

export type CheckChoice = 'off' | UpdatePolicy['interval'];
export type InstallChoice = 'off' | UpdatePolicy['mode'];

/** The "Check" row's choice from the policy. */
export const checkChoice = (p: Pick<UpdatePolicy, 'check' | 'interval'>): CheckChoice => (p.check ? p.interval : 'off');

/** What a "Check" choice saves (off keeps the interval for later). */
export const checkValues = (c: CheckChoice): Record<string, string> =>
  c === 'off' ? { update_check: '0' } : { update_check: '1', update_interval: c };

/** The "Install" row's choice from the policy. */
export const installChoice = (p: Pick<UpdatePolicy, 'auto' | 'mode'>): InstallChoice => (p.auto ? p.mode : 'off');

/** What an "Install" choice saves (off keeps the mode and time for later). */
export const installValues = (c: InstallChoice): Record<string, string> =>
  c === 'off' ? { update_auto: '0' } : { update_auto: '1', update_mode: c };

const HOURS: Record<UpdatePolicy['interval'], number> = { '6h': 6, '12h': 12, '1d': 24, '7d': 168 };

/** When the next automatic check is due (router time), or 0: none is scheduled or the first has not run yet. */
export function nextCheck(p: Pick<UpdatePolicy, 'check' | 'interval'>, last: number | undefined): number {
  if (!p.check || !last) return 0;
  return last + (HOURS[p.interval] ?? 24) * 3600;
}

/** An automatic install would take this component (`app`, `amneziawg`, `packages`). */
export const autoInstalls = (p: Pick<UpdatePolicy, 'auto' | 'targets'>, comp: UpdatePolicy['targets'][number]): boolean =>
  p.auto && p.targets.includes(comp);
