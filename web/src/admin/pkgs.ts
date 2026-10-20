// Installing a missing package from wherever a feature is turned on: runs the
// updater job in the operation modal (see ./updater/operation).

import { api, type Needs } from './api';
import { attempt } from './ui/toast';
import { confirmDialog } from './ui/modal';
import { runOperation } from './updater/operation';
import { fmt } from '../shared/i18n';

/** What installing a feature's packages is called: the question, then the operation's title. */
function texts(feature: keyof Needs): [string, string] {
  const t: Record<keyof Needs, [string, string]> = {
    https: [_('Install HTTPS for the portal?'), _('Installing HTTPS for the portal')],
    acme: [_('Install ACME certificates?'), _('Installing ACME certificates')],
    home: [_('Install the home-like link?'), _('Installing the home-like link')],
    awg: [_('Install AmneziaWG?'), _('Installing AmneziaWG')],
  };
  return t[feature];
}

/** Ask, then wait for the job; after it `done` runs once the service had a moment to pick the packages up. */
async function install(what: string, feature: keyof Needs, body: string, done?: () => void): Promise<boolean> {
  const [ask, title] = texts(feature);
  if (!(await confirmDialog(ask, body, _('Install')))) return false;
  const job = await runOperation(what, { title });
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
    'awg',
    _(
      'Dawnline installs the AmneziaWG build made for this firmware and loads it. If the network service has to restart to learn it, connections drop for a few seconds.',
    ),
    done,
  );
}

/** Install `names` for `feature` in the operation modal; resolves true when it finished, then calls `done`. */
export async function installMissing(feature: keyof Needs, names: string[], done?: () => void): Promise<boolean> {
  if (feature === 'awg') return installAwg(done);
  if (!names.length) return true;
  return install(
    `pkgs:${names.join(',')}`,
    feature,
    fmt(_('%s from the OpenWrt feeds. Dawnline sets the rest up when they arrive.'), names.join(', ')),
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
