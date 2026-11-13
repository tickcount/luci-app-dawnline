// Installing what a feature is missing, in words and as the updater's job
// (updates_run): the question, the job's title and what it does. Pure: the
// pages run it in a sheet (flows/install.ts).

import type { Needs } from '../api';
import { fmt } from '../../shared/i18n';

export interface Install {
  /** What updates_run gets. */
  what: string;
  ask: string;
  title: string;
  body: string;
}

/** Installing `names` for `feature` (AmneziaWG: the build made for this firmware, whatever the names). */
export function installOf(feature: keyof Needs, names: string[]): Install {
  const t: Record<keyof Needs, [string, string]> = {
    https: [_('Install HTTPS for the portal?'), _('Installing HTTPS for the portal')],
    acme: [_('Install ACME certificates?'), _('Installing ACME certificates')],
    home: [_('Install the home-like link?'), _('Installing the home-like link')],
    awg: [_('Install AmneziaWG?'), _('Installing AmneziaWG')],
  };
  const [ask, title] = t[feature];
  if (feature === 'awg')
    return {
      what: 'amneziawg:auto',
      ask,
      title,
      body: _(
        'Dawnline installs the AmneziaWG build made for this firmware and loads it. If the network service has to restart to learn it, connections drop for a few seconds.',
      ),
    };
  return {
    what: `pkgs:${names.join(',')}`,
    ask,
    title,
    body: fmt(_('%s from the OpenWrt feeds. Dawnline sets the rest up when they arrive.'), names.join(', ')),
  };
}
