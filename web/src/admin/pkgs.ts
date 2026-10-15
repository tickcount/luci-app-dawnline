// Installing a missing package from wherever a feature is turned on: runs the
// updater job in the operation modal (see ./updater/operation).

import { api, type Needs } from './api';
import { attempt } from './ui/toast';
import { confirmDialog } from './ui/modal';
import { runOperation } from './updater/operation';

const WHAT: Record<keyof Needs, string> = {
  https: 'HTTPS for the portal',
  acme: 'ACME certificates',
  home: 'the home-like link',
  awg: 'AmneziaWG',
};

/** Ask, then wait for the job; after it `done` runs once the service had a moment to pick the packages up. */
async function install(what: string, label: string, body: string, done?: () => void): Promise<boolean> {
  if (!(await confirmDialog(`Install ${label}?`, body, 'Install'))) return false;
  const job = await runOperation(what, { title: `Installing ${label}` });
  if (job?.state !== 'done') return false;
  // The service restarts to pick them up; give it a moment before reloading.
  setTimeout(() => done?.(), 4000);
  return true;
}

/**
 * AmneziaWG itself: the first build that exists for this firmware (feeds have
 * none). The router loads the module afterwards and, when netifd has to learn
 * the new protocol, restarts the network.
 */
export function installAwg(done?: () => void): Promise<boolean> {
  return install(
    'amneziawg:auto',
    'AmneziaWG',
    'Dawnline installs the AmneziaWG build made for this firmware and loads it. If the network service has to restart to learn it, connections drop for a few seconds.',
    done,
  );
}

/** Install `names` for `feature` in the operation modal; resolves true when it finished, then calls `done`. */
export async function installMissing(feature: keyof Needs, names: string[], done?: () => void): Promise<boolean> {
  if (feature === 'awg') return installAwg(done);
  if (!names.length) return true;
  return install(
    `pkgs:${names.join(',')}`,
    WHAT[feature],
    `${names.join(', ')} from the OpenWrt feeds. Dawnline sets the rest up when they arrive.`,
    done,
  );
}

/** Install what a feature is missing, asking the router what that is now. */
export async function installFeature(feature: keyof Needs, done?: () => void) {
  if (feature === 'awg') return installAwg(done);
  const st = await attempt(() => api.updatesStatus());
  if (st) return installMissing(feature, st.needs?.[feature] ?? [], done);
  return false;
}
