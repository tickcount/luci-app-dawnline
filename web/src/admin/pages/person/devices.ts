// Person page: the device cards (click one for its drawer) and the Add device slot.

import type { Device } from '../../../shared/types';
import { E } from '../../e';
import { api } from '../../api';
import { button } from '../../ui/button';
import { cancelButton, modal } from '../../ui/modal';
import { downloadFile } from '../../ui/files';
import { attempt, notify } from '../../ui/toast';
import { deviceStatus } from '../../ui/badges';
import { icon } from '../../../shared/icons';
import { kindLabel, ago, byDeviceState, bytes } from '../../../shared/format';
import { fmt, num } from '../../../shared/i18n';
import { addDevice, openDevice, quickMenu } from '../../device';
import { dayBars } from '../../widgets/tiles';
import type { PersonPage } from './index';

/** Setting up a device: its QR code (key and file one tap away). */
async function showDeviceQr(page: PersonPage, d: Device) {
  const cfg = await attempt(() => api.deviceConfig(d.id, true));
  if (!cfg) return;
  modal(fmt(_('Set up %s'), d.name), [await page.core.connectBlock(cfg, 'qr')], [cancelButton(_('Close'))]);
}

async function downloadConfig(page: PersonPage, d: Device) {
  const cfg = await attempt(() => api.deviceConfig(d.id, true));
  if (!cfg) return;
  if (!cfg.has_private_key) {
    notify(_('This device made its own keys in the browser; its configuration only exists there.'), 'warning');
    return;
  }
  const f = page.core.file.make(cfg);
  downloadFile(f.name, f.text, 'application/octet-stream');
}

export function devicesPart(page: PersonPage): HTMLElement {
  const p = page.p;
  const now = page.st.now;
  const open = (d: Device) => openDevice(p, d, page.deviceOpts());
  // The card opens the device's panel; its buttons (⋯, setup chips) do their own thing.
  const clickCard = (d: Device) => (ev: Event) => {
    if (!(ev.target as HTMLElement).closest('button:not(.dl-dcard-title), a')) void open(d);
  };
  const more = (d: Device) =>
    button([icon('more')], (ev: MouseEvent) => quickMenu(ev.currentTarget as HTMLElement, p, d, page.deviceOpts()), 'neutral', {
      title: _('QR, file, key, rename, new keys, remove'),
      class: 'cbi-button cbi-button-neutral dl-icon-only',
    });
  const cards = byDeviceState(p.devices).map((d) => {
    const head = E('div', { class: 'dl-dcard-head' }, [
      E('span', { class: 'dl-dcard-ic' }, icon(d.kind)),
      E('button', { type: 'button', class: 'dl-dcard-title', click: () => open(d) }, [
        E('b', {}, d.name),
        deviceStatus(d, now, undefined, p),
        d.config_stale ? E('span', { class: 'dl-pill warn dl-stale' }, _('Update config')) : '',
      ]),
      more(d),
    ]);
    const trend = E('div', { class: 'dl-dcard-trend' }, [
      E('div', { class: 'dl-stack' }, [E('b', {}, bytes(d.month[0] + d.month[1])), E('span', { class: 'dl-sub' }, _('this month'))]),
      dayBars(page.devSeries[d.id] ?? []),
    ]);
    return E('article', { class: `dl-dcard clickable${d.online ? ' online' : ''}${d.disabled ? ' off' : ''}`, click: clickCard(d) }, [
      head,
      d.handshake
        ? trend
        : d.disabled
          ? E(
              'div',
              { class: 'dl-sub' },
              `${kindLabel(d.kind)} · ${fmt(d.created_by === 'portal' ? _('created %s in the portal.') : _('created %s by you.'), ago(d.created, now))}`,
            )
          : E('div', { class: 'dl-chips-row' }, [
              E('button', { type: 'button', class: 'dl-chipbtn', click: () => showDeviceQr(page, d) }, [icon('qr'), _('Show QR')]),
              E('button', { type: 'button', class: 'dl-chipbtn', click: () => downloadConfig(page, d) }, [icon('download'), _('Config')]),
            ]),
    ]);
  });
  // Always the last card: admins may add over the person's limit, it says so.
  const over = p.devices.length >= p.device_limit;
  cards.push(
    E('button', { type: 'button', class: 'dl-dslot add', click: () => addDevice(p, page.deviceOpts()) }, [
      E('span', { class: 'dl-dslot-ic' }, icon('plus')),
      E('span', { class: 'dl-stack' }, [
        E('b', {}, _('Add device')),
        E(
          'span',
          { class: 'dl-sub' },
          over
            ? `${_('Over the limit')} · ${fmt(_('%s of %s'), p.devices.length, p.device_limit)}`
            : fmt(_('%s of %s'), p.devices.length, p.device_limit),
        ),
      ]),
    ]),
  );
  return E('section', { class: 'dl-devsec' }, [
    E('div', { class: 'dl-panel-head' }, [E('h3', {}, _('Devices')), E('span', { class: 'dl-sub' }, fmt(_('%s online'), num(p.online)))]),
    E('div', { class: 'dl-dgrid' }, cards),
  ]);
}
