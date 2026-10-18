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
import { KIND_LABEL, ago, byDeviceState, bytes } from '../../../shared/format';
import { addDevice, openDevice, quickMenu } from '../../device';
import { dayBars } from '../../widgets/tiles';
import type { PersonPage } from './index';

/** Setting up a device: its QR code (key and file one tap away). */
async function showDeviceQr(page: PersonPage, d: Device) {
  const cfg = await attempt(() => api.deviceConfig(d.id));
  if (!cfg) return;
  modal(`Set up ${d.name}`, [await page.core.connectBlock(cfg, 'qr')], [cancelButton('Close')]);
}

async function downloadConfig(page: PersonPage, d: Device) {
  const cfg = await attempt(() => api.deviceConfig(d.id));
  if (!cfg) return;
  if (!cfg.has_private_key) {
    notify('This device made its own keys in the browser; its configuration only exists there.', 'warning');
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
      title: 'QR, file, key, rename, new keys, remove',
      class: 'cbi-button cbi-button-neutral dl-icon-only',
    });
  const cards = byDeviceState(p.devices).map((d) => {
    const head = E('div', { class: 'dl-dcard-head' }, [
      E('span', { class: 'dl-dcard-ic' }, icon(d.kind)),
      E('button', { type: 'button', class: 'dl-dcard-title', click: () => open(d) }, [
        E('b', {}, d.name),
        deviceStatus(d, now, undefined, p),
        d.config_stale ? E('span', { class: 'dl-pill warn dl-stale' }, 'Update config') : '',
      ]),
      more(d),
    ]);
    const trend = E('div', { class: 'dl-dcard-trend' }, [
      E('div', { class: 'dl-stack' }, [E('b', {}, bytes(d.month[0] + d.month[1])), E('span', { class: 'dl-sub' }, 'this month')]),
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
              `${KIND_LABEL[d.kind]} · created ${ago(d.created, now)} ${d.created_by === 'portal' ? 'in the portal' : 'by you'}.`,
            )
          : E('div', { class: 'dl-chips-row' }, [
              E('button', { type: 'button', class: 'dl-chipbtn', click: () => showDeviceQr(page, d) }, [icon('qr'), 'Show QR']),
              E('button', { type: 'button', class: 'dl-chipbtn', click: () => downloadConfig(page, d) }, [icon('download'), 'Config']),
            ]),
    ]);
  });
  // Always the last card: admins may add over the person's limit, it says so.
  const over = p.devices.length >= p.device_limit;
  cards.push(
    E('button', { type: 'button', class: 'dl-dslot add', click: () => addDevice(p, page.deviceOpts()) }, [
      E('span', { class: 'dl-dslot-ic' }, icon('plus')),
      E('span', { class: 'dl-stack' }, [
        E('b', {}, 'Add device'),
        E(
          'span',
          { class: 'dl-sub' },
          over ? `Over the limit · ${p.devices.length} of ${p.device_limit}` : `${p.devices.length} of ${p.device_limit}`,
        ),
      ]),
    ]),
  );
  return E('section', { class: 'dl-devsec' }, [
    E('div', { class: 'dl-panel-head' }, [E('h3', {}, 'Devices'), E('span', { class: 'dl-sub' }, `${p.online} online`)]),
    E('div', { class: 'dl-dgrid' }, cards),
  ]);
}
