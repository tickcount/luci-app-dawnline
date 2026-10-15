// Installing a missing package from wherever a feature is turned on: runs the
// updater job and follows it with toasts.

import { api, type Needs } from './api';
import { attempt, confirmDialog, notify } from './ui';

const WHAT: Record<keyof Needs, string> = { https: 'HTTPS for the portal', acme: 'ACME certificates', home: 'the home-like link' };
const WAIT_MS = 5 * 60 * 1000;

/** Install `names` for `feature`; resolves true when the job finished, then calls `done`. */
export async function installMissing(feature: keyof Needs, names: string[], done?: () => void): Promise<boolean> {
  if (!names.length) return true;
  const ok = await confirmDialog(
    `Install ${WHAT[feature]}?`,
    `${names.join(', ')} from the OpenWrt feeds. Dawnline sets the rest up when they arrive.`,
    'Install',
  );
  if (!ok) return false;
  // The previous job stays in the status until the updater starts: wait for a new one.
  const before = (await api.updatesStatus().catch(() => null))?.job?.started ?? 0;
  if (!(await attempt(() => api.updatesRun(`pkgs:${names.join(',')}`)))) return false;
  notify(`Installing ${names.join(', ')}…`, 'info', 4000);
  const until = Date.now() + WAIT_MS;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 2000));
    const st = await api.updatesStatus().catch(() => null);
    const job = st?.job;
    if (!job || job.started === before || job.state === 'running') continue;
    if (job.state === 'done') {
      notify(`${names.join(', ')} installed`, 'success');
      // The service restarts to pick them up; give it a moment before reloading.
      setTimeout(() => done?.(), 4000);
      return true;
    }
    notify(job.error ?? 'Installation failed', 'error');
    return false;
  }
  notify('Still installing: see Updates for the log.', 'warning');
  return false;
}

/** Install what a feature is missing, asking the router what that is now. */
export async function installFeature(feature: keyof Needs, done?: () => void) {
  const st = await attempt(() => api.updatesStatus());
  if (st) return installMissing(feature, st.needs?.[feature] ?? [], done);
  return false;
}
