// A device's set-up in the portal's sheet: which app (AmneziaWG: its .conf;
// AmneziaVPN: its key), then in which form it is handed over (a QR code, the
// .conf file, the plain text: a track of the three, the code first for a
// phone or a tablet, the file for a computer or a router), and Copy and
// Download under it. Showing it marks nothing as given out: that is what
// making a configuration (Add, New keys) and the portal's fetch do. Inside a
// flow (Add, New keys) the portal's way under the head says how the first connection goes
// (portal/ui/wait-way.ts, watched on the router's status, flows/watch.ts):
// once connected what is under it folds and the sheet closes by itself onto
// the page. Show set-up has no such wait: it shows the forms and stays.

import type { ClientConfig, Device, Person, Status } from '../../shared/types';
import { api } from '../api';
import { h } from '../../portal/dom';
import { glide, head, onLeave, openSheet, sub, type View } from '../../portal/ui/sheet';
import { follow, waitWay } from '../../portal/ui/wait-way';
import { vpnKey, vpnQrText } from '../../shared/vpnkey';
import { fmt } from '../../shared/i18n';
import { kindLabel } from '../../shared/format';
import { tabs } from '../ui/tabs';
import { ic } from '../ui/icons';
import { loadQr, qrBox } from '../shell/qr';
import { copyText, downloadFile } from '../ui/files';
import { attempt } from '../ui/toast';
import { statusWatcher } from './watch';
import { putChildren } from '../../portal/ui/put';

type App = 'awg' | 'vpn';

export interface SetupCtx {
  person: Person;
  device: Device;
  /** The router's clock now (seconds). */
  now: () => number;
  /** A status the sheet read while it waited (the page repaints with it). */
  fresh?: (st: Status) => void;
  /** Once the sheet closed itself after the first connection. */
  done?: () => void;
}

const handheld = (d: Device) => d.kind === 'phone' || d.kind === 'tablet';

/** One line of a configuration: a section's head in the accent, a key's name in the text's colour. */
function confLine(line: string): Node {
  if (/^\s*\[.+\]\s*$/.test(line)) return h('span', { class: 'sec' }, line);
  const m = /^(\s*[A-Za-z0-9]+\s*=)(.*)$/.exec(line);
  return m ? h('span', {}, h('span', { class: 'k' }, m[1]), m[2]) : document.createTextNode(line);
}

/** How the set-up is handed over: a code to scan, the file, or its text to read and copy. */
type Form = 'qr' | 'file' | 'text';

/**
 * The set-up as a view: which app, then in which form (a QR code, the .conf file, the plain text; AmneziaVPN's key
 * has no file), the form itself, and Copy and Download under it. `way`: 'top' inside a flow (Add, New keys), where
 * the portal's way under the head waits for the first connection; null for Show set-up, which only shows it.
 */
export function setupView(c: SetupCtx, cfg: ClientConfig, way: 'top' | null): View {
  const d = c.device;
  let app: App = 'awg';
  let form: Form = handheld(d) ? 'qr' : 'file';
  let key = '';
  const keyOf = async () => (key ||= await vpnKey(cfg, cfg.server || c.person.name));
  const text = async () => (app === 'awg' ? cfg.conf : await keyOf());
  const box = h('div', { class: 'setup-show' });
  const forms = h('div', { class: 'setup-forms' });
  const dl = h(
    'button',
    { type: 'button', class: 'btn soft', onclick: () => downloadFile(cfg.filename, cfg.conf, 'application/octet-stream') },
    ic('download'),
    h('span', {}, _('Download .conf')),
  );
  /**
   * The forms' track and the form picked, drawn from the text at hand. Not asked for here: the view must stand whole
   * the moment it is put in the sheet, which measures it then (drawn a moment later, the sheet took an empty
   * view's height and jumped when the code landed: the owner, 2026-11-12, «анимация размера модалки снапает»).
   */
  const draw = (t: string) => {
    // AmneziaVPN takes a key, not a file: its forms are the code and the key's text
    if (app === 'vpn' && form === 'file') form = 'text';
    putChildren(forms, [
      tabs<Form>(
        [
          // «QR» alone: three names must fit a phone's track
          { id: 'qr', label: 'QR', icon: 'qr' },
          ...(app === 'awg' ? [{ id: 'file' as Form, label: '.conf', icon: 'file' }] : []),
          { id: 'text', label: app === 'awg' ? _('Text') : _('Key'), icon: 'code' },
        ],
        form,
        (f) => {
          form = f;
          void paint();
        },
        // drawn again on every pick: its pill goes on from the last one's place (ui/carry.ts)
        { cls: 'forms', label: _('Form'), keep: 'setup-form' },
      ).el,
    ]);
    dl.hidden = app !== 'awg';
    if (form === 'qr')
      putChildren(box, [
        h(
          'div',
          { class: 'inv-card su-qr' },
          qrBox(app === 'awg' ? t : vpnQrText(t)),
          h(
            'div',
            { class: 'inv-code' },
            h('span', {}, _('Scan it with the app on the device')),
            h('b', {}, app === 'awg' ? 'AmneziaWG' : 'AmneziaVPN'),
          ),
        ),
      ]);
    else if (form === 'file')
      putChildren(box, [
        h(
          'div',
          { class: 'filecard' },
          h(
            'div',
            { class: 'fc-row' },
            h('span', { class: 'filecard-ic' }, '.conf'),
            h(
              'span',
              { class: 't' },
              h('span', { class: 'mono' }, cfg.filename),
              h('span', {}, _('Import the file in AmneziaWG on the device')),
            ),
          ),
        ),
      ]);
    else
      putChildren(box, [
        h(
          'pre',
          {
            class: `conf su-text${app === 'vpn' ? ' wrap' : ''}`,
            tabindex: '0',
            'aria-label': app === 'awg' ? cfg.filename : _('AmneziaVPN key'),
          },
          app === 'awg' ? t.split('\n').flatMap((l, i) => (i ? ['\n', confLine(l)] : [confLine(l)])) : t,
        ),
      ]);
  };
  /** Another form or app picked: the sheet glides to the new height and width, what changed comes into focus. */
  const paint = async () => {
    const t = await text();
    glide(() => draw(t), [box]);
  };
  const apps = tabs(
    [
      { id: 'awg' as App, label: 'AmneziaWG', icon: 'amneziawg' },
      { id: 'vpn' as App, label: 'AmneziaVPN', icon: 'amnezia' },
    ],
    app,
    (a) => {
      app = a;
      void paint();
    },
    { cls: 'apps', label: _('App') },
  );
  const body = h(
    'div',
    { class: 'setup-b' },
    apps.el,
    forms,
    box,
    h(
      'div',
      { class: 'btnrow' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn soft',
          onclick: async () => void copyText(await text(), app === 'awg' ? _('Configuration copied') : _('Key copied')),
        },
        ic('copy'),
        h('span', {}, _('Copy')),
      ),
      dl,
    ),
  );
  // the configuration is at hand (AmneziaWG is what a sheet opens on): drawn before the view is handed over
  draw(cfg.conf);
  const noun = kindLabel(d.kind).toLocaleLowerCase();
  const subline = sub(
    way === 'top'
      ? fmt(_('%s · %s. Waiting for its first connection with the new configuration.'), c.person.name, noun)
      : `${c.person.name} · ${noun}`,
  );
  const title = fmt(_('Set-up · %s'), d.name);
  // Show set-up only shows it (the owner, 2026-11-11: no «waiting for a connection» there, only the forms)
  if (!way) return { el: h('div', { class: 'view setup-v' }, head(title), subline, body), label: title };
  const w = waitWay(d);
  const watch = statusWatcher(c.now(), c.fresh);
  const el = h('div', { class: 'view setup-v' }, head(title), subline, w.el, body);
  const f = follow(d, w, { sub: subline, rest: body, closed: c.done });
  onLeave(watch(d, f.seen, f.gaveUp));
  return { el, label: title };
}

/** Show the set-up: the sheet with its forms, nothing more. */
export async function showSetup(c: SetupCtx) {
  // the QR generator and the apps' marks come while the router answers (shell/qr.ts)
  const kit = loadQr().catch(() => undefined);
  const cfg = await attempt(() => api.deviceConfig(c.device.id));
  await kit;
  if (cfg) openSheet(() => setupView(c, cfg, null));
}
