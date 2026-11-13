// The router's own sections of Settings, by name: the one on screen
// (Updates, Personal portal, New people, History and storage, Backups,
// Remove Dawnline: each a module here) and the six entries they have on the
// rail, each with its state in a few words (system/model.ts).

import type { RailItem } from '../../../ui/rail';
import { whenAt } from '../../../events/clock';
import {
  certDays,
  defaultsWord,
  historyWord,
  portalHealth,
  portalWord,
  updatesHealth,
  updatesWord,
  type RailWord,
} from '../../../system/model';
import type { RouterPart } from '../route';
import type { RouterCtx } from './ctx';
import { backupsSection } from './backups';
import { defaultsSection } from './defaults';
import { historySection } from './history';
import { portalSection } from './portal';
import { removeSection } from './remove';
import { updatesSection } from './updates';

/** One section, drawn from what the router says now; `notice`: the slot of the notice of a new version of Dawnline, for Updates. */
export function routerSection(part: RouterPart, y: RouterCtx, notice: HTMLElement): HTMLElement {
  switch (part) {
    case 'updates':
      return updatesSection(y, notice);
    case 'portal':
      return portalSection(y);
    case 'defaults':
      return defaultsSection(y);
    case 'history':
      return historySection(y);
    case 'backups':
      return backupsSection(y);
    case 'remove':
      return removeSection(y);
  }
}

/** The sections' rail entries, in their order; `href`: a section's address. */
export function routerRail(y: RouterCtx, href: (id: RouterPart) => string): RailItem[] {
  const eff = y.set.effective as { portal_enabled?: boolean; portal_host?: string };
  const portal = portalWord({
    enabled: !!eff.portal_enabled,
    host: eff.portal_host ?? '',
    blocked: !!y.set.needs?.https?.length,
    days: certDays(y.set.cert, y.now()),
    failed: eff.portal_enabled ? portalHealth(y.checks ?? y.portal?.checks ?? []).failed : [],
  });
  const item = (id: RouterPart, icon: string, line: string, title: string, word?: RailWord): RailItem => ({
    id,
    icon,
    line,
    title,
    value: word?.text,
    tone: word?.tone,
    href: href(id),
  });
  return [
    item('updates', 'update', 'update', _('Updates'), updatesWord(y.upd, updatesHealth(y.checks ?? []))),
    item('portal', 'portal', 'window', _('Personal portal'), portal),
    item('defaults', 'newperson', 'newperson', _('New people'), defaultsWord(Number(y.set.settings.default_device_limit) || 3)),
    item('history', 'storage', 'storage', _('History and storage'), historyWord(y.set.logs.policy.keep_days)),
    item('backups', 'backup', 'archive', _('Backups'), {
      text: y.backups.length ? whenAt(y.backups[0].created, y.now(), y.st.tz) : _('no backups'),
    }),
    item('remove', 'trash', 'trash', _('Remove Dawnline')),
  ];
}
