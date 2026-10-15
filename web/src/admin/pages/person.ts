// Person page (admin/network/dawnline/person?id=…): devices as cards,
// locations, activity, and access & limits that apply immediately.

import type { DayUsage, Device, LogEvent, Person, Status } from '../../shared/types';
import { E } from '../e';
import { api, type PersonPatch } from '../api';
import {
  attempt,
  button,
  closeModal,
  confirmDialog,
  copyText,
  downloadFile,
  dropdown,
  iconButton,
  modal,
  notify,
  svg,
  type MenuItem,
} from '../ui';
import { clearLogDialog, exportEvents, resetUsageDialog } from '../logs';
import { addDevice, connectBlock, openDevice } from '../device';
import { inviteCard } from '../invite';
import { icon } from '../../shared/icons';
import { qrSvg } from '../../shared/qr';
import { ACCESS_LABEL, KIND_LABEL, ago, byDeviceState, bytes, date, daysLeft, initials } from '../../shared/format';
import { ConnectionMap, rangeControl } from '../map';
import { attachTip } from '../charts';
import { peopleUrl } from '../urls';
import { daysTile, eventRow, eventText, speedTile } from './overview';
import { stateBadge } from './people';
import { circleDialog, circleDot, homeAccess } from '../access';

type Step = 'day' | 'week' | 'month' | 'year' | 'custom';

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Move an end date by n steps (negative shortens). An empty date counts from today. */
export function shiftDate(cur: string, step: Step, n: number, customDays = 30): string {
  const d = cur ? new Date(`${cur}T12:00:00`) : new Date();
  if (step === 'day') d.setDate(d.getDate() + n);
  else if (step === 'week') d.setDate(d.getDate() + 7 * n);
  else if (step === 'month') d.setMonth(d.getMonth() + n);
  else if (step === 'year') d.setFullYear(d.getFullYear() + n);
  else d.setDate(d.getDate() + customDays * n);
  return iso(d);
}

const ACCESS_TEXT: Record<Person['access'], string> = {
  internet: 'Browse the internet through your router. No access to devices at home, and home cannot reach theirs.',
  lan: 'Reach devices at home, and home reaches theirs. Internet stays on their own connection.',
  both: 'Home devices and the internet, all through your router. Home reaches their devices too.',
};

export class PersonPage {
  st!: Status;
  id = '';
  p!: Person;
  events: LogEvent[] = [];
  /** The map stays folded into one line until asked for. */
  mapOpen = false;
  map: ConnectionMap | null = null;
  parts: Record<string, HTMLElement> = {};
  /** Daily traffic for the last 30 days. */
  series: DayUsage[] = [];
  /** The same per device. */
  devSeries: Record<string, DayUsage[]> = {};

  async load(): Promise<[Status, LogEvent[]]> {
    this.id = new URLSearchParams(location.search).get('id') ?? '';
    const [st, ev, use] = await Promise.all([
      api.status(30),
      api.events(5000).catch(() => ({ events: [] as LogEvent[] })),
      api.personUsage(this.id, 30).catch(() => null),
    ]);
    this.series = use?.person ?? [];
    this.devSeries = use?.devices ?? {};
    return [st, ev.events];
  }

  render([st, events]: [Status, LogEvent[]]): HTMLElement {
    this.st = st;
    this.events = events;
    const p = st.people.find((x) => x.id === this.id);
    if (!p)
      return E('div', { class: 'dl-empty' }, [
        E('h3', {}, 'Person not found'),
        E('p', {}, 'They may have been removed.'),
        E('a', { class: 'cbi-button', href: L.url('admin/network/dawnline/server') }, 'Back to Servers'),
      ]);
    this.p = p;
    for (const k of ['head', 'devices', 'traffic', 'places', 'activity', 'limits']) this.parts[k] = E('div', {});
    this.parts.devices.className = 'dl-person-devices';
    const root = E('div', {}, [
      E('nav', { class: 'dl-crumbs', 'aria-label': 'Breadcrumb' }, [
        E('a', { href: peopleUrl(p.server) }, st.servers.find((x) => x.id === p.server)?.name ?? 'Servers'),
        E('span', {}, '/'),
        E('a', { href: peopleUrl(p.server) }, 'People'),
        E('span', {}, '/'),
        E('span', {}, p.name),
      ]),
      this.parts.head,
      E('div', { class: 'dl-grid-person' }, [
        E('div', { class: 'dl-col' }, [this.parts.devices, this.parts.traffic, this.parts.places, this.parts.activity]),
        E('div', { class: 'dl-col' }, [this.parts.limits]),
      ]),
    ]);
    this.paint();
    const q = new URLSearchParams(location.search);
    const dev = q.get('device') && p.devices.find((d) => d.id === q.get('device'));
    if (dev) setTimeout(() => openDevice(this.p, dev, () => this.refresh(), this.st.geo), 50);
    else if (q.get('add')) setTimeout(() => addDevice(this.p, () => this.refresh()), 50);
    poll.add(() => this.refresh(true), 15);
    return root;
  }

  // Newest request wins: a quiet poll that started before an edit must not
  // paint its older answer over the refresh that follows the edit.
  private refreshSeq = 0;
  private refreshShown = 0;

  async refresh(quiet = false) {
    const seq = ++this.refreshSeq;
    const [st, ev, use] = await Promise.all([
      api.status(30).catch(() => null),
      api.events(5000).catch(() => null),
      api.personUsage(this.id, 30).catch(() => null),
    ]);
    if (!st || seq < this.refreshShown) return;
    this.refreshShown = seq;
    this.st = st;
    if (ev) this.events = ev.events;
    if (use) {
      this.series = use.person;
      this.devSeries = use.devices;
    }
    const p = st.people.find((x) => x.id === this.id);
    if (!p) {
      if (!quiet) location.href = peopleUrl(this.p?.server);
      return;
    }
    this.p = p;
    this.paint();
    this.map?.update(this.mapData());
  }

  /** Apply a change now and repaint from the server's answer. */
  async patch(patch: PersonPatch, ok?: string) {
    const r = await attempt(() => api.personUpdate(this.p.id, patch), ok);
    if (!r) return;
    const i = this.st.people.findIndex((x) => x.id === this.p.id);
    r.person.rate ??= this.p.rate;
    if (i >= 0) this.st.people[i] = r.person;
    this.p = r.person;
    this.paint();
  }

  mapData() {
    return { geo: this.st.geo, people: this.st.people, now: this.st.now, person: this.p.id };
  }

  mapCard(): HTMLElement {
    const head = E('div', { class: 'dl-panel-head pad' }, [
      E('h3', {}, 'Locations'),
      E('span', { class: 'dl-spacer' }),
      this.st.geo.enabled ? rangeControl('30d', (r) => this.map?.setRange(r), false) : '',
      button(
        'Hide',
        () => {
          this.mapOpen = false;
          this.map?.destroy();
          this.map = null;
          this.paintPlaces();
        },
        'neutral',
      ),
    ]);
    if (!this.st.geo.enabled)
      return E('div', { class: 'dl-panel flush' }, [
        head,
        E('div', { class: 'dl-map-off' }, [
          'Locations are off. ',
          E('a', { href: L.url('admin/network/dawnline/settings') }, 'Turn them on in Settings'),
          '.',
        ]),
      ]);
    this.map = new ConnectionMap(
      {
        openPerson: () => undefined,
        openDevice: (_pid, did) => {
          const d = this.p.devices.find((x) => x.id === did);
          if (d) openDevice(this.p, d, () => this.refresh(), this.st.geo);
        },
      },
      '30d',
      280,
    );
    requestAnimationFrame(() => this.map!.mount(this.mapData()));
    return E('div', { class: 'dl-panel flush' }, [head, this.map.el]);
  }

  paint() {
    const p = this.p;
    const st = this.st;
    const lastSeen = p.online ? 'online now' : p.last_seen ? `last seen ${ago(p.last_seen, st.now)}` : 'never connected';

    // Speed now and the last 30 days, the same tiles as the server Overview.
    const todayUse = this.series.find((d) => d.day === iso(new Date()));
    // Speed only while a device is online; otherwise the 30 days take the row.
    dom.content(
      this.parts.traffic,
      E('div', { class: `dl-person-live${p.online ? '' : ' solo'}` }, [
        p.online ? speedTile(p.rate ?? [], st.now, todayUse ? [todayUse.rx, todayUse.tx] : [0, 0]) : '',
        daysTile(this.series, `${bytes(p.month[0] + p.month[1])} this month`),
      ]),
    );

    const added = p.created ? `Added ${date(iso(new Date(p.created * 1000)))}` : '';
    const menu: (MenuItem | null)[] = [
      { label: 'Rename', icon: icon('edit'), run: () => this.rename() },
      { label: p.note ? 'Edit note' : 'Add note', icon: icon('file'), run: () => this.editNote() },
      ...(p.link
        ? [
            null,
            { label: 'Invite card', icon: icon('qr'), run: () => this.invite() },
            { label: 'New link', icon: icon('key'), run: () => this.newLink() },
          ]
        : []),
      null,
      {
        label: p.paused ? 'Resume' : 'Pause',
        icon: icon(p.paused ? 'play' : 'pause'),
        warn: !p.paused,
        run: () => this.patch({ paused: !p.paused }, p.paused ? 'Resumed' : 'Paused'),
      },
      { label: 'Delete', icon: icon('trash'), danger: true, run: () => this.remove() },
    ];
    dom.content(
      this.parts.head,
      E('div', { class: 'dl-person-head' }, [
        E('div', { class: 'dl-pagehead' }, [
          E('div', { class: 'dl-person-id' }, [
            E('span', { class: `dl-avatar lg${p.online ? ' online' : ''}` }, initials(p.name)),
            E('div', { class: 'dl-stack' }, [
              E('div', { class: 'dl-title-row' }, [E('h2', { class: 'dl-h1' }, p.name), stateBadge(p)]),
              E('span', { class: 'dl-faint', title: added }, `${p.devices.length} of ${p.device_limit} devices · ${lastSeen}`),
            ]),
          ]),
          E('div', { class: 'dl-pcard-actions' }, [
            p.link ? iconButton('link', 'Copy link', () => copyText(p.link!, 'Personal link copied'), 'neutral', 'dl-icon-only') : '',
            iconButton('more', 'More', (ev: MouseEvent) => dropdown(ev.currentTarget as HTMLElement, menu), 'neutral', 'dl-icon-only'),
          ]),
        ]),
        // Under the name block, not inside it, so the avatar centres on name + status; indented to the name.
        p.note
          ? E('button', { type: 'button', class: 'dl-pnote', title: 'Edit note', click: () => this.editNote() }, [
              icon('file'),
              E('span', {}, p.note),
            ])
          : '',
      ]),
    );

    this.paintDevices();
    this.paintLimits();
    this.paintPlaces();

    const all = this.events.filter((e) => e.person === p.id);
    // Back-and-forth network changes (Wi-Fi <-> mobile) fold into one row.
    const rows: HTMLElement[] = [];
    const latest = [...all].reverse();
    for (let i = 0; i < latest.length && rows.length < 10; i++) {
      const e = latest[i];
      let n = 1;
      while (e.type === 'roam' && latest[i + n]?.type === 'roam' && latest[i + n].device === e.device) n++;
      const row = eventRow(st, e, { server: false });
      if (n > 1) {
        const main = row.querySelector('.dl-row-main') as HTMLElement;
        dom.content(main, [...eventText(st, e).slice(0, 3), E('span', { class: 'dl-muted' }, `${n} times`)]);
        main.title = latest
          .slice(i, i + n)
          .map((x) => x.detail ?? '')
          .join('\n');
      }
      rows.push(row);
      i += n - 1;
    }
    const more = button(
      [icon('more')],
      () =>
        dropdown(more, [
          { label: 'Export CSV', icon: icon('download'), run: () => exportEvents(this.st, all, 'csv', p.id) },
          { label: 'Export JSON', icon: icon('download'), run: () => exportEvents(this.st, all, 'json', p.id) },
          null,
          {
            label: `Clear ${p.name}'s activity`,
            icon: icon('trash'),
            danger: true,
            run: () =>
              clearLogDialog(`Clear ${p.name}'s activity`, `Removes events about ${p.name} and their devices.`, { person: p.id }, () =>
                this.refresh(),
              ),
          },
        ]),
      'neutral',
      { title: 'Export or clear', class: 'cbi-button cbi-button-neutral dl-icon-only' },
    );
    dom.content(
      this.parts.activity,
      E('div', { class: 'dl-panel flush' }, [
        E('div', { class: 'dl-panel-head pad' }, [
          E('h3', {}, 'Activity'),
          E('span', { class: 'dl-sub' }, all.length > 10 ? `latest 10 of ${all.length}` : ''),
          E('span', { class: 'dl-spacer' }),
          more,
        ]),
        rows.length ? rows : E('div', { class: 'dl-row dl-muted' }, 'Nothing yet.'),
      ]),
    );
  }

  deviceStatus(d: Device): HTMLElement {
    // Status as coloured text, no dots (only avatars carry one).
    if (d.disabled) return E('span', { class: 'dl-dstat' }, 'Disabled');
    if (d.online) return E('span', { class: 'dl-dstat ok' }, 'Connected');
    if (!d.handshake) return E('span', { class: 'dl-dstat warn', title: 'Waiting for the first connection' }, 'Not set up yet');
    return E('span', { class: 'dl-dstat' }, `Last seen ${ago(d.handshake, this.st.now)}`);
  }

  /** While online: the client IP (copyable). Tunnel address and home name live in the device drawer. */
  /** Daily traffic of one device over the last 30 days, today on the right. */
  deviceBars(id: string): HTMLElement {
    const days = (this.devSeries[id] ?? []).slice(-30);
    const vals = days.map((x) => x.rx + x.tx);
    const max = Math.max(1, ...vals);
    const label = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return E(
      'div',
      { class: 'dl-dbars' },
      days.map((x, i) => {
        const bar = E('i', { class: `${vals[i] ? '' : 'zero'}${i === days.length - 1 ? ' hi' : ''}` });
        bar.style.height = `${Math.max(8, (vals[i] / max) * 100)}%`;
        attachTip(bar, () => [
          E('div', { class: 'dl-tip-title' }, i === days.length - 1 ? `Today · ${label(x.day)}` : label(x.day)),
          E('div', {}, bytes(vals[i])),
        ]);
        return bar;
      }),
    );
  }

  paintDevices() {
    const p = this.p;
    const refresh = () => this.refresh();
    const cards = byDeviceState(p.devices).map((d) => {
      const open = () => openDevice(p, d, refresh, this.st.geo);
      return E('article', { class: `dl-dcard${d.online ? ' online' : ''}${d.disabled ? ' off' : ''}` }, [
        E('div', { class: 'dl-dcard-head' }, [
          E('span', { class: 'dl-dcard-ic' }, icon(d.kind)),
          E('button', { type: 'button', class: 'dl-dcard-title', click: open }, [
            E('b', {}, d.name),
            this.deviceStatus(d),
            d.config_stale ? E('span', { class: 'dl-pill warn dl-stale' }, 'Update config') : '',
          ]),
          button([icon('more')], open, 'neutral', {
            title: `${d.name}: connect, rename, keys, remove`,
            class: 'cbi-button cbi-button-neutral dl-icon-only',
          }),
        ]),
        d.handshake
          ? E('div', { class: 'dl-dcard-trend' }, [
              E('div', { class: 'dl-stack' }, [E('b', {}, bytes(d.month[0] + d.month[1])), E('span', { class: 'dl-sub' }, 'this month')]),
              this.deviceBars(d.id),
            ])
          : d.disabled
            ? E(
                'div',
                { class: 'dl-sub' },
                `${KIND_LABEL[d.kind]} · created ${ago(d.created, this.st.now)} ${d.created_by === 'portal' ? 'in the portal' : 'by you'}.`,
              )
            : E('div', { class: 'dl-chips-row' }, [
                E('button', { type: 'button', class: 'dl-chipbtn', click: () => this.showDeviceQr(d) }, [icon('qr'), 'Show QR']),
                E('button', { type: 'button', class: 'dl-chipbtn', click: () => this.downloadConfig(d) }, [icon('download'), 'Config']),
              ]),
      ]);
    });
    // Always the last card: admins may add over the person's limit, it says so.
    const over = p.devices.length >= p.device_limit;
    cards.push(
      E('button', { type: 'button', class: 'dl-dslot add', click: () => addDevice(p, refresh) }, [
        E('span', { class: 'dl-dslot-ic' }, icon('plus')),
        E('span', { class: 'dl-stack' }, [
          E('b', {}, 'Add device'),
          over ? E('span', { class: 'dl-sub' }, `Over the limit · ${p.devices.length} of ${p.device_limit}`) : '',
        ]),
      ]),
    );
    dom.content(
      this.parts.devices,
      E('section', { class: 'dl-devsec' }, [
        E('div', { class: 'dl-panel-head' }, [E('h3', {}, 'Devices'), E('span', { class: 'dl-sub' }, `${p.online} online`)]),
        E('div', { class: 'dl-dgrid' }, cards),
      ]),
    );
  }

  paintLimits() {
    const p = this.p;
    const seg = E(
      'div',
      { class: 'dl-seg wide', role: 'radiogroup', 'aria-label': 'Access' },
      (['internet', 'lan', 'both'] as const).map((a) =>
        E(
          'button',
          {
            type: 'button',
            role: 'radio',
            class: p.access === a ? 'on' : '',
            'aria-checked': p.access === a ? 'true' : 'false',
            click: () => p.access !== a && this.patch({ access: a }, `Access: ${ACCESS_LABEL[a]}`),
          },
          [
            icon(a === 'internet' ? 'globe' : a === 'lan' ? 'home' : 'shield'),
            a === 'internet' ? 'Internet' : a === 'lan' ? 'Home' : 'Both',
          ],
        ),
      ),
    );

    // End date
    const left = daysLeft(p.expires);
    const dateInput = E('input', {
      type: 'date',
      class: 'dl-date-hidden',
      value: p.expires,
      tabindex: '-1',
      'aria-hidden': 'true',
    }) as HTMLInputElement;
    dateInput.addEventListener(
      'change',
      () => dateInput.value && this.patch({ expires: dateInput.value }, `Access until ${date(dateInput.value)}`),
    );
    // Extend from the current end, or from today when there is none or it has passed.
    const extend = (step: 'week' | 'month' | 'year', n: number, label: string) => {
      const next = shiftDate(p.expires && (left ?? -1) >= 0 ? p.expires : '', step, n);
      this.patch({ expires: next }, `Access until ${date(next)}`);
      return label;
    };
    const ext = (
      [
        ['week', 1, '+1 week'],
        ['month', 1, '+1 month'],
        ['month', 3, '+3 months'],
        ['year', 1, '+1 year'],
      ] as const
    ).map(([st, n, label]) => E('button', { type: 'button', class: 'dl-chipbtn', click: () => extend(st, n, label) }, label));
    // The native date input stays hidden behind the chip and only opens its picker.
    const pick = E('span', { class: 'dl-datechip' }, [
      E(
        'button',
        {
          type: 'button',
          class: 'dl-chipbtn',
          click: () => {
            try {
              dateInput.showPicker();
            } catch {
              dateInput.focus();
            }
          },
        },
        [icon('calendar'), p.expires ? date(p.expires) : 'Date'],
      ),
      dateInput,
    ]);
    const action = { pause: 'pause access', notify: 'keep access', remove: 'remove their devices' }[p.expire_action];
    const endTile = E('div', { class: 'dl-tile2' }, [
      E('div', { class: 'dl-tile2-label' }, [
        E('span', {}, 'Access ends'),
        p.expires
          ? E(
              'span',
              { class: left != null && left < 0 ? 'dl-bad' : left != null && left <= p.expire_warn ? 'dl-warn' : 'dl-ok' },
              left != null && left < 0 ? 'ended' : `${left} day${left === 1 ? '' : 's'} left`,
            )
          : E('span', { class: 'dl-faint' }, 'no end date'),
      ]),
      E('div', { class: 'dl-chips-row' }, [
        ...ext,
        pick,
        p.expires
          ? E('button', { type: 'button', class: 'dl-chipbtn', click: () => this.patch({ expires: '' }, 'No end date') }, 'No end')
          : '',
      ]),
      E('div', { class: 'dl-tile2-foot' }, [
        E(
          'span',
          { class: 'dl-muted' },
          `When it ends: ${action}${p.expire_warn ? `, warn ${p.expire_warn} day${p.expire_warn === 1 ? '' : 's'} before` : ''}`,
        ),
        E(
          'a',
          {
            href: '#',
            click: (ev: Event) => {
              ev.preventDefault();
              this.endSettings();
            },
          },
          'Change',
        ),
      ]),
    ]);

    // Data
    const used = p.quota_used || p.month[0] + p.month[1];
    const pct = p.quota_limit ? Math.min(100, (p.quota_used / p.quota_limit) * 100) : 0;
    const bar = E('div', { class: `dl-meter${pct >= 100 ? ' bad' : pct >= 90 ? ' warn' : ''}` }, [
      E('i'),
      p.quota_limit ? E('span', { class: 'mark', title: 'Alert at 90%' }) : '',
    ]);
    (bar.firstChild as HTMLElement).style.width = `${pct}%`;
    if (p.quota_limit)
      attachTip(bar, () => [
        E('div', { class: 'dl-tip-title' }, `${pct.toFixed(1)}% used`),
        E(
          'div',
          { class: 'dl-muted' },
          `${bytes(p.quota_used)} of ${bytes(p.quota_limit)} · ${bytes(Math.max(0, p.quota_limit - p.quota_used))} left`,
        ),
        E('div', { class: 'dl-faint' }, 'Alert at 90%'),
      ]);
    const period = E(
      'div',
      { class: 'dl-seg sm' },
      (['month', 'total'] as const).map((v) =>
        E(
          'button',
          { type: 'button', class: p.quota_period === v ? 'on' : '', click: () => p.quota_period !== v && this.patch({ quota_period: v }) },
          v === 'month' ? 'Monthly' : 'Total',
        ),
      ),
    );
    const presets = [10, 50, 100].map((gb) =>
      E(
        'button',
        {
          type: 'button',
          class: `dl-chipbtn${p.quota_gb === gb ? ' on' : ''}`,
          click: () => this.patch({ quota_gb: String(gb) }, `Data limit ${gb} GB`),
        },
        `${gb} GB`,
      ),
    );
    presets.push(
      E(
        'button',
        { type: 'button', class: `dl-chipbtn${!p.quota_gb ? ' on' : ''}`, click: () => this.patch({ quota_gb: '' }, 'No data limit') },
        'Unlimited',
      ),
    );
    presets.push(
      E(
        'button',
        {
          type: 'button',
          class: 'dl-chipbtn',
          click: () => {
            const v = prompt('Data limit in GB', p.quota_gb ? String(p.quota_gb) : '');
            if (v != null && v.trim() !== '' && Number(v) > 0) this.patch({ quota_gb: v.trim() }, `Data limit ${v.trim()} GB`);
          },
        },
        'Custom',
      ),
    );
    const dataTile = E('div', { class: 'dl-tile2' }, [
      E('div', { class: 'dl-tile2-label' }, [E('span', {}, 'Data'), period]),
      E('div', { class: 'dl-tile2-row' }, [
        E('span', { class: 'dl-tile2-value' }, [
          bytes(used),
          p.quota_limit ? E('span', { class: 'dl-faint' }, ` of ${bytes(p.quota_limit)}`) : E('span', { class: 'dl-faint' }, ' · no limit'),
        ]),
        p.quota_period === 'month' ? E('span', { class: 'dl-sub' }, 'resets on the 1st') : '',
      ]),
      p.quota_limit ? bar : '',
      E('div', { class: 'dl-chips-row' }, presets),
      p.quota_gb && p.quota_period === 'month'
        ? E('div', { class: 'dl-tile2-foot' }, [
            E('span', { class: 'dl-muted' }, p.bonus_gb ? `Includes +${p.bonus_gb} GB extra this month` : 'Need a little more this month?'),
            E(
              'a',
              {
                href: '#',
                click: (ev: Event) => {
                  ev.preventDefault();
                  this.patch({ bonus_gb: String((p.bonus_gb || 0) + 10) }, '+10 GB this month');
                },
              },
              '+10 GB this month',
            ),
          ])
        : '',
      E('div', { class: 'dl-tile2-foot' }, [
        E('span', { class: 'dl-muted' }, `${bytes(p.total[0] + p.total[1])} in total`),
        E(
          'button',
          {
            type: 'button',
            class: 'dl-linkbtn danger',
            click: () => resetUsageDialog('person', p.id, p.name, () => setTimeout(() => this.refresh(), 300)),
          },
          'Reset usage',
        ),
      ]),
    ]);

    // Hours
    const hoursOn = !!p.hours;
    const [h1, h2] = (p.hours || '07:00-23:00').split('-');
    const from = E('input', { type: 'time', class: 'cbi-input-text', value: h1 }) as HTMLInputElement;
    const to = E('input', { type: 'time', class: 'cbi-input-text', value: h2 }) as HTMLInputElement;
    const saveHours = () => this.patch({ hours: `${from.value}-${to.value}` }, `Allowed ${from.value}–${to.value}`);
    from.addEventListener('change', saveHours);
    to.addEventListener('change', saveHours);
    const sw = E(
      'button',
      {
        type: 'button',
        role: 'switch',
        'aria-checked': hoursOn ? 'true' : 'false',
        class: `dl-switch${hoursOn ? ' on' : ''}`,
        'aria-label': 'Limit hours',
        click: () => this.patch({ hours: hoursOn ? '' : '07:00-23:00' }, hoursOn ? 'Any time' : 'Allowed 07:00–23:00'),
      },
      E('i'),
    );
    const hoursTile = E('div', { class: 'dl-tile2' }, [
      E('div', { class: 'dl-tile2-row' }, [
        E('div', { class: 'dl-stack' }, [
          E('span', { class: 'dl-tile2-label' }, 'Allowed hours'),
          E('span', {}, hoursOn ? `${h1} – ${h2} (router time)` : 'Any time'),
        ]),
        sw,
      ]),
      hoursOn ? E('div', { class: 'dl-tile2-row' }, [from, E('span', { class: 'dl-faint' }, 'to'), to]) : '',
    ]);

    dom.content(
      this.parts.limits,
      // Heading above the card, like "Devices", so both columns line up (as on the portal).
      E('section', { class: 'dl-devsec', 'aria-label': 'Access and limits' }, [
        E('div', { class: 'dl-panel-head' }, [E('h3', {}, 'Access & limits')]),
        E('div', { class: 'dl-panel' }, [
          E('div', { class: 'dl-stack gap8' }, [
            E('span', { class: 'dl-tile2-label' }, 'Can reach'),
            seg,
            E('span', { class: 'dl-sub' }, ACCESS_TEXT[p.access]),
            p.access === 'lan' && this.st.services.length ? this.servicesPicker() : '',
            homeAccess(p) ? this.netsPicker() : '',
            p.access === 'lan' ? this.dnsPicker() : '',
          ]),
          E('div', { class: 'dl-tiles2' }, [this.devTile(), this.circleTile(), endTile, dataTile, hoursTile]),
        ]),
      ]),
    );
  }

  /**
   * DNS for Home-only access. The internet does not go through the tunnel, so
   * by default the device keeps its own DNS; home names are opt-in.
   */
  dnsPicker(): HTMLElement {
    const p = this.p;
    const seg = E(
      'div',
      { class: 'dl-seg sm', role: 'radiogroup', 'aria-label': 'DNS' },
      (
        [
          ['device', 'Device’s own DNS'],
          ['home', 'Home names'],
        ] as const
      ).map(([v, t]) =>
        E(
          'button',
          {
            type: 'button',
            role: 'radio',
            class: p.dns_mode === v ? 'on' : '',
            'aria-checked': p.dns_mode === v ? 'true' : 'false',
            click: () =>
              p.dns_mode !== v &&
              this.patch(
                { dns_mode: v },
                v === 'home'
                  ? 'Home names on — devices need their configuration again'
                  : 'Device DNS — devices need their configuration again',
              ),
          },
          t,
        ),
      ),
    );
    const fb = this.st.settings.home_dns_fallback;
    return E('div', { class: 'dl-stack gap4 dl-dnspick' }, [
      E('div', { class: 'dl-row-actions' }, [E('span', { class: 'dl-sub' }, 'DNS'), seg]),
      E(
        'span',
        { class: 'dl-sub' },
        p.dns_mode === 'home'
          ? [
              'Names like ',
              E('span', { class: 'dl-mono' }, `nas.${this.st.settings.domain}`),
              ' work. Internet names are resolved at home, so they depend on the tunnel',
              fb
                ? [' (', E('span', { class: 'dl-mono' }, fb), ' takes over when it is down).']
                : ' — with no fallback set, they stop when it is down.',
            ]
          : 'Internet keeps working exactly as without the VPN. Reach home devices by IP address.',
      ),
    ]);
  }

  /** Home networks this person reaches, when the server has more than one. */
  netsPicker(): HTMLElement | '' {
    const p = this.p;
    const srv = this.st.servers.find((x) => x.id === p.server);
    const all = srv?.home ?? [];
    if (all.length < 2) return '';
    const picked = new Set(p.home_nets?.length ? p.home_nets : all.map((h) => h.dev));
    return E('div', { class: 'dl-stack gap4' }, [
      E(
        'div',
        { class: 'dl-chips-row' },
        all.map((h) =>
          E(
            'button',
            {
              type: 'button',
              class: `dl-chipbtn${picked.has(h.dev) ? ' on' : ''}`,
              'aria-pressed': picked.has(h.dev) ? 'true' : 'false',
              title: h.nets.join(', '),
              click: () => {
                const next = new Set(picked);
                if (!next.delete(h.dev)) next.add(h.dev);
                if (!next.size) return notify('Keep at least one network, or choose Internet only.', 'warning', 5000);
                const list = next.size === all.length ? [] : [...next];
                this.patch(
                  { home_nets: list },
                  list.length ? `${p.name} reaches ${list.join(', ')}` : `${p.name} reaches every home network`,
                );
              },
            },
            h.dev,
          ),
        ),
      ),
      E(
        'span',
        { class: 'dl-sub' },
        p.home_nets?.length
          ? `Home networks ${p.name} reaches. Networks added to the server later stay out.`
          : `Home networks ${p.name} reaches: all of them. Untick one to keep ${p.name} out of it.`,
      ),
    ]);
  }

  /** The circle this person's devices share (servers where devices reach each other in circles). */
  circleTile(): HTMLElement | '' {
    const p = this.p;
    const srv = this.st.servers.find((x) => x.id === p.server);
    if (srv?.mesh !== 'circles' || !homeAccess(p)) return '';
    const circles = this.st.circles.filter((c) => c.server === p.server);
    const ci = circles.find((c) => c.id === p.circle);
    const mates = ci ? this.st.people.filter((x) => x.id !== p.id && x.circle === ci.id && homeAccess(x)).map((x) => x.name) : [];
    const change: HTMLElement = button('Change', () =>
      dropdown(change, [
        ...circles.map((c) => ({
          label: c.name,
          icon: circleDot(c),
          run: () => c.id !== p.circle && this.patch({ circle: c.id }, `${p.name} is in ${c.name}`),
        })),
        p.circle ? { label: 'No circle', icon: icon('x'), run: () => this.patch({ circle: '' }, `${p.name} is in no circle`) } : null,
        { label: 'New circle', icon: icon('plus'), run: () => circleDialog(this.st, p.server, null, () => this.refresh()) },
      ]),
    );
    return E('div', { class: 'dl-tile2' }, [
      E('span', { class: 'dl-tile2-label' }, ['Devices see each other', E('span', { class: 'dl-faint dl-w400' }, 'circle')]),
      E('div', { class: 'dl-tile2-row' }, [
        E('span', { class: 'dl-circle-name' }, ci ? [circleDot(ci), ci.name] : E('span', { class: 'dl-muted' }, 'No circle')),
        change,
      ]),
      E(
        'span',
        { class: 'dl-sub' },
        !ci
          ? `Only ${p.name}'s own devices see each other.`
          : mates.length
            ? `${p.name}'s devices and ${mates.join(', ')}'s see each other. Others don't.`
            : `Nobody else in ${ci.name} yet: only ${p.name}'s own devices see each other.`,
      ),
    ]);
  }

  /** Optional narrowing of home-network access to selected services. */
  servicesPicker(): HTMLElement {
    const chosen = new Set(this.p.services ?? []);
    return E('div', { class: 'dl-stack gap4' }, [
      E(
        'div',
        { class: 'dl-chips-row' },
        this.st.services.map((sv) =>
          E(
            'button',
            {
              type: 'button',
              class: `dl-chipbtn${chosen.has(sv.id) ? ' on' : ''}`,
              title: `${sv.address}${sv.ports.length ? ` · ${sv.ports.join(', ')}` : ''}`,
              click: () => {
                if (chosen.has(sv.id)) chosen.delete(sv.id);
                else chosen.add(sv.id);
                this.patch({ services: [...chosen] }, chosen.size ? 'Home services updated' : 'Whole home network');
              },
            },
            sv.name,
          ),
        ),
      ),
      E(
        'span',
        { class: 'dl-sub' },
        chosen.size ? 'Only the selected services at home.' : 'Whole home network. Pick services to narrow it down.',
      ),
    ]);
  }

  /** Device limit with a slot per device; never below the devices in use. */
  devTile(): HTMLElement {
    const p = this.p;
    const slots = E('div', { class: 'dl-slots' });
    // Devices added over the limit get their own soft orange slots after the allowed ones.
    for (let i = 0; i < Math.max(p.device_limit, p.devices.length); i++) {
      const d = p.devices[i];
      const over = i >= p.device_limit;
      const slot = E('i', { class: over ? 'over' : d ? 'used' : '' });
      attachTip(slot, () => [
        E('div', { class: 'dl-tip-title' }, d ? `${d.name}${over ? ' · over the limit' : ''}` : 'Free slot'),
        E(
          'div',
          { class: 'dl-muted' },
          d
            ? d.online
              ? 'Connected'
              : d.handshake
                ? `Last seen ${ago(d.handshake, this.st.now)}`
                : 'Not set up yet'
            : 'They can add a device here',
        ),
      ]);
      slots.appendChild(slot);
    }
    const floor = Math.max(1, p.devices.length);
    const minus = E(
      'button',
      {
        type: 'button',
        'aria-label': 'Allow fewer devices',
        disabled: p.device_limit <= floor ? 'disabled' : null,
        click: () => this.patch({ device_limit: String(p.device_limit - 1) }),
      },
      '−',
    );
    if (p.device_limit <= floor && p.devices.length > 1)
      attachTip(minus, () => [
        E('div', { class: 'dl-tip-title' }, `${p.devices.length} devices in use`),
        E('div', { class: 'dl-muted' }, 'Remove a device first to lower the limit'),
      ]);
    return E('div', { class: 'dl-tile2' }, [
      E('div', { class: 'dl-tile2-label' }, 'Devices'),
      E('div', { class: 'dl-tile2-row' }, [
        E('span', { class: 'dl-tile2-value' }, [String(p.devices.length), E('span', { class: 'dl-faint' }, ` / ${p.device_limit}`)]),
        E('div', { class: 'dl-stepper' }, [
          minus,
          E(
            'button',
            {
              type: 'button',
              'aria-label': 'Allow more devices',
              disabled: p.device_limit >= 32 ? 'disabled' : null,
              click: () => this.patch({ device_limit: String(p.device_limit + 1) }),
            },
            '+',
          ),
        ]),
      ]),
      slots,
    ]);
  }

  /** Where they connected from: one line, the map on request. */
  paintPlaces() {
    const st = this.st;
    if (!st.geo.enabled) {
      dom.content(
        this.parts.places,
        E('div', { class: 'dl-places' }, [
          icon('pin'),
          E('div', { class: 'dl-stack' }, [
            E('span', {}, 'Locations are off'),
            E('span', { class: 'dl-sub' }, 'City-level, from the client IP'),
          ]),
          E('span', { class: 'dl-spacer' }),
          E('a', { class: 'cbi-button cbi-button-neutral', href: L.url('admin/network/dawnline/settings') }, 'Turn on'),
        ]),
      );
      return;
    }
    if (this.mapOpen) {
      if (!this.map || !this.parts.places.contains(this.map.el)) dom.content(this.parts.places, this.mapCard());
      return;
    }
    const since = st.now - 30 * 86400;
    const pts = st.geo.points.filter((g) => g.person === this.p.id && g.ts >= since).sort((a, b) => b.ts - a.ts);
    const places = [...new Set(pts.map((g) => g.city || g.country).filter(Boolean))];
    const last = pts[0];
    dom.content(
      this.parts.places,
      E('div', { class: 'dl-places' }, [
        icon('pin'),
        E('div', { class: 'dl-stack' }, [
          E('span', {}, last ? last.city || last.country : 'No locations yet'),
          E(
            'span',
            { class: 'dl-sub' },
            last
              ? `${places.length} place${places.length === 1 ? '' : 's'} in 30 days${last.org ? ` · ${last.org}` : ''}`
              : 'Shown after a device connects',
          ),
        ]),
        E('span', { class: 'dl-spacer' }),
        pts.length
          ? button(
              'Show map',
              () => {
                this.mapOpen = true;
                this.paintPlaces();
              },
              'neutral',
            )
          : '',
      ]),
    );
  }

  invite() {
    const server = this.st.servers.find((s) => s.id === this.p.server)?.name ?? 'Home';
    inviteCard(this.p, server);
  }

  showQr() {
    const p = this.p;
    if (!p.link) return;
    modal(
      `${p.name}’s link`,
      [
        E('div', { class: 'dl-qr-pane' }, [
          svg(qrSvg(p.link), 'dl-qr'),
          E('div', { class: 'dl-hint' }, 'Scan with the phone camera to open the portal.'),
        ]),
      ],
      [E('button', { class: 'cbi-button', click: closeModal }, 'Close')],
    );
  }

  async newLink() {
    const p = this.p;
    if (!(await confirmDialog('Create a new link?', 'The old link stops working right away.', 'Create new link', true))) return;
    const r = await attempt(() => api.personRegen(p.id), 'New link created');
    if (r?.link) {
      p.link = r.link;
      copyText(r.link, 'New link copied');
      this.paint();
    }
  }

  /** Setting up a device: its QR code (key and file one tap away). */
  async showDeviceQr(d: Device) {
    const cfg = await attempt(() => api.deviceConfig(d.id));
    if (!cfg) return;
    modal(`Set up ${d.name}`, [await connectBlock(cfg, 'qr')], [E('button', { class: 'cbi-button', click: closeModal }, 'Close')]);
  }

  async downloadConfig(d: Device) {
    const cfg = await attempt(() => api.deviceConfig(d.id));
    if (!cfg) return;
    if (!cfg.has_private_key) {
      notify('This device made its own keys in the browser; its configuration only exists there.', 'warning');
      return;
    }
    downloadFile(cfg.filename, cfg.conf, 'application/octet-stream');
  }

  editNote() {
    const input = E(
      'textarea',
      { class: 'cbi-input-textarea dl-note-input', rows: 3, maxlength: 500, placeholder: 'Only you see this' },
      this.p.note ?? '',
    ) as HTMLTextAreaElement;
    modal(
      'Note',
      [input],
      [
        E('button', { class: 'cbi-button cbi-button-neutral', click: closeModal }, 'Cancel'),
        ' ',
        button(
          'Save',
          async () => {
            closeModal();
            await this.patch({ note: input.value.trim() }, input.value.trim() ? 'Note saved' : 'Note removed');
          },
          'positive',
        ),
      ],
    );
    setTimeout(() => input.focus(), 50);
  }

  endSettings() {
    const p = this.p;
    const act = E('select', { class: 'cbi-input-select' }, [
      E('option', { value: 'pause', selected: p.expire_action === 'pause' ? 'selected' : null }, 'Pause access'),
      E('option', { value: 'notify', selected: p.expire_action === 'notify' ? 'selected' : null }, 'Keep access'),
      E('option', { value: 'remove', selected: p.expire_action === 'remove' ? 'selected' : null }, 'Remove their devices'),
    ]) as HTMLSelectElement;
    const warn = E(
      'select',
      { class: 'cbi-input-select' },
      [0, 1, 3, 7, 14].map((n) =>
        E(
          'option',
          { value: n, selected: p.expire_warn === n ? 'selected' : null },
          n ? `${n} day${n === 1 ? '' : 's'} before` : 'Don’t warn',
        ),
      ),
    ) as HTMLSelectElement;
    modal(
      'When access ends',
      [
        E('div', { class: 'cbi-value' }, [E('label', { class: 'cbi-value-title' }, 'Then'), E('div', { class: 'cbi-value-field' }, act)]),
        E('div', { class: 'cbi-value' }, [
          E('label', { class: 'cbi-value-title' }, 'Warn'),
          E('div', { class: 'cbi-value-field' }, [
            warn,
            E('div', { class: 'cbi-value-description' }, 'Shown in their portal and on the Overview.'),
          ]),
        ]),
      ],
      [
        E('button', { class: 'cbi-button cbi-button-neutral', click: closeModal }, 'Cancel'),
        ' ',
        button(
          'Save',
          async () => {
            closeModal();
            await this.patch({ expire_action: act.value, expire_warn: warn.value }, 'Saved');
          },
          'positive',
        ),
      ],
    );
  }

  rename() {
    const input = E('input', { type: 'text', class: 'cbi-input-text', value: this.p.name, maxlength: 48 }) as HTMLInputElement;
    modal(
      'Rename',
      [E('div', { class: 'cbi-value' }, [E('label', { class: 'cbi-value-title' }, 'Name'), E('div', { class: 'cbi-value-field' }, input)])],
      [
        E('button', { class: 'cbi-button cbi-button-neutral', click: closeModal }, 'Cancel'),
        ' ',
        button(
          'Save',
          async () => {
            closeModal();
            await this.patch({ name: input.value }, 'Renamed');
          },
          'positive',
        ),
      ],
    );
    setTimeout(() => input.select(), 50);
  }

  async remove() {
    const p = this.p;
    const ok = await confirmDialog(
      `Delete ${p.name}?`,
      `All ${p.devices.length} devices are disconnected immediately and the personal link stops working.`,
      'Delete',
      true,
    );
    if (ok && (await attempt(() => api.personDelete(p.id), 'Deleted'))) location.href = peopleUrl(p.server);
  }
}
