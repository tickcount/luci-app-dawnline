// Device drawer: a right-hand panel with the device's status, connection
// (QR / key / file, from its server's core), details and actions; the ⋯ menu
// on a device card; and the admin's Add device dialog.

import type { Device, Geo, Kind, LogEvent, Person } from '../shared/types';
import { E } from './e';
import { api } from './api';
import { button } from './ui/button';
import { cancelButton, closeModal, confirmDialog, modal } from './ui/modal';
import { copyText, downloadFile } from './ui/files';
import { dropdown, type MenuItem } from './ui/menu';
import { drawer } from './ui/drawer';
import { attempt, notify } from './ui/toast';
import { liveField } from './ui/layout';
import { qrCode } from './ui/qr';
import { nameHelp } from './netcheck';
import { deviceStatus } from './ui/badges';
import { ago, bytes, isoDay, KIND_LABEL, KINDS, todayOf } from '../shared/format';
import { icon } from '../shared/icons';
import { eventBy } from './events/model';
import { spark } from './widgets/spark';
import { clearLogDialog, exportEvents, resetUsageDialog } from './logs';
import { coreFor, coreOf, type Core } from './cores';
import { plainWg } from './cores/awg';
import { onLiveChange } from './state/live';
import { ConnectionMap, rangeControl, type Range } from './map';
import { PlacesView } from './places/render';
import { personUrl } from './urls';

/** What the page that opens a device hands over. */
export interface DeviceOpts {
  /** Reload the page after a change made here. */
  refresh: () => unknown;
  geo?: Geo;
  /** The router's clock (seconds) and day, for "5 min ago" and the chart labels. */
  now?: number;
  today?: string;
  /** The device's server's core (AmneziaWG when not given). */
  core?: Core;
  /** The page's activity log, when it keeps one: the drawer reads it instead of fetching its own. */
  events?: () => LogEvent[] | null;
}

function when(ts: number): string {
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

const DEV_EVENT: Record<string, [string, string, string]> = {
  connect: ['ok', 'Connected', 'plug'],
  disconnect: ['', 'Went offline', 'plug'],
  roam: ['', 'Changed network', 'network'],
  device_added: ['ok', 'Added', 'plus'],
  device_removed: ['', 'Removed', 'trash'],
  device_keys: ['', 'New keys', 'reset'],
};

/** Activity of one device, newest first. */
function deviceEvents(events: LogEvent[], id: string, now?: number): HTMLElement {
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
        E('span', { class: 'dl-faint dl-nowrap', title: t.toLocaleString() }, ago(e.ts, now)),
      ]);
    }),
  );
}

/** Open the drawer of a device that was just made or changed, with fresh status. */
async function reopen(personId: string, deviceId: string, o: DeviceOpts) {
  const st = await api.status(1).catch(() => null);
  const p2 = st?.people.find((x) => x.id === personId);
  const d2 = p2?.devices.find((x) => x.id === deviceId);
  if (st && p2 && d2)
    void openDevice(p2, d2, { ...o, geo: st.geo, now: st.now, today: todayOf(st.series), core: coreFor(st.servers, p2.server) });
}

/** Device drawer. */
export async function openDevice(person: Person, dev: Device, o: DeviceOpts) {
  const cfg = await attempt(() => api.deviceConfig(dev.id));
  if (!cfg) return;
  const core = o.core ?? coreOf(null);
  let d = dev;
  let p = person;
  let geo = o.geo;
  let now = o.now;
  let today = o.today ?? isoDay(new Date());
  // Phones and tablets are set up by scanning; computers and routers by a file.
  const connect = await core.connectBlock(cfg, dev.kind === 'phone' || dev.kind === 'tablet' ? 'qr' : 'file');
  const titleEl = E('div', { class: 'dl-drawer-title' });
  const stats = E('div', {});
  const details = E('div', {});
  const log = E('div', {}, E('div', { class: 'dl-sub' }, 'Loading…'));
  let logEvents: LogEvent[] = [];
  const showLog = (events: LogEvent[]) => {
    logEvents = events.filter((e) => e.device === d.id);
    dom.content(log, deviceEvents(events, d.id, now));
    view?.update({ events });
  };
  /** The page's events when it has them; otherwise a fetch (`force` after clearing). */
  const loadLog = async (force = false) => {
    const own = o.events?.();
    if (own && !force) return showLog(own);
    const ev = await api.events(2000, person.id).catch(() => null);
    if (ev) showLog(ev.events);
  };

  // Where this device connected from: the map, a row per place with a strip of when it was
  // there (from the log's connections), and a replay of the period on the map.
  let range: Range = '30d';
  let map: ConnectionMap | null = null;
  let view: PlacesView | null = null;
  const paint = () => {
    dom.content(titleEl, [
      E('span', { class: `dl-dcard-ic${d.online ? ' on' : ''}` }, icon(d.kind)),
      E('div', { class: 'dl-stack' }, [
        E('div', { class: 'dl-title-row' }, [
          E('h3', {}, d.name),
          button([icon('edit')], () => rename(), 'neutral', { title: 'Rename', class: 'cbi-button cbi-button-neutral dl-icon-only sm' }),
        ]),
        E('span', { class: 'dl-sub' }, `${p.name} · ${KIND_LABEL[d.kind]}`),
      ]),
    ]);
    const week = d.spark.reduce((a, b) => a + b, 0);
    dom.content(
      stats,
      E('div', { class: 'dl-dstats' }, [
        E('div', { class: 'dl-dstats-cell wide' }, [
          E('span', { class: 'dl-metric-label' }, 'Status'),
          deviceStatus(d, now, 'Waiting for the first connection', p),
        ]),
        E('div', { class: 'dl-dstats-cell' }, [
          E('span', { class: 'dl-metric-label' }, 'This month'),
          E('b', {}, bytes(d.month[0] + d.month[1])),
          E('span', { class: 'dl-sub dl-mono' }, `↓ ${bytes(d.month[1])} ↑ ${bytes(d.month[0])}`),
        ]),
        E('div', { class: 'dl-dstats-cell' }, [
          E('span', { class: 'dl-metric-label' }, 'Last 7 days'),
          E('b', {}, bytes(week)),
          spark(d.spark, 120, 22, today),
        ]),
      ]),
    );
    dom.content(
      details,
      E('div', { class: 'dl-kv2' }, [
        copyRow('Tunnel address', d.address),
        d.hostname && p.access !== 'internet' ? copyRow('Local address', d.hostname) : '',
        // Where it connects from is under Locations (with the place and network); from home
        // (not on the map) or without locations, here.
        d.endpoint && !geo?.points.some((x) => x.device === d.id && x.ip === d.endpoint) ? row('Client IP', d.endpoint) : '',
        row(
          'Total',
          E('span', { class: 'dl-kv-act' }, [
            `↓ ${bytes(d.total[1])} · ↑ ${bytes(d.total[0])}`,
            E(
              'button',
              {
                type: 'button',
                class: 'dl-linkbtn danger',
                click: () => resetUsageDialog('device', d.id, d.name, () => setTimeout(changed, 300)),
              },
              'Reset',
            ),
          ]),
        ),
        row('Added', `${when(d.created)} · ${d.created_by === 'portal' ? 'from the portal' : 'by you'}`),
        // The whole key, copyable: it is what another WireGuard server needs to add this device by hand.
        cfg.amnezia.client_pub_key ? copyRow('Public key', cfg.amnezia.client_pub_key) : row('Public key', '—'),
      ]),
    );
    dom.content(foot, [
      button(
        [icon(d.disabled ? 'play' : 'pause'), d.disabled ? ' Enable' : ' Disable'],
        async () => {
          if (await attempt(() => api.deviceUpdate(d.id, undefined, !d.disabled), d.disabled ? 'Device enabled' : 'Device disabled'))
            await changed();
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
          o.refresh();
          handle.close();
          await reopen(p.id, d.id, o);
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
            o.refresh();
          }
        },
        'negative',
      ),
    ]);
  };

  /** The device's own state, fresh from the router; the page underneath is left alone. */
  const reload = async () => {
    const st = await api.status(1).catch(() => null);
    const p2 = st?.people.find((x) => x.id === p.id);
    const d2 = p2?.devices.find((x) => x.id === d.id);
    if (!st || !p2 || !d2) return;
    p = p2;
    d = d2;
    geo = st.geo;
    now = st.now;
    today = todayOf(st.series);
    paint();
    view?.update({ geo: st.geo, now: st.now, person: p, device: d });
  };
  /** After a change made here: this drawer and the page. */
  const changed = async () => {
    await reload();
    o.refresh();
  };

  const rename = () => {
    const input = E('input', { type: 'text', class: 'cbi-input-text', value: d.name, maxlength: 48 }) as HTMLInputElement;
    const taken = p.devices.filter((x) => x.id !== d.id).map((x) => x.name);
    const nameRow = liveField('Name', input, () => nameHelp(input.value, taken, 'Shown in the portal and in the app.'));
    modal(
      `Rename ${d.name}`,
      [nameRow],
      [
        cancelButton(),
        ' ',
        button(
          'Save',
          async () => {
            const h = nameRow.help();
            if (h.bad) {
              notify(h.text, 'warning');
              return;
            }
            if (await attempt(() => api.deviceUpdate(d.id, input.value, undefined), 'Renamed')) {
              closeModal();
              await changed();
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
            click: () =>
              clearLogDialog(`Clear ${d.name}'s activity`, `Removes events about ${d.name}.`, { device: d.id }, () => {
                void loadLog(true);
                o.refresh();
              }),
          },
          'Clear',
        ),
        E('a', { href: `${L.url('admin/network/dawnline/diagnostics')}?tab=log` }, 'All activity'),
      ]),
    ]),
    log,
  ]);
  const detailsSec = E('section', { class: 'dl-dsec' }, [E('div', { class: 'dl-dsec-head' }, E('h4', {}, 'Details')), details]);
  let locationsSec: HTMLElement | '' = '';
  if (geo?.enabled) {
    map = new ConnectionMap(
      { openPerson: (id) => (location.href = personUrl(id)), openDevice: (id, dev) => (location.href = personUrl(id, dev)) },
      range,
      220,
    );
    const v = (view = new PlacesView(map, range, {
      geo,
      now: now ?? Date.now() / 1000,
      person: p,
      device: d,
      events: o.events?.() ?? null,
    }));
    locationsSec = E('section', { class: 'dl-dsec' }, [
      E('div', { class: 'dl-dsec-head' }, [
        E('h4', {}, 'Locations'),
        rangeControl(
          range,
          (r) => {
            range = r;
            v.setRange(r);
          },
          false,
        ),
      ]),
      E('div', { class: 'dl-dmap' }, [map.el, v.controls]),
      v.el,
    ]);
  }
  // Connecting is what the drawer is for until the device is set up (or its configuration is old);
  // after that it goes to the bottom.
  const setUp = !d.handshake || d.config_stale;
  const body = E(
    'div',
    { class: 'dl-stack gap16' },
    setUp ? [stats, connectSec, detailsSec, locationsSec, activitySec] : [stats, detailsSec, locationsSec, activitySec, connectSec],
  );
  void loadLog();
  // Live status and log: at once when something happens (state/live.ts), and every 30 s anyway.
  const live = () => {
    void reload();
    void loadLog();
  };
  const off = onLiveChange(live);
  const watch = window.setInterval(live, 30000);
  const handle = drawer(titleEl, body, foot, () => {
    clearInterval(watch);
    off();
    view?.destroy();
    map?.destroy();
  });
  paint();
  if (map && view) requestAnimationFrame(() => view && map?.mount(view.mapData()));
}

/** ⋯ on a device card: quick actions (everything else is in the panel; click the card). */
export function quickMenu(anchor: HTMLElement, p: Person, d: Device, o: DeviceOpts) {
  const core = o.core ?? coreOf(null);
  const cfg = () => attempt(() => api.deviceConfig(d.id));
  const items: (MenuItem | null)[] = [
    {
      label: 'Show QR code',
      icon: icon('qr'),
      run: async () => {
        const c = await cfg();
        if (!c) return;
        modal(
          `${d.name} · QR code`,
          E('div', { class: 'dl-qr-pane' }, [
            qrCode(core.qrText(c)),
            E(
              'span',
              { class: 'dl-sub' },
              plainWg(c) ? 'Scan with AmneziaVPN or any WireGuard app on the device.' : 'Scan with AmneziaVPN or AmneziaWG on the device.',
            ),
          ]),
          cancelButton('Close'),
        );
      },
    },
    {
      label: core.file.label,
      icon: icon('download'),
      run: async () => {
        const c = await cfg();
        if (!c) return;
        const f = core.file.make(c);
        downloadFile(f.name, f.text, 'application/octet-stream');
      },
    },
    core.appKey
      ? {
          label: core.appKey.label,
          icon: icon('copy'),
          run: async () => {
            const c = await cfg();
            if (c) copyText(await core.appKey!.make(c), 'Key copied');
          },
        }
      : null,
    null,
    { label: 'Rename', icon: icon('edit'), run: () => openDevice(p, d, o) },
    {
      label: 'New keys',
      icon: icon('key'),
      run: async () => {
        if (
          await confirmDialog(
            'Generate new keys?',
            'The current configuration on this device stops working until it is imported again.',
            'Generate',
            true,
          )
        )
          if (await attempt(() => api.deviceRotate(d.id), 'New keys generated')) o.refresh();
      },
    },
    {
      label: d.disabled ? 'Enable' : 'Disable',
      icon: icon(d.disabled ? 'play' : 'pause'),
      warn: !d.disabled,
      run: async () => {
        if (await attempt(() => api.deviceUpdate(d.id, undefined, !d.disabled), d.disabled ? 'Device enabled' : 'Device disabled'))
          o.refresh();
      },
    },
    {
      label: 'Delete',
      icon: icon('trash'),
      danger: true,
      run: async () => {
        if (
          await confirmDialog(
            `Remove ${d.name}?`,
            'The device is disconnected immediately and its configuration stops working.',
            'Remove',
            true,
          )
        )
          if (await attempt(() => api.deviceDelete(d.id), 'Device removed')) o.refresh();
      },
    },
  ];
  dropdown(anchor, items);
}

/** Admin "Add device" dialog for a person; opens the new device's drawer. */
export function addDevice(person: Person, o: DeviceOpts) {
  const taken = person.devices.map((x) => x.name);
  // The name a type gives when none is typed: "Phone", then "Phone 2" (as the portal does).
  const suggest = (k: Kind) => {
    const base = KIND_LABEL[k];
    let n = 1;
    let name = base;
    while (taken.some((t) => t.toLowerCase() === name.toLowerCase())) name = `${base} ${++n}`;
    return name;
  };
  let kind: Kind = 'phone';
  const nameInput = E('input', { type: 'text', class: 'cbi-input-text', placeholder: suggest(kind), maxlength: 48 }) as HTMLInputElement;
  const nameRow = liveField('Name', nameInput, () =>
    nameInput.value.trim()
      ? nameHelp(nameInput.value, taken, 'Shown in the portal and in the app.')
      : { text: `Named after its type: ${suggest(kind)}.`, bad: false },
  );
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
            nameInput.placeholder = suggest(k);
            nameRow.refresh();
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
      nameRow,
    ],
    [
      cancelButton(),
      ' ',
      button(
        'Add device',
        async () => {
          const h = nameRow.help();
          if (h.bad) {
            notify(h.text, 'warning');
            return;
          }
          const name = nameInput.value.trim() || suggest(kind);
          const r = await attempt(() => api.deviceCreate(person.id, name, kind));
          if (!r) return;
          closeModal();
          notify(`${name} added`, 'success', 3000);
          o.refresh();
          await reopen(person.id, r.id, o);
        },
        'positive',
      ),
    ],
  );
  setTimeout(() => nameInput.focus(), 50);
}
