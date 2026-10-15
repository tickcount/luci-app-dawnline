// People: a native GridSection over `person` sections rendered as cards.
// Edits in the modal are staged (Save & Apply with rollback); creating,
// pausing and device actions take effect immediately through RPC.

import type { Person, Status } from '../../shared/types';
import { E } from '../e';
import { api } from '../api';
import { attempt, button, closeModal, confirmDialog, copyText, dropdown, iconButton, modal, notify, type MenuItem } from '../ui';
import { addDevice, openDevice } from '../device';
import { inviteCard } from '../invite';
import { personUrl } from '../urls';
import { scoped } from './overview';
import { attachTip } from '../charts';
import { icon } from '../../shared/icons';
import { ACCESS_LABEL, KIND_LABEL, STATE_LABEL, ago, bits, byDeviceState, bytes, date, daysLeft, initials } from '../../shared/format';

type Sid = string;

const STATE_ICON: Record<Person['state'], string> = {
  active: '',
  paused: 'pause',
  paused_all: 'pause',
  expired: 'calendar',
  quota: 'chart',
  hours: 'clock',
  no_server: 'alert',
};

/** Nothing while active; otherwise a small icon with the state as tooltip. */
export function stateBadge(p: Person): HTMLElement | '' {
  if (p.state === 'active') return '';
  const el = E('span', { class: `dl-ibadge ${stateTone(p)}`, 'aria-label': STATE_LABEL[p.state] }, icon(STATE_ICON[p.state] || 'alert'));
  attachTip(el, () => [E('div', { class: 'dl-tip-title' }, STATE_LABEL[p.state])]);
  return el;
}

/** Device slots as a row of segments (one per allowed device, used ones lit) and "2 of 10". */
function slotBar(p: Person): HTMLElement {
  const used = p.devices.length;
  // Devices added over the limit get their own (soft orange) segments after the allowed ones.
  const n = Math.max(1, p.device_limit, used);
  // 22px a segment until the bar is 160px long; past that the segments get thinner, so the count stays close.
  const width = Math.min(160, n * 22 + (n - 1) * 3);
  return E('div', { class: 'dl-slotbar', title: `${used} of ${p.device_limit} devices` }, [
    E(
      'span',
      { class: 'dl-slotbar-segs', style: `width: ${width}px` },
      Array.from({ length: n }, (_, i) => E('i', { class: i >= p.device_limit ? 'over' : i < used ? 'used' : '' })),
    ),
    E('span', { class: 'dl-slotbar-text' }, `${used} of ${p.device_limit}`),
  ]);
}

/** What the person can reach, as icons: home network, internet, or both. */
export function accessBadge(p: Person): HTMLElement {
  const kinds = p.access === 'both' ? ['lan', 'inet'] : p.access === 'lan' ? ['lan'] : ['inet'];
  const el = E(
    'span',
    { class: 'dl-access', 'aria-label': ACCESS_LABEL[p.access] },
    kinds.map((k) => E('span', { class: `dl-ibadge ${k}` }, icon(k === 'lan' ? 'home' : 'globe'))),
  );
  attachTip(el, () => [
    E('div', { class: 'dl-tip-title' }, ACCESS_LABEL[p.access]),
    p.access === 'lan' && p.services?.length
      ? E('div', { class: 'dl-muted' }, `${p.services.length} home service${p.services.length === 1 ? '' : 's'} only`)
      : '',
  ]);
  return el;
}

export function stateTone(p: Person): string {
  if (p.state === 'active') return 'ok';
  if (p.state === 'quota' || p.state === 'expired') return 'bad';
  return 'warn';
}

/** Access choice cards; returns the element and a getter. */
export function accessPicker(initial: Person['access'], onChange?: (v: Person['access']) => void) {
  let value = initial;
  const opts: { v: Person['access']; ic: string; text: string }[] = [
    { v: 'internet', ic: 'globe', text: 'Browse the internet through your router. No access to devices at home.' },
    { v: 'lan', ic: 'home', text: 'Reach devices at home (NAS, printer, cameras). Internet stays on their own connection.' },
    { v: 'both', ic: 'shield', text: 'Home devices and the internet, all through your router.' },
  ];
  const el = E(
    'div',
    { class: 'dl-choices' },
    opts.map((o) =>
      E(
        'button',
        {
          type: 'button',
          class: `dl-choice${o.v === value ? ' selected' : ''}`,
          'data-v': o.v,
          click: () => {
            value = o.v;
            el.querySelectorAll('.dl-choice').forEach((c) => c.classList.toggle('selected', (c as HTMLElement).dataset.v === o.v));
            onChange?.(o.v);
          },
        },
        [E('span', { class: 'dl-choice-title' }, [icon(o.ic), ACCESS_LABEL[o.v]]), E('span', { class: 'dl-choice-text' }, o.text)],
      ),
    ),
  );
  return { el, get: () => value };
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type Filter = 'all' | 'online' | 'attention' | 'paused';
type SortBy = 'seen' | 'name' | 'usage';

function needsAttention(p: Person): boolean {
  const left = daysLeft(p.expires);
  return (
    p.state === 'quota' ||
    p.state === 'expired' ||
    (left != null && left <= Math.max(p.expire_warn, 3)) ||
    (!!p.quota_limit && p.quota_used >= p.quota_limit * 0.9)
  );
}

function addMonth(iso: string): string {
  const d = iso ? new Date(`${iso}T12:00:00`) : new Date();
  const from = d.getTime() < Date.now() ? new Date() : d;
  from.setMonth(from.getMonth() + 1);
  return `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
}

let addOpened = false;

export class PeoplePage {
  st!: Status;
  map: any;
  // `?filter=online` (from Overview) preselects a tab.
  filter: Filter =
    (['all', 'online', 'attention', 'paused'] as Filter[]).find((f) => f === new URLSearchParams(location.search).get('filter')) ?? 'all';
  sort: SortBy = 'seen';
  noFooter = true;
  /** Set when shown as a server's People section: only that server's people. */
  serverId: string | null = null;
  polling = false;
  el: HTMLElement | null = null;

  async load(): Promise<Status> {
    return api.status(30);
  }

  /** The status limited to this page's server (or everything). */
  scope(st: Status): Status {
    return this.serverId ? scoped(st, this.serverId) : st;
  }

  /** Render as a section of the Servers page. */
  embed(st: Status, serverId: string): Promise<Node> {
    this.serverId = serverId;
    return this.render(st);
  }

  person(sid: Sid): Person | undefined {
    return this.st.people.find((p) => p.id === sid);
  }

  /**
   * Status for this page, newest request wins: a poll that started before an
   * edit must not paint its older answer over the refresh that follows it.
   */
  private statusSeq = 0;
  private statusShown = 0;
  async latestStatus(): Promise<Status | null> {
    const seq = ++this.statusSeq;
    const st = await api.status(30).catch(() => null);
    if (!st || seq < this.statusShown) return null;
    this.statusShown = seq;
    return st;
  }

  async refresh() {
    const st = await this.latestStatus();
    if (!st) return;
    this.st = this.scope(st);
    uci.unload('dawnline');
    await this.map.load();
    await this.map.reset();
    // The map keeps cards it already drew: paint them from the new status, like poll().
    this.paintCards();
    this.decorate();
  }

  paintCards() {
    for (const p of this.st.people) {
      const card = document.getElementById(`dl-card-${p.id}`);
      if (card) this.renderCard(card, p.id);
    }
  }

  render(stAll: Status): Promise<Node> {
    const st = this.scope(stAll);
    this.st = st;
    const page = this;
    let o: any;

    const m = new form.Map('dawnline');
    this.map = m;

    const s = m.section(form.GridSection, 'person');
    s.anonymous = true;
    s.addremove = true;
    s.addbtntitle = 'Add person';
    s.nodescriptions = true;
    s.renderSectionPlaceholder = () =>
      E(
        'em',
        {},
        st.servers.length ? 'No people yet. Add someone and send them their personal link.' : 'Set up the server first, then add people.',
      );

    // As a server section: only rows of people on that server.
    if (page.serverId) s.filter = (sid: Sid) => page.st.people.some((p) => p.id === sid);
    s.handleAdd = () => page.openCreate();
    s.handleRemove = (sid: Sid) => page.remove(sid);

    // Actions live inside the card (title row).
    s.renderRowActions = () => E('div', { class: 'dl-none' });

    o = s.option(form.DummyValue, '_card');
    o.modalonly = false;
    o.textvalue = (sid: Sid) => page.renderCard(E('div', { class: 'dl-card', id: `dl-card-${sid}` }), sid);

    return m.render().then((node: HTMLElement) => {
      node.classList.add('dl-map', 'dl-root');
      const sort = E(
        'select',
        {
          class: 'dl-select',
          'aria-label': 'Sort',
          change: (ev: Event) => {
            page.sort = (ev.target as HTMLSelectElement).value as SortBy;
            page.decorate();
          },
        },
        [E('option', { value: 'seen' }, 'Last seen'), E('option', { value: 'name' }, 'Name'), E('option', { value: 'usage' }, 'Usage')],
      );
      const wrap = E('div', { class: 'dl-root' }, [
        page.serverId
          ? ''
          : E('div', { class: 'dl-pagehead' }, [
              E('div', { class: 'dl-stack' }, [
                E('h2', { class: 'dl-h1' }, 'People'),
                E('span', { class: 'dl-muted', id: 'dl-people-count' }, this.countText()),
              ]),
              st.servers.length ? button([icon('plus'), ' Add person'], () => page.openCreate(), 'add') : '',
            ]),
        st.servers.length
          ? ''
          : E('div', { class: 'alert-message warning' }, [
              'No server yet. ',
              E('a', { href: L.url('admin/network/dawnline/server') }, 'Run the setup wizard'),
              ' before adding people.',
            ]),
        E('div', { class: 'dl-toolbar' }, [
          E('div', { class: 'dl-seg', id: 'dl-people-tabs', role: 'tablist' }),
          // Sort and add stay together on the right, wrapping as one group.
          E('div', { class: 'dl-toolbar-end' }, [
            sort,
            page.serverId ? button([icon('plus'), ' Add person'], () => page.openCreate(), 'add') : '',
          ]),
        ]),
        node,
      ]);
      this.el = wrap;
      requestAnimationFrame(() => this.decorate());
      if (!this.polling) {
        this.polling = true;
        // Only while visible (a server section may be swapped out).
        poll.add(() => (page.el?.isConnected ? page.poll() : Promise.resolve()), 10);
      }
      // ?add=1 opens Add person once, not again on every server's People tab.
      if (!addOpened && new URLSearchParams(location.search).get('add')) {
        addOpened = true;
        setTimeout(() => page.openCreate(), 100);
      }
      return wrap;
    });
  }

  countText(): string {
    const t = this.st.totals;
    return `${t.people} ${t.people === 1 ? 'person' : 'people'} · ${t.devices} device${t.devices === 1 ? '' : 's'} · ${t.online} online`;
  }

  /** Row classes, counters, filter tabs and sort order. */
  decorate() {
    const c = document.getElementById('dl-people-count');
    if (c) c.textContent = this.countText();
    const people = this.st.people;
    const counts: Record<Filter, number> = {
      all: people.length,
      online: people.filter((p) => p.online > 0).length,
      attention: people.filter(needsAttention).length,
      paused: people.filter((p) => p.state !== 'active' && p.state !== 'quota' && p.state !== 'expired').length,
    };
    const tabs = document.getElementById('dl-people-tabs');
    if (tabs) {
      const label: Record<Filter, string> = { all: 'All', online: 'Online', attention: 'Needs attention', paused: 'Paused' };
      dom.content(
        tabs,
        (Object.keys(label) as Filter[]).map((f) =>
          E(
            'button',
            {
              type: 'button',
              role: 'tab',
              class: f === this.filter ? 'on' : '',
              click: () => {
                this.filter = f;
                this.decorate();
              },
            },
            [label[f], E('b', { class: f === 'attention' && counts[f] ? 'warn' : '' }, String(counts[f]))],
          ),
        ),
      );
    }
    const match = (p: Person) => {
      if (this.filter === 'online' && !p.online) return false;
      if (this.filter === 'attention' && !needsAttention(p)) return false;
      if (this.filter === 'paused' && !(p.state !== 'active' && p.state !== 'quota' && p.state !== 'expired')) return false;
      return true;
    };
    const order = [...people].sort((a, b) =>
      this.sort === 'name'
        ? a.name.localeCompare(b.name)
        : this.sort === 'usage'
          ? b.month[0] + b.month[1] - (a.month[0] + a.month[1])
          : b.online - a.online || b.last_seen - a.last_seen,
    );
    let tbody: Element | null = null;
    let shown = 0;
    for (const p of order) {
      const card = document.getElementById(`dl-card-${p.id}`);
      const row = card?.closest('.cbi-section-table-row') as HTMLElement | null;
      if (!row) continue;
      tbody ??= row.parentElement;
      tbody?.appendChild(row);
      row.classList.toggle('dl-off', p.state !== 'active');
      row.classList.toggle('dl-attn-row', p.state === 'quota' || p.state === 'expired');
      // A class, not an inline style: the card layout sets display with !important.
      const hit = match(p);
      row.classList.toggle('dl-filtered', !hit);
      if (hit) shown++;
    }
    // Say so when the filter leaves nobody.
    const table = tbody?.closest('.cbi-section-table') ?? tbody;
    let none = document.getElementById('dl-people-none');
    if (table && people.length && !shown) {
      none ??= E('div', { id: 'dl-people-none', class: 'dl-empty' });
      dom.content(none, E('p', {}, 'No one here right now.'));
      if (none.parentElement !== table.parentElement) table.after(none);
    } else none?.remove();
  }

  async poll() {
    const stAll = await this.latestStatus();
    if (!stAll) return;
    const st = this.scope(stAll);
    this.st = st;
    this.paintCards();
    this.decorate();
  }

  async quick(p: Person, patch: Parameters<typeof api.personUpdate>[1], ok: string) {
    if (await attempt(() => api.personUpdate(p.id, patch), ok)) await this.poll();
  }

  renderCard(node: HTMLElement, sid: Sid): HTMLElement {
    const p = this.person(sid);
    if (!p) {
      dom.content(node, E('em', {}, 'Not saved yet — use “Save & Apply”.'));
      return node;
    }
    const left = daysLeft(p.expires);
    const free = Math.max(0, p.device_limit - p.devices.length);

    // Term and hours sit by the name; online/last seen lives in the strip below.
    const pills: Node[] = [];
    if (p.expires) {
      const soon = left != null && left >= 0 && left <= Math.max(p.expire_warn, 3);
      const over = left != null && left < 0;
      pills.push(
        E('span', { class: `dl-pill-ic${over ? ' bad' : soon ? ' warn' : ''}`, title: `Access ends ${date(p.expires)}` }, [
          icon('calendar'),
          over ? `ended ${date(p.expires)}` : soon ? `ends in ${left} day${left === 1 ? '' : 's'}` : `until ${date(p.expires)}`,
        ]),
      );
    }
    if (p.hours) pills.push(E('span', { class: 'dl-pill-ic', title: 'Allowed hours' }, [icon('clock'), p.hours.replace('-', '–')]));

    const chips = byDeviceState(p.devices).map((d) => {
      return E(
        'button',
        {
          type: 'button',
          class: `dl-chip${d.disabled ? ' disabled' : ''}${d.online ? ' live' : ''}`,
          title: `${KIND_LABEL[d.kind]} · ${d.address}${d.online ? ` · online from ${d.endpoint}` : d.handshake ? ` · seen ${ago(d.handshake, this.st.now)}` : ''}`,
          click: (ev: Event) => {
            ev.preventDefault();
            openDevice(p, d, () => this.refresh(), this.st.geo);
          },
        },
        [
          icon(d.kind),
          E('span', { class: 'dl-chip-name' }, d.name),
          !d.handshake && !d.disabled ? E('span', { class: 'dl-chip-tag' }, 'not set up') : '',
          // Online shows as the green dashed chip (.dl-chip.live); no dots.
        ],
      );
    });
    // Always there: over the limit the admin can still add one (the slot bar turns orange).
    chips.push(
      E(
        'button',
        {
          type: 'button',
          // Just a "+": the slots above say how many there are.
          class: 'dl-chip add',
          'aria-label': 'Add device',
          title: free > 0 ? 'Add device' : 'Add device · over the limit, admins can still add',
          click: (ev: Event) => {
            ev.preventDefault();
            addDevice(p, () => this.refresh());
          },
        },
        icon('plus'),
      ),
    );

    const fixes: Node[] = [];
    if (p.state === 'quota' && p.quota_period === 'month')
      fixes.push(
        E(
          'button',
          {
            type: 'button',
            class: 'dl-fix',
            click: () => this.quick(p, { bonus_gb: String((p.bonus_gb || 0) + 10) }, '+10 GB this month'),
          },
          '+10 GB this month',
        ),
      );
    if (p.expires && left != null && left <= Math.max(p.expire_warn, 3))
      fixes.push(
        E(
          'button',
          { type: 'button', class: 'dl-fix', click: () => this.quick(p, { expires: addMonth(p.expires) }, 'Extended by 1 month') },
          'Extend 1 month',
        ),
      );

    const more = iconButton(
      'more',
      'More',
      (ev: MouseEvent) =>
        dropdown(
          ev.currentTarget as HTMLElement,
          [
            {
              label: 'Open',
              icon: icon('open'),
              run: () => {
                location.href = personUrl(p.id);
              },
            },
            p.link
              ? {
                  label: 'Invite card',
                  icon: icon('qr'),
                  run: () => inviteCard(p, this.st.servers.find((s) => s.id === p.server)?.name ?? 'Home'),
                }
              : null,
            free > 0 ? { label: 'Add device', icon: icon('plus'), run: () => addDevice(p, () => this.refresh()) } : null,
            null,
            {
              label: p.paused ? 'Resume' : 'Pause',
              icon: icon(p.paused ? 'play' : 'pause'),
              warn: !p.paused,
              run: () => this.togglePause(p),
            },
            { label: 'Delete', icon: icon('trash'), danger: true, run: () => this.remove(p.id) },
          ].filter((x, i, a) => x || (i > 0 && a[i - 1])) as MenuItem[],
        ),
      'neutral',
      'dl-icon-only',
    );
    const actions = E('div', { class: 'dl-pcard-actions' }, [
      p.link ? iconButton('link', 'Copy link', () => copyText(p.link!, 'Personal link copied'), 'neutral', 'dl-icon-only') : '',
      more,
    ]);

    dom.content(
      node,
      E('div', { class: 'dl-pcard' }, [
        E('div', { class: 'dl-pcard-main' }, [
          // The avatar is centred on the name and the slots; devices follow under the name.
          E('div', { class: 'dl-pcard-top' }, [
            E('span', { class: `dl-avatar${p.online ? ' online' : ''}` }, initials(p.name)),
            E('div', { class: 'dl-pcard-who' }, [
              E('div', { class: 'dl-card-head' }, [
                E('a', { class: 'dl-card-name', href: personUrl(p.id) }, p.name),
                stateBadge(p),
                accessBadge(p),
                ...pills,
              ]),
              slotBar(p),
            ]),
          ]),
          E('div', { class: 'dl-chips' }, chips),
          fixes.length ? E('div', { class: 'dl-fixes' }, fixes) : '',
        ]),
        this.usageSide(p, actions),
      ]),
    );
    return node;
  }

  /** Status and actions, this month's usage, a bar split by device (or filled toward the limit), today or live speed. */
  usageSide(p: Person, actions: HTMLElement): HTMLElement {
    const used = p.quota_used || p.month[0] + p.month[1];
    const pct = p.quota_limit ? Math.min(100, (p.quota_used / p.quota_limit) * 100) : 0;
    const today = p.devices.reduce((a, d) => a + (d.spark[d.spark.length - 1] ?? 0), 0);
    const r = p.rate?.[p.rate.length - 1];
    const live = p.online && r && this.st.now - r[0] < 180;

    const bar = E('div', { class: `dl-usebar${pct >= 100 ? ' bad' : pct >= 90 ? ' warn' : ''}` });
    if (p.quota_limit) {
      const fill = E('i', { class: 'fill' });
      fill.style.width = `${pct}%`;
      bar.appendChild(fill);
      attachTip(bar, () => [
        E('div', { class: 'dl-tip-title' }, `${pct.toFixed(1)}% used`),
        E(
          'div',
          { class: 'dl-muted' },
          `${bytes(p.quota_used)} of ${bytes(p.quota_limit)} · ${bytes(Math.max(0, p.quota_limit - p.quota_used))} left`,
        ),
        E(
          'div',
          { class: 'dl-faint' },
          p.quota_period === 'total' ? 'In total' : `This month${p.bonus_gb ? ` · includes +${p.bonus_gb} GB extra` : ''}`,
        ),
      ]);
    } else {
      const devs = p.devices
        .map((d) => ({ d, v: d.month[0] + d.month[1] }))
        .filter((x) => x.v > 0)
        .sort((a, b) => b.v - a.v);
      devs.forEach((x, i) => {
        const seg = E('i', { class: `c${Math.min(i, 4)}` });
        seg.style.flexGrow = String(x.v);
        bar.appendChild(seg);
      });
      if (devs.length)
        attachTip(bar, () => [
          E('div', { class: 'dl-tip-title' }, 'This month by device'),
          ...devs.map((x, i) =>
            E('div', { class: 'dl-tip-row' }, [
              E('span', { class: `dl-swatch c${Math.min(i, 4)}` }),
              E('span', {}, x.d.name),
              E('b', {}, bytes(x.v)),
            ]),
          ),
        ]);
    }

    const limitText = p.quota_limit ? `${bytes(Math.max(0, p.quota_limit - p.quota_used))} left` : 'no limit';
    return E('div', { class: 'dl-pside' }, [
      E('div', { class: 'dl-pside-top' }, [
        live
          ? E('span', { class: 'dl-pside-state live' }, 'Online')
          : E('span', { class: 'dl-pside-state' }, p.online ? 'Online' : p.last_seen ? 'Offline' : 'Never connected'),
        actions,
      ]),
      E('div', { class: 'dl-use-num' }, [
        E('b', { class: used ? '' : 'dl-faint' }, bytes(used)),
        E(
          'span',
          { class: 'dl-faint' },
          p.quota_limit ? `of ${bytes(p.quota_limit)}` : p.quota_period === 'total' && p.quota_gb ? 'in total' : 'this month',
        ),
      ]),
      bar,
      live
        ? E('div', { class: 'dl-use-live', title: 'Right now' }, [`↓ ${bits(r![2])}`, E('span', { class: 'dl-faint' }, `↑ ${bits(r![1])}`)])
        : E('div', { class: 'dl-faint dl-pside-foot' }, today ? `today ${bytes(today)} · ${limitText}` : limitText),
    ]);
  }

  async togglePause(p: Person) {
    if (await attempt(() => api.personPause(p.id, !p.paused), p.paused ? `${p.name} resumed` : `${p.name} paused`)) await this.refresh();
  }

  async remove(sid: Sid) {
    const p = this.person(sid);
    const ok = await confirmDialog(
      `Remove ${p?.name ?? sid}?`,
      `All ${p?.devices.length ?? 0} devices are disconnected immediately and the personal link stops working. Usage history is kept in backups.`,
      'Remove',
      true,
    );
    if (ok && (await attempt(() => api.personDelete(sid), 'Person removed'))) await this.refresh();
  }

  openCreate() {
    const st = this.st;
    if (!st.servers.length) {
      notify('Set up the server first.', 'warning');
      return;
    }
    const name = E('input', { type: 'text', class: 'cbi-input-text', placeholder: 'e.g. Myata', maxlength: 48 }) as HTMLInputElement;
    const access = accessPicker('internet');
    const limit = E('input', {
      type: 'number',
      class: 'cbi-input-text',
      min: 1,
      max: 32,
      value: st.settings.default_device_limit,
    }) as HTMLInputElement;
    const expires = E('input', { type: 'date', class: 'cbi-input-text' }) as HTMLInputElement;
    const quota = E('input', {
      type: 'number',
      class: 'cbi-input-text',
      min: 0,
      step: 'any',
      placeholder: 'Unlimited',
    }) as HTMLInputElement;
    const quick = (label: string, months: number) =>
      E(
        'button',
        {
          type: 'button',
          class: 'cbi-button cbi-button-neutral',
          click: () => {
            if (!months) expires.value = '';
            else {
              const d = new Date();
              d.setMonth(d.getMonth() + months);
              expires.value = isoDate(d);
            }
          },
        },
        label,
      );
    const srv = st.servers[0];
    const server =
      !this.serverId && st.servers.length > 1
        ? (E(
            'select',
            { class: 'cbi-input-select' },
            st.servers.map((s) => E('option', { value: s.id }, s.name)),
          ) as HTMLSelectElement)
        : null;

    const row = (label: string, w: Node, help?: string) =>
      E('div', { class: 'cbi-value' }, [
        E('label', { class: 'cbi-value-title' }, label),
        E('div', { class: 'cbi-value-field' }, [w, help ? E('div', { class: 'cbi-value-description' }, help) : '']),
      ]);

    modal(
      'Add person',
      [
        row('Name', name),
        server ? row('Server', server) : '',
        E('div', { class: 'cbi-value dl-block' }, [
          E('label', { class: 'cbi-value-title' }, 'Access'),
          E('div', { class: 'cbi-value-field' }, access.el),
        ]),
        row('Devices', limit, 'How many devices they can add themselves.'),
        row(
          'End date',
          E('div', { class: 'dl-actions' }, [expires, quick('1 month', 1), quick('3 months', 3), quick('1 year', 12), quick('None', 0)]),
          'Optional.',
        ),
        row('Monthly data (GB)', quota, 'Optional. They are paused when it runs out and resumed next month.'),
      ],
      [
        E('button', { class: 'cbi-button cbi-button-neutral', click: closeModal }, 'Cancel'),
        ' ',
        button(
          'Create and copy link',
          async () => {
            const r = await attempt(() =>
              api.personCreate(
                name.value.trim(),
                '',
                server?.value ?? srv.id,
                access.get(),
                Number(limit.value) || st.settings.default_device_limit,
                expires.value,
                Number(quota.value) || 0,
                'month',
              ),
            );
            if (!r) return;
            if (r.link) await copyText(r.link, 'Personal link copied');
            this.showCreated(r.id, name.value.trim(), r.link, st.servers.find((x) => x.id === (server?.value ?? srv.id))?.name ?? srv.name);
            await this.refresh();
          },
          'positive',
        ),
      ],
    );
    setTimeout(() => name.focus(), 50);
  }

  showCreated(id: string, name: string, link: string | null, server: string) {
    if (link) {
      inviteCard({ id, name, link }, server, {
        title: `${name} is ready`,
        lead: `Send ${name} the card or the link. They open it, add their devices and connect — no account needed.`,
      });
      return;
    }
    modal(
      `${name} is ready`,
      [E('p', {}, 'Created. Turn on the personal portal in Settings to get a link, or add devices for them here.')],
      [E('button', { class: 'cbi-button cbi-button-positive', click: closeModal }, 'Done')],
    );
  }
}
