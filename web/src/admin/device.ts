// Device drawer: a right-hand panel with the device's status, connection
// (QR / key / file, from its server's core), details and actions; the ⋯ menu
// on a device card; and the admin's Add device dialog. Its own link (link
// state, MTU, keep-alive, LAN Bypass) is ./device-link.

import type { ClientConfig, Device, Geo, Kind, LogEvent, Person, Server } from '../shared/types';
import { E } from './e';
import { api } from './api';
import { button } from './ui/button';
import { cancelButton, closeModal, confirmDialog, modal } from './ui/modal';
import { copyText, downloadFile } from './ui/files';
import { dropdown, type MenuItem } from './ui/menu';
import { drawer } from './ui/drawer';
import { attempt, notify } from './ui/toast';
import { liveField, warnNote } from './ui/layout';
import { isOn, sw } from './ui/controls';
import { qrCode } from './ui/qr';
import { deviceNameHelp, type Help } from './netcheck';
import { deviceStatus } from './ui/badges';
import {
  ago,
  bytes,
  defaultName,
  fitName,
  homeOf,
  isoDay,
  kindLabel,
  netsLabel,
  pickLabel,
  PICKS,
  todayOf,
  type KindPick,
} from '../shared/format';
import { guardDeviceName } from '../shared/name-guard';
import { fill, fmt, locale, num } from '../shared/i18n';
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
import { linkRows, linkStatus } from './device-link';

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
  /** The device's server: what an empty MTU or keep-alive of its own gives. */
  server?: Server;
  /** The page's activity log, when it keeps one: the drawer reads it instead of fetching its own. */
  events?: () => LogEvent[] | null;
}

function when(ts: number): string {
  return ts
    ? new Date(ts * 1000).toLocaleString(locale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';
}

function copyRow(label: string, value: string, mono = false): HTMLElement {
  return E('div', { class: 'dl-kvrow' }, [
    E('span', { class: 'dl-kvrow-k' }, label),
    E(
      'button',
      {
        type: 'button',
        class: `dl-kvrow-v copy${mono ? ' dl-mono' : ''}`,
        title: _('Copy'),
        click: () => copyText(value, fmt(_('%s copied'), label)),
      },
      [E('span', {}, value), icon('copy')],
    ),
  ]);
}

function row(label: string, value: Node | string): HTMLElement {
  return E('div', { class: 'dl-kvrow' }, [E('span', { class: 'dl-kvrow-k' }, label), E('span', { class: 'dl-kvrow-v' }, value)]);
}

/** The device's own events: tone and icon (what they say is in eventText). */
const DEV_EVENT: Record<string, [string, string]> = {
  connect: ['ok', 'plug'],
  disconnect: ['', 'plug'],
  roam: ['', 'network'],
  device_added: ['ok', 'plus'],
  device_removed: ['', 'trash'],
  device_keys: ['', 'reset'],
};

/** What happened in the text colour, the details muted (as in the main log). */
function eventText(e: LogEvent): (string | HTMLElement)[] {
  const m = (t: string) => E('span', { class: 'dl-muted' }, t);
  const by = eventBy(e) === 'portal' ? _('on the portal') : eventBy(e) === 'admin' ? _('by you') : '';
  switch (e.type) {
    case 'connect':
      return [...(e.detail ? fill(_('Connected from %s'), m(e.detail)) : [_('Connected')]), e.where ? m(` · ${e.where}`) : ''];
    case 'disconnect':
      return [_('Went offline')];
    case 'roam':
      return [_('Changed network'), m(` · ${e.detail ?? ''}`)];
    case 'device_added':
      return by ? fill(_('Added %s'), m(by)) : [_('Added')];
    case 'device_removed':
      return by ? fill(_('Removed %s'), m(by)) : [_('Removed')];
    default: // device_keys
      return by ? fill(_('New keys %s'), m(by)) : [_('New keys')];
  }
}

/** Activity of one device, newest first. */
function deviceEvents(events: LogEvent[], id: string, now?: number): HTMLElement {
  const mine = events
    .filter((e) => e.device === id && DEV_EVENT[e.type])
    .reverse()
    .slice(0, 12);
  if (!mine.length) return E('div', { class: 'dl-sub' }, _('No activity yet.'));
  return E(
    'div',
    { class: 'dl-dev-log' },
    mine.map((e) => {
      const [tone, ic] = DEV_EVENT[e.type];
      const t = new Date(e.ts * 1000);
      return E('div', { class: `dl-dev-log-row${eventBy(e) === 'admin' ? ' dl-ev-by-admin' : ''}` }, [
        eventBy(e) === 'admin'
          ? E('span', { class: 'dl-ev-tile', title: _('Done by you in LuCI') }, icon('admin'))
          : E('span', { class: `dl-ev-tile ev ${tone}` }, icon(ic)),
        E('span', { class: 'dl-row-main' }, eventText(e)),
        E('span', { class: 'dl-faint dl-nowrap', title: t.toLocaleString(locale()) }, ago(e.ts, now)),
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
    void openDevice(p2, d2, {
      ...o,
      geo: st.geo,
      now: st.now,
      today: todayOf(st.series),
      core: coreFor(st.servers, p2.server),
      server: st.servers.find((s) => s.id === p2.server),
    });
}

/**
 * The connection of a device that holds an older configuration, behind a button: showing the new one is what
 * counts as giving it out (it clears "Update config"), never opening the drawer. `shown` runs once it is out.
 */
function newConfigGate(id: string, show: (cfg: ClientConfig) => Promise<HTMLElement>, shown: () => unknown): HTMLElement {
  const box = E('div', { class: 'dl-row-actions' });
  dom.content(
    box,
    button([icon('qr'), ' ', _('Show the new configuration')], async () => {
      const cfg = await attempt(() => api.deviceConfig(id, true));
      if (!cfg) return;
      box.className = '';
      dom.content(box, await show(cfg));
      void shown();
    }),
  );
  return box;
}

/** Device drawer. */
export async function openDevice(person: Person, dev: Device, o: DeviceOpts) {
  // A look: only a delivery (a code, a file, a key handed to the device) clears "Update config".
  const cfg = await attempt(() => api.deviceConfig(dev.id));
  if (!cfg) return;
  const core = o.core ?? coreOf(null);
  let d = dev;
  let p = person;
  let geo = o.geo;
  let now = o.now;
  let today = o.today ?? isoDay(new Date());
  let srv = o.server;
  // Phones and tablets are set up by scanning; computers and routers by a file.
  const block = (c: ClientConfig) => core.connectBlock(c, dev.kind === 'phone' || dev.kind === 'tablet' ? 'qr' : 'file');
  // An older configuration on the device: the new one waits for a click (the inline QR code is itself a delivery).
  // `relinked`: its MTU or keep-alive was just changed here, which outdates the configuration on screen even where
  // the router keeps no record of what the device got (never "stale" then, e.g. after a JSON import).
  let gated = dev.config_stale;
  let relinked = false;
  const gate = () =>
    newConfigGate(dev.id, block, () => {
      gated = false;
      return changed();
    });
  const connect = gated ? gate() : await block(cfg);
  const titleEl = E('div', { class: 'dl-drawer-title' });
  const stats = E('div', {});
  const details = E('div', {});
  const log = E('div', {}, E('div', { class: 'dl-sub' }, _('Loading…')));
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
          button([icon('edit')], () => rename(), 'neutral', { title: _('Rename'), class: 'cbi-button cbi-button-neutral dl-icon-only sm' }),
        ]),
        E('span', { class: 'dl-sub' }, `${p.name} · ${kindLabel(d.kind)}`),
      ]),
    ]);
    const days = d.spark.map(([rx, tx]) => rx + tx);
    const week = days.reduce((a, b) => a + b, 0);
    dom.content(
      stats,
      E('div', { class: 'dl-dstats' }, [
        E('div', { class: 'dl-dstats-cell wide' }, [
          E('span', { class: 'dl-metric-label' }, _('Status')),
          // Its link failing in a named way says so, with what it means; otherwise its usual status.
          (d.link && !d.disabled && linkStatus(d.link)) || deviceStatus(d, now, _('Waiting for the first connection'), p),
        ]),
        E('div', { class: 'dl-dstats-cell' }, [
          E('span', { class: 'dl-metric-label' }, _('This month')),
          E('b', {}, bytes(d.month[0] + d.month[1])),
          E('span', { class: 'dl-sub dl-mono' }, `↓ ${bytes(d.month[1])} ↑ ${bytes(d.month[0])}`),
        ]),
        E('div', { class: 'dl-dstats-cell' }, [
          E('span', { class: 'dl-metric-label' }, _('Last 7 days')),
          E('b', {}, bytes(week)),
          spark(days, 120, 22, today),
        ]),
      ]),
    );
    dom.content(
      details,
      E('div', { class: 'dl-kv2' }, [
        copyRow(_('Tunnel address'), d.address),
        ...linkRows(d, p, srv, () => {
          relinked = true;
          return changed();
        }).map(([k, v]) => row(k, v)),
        d.hostname && p.access !== 'internet' ? copyRow(_('Local address'), d.hostname) : '',
        // Where it connects from is under Locations (with the place and network); from home
        // (not on the map) or without locations, here.
        d.endpoint && !geo?.points.some((x) => x.device === d.id && x.ip === d.endpoint) ? row(_('Client IP'), d.endpoint) : '',
        row(
          _('Total'),
          E('span', { class: 'dl-kv-act' }, [
            `↓ ${bytes(d.total[1])} · ↑ ${bytes(d.total[0])}`,
            E(
              'button',
              {
                type: 'button',
                class: 'dl-linkbtn danger',
                click: () => resetUsageDialog('device', d.id, d.name, () => setTimeout(changed, 300)),
              },
              _('Reset'),
            ),
          ]),
        ),
        row(_('Added'), `${when(d.created)} · ${d.created_by === 'portal' ? _('from the portal') : _('by you')}`),
        // The whole key, copyable: it is what another WireGuard server needs to add this device by hand.
        cfg.amnezia.client_pub_key ? copyRow(_('Public key'), cfg.amnezia.client_pub_key) : row(_('Public key'), '—'),
      ]),
    );
    dom.content(foot, [
      button(
        [icon(d.disabled ? 'play' : 'pause'), ' ', d.disabled ? _('Enable') : _('Disable')],
        async () => {
          if (await attempt(() => api.deviceUpdate(d.id, undefined, !d.disabled), d.disabled ? _('Device enabled') : _('Device disabled')))
            await changed();
        },
        'neutral',
        d.disabled ? {} : { class: 'cbi-button cbi-button-neutral dl-btn-warn' },
      ),
      button([icon('key'), ' ', _('New keys')], async () => {
        if (
          !(await confirmDialog(
            _('Generate new keys?'),
            _('The current configuration on this device stops working until it is imported again.'),
            _('Generate'),
            true,
          ))
        )
          return;
        const c = await attempt(() => api.deviceRotate(d.id), _('New keys generated'));
        if (c) {
          o.refresh();
          handle.close();
          await reopen(p.id, d.id, o);
        }
      }),
      E('span', { class: 'dl-spacer' }),
      button(
        [icon('trash'), ' ', _('Remove')],
        async () => {
          if (
            !(await confirmDialog(
              fmt(_('Remove %s?'), d.name),
              _('The device is disconnected immediately and its configuration stops working.'),
              _('Remove'),
              true,
            ))
          )
            return;
          if (await attempt(() => api.deviceDelete(d.id), _('Device removed'))) {
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
    srv = st.servers.find((s) => s.id === p2.server);
    paint();
    // A change made here (its MTU or keep-alive) or elsewhere left the configuration on screen behind: the new one
    // waits behind the button.
    if ((d.config_stale || relinked) && !gated) {
      gated = true;
      dom.content(connectSec, connectBody(gate()));
    }
    relinked = false;
    view?.update({ geo: st.geo, now: st.now, person: p, device: d });
  };
  /** After a change made here: this drawer and the page. */
  const changed = async () => {
    await reload();
    o.refresh();
  };

  const rename = () => {
    const input = E('input', { type: 'text', class: 'cbi-input-text', value: d.name }) as HTMLInputElement;
    const said = nameGuard(input, () => nameRow.refresh());
    const taken = p.devices.filter((x) => x.id !== d.id).map((x) => x.name);
    const nameRow = liveField(_('Name'), input, () => said(deviceNameHelp(input.value, taken, _('Shown in the portal and in the app.'))));
    modal(
      fmt(_('Rename %s'), d.name),
      [nameRow],
      [
        cancelButton(),
        ' ',
        button(
          _('Save'),
          async () => {
            const h = nameRow.help();
            if (h.bad) {
              notify(h.text, 'warning');
              return;
            }
            if (await attempt(() => api.deviceUpdate(d.id, input.value, undefined), _('Renamed'))) {
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
  const connectBody = (c: HTMLElement) => [
    // Whether it is connected (or still waiting) is in Status above.
    E('div', { class: 'dl-dsec-head' }, [E('h4', {}, _('Connect', 'section'))]),
    d.config_stale
      ? warnNote(
          _(
            'This device has an older configuration: networks or DNS changed since it was set up. Import it again with the QR code, key or file below.',
          ),
        )
      : '',
    c,
  ];
  const connectSec = E('section', { class: 'dl-dsec' }, connectBody(connect));
  const activitySec = E('section', { class: 'dl-dsec' }, [
    E('div', { class: 'dl-dsec-head' }, [
      E('h4', {}, _('Activity')),
      E('div', { class: 'dl-dsec-actions' }, [
        E(
          'button',
          { type: 'button', class: 'dl-linkbtn', click: () => exportEvents({ people: [p] }, logEvents, 'csv', d.id) },
          _('Export'),
        ),
        E(
          'button',
          {
            type: 'button',
            class: 'dl-linkbtn danger',
            click: () =>
              clearLogDialog(fmt(_("Clear %s's activity"), d.name), fmt(_('Removes events about %s.'), d.name), { device: d.id }, () => {
                void loadLog(true);
                o.refresh();
              }),
          },
          _('Clear'),
        ),
        E('a', { href: `${L.url('admin/network/dawnline/diagnostics')}?tab=log` }, _('All activity')),
      ]),
    ]),
    log,
  ]);
  const detailsSec = E('section', { class: 'dl-dsec' }, [
    E('div', { class: 'dl-dsec-head' }, E('h4', {}, _('Details', 'section'))),
    details,
  ]);
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
        E('h4', {}, _('Locations')),
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
  // Each of these gives the configuration out.
  const cfg = () => attempt(() => api.deviceConfig(d.id, true));
  const items: (MenuItem | null)[] = [
    {
      label: _('Show QR code'),
      icon: icon('qr'),
      run: async () => {
        const c = await cfg();
        if (!c) return;
        modal(
          `${d.name} · ${_('QR code')}`,
          E('div', { class: 'dl-qr-pane' }, [
            qrCode(core.qrText(c)),
            E(
              'span',
              { class: 'dl-sub' },
              plainWg(c)
                ? _('Scan with AmneziaVPN or any WireGuard app on the device.')
                : _('Scan with AmneziaVPN or AmneziaWG on the device.'),
            ),
          ]),
          cancelButton(_('Close')),
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
            if (c) copyText(await core.appKey!.make(c), _('Key copied'));
          },
        }
      : null,
    null,
    { label: _('Rename'), icon: icon('edit'), run: () => openDevice(p, d, o) },
    {
      label: _('New keys'),
      icon: icon('key'),
      run: async () => {
        if (
          await confirmDialog(
            _('Generate new keys?'),
            _('The current configuration on this device stops working until it is imported again.'),
            _('Generate'),
            true,
          )
        )
          if (await attempt(() => api.deviceRotate(d.id), _('New keys generated'))) o.refresh();
      },
    },
    {
      label: d.disabled ? _('Enable') : _('Disable'),
      icon: icon(d.disabled ? 'play' : 'pause'),
      warn: !d.disabled,
      run: async () => {
        if (await attempt(() => api.deviceUpdate(d.id, undefined, !d.disabled), d.disabled ? _('Device enabled') : _('Device disabled')))
          o.refresh();
      },
    },
    {
      label: _('Delete'),
      icon: icon('trash'),
      danger: true,
      run: async () => {
        if (
          await confirmDialog(
            fmt(_('Remove %s?'), d.name),
            _('The device is disconnected immediately and its configuration stops working.'),
            _('Remove'),
            true,
          )
        )
          if (await attempt(() => api.deviceDelete(d.id), _('Device removed'))) o.refresh();
      },
    },
  ];
  dropdown(anchor, items);
}

/**
 * A device's name field guarded as the portal's are (shared/name-guard.ts): a refused character shakes the input,
 * and the row's help says why until a change gets in or the field is left (Save never reads a stale reason).
 * Returns what the row's help passes its own through.
 */
function nameGuard(input: HTMLInputElement, refresh: () => void): (help: Help) => Help {
  let why: string | null = null;
  guardDeviceName(input, input, (w) => {
    why = w;
    refresh();
  });
  input.addEventListener('blur', () => {
    if (!why) return;
    why = null;
    refresh();
  });
  return (help) => (why ? { text: why, bad: true } : help);
}

/** Admin "Add device" dialog for a person; opens the new device's drawer. */
export function addDevice(person: Person, o: DeviceOpts) {
  const taken = person.devices.map((x) => x.name);
  // The name a type gives when none is typed: "Phone", then "Phone 2" (as the portal does).
  const suggest = (k: Kind) => {
    const base = defaultName(k);
    let n = 1;
    let name = fitName(base);
    while (taken.some((t) => t.toLowerCase() === name.toLowerCase())) name = fitName(base, ` ${++n}`);
    return name;
  };
  // Mobile from here is a phone: the admin is never on the device itself (see KindPick).
  const kindOf = (p: KindPick): Kind => (p === 'mobile' ? 'phone' : p);
  let pick: KindPick = 'mobile';
  const nameInput = E('input', {
    type: 'text',
    class: 'cbi-input-text',
    placeholder: suggest(kindOf(pick)),
  }) as HTMLInputElement;
  const said = nameGuard(nameInput, () => nameRow.refresh());
  const nameRow = liveField(_('Name'), nameInput, () =>
    said(
      nameInput.value.trim()
        ? deviceNameHelp(nameInput.value, taken, _('Shown in the portal and in the app.'))
        : { text: fmt(_('Named after its type: %s.'), suggest(kindOf(pick))), bad: false },
    ),
  );
  const kinds = E(
    'div',
    { class: 'dl-kinds', role: 'radiogroup', 'aria-label': _('Type') },
    PICKS.map((k) =>
      E(
        'button',
        {
          type: 'button',
          role: 'radio',
          class: k === pick ? 'on' : '',
          'aria-checked': k === pick ? 'true' : 'false',
          'data-kind': k,
          click: () => {
            pick = k;
            kinds.querySelectorAll('button').forEach((c) => {
              const on = (c as HTMLElement).dataset.kind === k;
              c.classList.toggle('on', on);
              c.setAttribute('aria-checked', on ? 'true' : 'false');
            });
            nameInput.placeholder = suggest(kindOf(k));
            nameRow.refresh();
          },
        },
        [icon(k), E('span', {}, pickLabel(k))],
      ),
    ),
  );
  // LAN Bypass: off unless chosen (the person chooses it on the portal, the admin here).
  const bypass = sw(false, _('LAN Bypass'));
  const over = person.devices.length >= person.device_limit;
  modal(
    fmt(_('Add a device for %s'), person.name),
    [
      over
        ? E(
            'p',
            { class: 'dl-hint' },
            fmt(
              N_(
                person.device_limit,
                '%s already has %s of %s device. As admin you can still add one.',
                '%s already has %s of %s devices. As admin you can still add one.',
              ),
              person.name,
              num(person.devices.length),
              num(person.device_limit),
            ),
          )
        : '',
      E('div', { class: 'dl-fld' }, [E('span', { class: 'dl-fld-label' }, _('Type')), kinds]),
      // As the portal's Add a device: between the type and the name.
      E('div', { class: 'cbi-value dl-live' }, [
        E('div', { class: 'cbi-value-title' }, [
          E('label', {}, _('LAN Bypass')),
          E(
            'div',
            { class: 'dl-sub' },
            homeOf(person, o.server).length
              ? fmt(
                  _('The device’s local network stays reachable while connected, except %s: your home network.'),
                  netsLabel(homeOf(person, o.server)),
                )
              : _('The device’s local network stays reachable while connected.'),
          ),
        ]),
        E('div', { class: 'cbi-value-field' }, bypass),
      ]),
      nameRow,
    ],
    [
      cancelButton(),
      ' ',
      button(
        _('Add device'),
        async () => {
          const h = nameRow.help();
          if (h.bad) {
            notify(h.text, 'warning');
            return;
          }
          const name = nameInput.value.trim() || suggest(kindOf(pick));
          const r = await attempt(() => api.deviceCreate(person.id, name, kindOf(pick), isOn(bypass)));
          if (!r) return;
          closeModal();
          notify(fmt(_('%s added'), name), 'success', 3000);
          o.refresh();
          await reopen(person.id, r.id, o);
        },
        'positive',
      ),
    ],
  );
  setTimeout(() => nameInput.focus(), 50);
}
