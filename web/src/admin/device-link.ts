// A device's own link in its drawer (./device): what goes wrong with its
// connection (the agent's link state, in words about the device), its MTU and
// keep-alive with a dialog each, and LAN Bypass as it was chosen when the
// device was added. The router checks the values again
// (core.set_device_link); the help lines are ./netcheck's, the state's words
// ./events/model's.

import type { Device, DeviceLink, Person, Server } from '../shared/types';
import { E } from './e';
import { api, type DeviceLinkPatch } from './api';
import { button } from './ui/button';
import { cancelButton, closeModal, modal } from './ui/modal';
import { attempt, notify } from './ui/toast';
import { liveField } from './ui/layout';
import { deviceKeepaliveHelp, deviceMtuHelp, type Help } from './netcheck';
import { linkStateText } from './events/model';
import { fmt } from '../shared/i18n';
import { homeOf, netsLabel } from '../shared/format';

/** Status while the link fails in a named way: the state (warn) and a line on what it means; null for an unknown one. */
export function linkStatus(link: DeviceLink): HTMLElement[] | null {
  const t = linkStateText(link.state);
  return t ? [E('span', { class: 'dl-dstat warn' }, t.title), E('span', { class: 'dl-sub' }, t.line)] : null;
}

/** The MTU a device gets with none of its own: its server's for its kind (null when that is not known). */
function autoMtu(d: Device, srv?: Server): number | null {
  if (srv) return d.kind === 'phone' || d.kind === 'tablet' ? srv.mtus.phone : srv.mtus.computer;
  return d.mtu ? null : (d.mtu_used ?? null);
}

/** One value in a dialog of its own: the field with its help as it is typed, Save through device_update. */
function linkDialog(
  title: string,
  label: string,
  input: HTMLInputElement,
  help: () => Help,
  patch: () => DeviceLinkPatch,
  id: string,
  saved: () => unknown,
) {
  const field = liveField(label, input, help);
  modal(
    title,
    [field],
    [
      cancelButton(),
      ' ',
      button(
        _('Save'),
        async () => {
          const h = field.help();
          if (h.bad) {
            notify(h.text, 'warning');
            return;
          }
          if (await attempt(() => api.deviceUpdate(id, undefined, undefined, patch()), _('Saved'))) {
            closeModal();
            await saved();
          }
        },
        'positive',
      ),
    ],
  );
  setTimeout(() => input.select(), 50);
}

/** A number field for a link value: the device's own, or empty for what it gets without one (`placeholder`). */
function numberInput(value: number | null | undefined, placeholder: string | null): HTMLInputElement {
  return E('input', {
    type: 'text',
    class: 'cbi-input-text',
    inputmode: 'numeric',
    maxlength: 4,
    value: value == null ? '' : String(value),
    placeholder,
  }) as HTMLInputElement;
}

function mtuDialog(d: Device, srv: Server | undefined, saved: () => unknown) {
  const auto = autoMtu(d, srv);
  const input = numberInput(d.mtu || null, auto ? fmt(_('Automatic: %s'), auto) : null);
  linkDialog(
    fmt(_('MTU of %s'), d.name),
    'MTU',
    input,
    () => deviceMtuHelp(input.value),
    () => ({ mtu: input.value.trim() }),
    d.id,
    saved,
  );
}

function keepaliveDialog(d: Device, srv: Server | undefined, saved: () => unknown) {
  const input = numberInput(d.keepalive, srv ? fmt(_('As the server: %s'), srv.keepalive) : null);
  linkDialog(
    fmt(_('Keep-alive of %s'), d.name),
    _('Keep-alive'),
    input,
    () => deviceKeepaliveHelp(input.value),
    () => ({ keepalive: input.value.trim() }),
    d.id,
    saved,
  );
}

/**
 * Details rows as [label, value]: the MTU and keep-alive its configuration
 * carries, each with Change (its own dialog, then `saved`), and LAN Bypass as
 * it was chosen when the device was added.
 */
export function linkRows(d: Device, p: Person, srv: Server | undefined, saved: () => unknown): [string, Node][] {
  const home = homeOf(p, srv);
  // Two buttons say "Change": each is named after its row for a screen reader.
  const value = (v: string, from: string, name: string, change: () => void) =>
    E('span', { class: 'dl-kv-act' }, [
      E('span', {}, [v, from ? [' ', E('span', { class: 'dl-faint' }, from)] : '']),
      E('button', { type: 'button', class: 'dl-linkbtn', 'aria-label': name, click: change }, _('Change')),
    ]);
  const ka = d.keepalive_used;
  return [
    [
      'MTU',
      value(d.mtu_used == null ? '—' : String(d.mtu_used), d.mtu ? '' : _('automatic'), _('Change the MTU'), () =>
        mtuDialog(d, srv, saved),
      ),
    ],
    [
      _('Keep-alive'),
      value(
        ka == null ? '—' : ka ? fmt(_('%s s'), ka) : _('Off'),
        d.keepalive != null ? '' : _('as the server'),
        _('Change the keep-alive'),
        () => keepaliveDialog(d, srv, saved),
      ),
    ],
    [
      _('LAN Bypass'),
      E('span', {}, [
        !d.lan_bypass ? _('Off') : home.length ? fmt(_('On, except %s (home)'), netsLabel(home)) : _('On'),
        ' ',
        E('span', { class: 'dl-faint' }, _('set when it was added')),
      ]),
    ],
  ];
}
