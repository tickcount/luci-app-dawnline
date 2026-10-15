// Device drawer: a right-hand panel with the device's status, connection
// (QR / key / file), details and actions. Replaces the old tabbed modal.

import type { ClientConfig, Device, Geo, Kind, LogEvent, Person } from '../shared/types';
import { E } from './e';
import { api } from './api';
import { attempt, button, closeModal, confirmDialog, copyText, downloadFile, modal, notify, svg } from './ui';
import { qrSvg } from '../shared/qr';
import { vpnKey } from '../shared/vpnkey';
import { ago, bytes, KIND_LABEL, KINDS } from '../shared/format';
import { icon } from '../shared/icons';
import { eventBy } from './pages/overview';
import { spark } from './charts';
import { clearLogDialog, exportEvents, resetUsageDialog } from './logs';

let current: { close: () => void } | null = null;

function iso(ts: number): string {
  return ts
    ? new Date(ts * 1000).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';
}

function copyRow(label: string, value: string, mono = false): HTMLElement {
  return E('div', { class: 'dl-kvrow' }, [
    E('span', { class: 'dl-kvrow-k' }, label),
    E(
      'button',
      { type: 'button', class: `dl-kvrow-v copy${mono ? ' dl-mono' : ''}`, title: 'Copy', click: () => copyText(value, `${label} copied`) },
      [E('span', {}, value), icon('copy')],
    ),
  ]);
}

function row(label: string, value: Node | string): HTMLElement {
  return E('div', { class: 'dl-kvrow' }, [E('span', { class: 'dl-kvrow-k' }, label), E('span', { class: 'dl-kvrow-v' }, value)]);
}

/** One configuration line, highlighted; private and preshared keys masked unless shown. */
function confLine(line: string, reveal: boolean): Node {
  if (/^\s*\[.+\]\s*$/.test(line)) return E('span', { class: 'dl-conf-sec' }, line);
  const m = /^(\s*[A-Za-z0-9]+\s*=)\s*(.*)$/.exec(line);
  if (!m) return document.createTextNode(line);
  const secret = /^(\s*)(PrivateKey|PresharedKey)\b/.test(line);
  return E('span', {}, [
    E('span', { class: 'dl-conf-k' }, m[1]),
    ' ',
    secret && !reveal ? E('span', { class: 'dl-conf-mask' }, '••••••••••••••••') : m[2],
  ]);
}

/** The .conf as a file card (download) and a folded, highlighted view with copy and a hidden key. */
function fileCard(cfg: ClientConfig): HTMLElement {
  let reveal = false;
  const pre = E('pre', { class: 'dl-conf' });
  const paint = () =>
    dom.content(
      pre,
      cfg.conf.split('\n').flatMap((l, i) => (i ? ['\n', confLine(l, reveal)] : [confLine(l, reveal)])),
    );
  const eye = E(
    'button',
    {
      type: 'button',
      class: 'dl-chipbtn',
      click: (ev: Event) => {
        ev.preventDefault();
        reveal = !reveal;
        dom.content(eye, [icon(reveal ? 'x' : 'key'), reveal ? 'Hide key' : 'Show key']);
        paint();
      },
    },
    [icon('key'), 'Show key'],
  );
  paint();
  const size = new Blob([cfg.conf]).size;
  return E('div', { class: 'dl-stack gap8' }, [
    E('div', { class: 'dl-filecard' }, [
      E('span', { class: 'dl-filecard-ic' }, '.conf'),
      E('span', { class: 'dl-stack' }, [
        E('span', { class: 'dl-mono dl-ellipsis' }, cfg.filename),
        E('span', { class: 'dl-sub' }, `AmneziaWG · ${size} bytes · import it in the app`),
      ]),
      button([icon('download'), ' Download'], () => downloadFile(cfg.filename, cfg.conf, 'application/octet-stream'), 'positive'),
    ]),
    E('details', { class: 'dl-params' }, [
      E('summary', {}, [
        icon('chevron'),
        E('span', {}, 'Configuration'),
        E('span', { class: 'dl-spacer' }),
        eye,
        E(
          'button',
          {
            type: 'button',
            class: 'dl-chipbtn',
            click: (ev: Event) => {
              ev.preventDefault();
              copyText(cfg.conf, 'Configuration copied');
            },
          },
          [icon('copy'), 'Copy'],
        ),
      ]),
      pre,
    ]),
  ]);
}

/** File / key / QR switcher for a client configuration; opens on the file unless asked otherwise. */
export async function connectBlock(cfg: ClientConfig, initial: 'file' | 'key' | 'qr' = 'file'): Promise<HTMLElement> {
  if (!cfg.has_private_key)
    return E(
      'div',
      { class: 'dl-hint' },
      'This device generated its own keys in the browser, so its full configuration only exists on that device.',
    );
  const key = await vpnKey(cfg, `${cfg.server} · ${cfg.person} · ${cfg.name}`);
  const panes: Record<string, () => Node> = {
    qr: () =>
      E('div', { class: 'dl-qr-pane' }, [
        svg(qrSvg(cfg.conf), 'dl-qr'),
        E('span', { class: 'dl-sub' }, 'Scan with AmneziaVPN or AmneziaWG on the device.'),
      ]),
    key: () =>
      E('div', { class: 'dl-stack gap8' }, [
        E('div', { class: 'dl-linkbox' }, [E('span', { class: 'dl-mono' }, key), button('Copy', () => copyText(key, 'Key copied'))]),
        E('span', { class: 'dl-sub' }, 'AmneziaVPN → Add server → Insert key. Keep it private.'),
      ]),
    file: () => fileCard(cfg),
  };
  const body = E('div', { class: 'dl-connect-body' });
  const seg = E('div', { class: 'dl-seg' });
  const show = (id: string) => {
    seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
    dom.content(body, panes[id]());
  };
  for (const [id, label] of [
    ['file', 'File'],
    ['key', 'Key'],
    ['qr', 'QR code'],
  ])
    seg.appendChild(E('button', { type: 'button', 'data-id': id, click: () => show(id) }, label));
  show(initial);
  return E('div', { class: 'dl-stack gap12' }, [seg, body]);
}

function drawer(title: Node, body: Node, foot: Node | null, onClose: () => void): { close: () => void; panel: HTMLElement } {
  current?.close();
  const panel = E('aside', { class: 'dl-drawer', role: 'dialog', 'aria-modal': 'true' }, [
    E('div', { class: 'dl-drawer-head' }, [
      title,
      E('button', { type: 'button', class: 'dl-drawer-x', 'aria-label': 'Close', click: () => close() }, icon('x')),
    ]),
    E('div', { class: 'dl-drawer-body' }, body),
    foot ? E('div', { class: 'dl-drawer-foot' }, foot) : '',
  ]);
  const overlay = E(
    'div',
    {
      class: 'dl-drawer-overlay dl-root',
      click: (ev: Event) => {
        if (ev.target === overlay) close();
      },
    },
    panel,
  );
  const onKey = (ev: KeyboardEvent) => {
    // LuCI keeps an empty .modal in the page; the body class says whether one is open.
    if (ev.key === 'Escape' && !document.body.classList.contains('modal-overlay-active')) close();
  };
  function close() {
    document.removeEventListener('keydown', onKey);
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 220);
    if (current === handle) current = null;
    onClose();
  }
  const handle = { close, panel };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  current = handle;
  return handle;
}

const DEV_EVENT: Record<string, [string, string, string]> = {
  connect: ['ok', 'Connected', 'plug'],
  disconnect: ['', 'Went offline', 'plug'],
  roam: ['', 'Changed network', 'network'],
  device_added: ['ok', 'Added', 'plus'],
  device_removed: ['', 'Removed', 'trash'],
  device_keys: ['', 'New keys', 'reset'],
};

/** Activity of one device, newest first. */
function deviceEvents(events: LogEvent[], id: string): HTMLElement {
  const mine = events
    .filter((e) => e.device === id && DEV_EVENT[e.type])
    .reverse()
    .slice(0, 12);
  if (!mine.length) return E('div', { class: 'dl-sub' }, 'No activity yet.');
  return E(
    'div',
    { class: 'dl-dev-log' },
    mine.map((e) => {
      const [tone, label, ic] = DEV_EVENT[e.type];
      // As in the main log: what happened in the text colour, the details muted.
      const extra =
        e.type === 'connect'
          ? [
              e.detail ? E('span', { class: 'dl-muted' }, ` from ${e.detail}`) : '',
              e.where ? E('span', { class: 'dl-muted' }, ` · ${e.where}`) : '',
            ]
          : e.type === 'roam'
            ? [E('span', { class: 'dl-muted' }, ` · ${e.detail ?? ''}`)]
            : e.type === 'device_added' || e.type === 'device_removed' || e.type === 'device_keys'
              ? [E('span', { class: 'dl-muted' }, eventBy(e) === 'portal' ? ' on the portal' : eventBy(e) === 'admin' ? ' by you' : '')]
              : [];
      const t = new Date(e.ts * 1000);
      return E('div', { class: `dl-dev-log-row${eventBy(e) === 'admin' ? ' dl-ev-by-admin' : ''}` }, [
        eventBy(e) === 'admin'
          ? E('span', { class: 'dl-ev-tile', title: 'Done by you in LuCI' }, icon('admin'))
          : E('span', { class: `dl-ev-tile ev ${tone}` }, icon(ic)),
        E('span', { class: 'dl-row-main' }, [E('span', {}, label), ...extra]),
        E('span', { class: 'dl-faint dl-nowrap', title: t.toLocaleString() }, ago(e.ts)),
      ]);
    }),
  );
}

function statusLine(d: Device): HTMLElement {
  // Status as coloured text, no dots (only avatars carry one).
  if (d.disabled) return E('span', { class: 'dl-dstat' }, 'Disabled');
  if (d.online) return E('span', { class: 'dl-dstat ok' }, 'Connected');
  if (!d.handshake) return E('span', { class: 'dl-dstat warn' }, 'Waiting for the first connection');
  return E('span', { class: 'dl-dstat' }, `Last seen ${ago(d.handshake)}`);
}

/** Device drawer; `refresh` reloads the page after changes. */
export async function openDevice(person: Person, dev: Device, refresh: () => unknown, geo?: Geo) {
  const cfg = await attempt(() => api.deviceConfig(dev.id));
  if (!cfg) return;
  let d = dev;
  let p = person;
  const connect = await connectBlock(cfg);
  const titleEl = E('div', { class: 'dl-drawer-title' });
  const stats = E('div', {});
  const details = E('div', {});
  const log = E('div', {}, E('div', { class: 'dl-sub' }, 'Loading…'));
  let logEvents: LogEvent[] = [];
  const loadLog = async () => {
    const ev = await api.events(5000).catch(() => null);
    if (!ev) return;
    logEvents = ev.events.filter((e) => e.device === d.id);
    dom.content(log, deviceEvents(ev.events, d.id));
  };

  const paint = () => {
    const place = geo?.points.find((x) => x.device === d.id && x.ip === d.endpoint);
    dom.content(titleEl, [
      E('span', { class: `dl-dcard-ic${d.online ? ' on' : ''}` }, icon(d.kind)),
      E('div', { class: 'dl-stack' }, [
        E('div', { class: 'dl-title-row' }, [
          E('h3', {}, d.name),
          button([icon('edit')], () => rename(), 'neutral', { title: 'Rename', class: 'cbi-button cbi-button-neutral dl-icon-only sm' }),
        ]),
        E('span', { class: 'dl-sub' }, [`${p.name} · ${KIND_LABEL[d.kind]}`]),
      ]),
    ]);
    const week = d.spark.reduce((a, b) => a + b, 0);
    dom.content(
      stats,
      E('div', { class: 'dl-dstats' }, [
        E('div', { class: 'dl-dstats-cell wide' }, [E('span', { class: 'dl-metric-label' }, 'Status'), statusLine(d)]),
        E('div', { class: 'dl-dstats-cell' }, [
          E('span', { class: 'dl-metric-label' }, 'This month'),
          E('b', {}, bytes(d.month[0] + d.month[1])),
          E('span', { class: 'dl-sub dl-mono' }, `↓ ${bytes(d.month[1])} ↑ ${bytes(d.month[0])}`),
        ]),
        E('div', { class: 'dl-dstats-cell' }, [
          E('span', { class: 'dl-metric-label' }, 'Last 7 days'),
          E('b', {}, bytes(week)),
          spark(d.spark, 120, 22),
        ]),
      ]),
    );
    dom.content(
      details,
      E('div', { class: 'dl-kv2' }, [
        copyRow('Tunnel address', d.address),
        d.hostname && p.access !== 'internet' ? copyRow('Local address', d.hostname) : '',
        d.endpoint
          ? row(
              'Client IP',
              E('span', {}, [
                d.endpoint,
                place ? E('span', { class: 'dl-muted' }, ` · ${[place.city, place.org].filter(Boolean).join(' · ')}`) : '',
              ]),
            )
          : '',
        row(
          'Total',
          E('span', { class: 'dl-kv-act' }, [
            `↓ ${bytes(d.total[1])} · ↑ ${bytes(d.total[0])}`,
            E(
              'button',
              {
                type: 'button',
                class: 'dl-linkbtn danger',
                click: () => resetUsageDialog('device', d.id, d.name, () => setTimeout(reload, 300)),
              },
              'Reset',
            ),
          ]),
        ),
        row('Added', `${iso(d.created)} · ${d.created_by === 'portal' ? 'from the portal' : 'by you'}`),
        row(
          'Public key',
          E('span', { class: 'dl-mono dl-faint' }, cfg.amnezia.client_pub_key ? `${cfg.amnezia.client_pub_key.slice(0, 16)}…` : '—'),
        ),
      ]),
    );
    dom.content(foot, [
      button(
        [icon(d.disabled ? 'play' : 'pause'), d.disabled ? ' Enable' : ' Disable'],
        async () => {
          if (await attempt(() => api.deviceUpdate(d.id, undefined, !d.disabled), d.disabled ? 'Device enabled' : 'Device disabled'))
            await reload();
        },
        'neutral',
        d.disabled ? {} : { class: 'cbi-button cbi-button-neutral dl-btn-warn' },
      ),
      button([icon('key'), ' New keys'], async () => {
        if (
          !(await confirmDialog(
            'Generate new keys?',
            'The current configuration on this device stops working until it is imported again.',
            'Generate',
            true,
          ))
        )
          return;
        const c = await attempt(() => api.deviceRotate(d.id), 'New keys generated');
        if (c) {
          refresh();
          handle.close();
          const st = await api.status(1);
          const p2 = st.people.find((x) => x.id === p.id);
          const d2 = p2?.devices.find((x) => x.id === d.id);
          if (p2 && d2) openDevice(p2, d2, refresh, st.geo);
        }
      }),
      E('span', { class: 'dl-spacer' }),
      button(
        [icon('trash'), ' Remove'],
        async () => {
          if (
            !(await confirmDialog(
              `Remove ${d.name}?`,
              'The device is disconnected immediately and its configuration stops working.',
              'Remove',
              true,
            ))
          )
            return;
          if (await attempt(() => api.deviceDelete(d.id), 'Device removed')) {
            handle.close();
            refresh();
          }
        },
        'negative',
      ),
    ]);
  };

  const reload = async () => {
    const st = await api.status(1).catch(() => null);
    const p2 = st?.people.find((x) => x.id === p.id);
    const d2 = p2?.devices.find((x) => x.id === d.id);
    if (!st || !p2 || !d2) return;
    p = p2;
    d = d2;
    geo = st.geo;
    paint();
    refresh();
  };

  const rename = () => {
    const input = E('input', { type: 'text', class: 'cbi-input-text', value: d.name, maxlength: 48 }) as HTMLInputElement;
    modal(
      `Rename ${d.name}`,
      [E('div', { class: 'cbi-value' }, [E('label', { class: 'cbi-value-title' }, 'Name'), E('div', { class: 'cbi-value-field' }, input)])],
      [
        E('button', { class: 'cbi-button cbi-button-neutral', click: closeModal }, 'Cancel'),
        ' ',
        button(
          'Save',
          async () => {
            if (await attempt(() => api.deviceUpdate(d.id, input.value, undefined), 'Renamed')) {
              closeModal();
              await reload();
            }
          },
          'positive',
        ),
      ],
    );
    setTimeout(() => input.select(), 50);
  };

  const foot = E('div', { class: 'dl-drawer-actions' });
  const connectSec = E('section', { class: 'dl-dsec' }, [
    // Whether it is connected (or still waiting) is in Status above.
    E('div', { class: 'dl-dsec-head' }, [E('h4', {}, 'Connect')]),
    d.config_stale
      ? E('div', { class: 'dl-note warn' }, [
          icon('alert'),
          E(
            'span',
            {},
            'This device has an older configuration: networks or DNS changed since it was set up. Import it again with the QR code, key or file below.',
          ),
        ])
      : '',
    connect,
  ]);
  const activitySec = E('section', { class: 'dl-dsec' }, [
    E('div', { class: 'dl-dsec-head' }, [
      E('h4', {}, 'Activity'),
      E('div', { class: 'dl-dsec-actions' }, [
        E('button', { type: 'button', class: 'dl-linkbtn', click: () => exportEvents({ people: [p] }, logEvents, 'csv', d.id) }, 'Export'),
        E(
          'button',
          {
            type: 'button',
            class: 'dl-linkbtn danger',
            click: () => clearLogDialog(`Clear ${d.name}'s activity`, `Removes events about ${d.name}.`, { device: d.id }, loadLog),
          },
          'Clear',
        ),
        E('a', { href: `${L.url('admin/network/dawnline/diagnostics')}?tab=log` }, 'All activity'),
      ]),
    ]),
    log,
  ]);
  const detailsSec = E('section', { class: 'dl-dsec' }, [E('div', { class: 'dl-dsec-head' }, E('h4', {}, 'Details')), details]);
  // Connecting is what the drawer is for until the device is set up (or its configuration is old);
  // after that it goes to the bottom.
  const setUp = !d.handshake || d.config_stale;
  const body = E(
    'div',
    { class: 'dl-stack gap16' },
    setUp ? [stats, connectSec, detailsSec, activitySec] : [stats, detailsSec, activitySec, connectSec],
  );
  loadLog();
  const watch = window.setInterval(() => {
    reload();
    loadLog();
  }, 8000);
  const handle = drawer(titleEl, body, foot, () => clearInterval(watch));
  paint();
}

/** Admin "Add device" dialog for a person; opens the new device's drawer. */
export function addDevice(person: Person, refresh: () => unknown) {
  const nameInput = E('input', { type: 'text', class: 'cbi-input-text', placeholder: KIND_LABEL.phone, maxlength: 48 }) as HTMLInputElement;
  let kind: Kind = 'phone';
  const kinds = E(
    'div',
    { class: 'dl-kinds', role: 'radiogroup', 'aria-label': 'Type' },
    KINDS.map((k) =>
      E(
        'button',
        {
          type: 'button',
          role: 'radio',
          class: k === kind ? 'on' : '',
          'aria-checked': k === kind ? 'true' : 'false',
          'data-kind': k,
          click: () => {
            kind = k;
            kinds.querySelectorAll('button').forEach((c) => {
              const on = (c as HTMLElement).dataset.kind === k;
              c.classList.toggle('on', on);
              c.setAttribute('aria-checked', on ? 'true' : 'false');
            });
            nameInput.placeholder = KIND_LABEL[k];
          },
        },
        [icon(k), E('span', {}, KIND_LABEL[k])],
      ),
    ),
  );
  const over = person.devices.length >= person.device_limit;
  modal(
    `Add a device for ${person.name}`,
    [
      over
        ? E(
            'p',
            { class: 'dl-hint' },
            `${person.name} already has ${person.devices.length} of ${person.device_limit} devices. As admin you can still add one.`,
          )
        : '',
      E('div', { class: 'dl-fld' }, [E('span', { class: 'dl-fld-label' }, 'Type'), kinds]),
      E('label', { class: 'dl-fld' }, [E('span', { class: 'dl-fld-label' }, 'Name'), nameInput]),
    ],
    [
      E('button', { class: 'cbi-button cbi-button-neutral', click: closeModal }, 'Cancel'),
      ' ',
      button(
        'Add device',
        async () => {
          const name = nameInput.value.trim() || nameInput.placeholder.replace(/^e\.g\. /, '');
          const r = await attempt(() => api.deviceCreate(person.id, name, kind));
          if (!r) return;
          closeModal();
          notify(`${name} added`, 'success', 3000);
          refresh();
          const st = await api.status(1);
          const p2 = st.people.find((x) => x.id === person.id);
          const d2 = p2?.devices.find((x) => x.id === r.id);
          if (p2 && d2) openDevice(p2, d2, refresh, st.geo);
        },
        'positive',
      ),
    ],
  );
  setTimeout(() => nameInput.focus(), 50);
}
