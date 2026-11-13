// New keys for a device (the portal's Reconnect, the admin's way): what it is
// and LAN Bypass asked again, then the set-up of the new keys with the wait
// for its first connection (flows/setup.ts). Its configuration stops working
// at once: the sheet says so before the button.

import type { Device, Person, Server } from '../../shared/types';
import { api } from '../api';
import { h } from '../../portal/dom';
import { go, head, openSheet, sub, type View } from '../../portal/ui/sheet';
import { once } from '../../portal/ui/feedback';
import { kindOf, kindTiles } from '../../portal/flows/device-form';
import { PICKS, pickOf, type KindPick } from '../../shared/format';
import { fmt } from '../../shared/i18n';
import { errorText, notify } from '../ui/toast';
import { ic } from '../ui/icons';
import { adminLan } from './device-form';
import { setupView, type SetupCtx } from './setup';
import { loadQr } from '../shell/qr';

export interface KeysCtx {
  person: Person;
  device: Device;
  server?: Server;
  now: () => number;
  /** Once the new keys are made (the page reads the status again). */
  made?: () => void;
  setup?: Pick<SetupCtx, 'fresh' | 'done'>;
}

function vNewKeys(c: KeysCtx): View {
  const d = c.device;
  let pick: KindPick = pickOf(d.kind);
  let bypass = d.lan_bypass;
  const kinds = kindTiles(PICKS, (k) => (pick = k));
  kinds.set(pick);
  const lan = adminLan(c.person, c.server, bypass, (on) => (bypass = on));
  const run = async () => {
    try {
      const kind = kindOf(pick, d.kind);
      const kit = loadQr().catch(() => undefined);
      const cfg = await api.deviceRotate(d.id, kind, bypass);
      await kit;
      c.made?.();
      go(() =>
        setupView(
          { person: c.person, device: { ...d, kind, lan_bypass: bypass, handshake: 0, online: false }, now: c.now, ...c.setup },
          cfg,
          'top',
        ),
      );
    } catch (e) {
      notify(errorText(e), 'error', 10000);
    }
  };
  const goBtn = h(
    'button',
    { type: 'button', class: 'btn warn block nk-go', onclick: (ev: Event) => once(ev.currentTarget as HTMLButtonElement, run) },
    ic('refresh'),
    h('span', {}, _('Issue new keys')),
  );
  const title = fmt(_('New keys · %s'), d.name);
  const el = h(
    'div',
    { class: 'view' },
    head(title),
    sub(_('Its configuration stops working at once. Set the device up again: the new one opens next.')),
    kinds.el,
    lan,
    goBtn,
  );
  return { el, label: title };
}

export const newKeys = (c: KeysCtx) => openSheet(() => vNewKeys(c));
