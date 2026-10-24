// People: one card per person, built from the status (the config itself,
// with keys, is never read by the browser). Creating, editing, pausing and
// device actions take effect immediately through RPC.

import type { Person, Status } from '../../shared/types';
import { E } from '../e';
import { api } from '../api';
import { button, iconButton } from '../ui/button';
import { cancelButton, closeModal, confirmDialog, modal } from '../ui/modal';
import { copyText } from '../ui/files';
import { dropdown, type MenuItem } from '../ui/menu';
import { attempt, notify } from '../ui/toast';
import { attachTip } from '../ui/tooltip';
import { accessBadge } from '../ui/badges';
import { addDevice, openDevice, type DeviceOpts } from '../device';
import { copyPersonLink, inviteCard } from '../invite';
import { personUrl } from '../urls';
import { scoped } from '../state/scope';
import { createPoller, focusInside, type Poller } from '../state/poller';
import { onNavigate } from '../ui/nav';
import { accessPicker } from '../widgets/access-picker';
import { firstBad, liveField } from '../ui/layout';
import { expiresHelp, limitHelp, nameHelp, quotaHelp } from '../netcheck';
import { coreFor } from '../cores';
import { icon } from '../../shared/icons';
import {
  kindLabel,
  addMonthsClamped,
  ago,
  bits,
  byDeviceState,
  bytes,
  date,
  dayDiff,
  daysLeft,
  endsIn,
  endsSoon,
  initials,
  todayOf,
} from '../../shared/format';
import { fill, fmt, num, plural } from '../../shared/i18n';

type Sid = string;

/** Per-browser conveniences (a tab, a sort): storage may be absent or refuse. */
function remembered(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* no storage */
  }
}

/** Device slots as a row of segments (one per allowed device, used ones lit) and "2 of 10". */
function slotBar(p: Person): HTMLElement {
  const used = p.devices.length;
  // Devices added over the limit get their own (soft orange) segments after the allowed ones.
  const n = Math.max(1, p.device_limit, used);
  // 22px a segment until the bar is 160px long; past that the segments get thinner, so the count stays close.
  const width = Math.min(160, n * 22 + (n - 1) * 3);
  return E('div', { class: 'dl-slotbar', title: fmt(N_(p.device_limit, '%s of %s device', '%s of %s devices'), used, p.device_limit) }, [
    E(
      'span',
      { class: 'dl-slotbar-segs', style: `width: ${width}px` },
      Array.from({ length: n }, (_x, i) => E('i', { class: i >= p.device_limit ? 'over' : i < used ? 'used' : '' })),
    ),
    E('span', { class: 'dl-slotbar-text' }, fmt(_('%s of %s'), used, p.device_limit)),
  ]);
}

type Filter = 'all' | 'online' | 'attention' | 'paused';
type SortBy = 'seen' | 'name' | 'usage';

/** Paused by someone or something about the person; not over a limit (Needs attention), and not their server being off (the admin's pause still counts then). */
const paused = (p: Person): boolean => (p.state === 'server_off' ? p.paused : !['active', 'quota', 'expired'].includes(p.state));
/** Can't connect for a reason of their own (not just their server being off). */
const stopped = (p: Person): boolean => (p.state === 'server_off' ? p.paused : p.state !== 'active');
/** Why they can't connect, their own reason (the admin's pause shows through a turned-off server), or null. */
const stopReason = (p: Person): Exclude<Person['state'], 'active' | 'server_off'> | null =>
  !stopped(p) ? null : p.state === 'server_off' ? 'paused' : (p.state as Exclude<Person['state'], 'active' | 'server_off'>);

function needsAttention(p: Person, today: string): boolean {
  const left = daysLeft(p.expires, today);
  return p.state === 'quota' || p.state === 'expired' || endsSoon(p, left) || (!!p.quota_limit && p.quota_used >= p.quota_limit * 0.9);
}

/** A month more, from the end date or from today once it has passed. */
function addMonth(end: string, today: string): string {
  return addMonthsClamped(end && dayDiff(end, today) >= 0 ? end : today, 1);
}

const ids = (st: Status) =>
  st.people
    .map((p) => p.id)
    .sort()
    .join(' ');

let addOpened = false;

export class PeoplePage {
  st!: Status;
  /** The cards, one per person, in the current sort order. */
  private list: HTMLElement = E('div', { class: 'dl-plist', role: 'list' });
  // `?filter=online` (from Overview) preselects a tab.
  // The tab and the sort are remembered in this browser; ?filter= (from Overview) wins for the tab.
  filter: Filter =
    (['all', 'online', 'attention', 'paused'] as Filter[]).find(
      (f) => f === (new URLSearchParams(location.search).get('filter') ?? remembered('dl.people.filter')),
    ) ?? 'all';
  sort: SortBy = (['seen', 'name', 'usage'] as SortBy[]).find((x) => x === remembered('dl.people.sort')) ?? 'seen';
  /** What the admin typed into Find (name, note, device, address). */
  query = '';
  noFooter = true;
  /** Set when shown as a server's People section: only that server's people. */
  serverId: string | null = null;
  el: HTMLElement | null = null;
  poller?: Poller<Status>;

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

  get today(): string {
    return todayOf(this.st.series);
  }

  /** What a device drawer opened from here gets. */
  deviceOpts(p: Person): DeviceOpts {
    return {
      refresh: () => this.refresh(),
      geo: this.st.geo,
      now: this.st.now,
      today: this.today,
      core: coreFor(this.st.servers, p.server),
      server: this.st.servers.find((s) => s.id === p.server),
    };
  }

  /**
   * A new status (newest answer wins, see the poller). People added or removed
   * elsewhere re-render the list; otherwise the cards repaint in place.
   */
  take(stAll: Status, quiet: boolean) {
    const st = this.scope(stAll);
    const changed = ids(st) !== ids(this.st);
    this.st = st;
    if (changed) this.rebuild();
    else {
      this.paintCards(quiet);
      this.decorate(quiet);
    }
  }

  /** Repaint the cards from a fresh status (after a change made here). */
  async update() {
    await this.poller?.refresh();
  }

  /** Everything again, the form's sections too (after adding or removing someone). */
  async refresh() {
    this.poller?.claim();
    const st = await api.status(30).catch(() => null);
    if (!st) return;
    this.st = this.scope(st);
    this.rebuild();
  }

  /** One card per person (cards already shown are kept and repainted), or the empty state. */
  rebuild() {
    const old = new Map<string, HTMLElement>();
    for (const el of Array.from(this.list.children) as HTMLElement[]) if (el.dataset.sid) old.set(el.dataset.sid, el);
    const cards = this.st.people.map((p) => {
      const card = old.get(p.id) ?? E('div', { class: 'dl-card', role: 'listitem', 'data-sid': p.id });
      return this.renderCard(card, p.id);
    });
    dom.content(
      this.list,
      cards.length
        ? cards
        : E(
            'div',
            { class: 'dl-plist-none' },
            this.st.servers.length
              ? _('No people yet. Add someone and send them their personal link.')
              : _('Set up the server first, then add people.'),
          ),
    );
    this.decorate();
  }

  /** `quiet` (a periodic repaint) leaves alone a card that has the keyboard focus. */
  paintCards(quiet = false) {
    for (const p of this.st.people) {
      const card = this.card(p.id);
      if (card && !(quiet && focusInside(card))) this.renderCard(card, p.id);
    }
  }

  /** This page's card for a person (a server's People section has its own list). */
  card(sid: Sid): HTMLElement | null {
    return this.list.querySelector<HTMLElement>(`[data-sid="${CSS.escape(sid)}"]`);
  }

  render(stAll: Status): Promise<Node> {
    const st = this.scope(stAll);
    this.st = st;
    const sort = E(
      'select',
      {
        class: 'dl-select',
        'aria-label': _('Sort'),
        change: (ev: Event) => {
          this.sort = (ev.target as HTMLSelectElement).value as SortBy;
          remember('dl.people.sort', this.sort);
          this.decorate();
        },
      },
      [
        E('option', { value: 'seen', selected: this.sort === 'seen' ? 'selected' : null }, _('Last seen', 'sort')),
        E('option', { value: 'name', selected: this.sort === 'name' ? 'selected' : null }, _('Name', 'sort')),
        E('option', { value: 'usage', selected: this.sort === 'usage' ? 'selected' : null }, _('Usage', 'sort')),
      ],
    );
    // Find, once the list is long enough to need it; "/" focuses it.
    const find = E('input', {
      type: 'search',
      class: 'cbi-input-text dl-people-find',
      placeholder: _('Find…'),
      'aria-label': _('Find a person or device'),
      hidden: st.people.length > 8 ? null : 'hidden',
      input: (ev: Event) => {
        this.query = (ev.target as HTMLInputElement).value.trim().toLowerCase();
        this.decorate();
      },
    }) as HTMLInputElement;
    const onSlash = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      if (ev.key === '/' && !find.hidden && !['INPUT', 'TEXTAREA', 'SELECT'].includes(t?.tagName) && !t?.isContentEditable) {
        ev.preventDefault();
        find.focus();
      }
    };
    document.addEventListener('keydown', onSlash);
    onNavigate(() => document.removeEventListener('keydown', onSlash));
    const wrap = E('div', { class: 'dl-root' }, [
      this.serverId
        ? ''
        : E('div', { class: 'dl-pagehead' }, [
            E('div', { class: 'dl-stack' }, [
              E('h2', { class: 'dl-h1' }, _('People')),
              E('span', { class: 'dl-muted dl-people-count' }, this.countText()),
            ]),
            st.servers.length ? button([icon('plus'), ` ${_('Add person')}`], () => this.openCreate(), 'add') : '',
          ]),
      st.servers.length
        ? ''
        : E(
            'div',
            { class: 'alert-message warning' },
            fill(
              _('No server yet. %s before adding people.'),
              E('a', { href: L.url('admin/network/dawnline/server') }, _('Run the setup wizard')),
            ),
          ),
      E('div', { class: 'dl-toolbar' }, [
        E('div', { class: 'dl-seg dl-people-tabs', role: 'tablist' }),
        // Sort and add stay together on the right, wrapping as one group.
        E('div', { class: 'dl-toolbar-end' }, [
          find,
          sort,
          this.serverId ? button([icon('plus'), ` ${_('Add person')}`], () => this.openCreate(), 'add') : '',
        ]),
      ]),
      this.list,
    ]);
    this.el = wrap;
    this.rebuild();
    // Only while visible (a server section may be swapped out).
    this.poller ??= createPoller({
      fetch: () => api.status(30),
      every: 30,
      live: true,
      active: () => !!this.el?.isConnected,
      apply: (st, quiet) => this.take(st, quiet),
    });
    // ?add=1 opens Add person once, not again on every server's People tab.
    if (!addOpened && new URLSearchParams(location.search).get('add')) {
      addOpened = true;
      setTimeout(() => this.openCreate(), 100);
    }
    return Promise.resolve(wrap);
  }

  countText(): string {
    const t = this.st.totals;
    return [
      plural(t.people, '%s person', '%s people'),
      plural(t.devices, '%s device', '%s devices'),
      fmt(_('%s online'), num(t.online)),
    ].join(' · ');
  }

  /** Row classes, counters, filter tabs and sort order; a `quiet` repaint keeps focused tabs. */
  decorate(quiet = false) {
    const c = this.el?.querySelector('.dl-people-count');
    if (c) c.textContent = this.countText();
    const people = this.st.people;
    const today = this.today;
    const attn = (p: Person) => needsAttention(p, today);
    const counts: Record<Filter, number> = {
      all: people.length,
      online: people.filter((p) => p.online > 0).length,
      attention: people.filter(attn).length,
      paused: people.filter((p) => paused(p)).length,
    };
    const tabs = this.el?.querySelector<HTMLElement>('.dl-people-tabs');
    if (tabs && !(quiet && focusInside(tabs))) {
      const label: Record<Filter, string> = { all: _('All'), online: _('Online'), attention: _('Needs attention'), paused: _('Paused') };
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
                remember('dl.people.filter', f);
                this.decorate();
              },
            },
            [label[f], E('b', { class: f === 'attention' && counts[f] ? 'warn' : '' }, String(counts[f]))],
          ),
        ),
      );
    }
    const q = this.query;
    const hay = (p: Person) =>
      [p.name, p.note ?? '', ...p.devices.flatMap((d) => [d.name, d.address, d.hostname, d.endpoint])].join(' ').toLowerCase();
    const match = (p: Person) => {
      if (this.filter === 'online' && !p.online) return false;
      if (this.filter === 'attention' && !attn(p)) return false;
      if (this.filter === 'paused' && !paused(p)) return false;
      if (q && !hay(p).includes(q)) return false;
      return true;
    };
    // Whatever the sort: people who can connect, then those held by a limit or an end
    // date (often something to fix), then the ones the admin paused, last.
    const rank = (p: Person) => (stopReason(p) === 'paused' ? 2 : stopped(p) ? 1 : 0);
    const order = [...people].sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (this.sort === 'name'
          ? a.name.localeCompare(b.name)
          : this.sort === 'usage'
            ? b.month[0] + b.month[1] - (a.month[0] + a.month[1])
            : b.online - a.online || b.last_seen - a.last_seen),
    );
    let shown = 0;
    for (const p of order) {
      const card = this.card(p.id);
      if (!card) continue;
      this.list.appendChild(card);
      card.classList.toggle('dl-off', stopped(p));
      const hit = match(p);
      card.classList.toggle('dl-filtered', !hit);
      if (hit) shown++;
    }
    // Say so when the filter leaves nobody.
    let none = this.el?.querySelector<HTMLElement>('.dl-people-none') ?? null;
    if (people.length && !shown) {
      none ??= E('div', { class: 'dl-empty dl-people-none' }, E('p', {}, _('No one here right now.')));
      if (none.previousElementSibling !== this.list) this.list.after(none);
    } else none?.remove();
  }

  async quick(p: Person, patch: Parameters<typeof api.personUpdate>[1], ok: string) {
    if (await attempt(() => api.personUpdate(p.id, patch), ok)) await this.update();
  }

  renderCard(node: HTMLElement, sid: Sid): HTMLElement {
    const p = this.person(sid);
    if (!p) {
      dom.content(node, E('em', {}, _('This person was just removed.')));
      return node;
    }
    const today = this.today;
    const left = daysLeft(p.expires, today);
    const free = Math.max(0, p.device_limit - p.devices.length);
    // The link itself is not in the status (person_links asks for it).
    const portal = p.has_link ?? this.st.settings.portal_enabled;

    // Term and hours sit by the name; online/last seen lives in the strip below.
    const pills: Node[] = [];
    const why = stopReason(p);
    if (p.expires && why !== 'expired') {
      const soon = endsSoon(p, left);
      const over = left != null && left < 0;
      pills.push(
        E('span', { class: `dl-pill-ic${over ? ' bad' : soon ? ' warn' : ''}`, title: fmt(_('Access ends %s'), date(p.expires)) }, [
          icon('calendar'),
          over ? fmt(_('ended %s'), date(p.expires)) : soon ? endsIn(left as number) : fmt(_('until %s'), date(p.expires)),
        ]),
      );
    }
    if (p.hours && why !== 'hours')
      pills.push(E('span', { class: 'dl-pill-ic', title: _('Allowed hours') }, [icon('clock'), p.hours.replace('-', '–')]));

    const chips = byDeviceState(p.devices).map((d) => {
      return E(
        'button',
        {
          type: 'button',
          class: `dl-chip${d.disabled ? ' disabled' : ''}${d.online ? ' live' : ''}`,
          title: [
            kindLabel(d.kind),
            d.address,
            d.online ? fmt(_('online from %s'), d.endpoint) : d.handshake ? fmt(_('seen %s'), ago(d.handshake, this.st.now)) : '',
          ]
            .filter(Boolean)
            .join(' · '),
          click: (ev: Event) => {
            ev.preventDefault();
            void openDevice(p, d, this.deviceOpts(p));
          },
        },
        [
          icon(d.kind),
          E('span', { class: 'dl-chip-name' }, d.name),
          !d.handshake && !d.disabled ? E('span', { class: 'dl-chip-tag' }, _('not set up')) : '',
          // Online shows as the green chip (.dl-chip.live); no dots.
        ],
      );
    });
    // Always there: over the limit the admin can still add one (the slot bar turns orange).
    chips.push(
      E(
        'button',
        {
          type: 'button',
          class: 'dl-chip add',
          title: free > 0 ? _('Add device') : _('Over the limit: admins can still add'),
          click: (ev: Event) => {
            ev.preventDefault();
            addDevice(p, this.deviceOpts(p));
          },
        },
        [icon('plus'), _('Add device')],
      ),
    );

    // Ending soon (the strip below handles an end that has passed).
    const fixes: Node[] = [];
    if (p.expires && endsSoon(p, left) && why !== 'expired')
      fixes.push(
        E(
          'button',
          {
            type: 'button',
            class: 'dl-fix',
            click: () => this.quick(p, { expires: addMonth(p.expires, today) }, _('Extended by 1 month')),
          },
          _('Extend 1 month'),
        ),
      );

    const more = iconButton(
      'more',
      _('More'),
      (ev: MouseEvent) =>
        dropdown(
          ev.currentTarget as HTMLElement,
          [
            {
              label: _('Open'),
              icon: icon('open'),
              run: () => {
                location.href = personUrl(p.id);
              },
            },
            portal
              ? {
                  label: _('Invite card'),
                  icon: icon('qr'),
                  run: () => inviteCard(p, this.st.servers.find((s) => s.id === p.server)?.name ?? _('Home')),
                }
              : null,
            free > 0 ? { label: _('Add device'), icon: icon('plus'), run: () => addDevice(p, this.deviceOpts(p)) } : null,
            null,
            {
              label: p.paused ? _('Resume') : _('Pause'),
              icon: icon(p.paused ? 'play' : 'pause'),
              warn: !p.paused,
              run: () => this.togglePause(p),
            },
            { label: _('Delete'), icon: icon('trash'), danger: true, run: () => this.remove(p.id) },
          ].filter((x, i, a) => x || (i > 0 && a[i - 1])) as MenuItem[],
        ),
      'neutral',
      'dl-icon-only',
    );
    const actions = E('div', { class: 'dl-pcard-actions' }, [
      portal ? iconButton('link', _('Copy link'), () => copyPersonLink(p.id), 'neutral', 'dl-icon-only') : '',
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
        why ? this.stopStrip(p, why) : '',
      ]),
    );
    return node;
  }

  /** Across the bottom of a stopped person's card: why, since when or until when, and the one action that lifts it. */
  stopStrip(p: Person, why: NonNullable<ReturnType<typeof stopReason>>): HTMLElement {
    const today = this.today;
    // The month's data resets on the 1st (router time).
    const reset = addMonthsClamped(`${today.slice(0, 8)}01`, 1);
    const extra = () => this.quick(p, { bonus_gb: String((p.bonus_gb || 0) + 10) }, _('+10 GB this month'));
    const what: Record<typeof why, [string, 'warn' | 'bad', string, string, [string, string, () => unknown] | null]> = {
      paused: ['pause', 'warn', _('Paused'), _('Devices can’t connect until you resume'), ['play', _('Resume'), () => this.togglePause(p)]],
      quota:
        p.quota_period === 'month'
          ? [
              'chart',
              'bad',
              _('Data limit reached'),
              fmt(_('Paused until it resets on %s'), date(reset)),
              ['plus', _('+10 GB this month'), extra],
            ]
          : [
              'chart',
              'bad',
              _('Data limit reached'),
              _('Paused until the limit is raised'),
              ['edit', _('Change limit'), () => (location.href = personUrl(p.id))],
            ],
      expired: [
        'calendar',
        'bad',
        fmt(_('Access ended %s'), date(p.expires)),
        _('Devices can’t connect'),
        ['calendar', _('Extend 1 month'), () => this.quick(p, { expires: addMonth(p.expires, today) }, _('Extended by 1 month'))],
      ],
      hours: ['clock', 'warn', _('Outside allowed hours'), fmt(_('Access %s (router time)'), p.hours.replace('-', '–')), null],
      no_server: ['alert', 'warn', _('No server'), _('Choose a server on their page'), null],
    };
    const [ic, tone, title, sub, act] = what[why];
    return E('div', { class: `dl-pstrip ${tone}` }, [
      E('span', { class: `dl-need-ic ${tone}` }, icon(ic)),
      E('span', { class: 'dl-pstrip-text' }, [E('b', {}, title), E('span', { class: 'dl-faint' }, sub)]),
      act ? button([icon(act[0]), ` ${act[1]}`], act[2]) : '',
    ]);
  }

  /** Status and actions, this month's usage, a bar split by device (or filled toward the limit), today or live speed. */
  usageSide(p: Person, actions: HTMLElement): HTMLElement {
    const used = p.quota_used || p.month[0] + p.month[1];
    const pct = p.quota_limit ? Math.min(100, (p.quota_used / p.quota_limit) * 100) : 0;
    const today = p.devices.reduce((a, d) => a + (d.spark[d.spark.length - 1] ?? [0, 0]).reduce((x, y) => x + y), 0);
    const r = p.rate?.[p.rate.length - 1];
    const live = p.online && r && this.st.now - r[0] < 180;

    const bar = E('div', { class: `dl-usebar${pct >= 100 ? ' bad' : pct >= 90 ? ' warn' : ''}` });
    if (p.quota_limit) {
      const fill = E('i', { class: 'fill' });
      fill.style.width = `${pct}%`;
      bar.appendChild(fill);
      attachTip(bar, () => [
        E('div', { class: 'dl-tip-title' }, fmt(_('%s%% used'), num(pct, 1))),
        E(
          'div',
          { class: 'dl-muted' },
          `${fmt(_('%s of %s'), bytes(p.quota_used), bytes(p.quota_limit))} · ${fmt(_('%s left'), bytes(Math.max(0, p.quota_limit - p.quota_used)))}`,
        ),
        E(
          'div',
          { class: 'dl-faint' },
          p.quota_period === 'total'
            ? _('In total')
            : [_('This month'), p.bonus_gb ? fmt(_('includes +%s GB extra'), num(p.bonus_gb)) : ''].filter(Boolean).join(' · '),
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
          E('div', { class: 'dl-tip-title' }, _('This month by device')),
          ...devs.map((x, i) =>
            E('div', { class: 'dl-tip-row' }, [
              E('span', { class: `dl-swatch c${Math.min(i, 4)}` }),
              E('span', {}, x.d.name),
              E('b', {}, bytes(x.v)),
            ]),
          ),
        ]);
    }

    const limitText = p.quota_limit ? fmt(_('%s left'), bytes(Math.max(0, p.quota_limit - p.quota_used))) : _('no limit');
    return E('div', { class: 'dl-pside' }, [
      E('div', { class: 'dl-pside-top' }, [
        live
          ? E('span', { class: 'dl-pside-state live' }, _('Online'))
          : E('span', { class: 'dl-pside-state' }, p.online ? _('Online') : p.last_seen ? _('Offline') : _('Never connected')),
        actions,
      ]),
      E('div', { class: 'dl-use-num' }, [
        E('b', { class: used ? '' : 'dl-faint' }, bytes(used)),
        E(
          'span',
          { class: 'dl-faint' },
          p.quota_limit
            ? fmt(_('of %s'), bytes(p.quota_limit))
            : p.quota_period === 'total' && p.quota_gb
              ? _('in total')
              : _('this month'),
        ),
      ]),
      bar,
      live
        ? E('div', { class: 'dl-use-live', title: _('Right now') }, [
            `↓ ${bits(r![2])}`,
            E('span', { class: 'dl-faint' }, `↑ ${bits(r![1])}`),
          ])
        : E('div', { class: 'dl-faint dl-pside-foot' }, today ? `${fmt(_('today %s'), bytes(today))} · ${limitText}` : limitText),
    ]);
  }

  async togglePause(p: Person) {
    if (await attempt(() => api.personPause(p.id, !p.paused), fmt(p.paused ? _('%s resumed') : _('%s paused'), p.name)))
      await this.refresh();
  }

  async remove(sid: Sid) {
    const p = this.person(sid);
    const ok = await confirmDialog(
      fmt(_('Remove %s?'), p?.name ?? sid),
      plural(
        p?.devices.length ?? 0,
        '%s device is disconnected immediately and the personal link stops working. Usage history is kept in backups.',
        'All %s devices are disconnected immediately and the personal link stops working. Usage history is kept in backups.',
      ),
      _('Remove'),
      true,
    );
    if (ok && (await attempt(() => api.personDelete(sid), _('Person removed')))) await this.refresh();
  }

  openCreate() {
    const st = this.st;
    if (!st.servers.length) {
      notify(_('Set up the server first.'), 'warning');
      return;
    }
    const name = E('input', { type: 'text', class: 'cbi-input-text', placeholder: _('e.g. Myata'), maxlength: 48 }) as HTMLInputElement;
    // The last person's access and data limit come back pre-filled (most are alike).
    const last = (() => {
      try {
        return JSON.parse(remembered('dl.person.last') ?? '{}') as { access?: Person['access']; quota?: string };
      } catch {
        return {} as { access?: Person['access']; quota?: string };
      }
    })();
    const access = accessPicker(last.access ?? 'internet');
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
      placeholder: _('Unlimited'),
      value: last.quota ?? '',
    }) as HTMLInputElement;
    const quick = (label: string, months: number) =>
      E(
        'button',
        {
          type: 'button',
          class: 'cbi-button cbi-button-neutral',
          click: () => {
            expires.value = months ? addMonthsClamped(todayOf(st.series), months) : '';
            expires.dispatchEvent(new Event('change'));
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
    // Each field says what its value means, or what is wrong, as it is typed; Create refuses what the router would.
    const today = todayOf(st.series);
    const nameRow = liveField(_('Name', 'person'), name, () => nameHelp(name.value, [], _('Shown in their portal and apps.')));
    const limitRow = liveField(_('Devices'), limit, () => limitHelp(limit.value));
    const expRow = liveField(
      _('End date'),
      expires,
      () => expiresHelp(expires.value, today, daysLeft, date),
      E('div', { class: 'dl-actions' }, [
        expires,
        quick(_('1 month'), 1),
        quick(_('3 months'), 3),
        quick(_('1 year'), 12),
        quick(_('None', 'end date'), 0),
      ]),
    );
    const quotaRow = liveField(_('Monthly data (GB)'), quota, () => quotaHelp(quota.value));
    // The quick buttons set the date without an input event.
    expires.addEventListener('change', () => expRow.refresh());
    const portalOn = st.settings.portal_enabled;

    modal(
      _('Add person'),
      [
        nameRow,
        server ? row(_('Server'), server) : '',
        E('div', { class: 'cbi-value dl-block' }, [
          E('label', { class: 'cbi-value-title' }, _('Access')),
          E('div', { class: 'cbi-value-field' }, access.el),
        ]),
        limitRow,
        expRow,
        quotaRow,
      ],
      [
        cancelButton(),
        ' ',
        button(
          // Without the portal there is no link to copy.
          portalOn ? _('Create and copy link') : _('Create'),
          async () => {
            const bad = firstBad([nameRow, limitRow, expRow, quotaRow]);
            if (bad) {
              notify(bad, 'warning');
              return;
            }
            const r = await attempt(() =>
              api.personCreate(
                name.value.trim(),
                '',
                server?.value ?? srv.id,
                access.get(),
                limit.value.trim(),
                expires.value,
                quota.value.trim(),
                'month',
              ),
            );
            if (!r) return;
            remember('dl.person.last', JSON.stringify({ access: access.get(), quota: quota.value.trim() }));
            // After the await some browsers refuse the clipboard: the card has its own Copy.
            if (r.link) await copyText(r.link, _('Personal link copied'), true);
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
        title: fmt(_('%s is ready'), name),
        lead: fmt(_('Send %s the card or the link. They open it, add their devices and connect - no account needed.'), name),
      });
      return;
    }
    // No portal, no link: the two ways on from here, as buttons.
    const p = this.person(id);
    modal(
      fmt(_('%s is ready'), name),
      [E('p', {}, _('Created. Turn on the personal portal in Settings to get a link, or add devices for them here.'))],
      [
        E('button', { class: 'cbi-button cbi-button-neutral', click: closeModal }, _('Done')),
        ' ',
        E(
          'a',
          { class: 'cbi-button cbi-button-neutral', href: `${L.url('admin/network/dawnline/settings')}?section=portal` },
          _('Open Settings'),
        ),
        ' ',
        p
          ? button(
              _('Add device'),
              () => {
                closeModal();
                addDevice(p, this.deviceOpts(p));
              },
              'positive',
            )
          : '',
      ],
    );
  }
}
