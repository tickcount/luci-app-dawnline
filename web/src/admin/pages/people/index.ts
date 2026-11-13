// People: who connects and what they may do. The section row and the head (how many people and devices, how many
// online; Add person). The filter bar (ui/filter-bar.ts): the page's search (name, note, device, address; a card
// says what it was found by and leads to that device), the view (Cards · Map) and «Select» for several at once
// (pick.ts and its dock); under them the filters as chips (filters.ts), each in the address. Then the list: the
// cards (cards.ts) with the notices over them, or the map with its list (map-view.ts). A person (person/) and a
// device (device/) are pages of their own inside this view (ui/subpage.ts): opening one gives it the whole column,
// the list with the head and the bar waits under it, and the way back returns the list where it was, with the same
// filters. Their addresses are this view's (people?id=, ?device=, ?view=map).
//
// Moving inside the page loads nothing (moves.ts): opening pushes a history entry, the way back steps back to it;
// filters and the order replace the entry.
//
// Live: the status on the live revision, 30 s as the fallback; the log of the last 8 days for everyone in one request
// (the cards' presence), then what came after it with each new status; a page reads what else it shows.

import type { LogEvent, Status } from '../../../shared/types';
import { share } from '../../../shared/live/share';
import { api } from '../../api';
import { h, markup } from '../../../portal/dom';
import { sheetOpen } from '../../../portal/ui/sheet';
import { layer } from '../../../portal/ui/layer';
import { todayOf } from '../../../shared/format';
import { fmt, num, plural } from '../../../shared/i18n';
import { createPoller } from '../../state/poller';
import { routerDay } from '../../events/clock';
import { glass } from '../../ui/glass';
import { ic } from '../../ui/icons';
import { pageHead, setFacts, fact } from '../../ui/page-head';
import { tabs } from '../../ui/tabs';
import { onNavigate } from '../../ui/nav';
import { emptyState } from '../../ui/empty';
import { filterBar, searchField, type FilterBar, type Search } from '../../ui/filter-bar';
import { subpage, type Subpage } from '../../ui/subpage';
import { canWrite } from '../../shell/role';
import { navRow } from '../../shell/nav';
import { href, logUrl } from '../../shell/routes';
import { peopleOnline } from '../../people/lines';
import { find, words, type Match } from '../../people/find';
import { scoped } from '../../people/roster';
import { listOf, parseRoute, type PeopleRoute } from '../../people/route';
import type { ActCtx } from '../../people/ctx';
import { addPerson } from '../../flows/add-person';
import type { PeopleHost } from './host';
import { pageMoves, type Moves } from './moves';
import { pickPeople, type Pick } from './pick';
import { filterChips } from './filters';
import { Cards } from './cards';
import { MapView } from './map-view';
import { PersonPanel } from './person';
import { DevicePanel } from './device';
import { enter } from '../../ui/entrance';
import { putChildren } from '../../../portal/ui/put';

export type PeopleData = Status;

/** The log the cards read: the last 8 days (the week's hours, since when someone is online, when paused). */
const SPAN = 8 * 86400;
const EVENTS = 5000;
/** A phone: the page's column under this. */
const NARROW = 560;

/** The view switch's icon for the cards: four tiles. */
const cardsIcon = (): Element =>
  markup(
    '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="2"/><rect x="13" y="4" width="7" height="7" rx="2"/><rect x="4" y="13" width="7" height="7" rx="2"/><rect x="13" y="13" width="7" height="7" rx="2"/></svg>',
  );

export class PeoplePage implements PeopleHost {
  write = canWrite();
  protected status!: Status;
  /** The router's last answer, each new one laid over it: who did not change is the object they were (shared/live/share.ts). */
  private raw: Status | null = null;
  private keep(st: Status): Status {
    return (this.raw = share(this.raw, st));
  }
  private skew = 0;
  protected r: PeopleRoute = parseRoute(location.search.replace(/^\?/, ''));
  private page = h('div', { class: 'page people' });
  private head!: HTMLElement;
  private search: Search | null = null;
  private bar: FilterBar | null = null;
  private viewBox = h('div', { class: 'pp-viewbox' });
  private sub: Subpage = subpage(this.page);
  private cards: Cards | null = null;
  private map: MapView | null = null;
  private pick: Pick | null = null;
  private moves: Moves | null = null;
  private panel: PersonPanel | DevicePanel | null = null;
  /** The log the cards read; null until the first answer. */
  private events: LogEvent[] | null = null;
  /** What stands in the list's place: a page's object, or one that is not there (''. nothing). */
  private shown = '';

  load(): Promise<PeopleData> {
    return api.status(1);
  }

  /* ---------- what a page built on this one may change (a server's People, pages/server/people.ts) ---------- */

  /** What of the router's answer the page reads (all of it). */
  protected scope(st: Status): Status {
    return st;
  }

  /** The row over the page's head (the admin's sections), or none when the page stands inside another's frame. */
  protected chrome(): HTMLElement | null {
    return navRow();
  }

  /* ---------- what the parts read (PeopleHost) ---------- */

  st = (): Status => this.status;
  now = (): number => Date.now() / 1000 + this.skew;
  today = (): string => todayOf(this.status.series) || routerDay(this.now(), this.status.tz);
  route = (): PeopleRoute => this.r;
  narrow = (): boolean => (this.page.clientWidth || innerWidth) < NARROW;

  /** What a one-tap action from the list needs. */
  private acts: ActCtx = { st: this.st, today: this.today, now: this.now, reload: () => this.reload() };

  take(st: Status) {
    this.status = this.scope(this.keep(st));
    this.skew = st.now - Date.now() / 1000;
    this.fresh(true);
  }

  async reload() {
    const st = await api.status(1).catch(() => null);
    if (!st) return;
    this.status = this.scope(this.keep(st));
    this.skew = st.now - Date.now() / 1000;
    this.fresh(false);
  }

  go(r: PeopleRoute, how: 'push' | 'replace' = 'push') {
    this.moves?.go(r, how);
  }

  /* ---------- the page ---------- */

  render(st: PeopleData): HTMLElement {
    const page = this.page;
    this.status = this.scope(this.keep(st));
    this.skew = st.now - Date.now() / 1000;
    if (this.r.server && !st.servers.some((s) => s.id === this.r.server)) this.r = { ...this.r, server: undefined };
    const add =
      this.write && st.servers.length
        ? h('button', { type: 'button', class: 'btn accent sm', onclick: () => this.add() }, ic('plus'), h('span', {}, _('Add person')))
        : null;
    this.head = pageHead({ icon: glass('people', 'grey'), title: _('People'), acts: add ? [add] : [] });
    const row = this.chrome();
    if (row) page.append(row);
    page.append(this.head);
    if (!st.servers.length) {
      setFacts(this.head, [this.write ? null : fact([ic('eye'), _('View only')])]);
      page.append(
        emptyState({
          icon: 'server',
          title: _('No server yet'),
          text: _('Set up the server first, then add people.'),
          action: h('a', { class: 'btn accent sm', href: href({ view: 'server' }) }, h('span', {}, _('Set up the server'))),
        }),
      );
      return page;
    }
    this.cards = new Cards(this, {
      picking: () => !!this.pick?.picking(),
      pickable: this.write && st.people.length > 1,
      reset: () => this.reset(),
      add: () => this.add(),
      waiting: () => this.go({ ...this.r, need: 'config', group: undefined }, 'replace'),
      acts: this.acts,
    });
    page.append(this.makeBar(), this.sub.el);
    this.moves = pageMoves(page, this.route, (r, how) => this.arrive(r, how));
    this.paint(false);
    this.sync('load');
    this.listen();
    void this.readLog();
    createPoller({
      fetch: () => api.status(1),
      every: 30,
      live: true,
      active: () => page.isConnected,
      apply: (d, quiet) => {
        this.status = this.scope(this.keep(d));
        this.skew = d.now - Date.now() / 1000;
        this.fresh(quiet);
        void this.readLog();
      },
    });
    if (this.r.sheet === 'add' && !this.r.id && this.write) requestAnimationFrame(() => this.add());
    return page;
  }

  /** The log the cards read: the last 8 days at first, then what came after the newest it has. */
  private async readLog() {
    const now = this.status.now;
    const had = this.events;
    const newest = had?.length ? had[had.length - 1].ts : 0;
    const r = await api.events(EVENTS, undefined, newest ? newest - 1 : now - SPAN - 1).catch(() => null);
    if (!r || !this.cards) return;
    const key = (e: LogEvent) => `${e.ts}|${e.type}|${e.device ?? ''}|${e.person ?? ''}|${e.detail ?? ''}`;
    const seen = new Set((had ?? []).map(key));
    const fresh = r.events.filter((e) => !seen.has(key(e)));
    if (had && !fresh.length) return;
    this.events = [...(had ?? []), ...fresh].filter((e) => e.ts >= now - SPAN).sort((a, b) => a.ts - b.ts);
    this.cards.take(this.events);
    this.paint(true);
  }

  /** What the page listens to outside its own tree, until LuCI leaves it. */
  private listen() {
    const lay = layer();
    // Escape takes a page back to the list at once (the keyboard never animates); a sheet, a menu or a pick over it
    // takes it first.
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !this.shown || sheetOpen() || this.pick?.picking()) return;
      if ((lay as ParentNode).querySelector('.drop, .menu')) return;
      const t = e.composedPath()[0] as HTMLElement | undefined;
      if (t && ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      this.keyed = true;
      this.close();
    };
    document.addEventListener('keydown', esc);
    const off = onNavigate(() => {
      off();
      document.removeEventListener('keydown', esc);
      this.panel?.destroy();
      this.cards?.stop();
    });
  }

  /* ---------- the bar ---------- */

  private makeBar(): HTMLElement {
    this.search = searchField({
      placeholder: _('Name, device, IP'),
      label: _('Find a person, a device or an address'),
      page: this.page,
      typed: () => this.paint(false),
    });
    this.paintView();
    const toggle =
      this.write && this.status.people.length > 1
        ? (h(
            'button',
            {
              type: 'button',
              class: 'btn soft sm pk-toggle',
              'aria-pressed': 'false',
              title: _('Select several: extend, pause, resume. Or hold a card.'),
            },
            h('span', {}, _('Select')),
          ) as HTMLButtonElement)
        : null;
    if (toggle)
      this.pick = pickPeople(this.cards!.groups, toggle, {
        people: () => this.status.people,
        today: this.today,
        reload: () => this.reload(),
      });
    this.bar = filterBar({ top: [this.search.el, this.viewBox, toggle] });
    return this.bar.el;
  }

  /** The view's track: Cards · Map (drawn again when the address changed the view under it: Back). */
  private paintView() {
    const on = this.r.view === 'map' ? 'map' : 'cards';
    if (this.viewBox.dataset.on === on) return;
    this.viewBox.dataset.on = on;
    putChildren(this.viewBox, [
      tabs<'cards' | 'map'>(
        [
          { id: 'cards', label: _('Cards'), icon: 'cards' },
          { id: 'map', label: _('Map'), icon: 'map' },
        ],
        on,
        (v) => {
          this.viewBox.dataset.on = v;
          // the map has no order and no group chips; the cards have no period
          this.go({
            ...this.r,
            view: v === 'map' ? 'map' : undefined,
            sort: undefined,
            group: undefined,
            range: undefined,
            s: undefined,
            sheet: undefined,
          });
        },
        { cls: 'pp-view', label: _('View') },
      ).el,
    ]);
    this.viewBox.querySelector('.tab[data-id="cards"] .i')?.replaceWith(cardsIcon());
  }

  private reset() {
    this.search?.clear();
    this.go({ view: this.r.view, id: this.r.id, device: this.r.device, range: this.r.range }, 'replace');
  }

  private add() {
    addPerson({ st: this.status, today: this.today(), server: this.r.server ?? '', added: () => void this.reload() });
  }

  /* ---------- the list ---------- */

  private paint(quiet: boolean) {
    const r = this.r;
    const st = this.status;
    const t = { now: this.now(), today: this.today() };
    const all = scoped(st.people, r, t, false);
    setFacts(this.head, [
      fact(plural(all.length, '%s person', '%s people')),
      fact(
        plural(
          all.reduce((n, p) => n + p.devices.length, 0),
          '%s device',
          '%s devices',
        ),
      ),
      fact(fmt(_('%s online'), num(peopleOnline(all)))),
      this.write ? null : fact([ic('eye'), _('View only')]),
    ]);
    if (!this.cards || !this.bar) return;
    const query = this.search?.value() ?? '';
    const ws = words(query);
    const found = new Map<string, Match | null>();
    const hit = scoped(st.people, r, t).filter((p) => {
      const f = find(p, ws);
      if (f.hit) found.set(p.id, f.match);
      return f.hit;
    });
    const narrowed = !!(r.group || r.server || r.need || r.sort || ws.length);
    // one person, or nobody: nothing to narrow or to order
    this.bar.chips(
      st.people.length > 1 ? filterChips(st, r, t, (patch) => this.go({ ...this.r, ...patch }, 'replace')) : [],
      narrowed ? () => this.reset() : null,
    );
    this.bar.count(hit.length, st.people.length, hit.length === st.people.length);
    const map = r.view === 'map';
    this.page.classList.toggle('map', map);
    const list = this.sub.list;
    // cards ↔ map: the view that goes is gone at once, the one that comes in comes in as a page does (ui/entrance.ts)
    const swap = list.firstElementChild && list.firstElementChild !== (map ? this.map?.el : this.cards.el) && !this.shown;
    if (map) {
      this.map ??= new MapView(this);
      if (this.map.el.parentElement !== list) putChildren(list, [this.map.el]);
      this.map.paint(r, hit);
      if (swap) enter(this.map.el);
      return;
    }
    if (this.cards.el.parentElement !== list) {
      putChildren(list, [this.cards.el]);
      this.cards.forget();
    }
    // under a person's or a device's page the list waits as it was: drawn again when it is back
    if (this.shown) return;
    this.cards.paint({ people: hit, found, words: ws, query }, quiet);
    this.pick?.adopt();
    if (swap) enter(this.cards.el);
  }

  /* ---------- a person's or a device's page ---------- */

  /** The page at another route: a pick, or a traversal (Back). */
  protected arrive(r: PeopleRoute, how: 'pick' | 'back') {
    this.r = r;
    this.paintView();
    this.sync(how);
    this.paint(false);
  }

  /** Escape asked for the list: it comes back without motion. */
  private keyed = false;

  /** The person a route is about (a device's owner). */
  protected owner(r: PeopleRoute): string | undefined {
    return r.device ? this.status.people.find((p) => p.devices.some((d) => d.id === r.device))?.id : r.id;
  }

  /** The page the route asks for, opened, swapped or taken back to the list. */
  protected sync(how: 'load' | 'pick' | 'back') {
    const r = this.r;
    // the map view with a person or a device is their places on the map (map-view.ts scopes to them), not their page
    const want = r.view === 'map' ? '' : r.device ? `d:${r.device}` : r.id ? `p:${r.id}` : '';
    if (want === this.shown) {
      // the same page asked for a block or a sheet of its own
      if (how === 'pick') this.panel?.arrive(r.s, r.sheet);
      return;
    }
    this.panel?.destroy();
    this.panel = null;
    this.shown = want;
    // back by Escape: the list stands there at once, as it was left
    const keyed = this.keyed;
    this.keyed = false;
    if (!want) return this.sub.show(null, keyed ? 'load' : how);
    this.pick?.leave();
    const known = r.device
      ? this.status.people.some((p) => p.devices.some((d) => d.id === r.device))
      : this.status.people.some((p) => p.id === r.id);
    if (!known) {
      const back = h('button', { type: 'button', class: 'btn soft sm' }, h('span', {}, _('To people')));
      back.addEventListener('click', () => this.close());
      this.sub.show(
        emptyState({
          icon: r.device ? 'phone' : 'person',
          title: r.device ? _('No such device') : _('No such person'),
          text: r.device
            ? _('It was removed, or the link is out of date. Its events stay in the log for as long as the log keeps them.')
            : _('They were removed, or the link is out of date. Their devices’ events stay in the log for as long as the log keeps them.'),
          action: h(
            'div',
            { class: 'pp-gone-acts' },
            back,
            h('a', { class: 'btn soft sm', href: logUrl(r.device ? { device: r.device } : {}) }, h('span', {}, _('Open the log'))),
          ),
        }),
        how,
      );
      return;
    }
    const close = () => this.close();
    const panel = r.device ? new DevicePanel(r.device, this, close) : new PersonPanel(r.id!, this, close);
    this.panel = panel;
    this.sub.show(panel.el, how, this.owner(r));
    // what the address asks to open on arrival (a block, a sheet), once the page stands
    if (r.s || r.sheet) requestAnimationFrame(() => panel.arrive(r.s, r.sheet));
  }

  /** Back to the list as it stands (a step back in history when that is where the page was opened from). */
  private close() {
    const go = () => this.moves?.back(listOf(this.r));
    // a person's page with changes waiting asks first
    if (this.panel instanceof PersonPanel) this.panel.leave(go);
    else go();
  }

  /** A new answer from the router; `quiet`: a periodic one (what holds the focus is left alone). */
  protected fresh(quiet: boolean) {
    this.paint(quiet);
    if (this.panel) this.panel.fresh(quiet);
    // the page's object went away (removed here or elsewhere): it says so
    const r = this.r;
    const there = r.device
      ? this.status.people.some((p) => p.devices.some((d) => d.id === r.device))
      : !r.id || this.status.people.some((p) => p.id === r.id);
    if (this.panel && !there) {
      this.shown = '';
      this.sync('back');
    }
  }
}
