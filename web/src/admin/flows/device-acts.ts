// What is done to one device from its ⋯ (its own page, or its card on its
// person's page): turned off or on in one tap, said with Undo; its traffic
// history reset and the device removed, each after a question in the sheet
// (neither can be taken back).

import type { Device } from '../../shared/types';
import { api } from '../api';
import { closeSheet, openSheet } from '../../portal/ui/sheet';
import { fmt } from '../../shared/i18n';
import { errorText, notify } from '../ui/toast';
import { say } from '../shell/toast';
import { askView } from './ask';

export interface DeviceActCtx {
  device: Device;
  /** Read the router again and draw what changed. */
  reload(): void;
  /** It is gone (removed): where the page goes now. */
  removed?(): void;
}

/** Turn it off or on: one tap, said with its Undo. */
export async function toggleDevice(c: DeviceActCtx, off: boolean) {
  const d = c.device;
  try {
    await api.deviceUpdate(d.id, undefined, off);
  } catch (e) {
    notify(errorText(e), 'error', 10000);
    return;
  }
  c.reload();
  say(off ? fmt(_('%s is turned off'), d.name) : fmt(_('%s is turned on'), d.name), {
    undo: () => void api.deviceUpdate(d.id, undefined, !off).then(() => c.reload()),
    undone: off ? fmt(_('%s is turned on'), d.name) : fmt(_('%s is turned off'), d.name),
  });
}

/** Reset its traffic history, after a question. */
export function resetDeviceTraffic(c: DeviceActCtx) {
  const d = c.device;
  openSheet(() =>
    askView({
      icon: 'chart',
      tone: 'red',
      title: fmt(_('Reset traffic history for %s?'), d.name),
      text: [fmt(_("Clears %s's daily and monthly traffic history. Their person's totals and data limit are not changed."), d.name)],
      action: _('Reset'),
      cls: 'red',
      run: async () => {
        await api.usageClear('device', d.id);
        closeSheet();
        say(_('Traffic history reset'));
        c.reload();
      },
    }),
  );
}

/** Remove it, after a question. */
export function removeDevice(c: DeviceActCtx) {
  const d = c.device;
  openSheet(() =>
    askView({
      icon: 'trash',
      tone: 'red',
      title: fmt(_('Remove %s?'), d.name),
      text: [_('Its configuration stops working at once. It can be added again here or on the portal.')],
      action: _('Remove'),
      cls: 'red',
      run: async () => {
        await api.deviceDelete(d.id);
        closeSheet();
        notify(fmt(_('%s removed'), d.name), 'success', 3000);
        if (c.removed) c.removed();
        else c.reload();
      },
    }),
  );
}
