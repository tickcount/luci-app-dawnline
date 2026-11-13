// Installing what a feature is missing (AmneziaWG for a new server, the
// home-like link's packages, HTTPS or ACME for the portal): the question in
// the portal's sheet, then the updater's job in the same sheet
// (flows/operation.ts). The words are updater/install.ts's.

import type { Needs } from '../api';
import { runOperation } from './operation';
import { installOf } from '../updater/install';

/** What is installed, as the question's glass: the feature's own picture (flows/packages.ts), AmneziaWG's mark. */
const ICON: Record<keyof Needs, string> = { https: 'lock', acme: 'cert', home: 'home', awg: 'amneziawg' };

/** Ask, then install `names` for `feature` in the sheet; `done` once it finished and the service had a moment. */
export function installSheet(feature: keyof Needs, names: string[], done?: () => void) {
  const it = installOf(feature, names);
  runOperation({
    what: it.what,
    title: it.title,
    ask: { icon: ICON[feature], tone: 'blue', title: it.ask, text: [it.body], action: _('Install'), cls: 'accent' },
    // the service restarts to pick them up: a moment before the page reads again
    done: () => setTimeout(() => done?.(), 4000),
  });
}
