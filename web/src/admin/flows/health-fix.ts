// Running a Health check's fix where it stands: in the Settings section the
// check is about (pages/settings/health.ts), or in Overview's list for a
// check no section is about (pages/overview/health.ts). A fix on the router
// (health_fix) answers with the checks as they stand after it; a network
// restart asks first (every interface restarts) and the checks are run again
// once the network is back; an `install:` fix opens the install sheet
// (flows/install.ts) with what the feature still needs; «Open Updates» leads
// to that section of Settings. An error is said in a toast and nothing
// changes.

import { api, type Health, type Needs } from '../api';
import { closeSheet, openSheet } from '../../portal/ui/sheet';
import { settingsUrl } from '../shell/routes';
import { say } from '../shell/toast';
import { visit } from '../shell/visit';
import { errorText, notify } from '../ui/toast';
import { askView } from './ask';
import { installSheet } from './install';

/** The network restarts a second after the router's answer: the checks are looked at again once it is back (ms). */
const NET_BACK = 5000;

export interface FixPage {
  /** The checks as the fix left them. */
  took(r: Health): void;
  /** Run the checks again and read the router (after an install, after the network is back). */
  again(): void;
}

/** On the router: the answer is the checks after it. */
async function onRouter(fix: string, page: FixPage) {
  page.took(await api.healthFix(fix));
  say(_('Done'));
  if (fix === 'netrestart') setTimeout(page.again, NET_BACK);
}

export async function runFix(fix: string, page: FixPage): Promise<void> {
  if (fix === 'updates') return visit(settingsUrl('updates'));
  if (fix.startsWith('install:')) {
    const feature = fix.slice(8) as keyof Needs;
    // AmneziaWG's packages are picked by the updater itself; the others' are listed by it
    const needs = feature === 'awg' ? [] : ((await api.updatesStatus().catch(() => null))?.needs?.[feature] ?? []);
    return installSheet(feature, needs, page.again);
  }
  if (fix !== 'netrestart') return onRouter(fix, page).catch((e) => void notify(errorText(e), 'error', 10000));
  openSheet(() =>
    askView({
      icon: 'refresh',
      tone: 'orange',
      title: _('Restart the network?'),
      text: [_('Every interface restarts. Connections drop for a few seconds.')],
      action: _('Restart network'),
      cls: 'warn',
      run: async () => {
        await onRouter(fix, page);
        closeSheet();
      },
    }),
  );
}
