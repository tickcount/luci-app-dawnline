// A device's set-up, as its dialog shows it (pages/server/device-dialog.ts): the two values of its own that are
// written into its configuration, edited in place (ui/edit-rows.ts), then its addresses as the portal's name
// chips, a press copies. The block's head (setupHead) says when the configuration was given out and carries the
// one ⟳ of the values: changing either outdates what the device has. The configuration itself (QR, file, text) is
// one press away, «Show set-up» in the dialog's head, so no file stands here; LAN Bypass is chosen where a
// configuration is made (adding a device, new keys, the portal), not here.

import { h } from '../../portal/dom';
import { EASE_OUT, play } from '../../portal/motion';
import { closeSheet } from '../../portal/ui/sheet';
import { ago } from '../../shared/format';
import { fmt } from '../../shared/i18n';
import type { DeviceLinkPatch } from '../api';
import { ic } from '../ui/icons';
import { copyText } from '../ui/files';
import { reMark, textRow } from '../ui/edit-rows';
import { blockHead } from '../ui/page-head';
import { deviceKeepaliveHelp, deviceMtuHelp } from '../netcheck';
import type { DeviceCtx } from '../people/ctx';
import { askBlock } from '../flows/behind-ask';
import { netsOf } from '../servers/behind';
import { settingsUrl } from '../shell/routes';
import { replaces } from '../../portal/ui/carry';
import { foldLine } from '../../portal/ui/chips-motion';

export interface ConfigActs {
  /** A change to how it connects: saved at once, or asked first once it has connected (pages/device/index.ts change). */
  change(what: string, value: string, patch: DeviceLinkPatch): Promise<boolean>;
}

/** The block's head: when its configuration was given out, and ⟳ when a change here makes the device fetch it again. */
export function setupHead(c: DeviceCtx): HTMLElement {
  const d = c.d;
  const issued = d.config_issued && !d.disabled ? fmt(_('given out %s'), ago(d.config_issued, c.now())) : undefined;
  return blockHead(_('Set-up'), issued, d.handshake && !d.disabled && c.write ? reMark(1) : undefined);
}

export function configCard(c: DeviceCtx, a: ConfigActs): HTMLElement {
  const { d, p, srv } = c;
  // what is written into the configuration: the device's own link values
  const auto = srv ? (d.kind === 'phone' || d.kind === 'tablet' ? srv.mtus.phone : srv.mtus.computer) : d.mtu ? null : d.mtu_used;
  const mtuEmpty = auto ? fmt(_('%s · automatic'), auto) : _('Automatic');
  const kaEmpty = _('As the server');
  const ka = d.keepalive;
  const kaShown = ka == null ? kaEmpty : ka ? fmt(_('%s s'), ka) : _('Off', 'keep-alive');
  const refuse = (help: { text: string; bad: boolean }) => (help.bad ? help.text : null);
  const params = h(
    'div',
    { class: 'kt-params' },
    textRow(
      {
        label: 'MTU',
        value: d.mtu ? String(d.mtu) : mtuEmpty,
        start: d.mtu ? String(d.mtu) : '',
        numeric: true,
        mode: { empty: mtuEmpty, placeholder: _('automatic'), says: _('1280–1500, or empty: automatic'), on: !d.mtu },
        refuse: (v) => refuse(deviceMtuHelp(v)),
        ask: (v) => void a.change('MTU', v || mtuEmpty, { mtu: v }),
      },
      c.write,
    ),
    textRow(
      {
        label: _('Keep-alive'),
        value: kaShown,
        start: ka == null ? '' : String(ka),
        numeric: true,
        mode: { empty: kaEmpty, placeholder: _('as the server'), says: _('Seconds, or empty: as the server'), on: ka == null },
        refuse: (v) => refuse(deviceKeepaliveHelp(v)),
        ask: (v) =>
          void a.change(_('Keep-alive'), v ? (v === '0' ? _('Off', 'keep-alive') : fmt(_('%s s'), v)) : kaEmpty, { keepalive: v }),
      },
      c.write,
    ),
  );

  const chip = (text: string, said: string, label: string, shown: (string | HTMLElement)[] = [text]) =>
    h(
      'button',
      {
        type: 'button',
        class: 'namechip',
        title: `${label}: ${text}`,
        'aria-label': fmt(_('Copy: %s'), label),
        onclick: () => void copyText(text, said),
      },
      h('span', {}, ...shown),
      ic('copy'),
    );
  const host = d.hostname && p.access !== 'internet' ? d.hostname : '';
  const dot = host.indexOf('.');
  const addrs = h(
    'div',
    { class: 'names kt-names' },
    chip(d.address, _('Address copied'), _('Address in the tunnel')),
    host
      ? chip(
          host,
          _('Name copied'),
          _('Name in the network'),
          dot > 0 ? [host.slice(0, dot), h('span', { class: 'faint' }, host.slice(dot))] : [host],
        )
      : null,
  );
  // A router's networks, under its addresses: said here, changed in the server's Network section, where they wait
  // for «Apply» with the server's other changes (the link leads there).
  let behind: HTMLElement[] = [];
  if (d.kind === 'router' && !d.waiting) {
    const nets = netsOf(d);
    behind = [
      h('div', { class: 'kt-lbl' }, _('Networks behind it')),
      h(
        'div',
        { class: 'names kt-names' },
        ...nets.map((n) => chip(n, _('Network copied'), _('Network behind it'))),
        c.write || nets.length
          ? h(
              'a',
              { class: 'pill-link', href: settingsUrl('home', p.server) },
              nets.length ? _('Change') : _('Set in Network'),
              ic('chevron'),
            )
          : h('span', { class: 'faint' }, _('No network behind it')),
      ),
    ];
  }
  // what its owner asked for on their own page is answered here, first in its set-up
  const ask = askBlock({
    p,
    d,
    people: c.st.people,
    srv,
    write: c.write,
    changed: () => void c.refresh(),
    // a router turned down is no device of these pages any more: its dialog goes as its × sends it
    gone: closeSheet,
  });
  const el = h('div', { class: 'kt-conf' }, ask, params, h('div', { class: 'kt-lbl' }, _('Addresses')), addrs, ...behind);
  // The question answered a moment ago (this card drawn again by it, ui/carry.ts): it folds away where it stood,
  // the rows under it coming up, and what the answer brought (the networks taken) comes in after it has begun to.
  const old = replaces(`conf:${d.id}`, el);
  const gone = !ask ? old?.querySelector<HTMLElement>(':scope > .nb-ask') : null;
  if (gone)
    requestAnimationFrame(() => {
      if (!el.isConnected) return;
      foldLine(gone, el, el.firstElementChild);
      behind.forEach((x) =>
        play(
          x,
          [
            { opacity: 0, filter: 'blur(4px)' },
            { opacity: 1, filter: 'blur(0px)' },
          ],
          { duration: 280, easing: EASE_OUT, delay: 110, fill: 'backwards' },
        ),
      );
    });
  return el;
}
