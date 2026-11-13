// A person as a page of its own inside People (people?id=): what they have and what they may do, every part on the
// page at once. The way back and ×; the head (head.ts: their phrase, its one action, their link, ⋯) across; under it
// two columns, as the portal's (devices on the left, access on the right): the main column has their devices as
// cards (devices.ts, two across) under «Devices 3 of − 4 +» (the limit in the block's head, where the count stands),
// their traffic as a device's page has it (device/traffic.ts: the week, this month, all time, the speed now), their
// places (rows with strips of 7 days) and their latest events as the Log's rows; the side column is one «Access»
// stack that stays in sight while the page scrolls: the term, the data limit and what they reach
// (widgets/term.ts, limit-meter.ts, reach.ts), each a card with its head inside (one line while there is
// nothing more to say: no end date). Narrower: one column, the access stack first. ?s=<block> brings one
// into view, ?sheet=add opens adding a device, ?sheet=places their places' close-up (&pick=: on one device).
//
// Live: the status comes from the page; their events (after the newest it has) and their days are read on opening,
// with every status the page takes and after a change made here; their speed now from the meter once a second,
// only while a device of theirs is online and the panel is in the page. A part holding the focus (a field being
// edited, a handle held) is left alone by a background repaint.
//
// What changes how their access works (what they reach, the limit, how many devices) is not made by one
// press: it waits (people/draft.ts), the page shows them as they would be with «not applied» on the part's head, and
// the dock at the window's foot applies everything at once or lets it go. A name, a note and the one-tap actions
// (pause, extend, more data this month) are made at once, as before. Leaving while changes wait is asked about.

import { openCloseUp } from '../../../flows/places-closeup';
import { plain } from '../../../shell/sheets';
import { refill } from '../../../ui/reshape';
import type { DayUsage, LogEvent, Person } from '../../../../shared/types';
import { api, type PersonPatch } from '../../../api';
import { h } from '../../../../portal/dom';
import { todayOf } from '../../../../shared/format';
import { fill, fmt, num, plural } from '../../../../shared/i18n';
import { closeSheet, openSheet } from '../../../../portal/ui/sheet';
import { askView } from '../../../flows/ask';
import { draftCount, draftParts, draftRefetch, preview, split, stageDraft, type Draft, type DraftPart } from '../../../people/draft';
import { pendingDock } from '../../settings/pending-dock';
import { errorText, notify } from '../../../ui/toast';
import { blockHead } from '../../../ui/page-head';
import { pageBar } from '../../../ui/subpage';
import { stepper } from '../../../ui/stepper';
import { ic } from '../../../ui/icons';
import { focusInside, type Poller } from '../../../state/poller';
import { LiveMeter } from '../../../state/meter';
import { pollMeter } from '../../../state/meterpoll';
import { routerDay } from '../../../events/clock';
import { say } from '../../../shell/toast';
import { deviceUrl, peopleAt, placesUrl } from '../../../shell/routes';
import { addDevice } from '../../../flows/add-device';
import { listOf } from '../../../people/route';
import type { ActCtx, PersonCtx } from '../../../people/ctx';
import { termBlock } from '../../../widgets/term';
import { limitMeter, limitPeriod } from '../../../widgets/limit-meter';
import { reachFork, reachMark } from '../../../widgets/reach';
import { feedShort, logLink } from '../../../widgets/feed';
import { placeRow } from '../../../widgets/place-rows';
import type { PeopleHost } from '../host';
import { personHead } from './head';
import { deviceGrid } from './devices';
import { personUse, trafficCard, type TrafficCard } from '../device/traffic';

/** Their events the panel reads (30 days of them). */
const LIMIT = 3000;
const DAYS30 = 30 * 86400;

type Block = 'use' | 'devices' | 'term' | 'traffic' | 'reach' | 'places' | 'log';

/** A part of the access stack: its card with its head inside, first. */
function part(head: HTMLElement, card: HTMLElement): HTMLElement {
  card.classList.add('pp-part');
  card.prepend(head);
  return card;
}

export class PersonPanel {
  readonly kind = 'person';
  el = h('article', { class: 'kt-panel pp-person' });
  private c!: PersonCtx;
  private events: LogEvent[] = [];
  private days: DayUsage[] = [];
  private gone = false;
  /** Reading again after a change made here: the status that comes meanwhile is drawn with the events, once. */
  private batching = false;
  private headBox = h('div', { class: 'kt-phead' });
  private box: Record<Block, HTMLElement>;
  /** Their Traffic card, its speed now fed by the meter. */
  private traffic?: TrafficCard;
  private meter = new LiveMeter();
  private poll: Poller<unknown>;
  /** Service lines of their feed left unfolded. */
  private open = new Set<string>();
  /** The person as the router has them (`c.p` is them with what waits over it). */
  private real!: Person;
  /** Their changes that wait for «Apply». */
  private draft: Draft = {};
  private applying = false;
  private dock = pendingDock({ apply: () => void this.apply(), cancel: () => this.forget(), column: () => this.el });

  constructor(
    readonly id: string,
    private host: PeopleHost,
    close: () => void,
  ) {
    const sec = (cls: string) => h('section', { class: `kt-b ${cls}` });
    const b = (this.box = {
      use: sec('b-use'),
      devices: sec('b-devices'),
      term: sec('b-term'),
      traffic: sec('b-traffic'),
      reach: sec('b-reach'),
      places: sec('b-places'),
      log: sec('b-log'),
    });
    this.el.append(
      pageBar({ back: _('People'), to: peopleAt(listOf(host.route())), close: () => this.leave(close) }),
      this.headBox,
      h(
        'div',
        { class: 'pp-cols' },
        // their traffic first, then the devices it is made of (the owner, 2026-11-12: «траффик должен идти выше devices»)
        h('div', { class: 'pp-main kt-blocks' }, b.use, b.devices, b.places, b.log),
        h(
          'aside',
          { class: 'pp-side', 'aria-label': _('Access') },
          blockHead(_('Access')),
          h('div', { class: 'pp-stack' }, b.term, b.traffic, b.reach),
        ),
      ),
    );
    // a link that leads off their page while changes wait is held and asked about first
    this.el.addEventListener(
      'click',
      (e) => {
        if (!draftCount(this.draft) || e.defaultPrevented || !plain(e)) return;
        const a = e.composedPath().find((x): x is HTMLAnchorElement => x instanceof HTMLAnchorElement && !!x.href);
        if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
        e.preventDefault();
        e.stopPropagation();
        this.leave(() => a.click());
      },
      true,
    );
    this.take();
    this.paint(false);
    void this.load(false);
    this.poll = pollMeter(
      this.meter,
      () => this.el.isConnected && !this.gone && this.c.p.online > 0 && !!this.c.srv?.enabled,
      () => this.paintSpeed(),
    );
  }

  destroy() {
    this.gone = true;
    this.poll.stop();
    // left by a way that could not ask (the browser's Back): what waited is gone with the page, and said
    if (draftCount(this.draft))
      notify(plural(draftCount(this.draft), '%s change was not applied', '%s changes were not applied'), 'warning');
    this.draft = {};
    this.syncDock();
  }

  /** How many of their changes wait for «Apply». */
  waiting(): number {
    return draftCount(this.draft);
  }

  /** Leave their page: asked first while changes wait («Leave» lets them go). */
  leave(go: () => void) {
    const n = draftCount(this.draft);
    if (!n) return go();
    openSheet(() =>
      askView({
        icon: 'out',
        tone: 'orange',
        title: _('Leave without applying?'),
        text: [plural(n, '%s change is not applied: it will be lost.', '%s changes are not applied: they will be lost.')],
        action: _('Leave'),
        cls: 'warn',
        run: async () => {
          this.draft = {};
          this.syncDock();
          closeSheet(true);
          go();
        },
      }),
    );
  }

  /** «Cancel»: every part goes back to what the router has. */
  private forget() {
    this.draft = {};
    this.syncDock();
    if (this.take()) this.paint(false);
  }

  private syncDock() {
    const n = this.real ? draftRefetch(this.real, this.draft) : 0;
    this.dock.sync({ changes: draftCount(this.draft), refetch: { n, paused: 0, fresh: 0, people: n ? 1 : 0 }, breaks: false });
  }

  /** «Apply»: everything that waits in one person_update; asked first when devices fetch their configuration again. */
  private async apply() {
    const draft = this.draft;
    const count = draftCount(draft);
    if (!count || this.applying) return;
    const save = async () => {
      this.applying = true;
      try {
        await api.personUpdate(this.id, draft);
        this.draft = {};
        this.syncDock();
        say(plural(count, '%s change applied', '%s changes applied'));
        await this.reload();
        return true;
      } catch (e) {
        notify(errorText(e), 'error', 10000);
        return false;
      } finally {
        this.applying = false;
      }
    };
    const n = draftRefetch(this.real, draft);
    if (!n) return void save();
    openSheet(() =>
      askView({
        icon: 'refresh',
        tone: 'orange',
        title: fmt(_('Apply the changes for %s?'), this.real.name),
        text: [
          plural(
            n,
            '%s device fetches its configuration again. Until then it works the old way.',
            '%s devices fetch their configuration again. Until then they work the old way.',
          ),
        ],
        action: _('Apply'),
        cls: 'warn',
        run: async () => {
          if (await save()) closeSheet();
        },
      }),
    );
  }

  /** What the address asks to open on arrival: a block brought into view, adding a device, their places' close-up. */
  arrive(s?: string, sheet?: string) {
    const box = s && s in this.box ? this.box[s as Block] : null;
    if (box) requestAnimationFrame(() => box.scrollIntoView({ block: 'start' }));
    if (sheet === 'add' && this.c.write) this.addDevice();
    else if (sheet === 'places') this.openPlaces(new URLSearchParams(location.search).get('pick'));
  }

  /** Their devices with places: the one online, else the one seen last, first. */
  private placed(): string[] {
    const pts = this.c.st.geo.points;
    const newest = (id: string) => Math.max(...pts.filter((x) => x.device === id).map((x) => (x.online ? Infinity : x.ts)));
    return this.c.p.devices
      .filter((d) => pts.some((x) => x.device === d.id))
      .map((d) => d.id)
      .sort((a, b) => newest(b) - newest(a));
  }

  /** Their places' close-up: all their devices at once when there are several, else the one; `pick`: that one. */
  private openPlaces(pick?: string | null) {
    const devs = this.placed();
    if (!this.c.st.geo.enabled || !devs.length) return;
    const id = pick && devs.includes(pick) ? pick : devs.length > 1 ? null : devs[0];
    openCloseUp(id, this.c.st, { person: this.c.p.id, devices: devs });
  }

  private addDevice() {
    addDevice({
      person: this.c.p,
      server: this.c.srv,
      now: this.c.now,
      added: () => void this.reload(),
      people: this.c.st.people,
      servers: this.c.st.servers,
    });
  }

  /** The person in the page's status; false when they are not there (removed). */
  private take(): boolean {
    const st = this.host.st();
    const real = st.people.find((x) => x.id === this.id);
    if (!real) return false;
    this.real = real;
    // what the router has by now stops waiting (the same change made elsewhere)
    this.draft = stageDraft(this.draft, real, {});
    const p = preview(real, this.draft);
    const acts: ActCtx = {
      st: () => this.host.st(),
      today: () => this.c.today,
      now: this.host.now,
      reload: () => this.reload(),
      // «Change the limit» (a limit for the whole term reached): the limit is on the panel, edited in place
      limit: () => {
        this.box.traffic.scrollIntoView({ block: 'nearest' });
        this.box.traffic.querySelector<HTMLElement>('.kt-lim-b')?.click();
      },
    };
    this.c = {
      st,
      p,
      srv: st.servers.find((s) => s.id === p.server),
      events: this.events,
      days: this.days,
      write: this.host.write,
      today: todayOf(this.days.length ? this.days : st.series) || routerDay(this.host.now(), st.tz),
      now: this.host.now,
      patch: (patch, said) => this.patch(patch, said),
      acts,
    };
    return true;
  }

  /** Their events (after the newest it has when `live`) and their days. */
  private async load(live: boolean) {
    const st = this.host.st();
    const newest = this.events.length ? this.events[this.events.length - 1].ts : 0;
    const since = live && newest ? newest - 1 : st.now - DAYS30 - 1;
    const [ev, use] = await Promise.all([
      api.events(LIMIT, this.id, since).then(
        (r) => r.events,
        () => null,
      ),
      api.personUsage(this.id, 31).then(
        (r) => r.person,
        () => this.days,
      ),
    ]);
    if (this.gone) return;
    const key = (e: LogEvent) => `${e.ts}|${e.type}|${e.device ?? ''}|${e.detail ?? ''}`;
    const had = new Set(this.events.map(key));
    const fresh = ev ?? [];
    const events = live && newest && ev ? [...this.events, ...fresh.filter((e) => !had.has(key(e)))] : (ev ?? this.events);
    this.events = events.filter((e) => e.ts >= st.now - DAYS30);
    this.days = use;
    if (this.take()) this.paint(live);
  }

  /** Read everything again now (after a change made here). */
  private async reload() {
    // one repaint for the change: the page's new status is taken in, drawn once their events are read too
    this.batching = true;
    try {
      await this.host.reload();
    } finally {
      this.batching = false;
    }
    await this.load(false);
  }

  /**
   * A change made on the page. What changes how their access works waits for «Apply» (drawn at once, as it would
   * be); the rest (a name, a note, a one-tap action) is saved and the router's answer drawn; false when the router
   * refused (said in a toast).
   */
  private async patch(all: PersonPatch, said?: string): Promise<boolean> {
    const { waits, now: patch } = split(all);
    if (draftCount(waits)) {
      this.draft = stageDraft(this.draft, this.real, waits);
      this.syncDock();
      if (this.take()) this.paint(false);
    }
    if (!Object.keys(patch).length) return true;
    try {
      await api.personUpdate(this.id, patch);
      if (said) say(said);
      await this.reload();
      return true;
    } catch (e) {
      notify(errorText(e), 'error', 10000);
      return false;
    }
  }

  /** A new status from the page; `quiet`: a periodic one. */
  fresh(quiet: boolean) {
    if (!this.take() || this.batching) return;
    // a periodic one: drawn once, with their new events
    if (quiet) void this.load(true);
    else this.paint(false);
  }

  private put(box: HTMLElement, quiet: boolean, ...kids: (Node | null)[]) {
    // a part being edited (a field, a handle held, a native picker) is left alone by a background repaint
    if (quiet && (focusInside(box) || box.querySelector('.held'))) return;
    // what changes unfolds or folds and morphs, never jumps (ui/reshape.ts)
    refill(
      box,
      kids.filter((k): k is Node => !!k),
    );
  }

  private paint(quiet: boolean) {
    const c = this.c;
    const p = c.p;
    const b = this.box;
    // «not applied» beside the name of each part that has a change waiting
    const waits = draftParts(this.draft);
    const head = (part: DraftPart, el: HTMLElement): HTMLElement => {
      if (waits.has(part)) el.querySelector('h2')?.after(h('span', { class: 'kt-wait' }, h('span', { class: 'reimp' }, _('not applied'))));
      return el;
    };
    this.put(this.headBox, quiet, personHead(c));
    // their traffic as a device's page has it (their devices summed): the week's bars, this month, all time, the
    // speed now while they are online; the card stays across repaints, its numbers morph when they change
    if (this.traffic) this.traffic.set(personUse(p));
    else {
      this.traffic = trafficCard(personUse(p), `p:${p.id}`, p.name);
      this.put(b.use, quiet, blockHead(_('Traffic')), this.traffic.el);
    }
    this.el.setAttribute('aria-label', p.name);
    this.put(
      b.devices,
      quiet,
      head(
        'devices',
        blockHead(
          _('Devices'),
          // «3 of − 4 +»: the count, and the limit changed where it stands
          fill<string | HTMLElement>(
            _('%s of %s'),
            num(p.devices.length),
            stepper(
              {
                value: p.device_limit,
                label: _('Device limit'),
                min: Math.max(1, p.devices.length),
                max: 32,
                floorWhy: _('To lower the limit, remove a device first'),
                change: (n) => c.patch({ device_limit: String(n) }),
              },
              c.write,
            ),
          ),
        ),
      ),
      p.devices.length || c.write ? deviceGrid(c, () => void this.reload()) : h('div', { class: 'card kt-none' }, _('No devices yet')),
    );
    // the access stack: each part a card with its head inside
    this.put(b.term, quiet, part(blockHead(_('Term'), p.expires ? undefined : _('No end date')), termBlock(c)));
    this.put(b.traffic, quiet, part(head('limit', blockHead(_('Usage'), undefined, limitPeriod(c))), limitMeter(c)));
    this.put(b.reach, quiet, part(head('reach', blockHead(_('What they reach'), undefined, reachMark(c))), reachFork(c)));
    this.put(b.places, quiet, ...this.places());
    this.put(
      b.log,
      quiet,
      blockHead(_('Latest'), undefined, logLink({ person: p.id })),
      feedShort(c.st, c.events, { own: p.id, open: this.open, toggled: () => this.paint(false) }),
    );
    this.paintSpeed();
  }

  /** Where their devices are: a row a device at its newest place, with the strip of the last 7 days. */
  private places(): (Node | null)[] {
    const c = this.c;
    const st = c.st;
    if (!st.geo.enabled) return [];
    const rows = c.p.devices
      .map((d) => {
        const pt = st.geo.points.filter((x) => x.device === d.id).sort((a, b) => Number(b.online) - Number(a.online) || b.ts - a.ts)[0];
        return pt ? placeRow({ st, pt, p: c.p, d, events: c.events, range: '7d', href: deviceUrl(d.id), own: true }) : null;
      })
      .filter((r): r is HTMLElement => !!r);
    // on the map: the places' close-up over the page, all their devices or one picked in it (a new tab: the People map)
    const onMap = h(
      'a',
      {
        class: 'pill-link',
        href: placesUrl({ person: c.p.id }),
        onclick: (e: Event) => {
          if (!plain(e)) return;
          e.preventDefault();
          this.openPlaces();
        },
      },
      _('On the map'),
      ic('chevron'),
    );
    return [
      blockHead(_('Places'), _('7 days'), rows.length ? onMap : null),
      rows.length
        ? h('div', { class: 'olist pl-list kt-plist' }, ...rows)
        : h('div', { class: 'card kt-none' }, _('Their devices have not connected from a known place yet.')),
    ];
  }

  /** A new second of the meter: their speed now in the Traffic card, while a device of theirs is online. */
  private paintSpeed() {
    const c = this.c;
    if (!this.traffic) return;
    if (!c.p.online || !c.srv?.enabled) return this.traffic.speed(null);
    const s = this.meter.speed(
      c.srv.id,
      Date.now(),
      c.p.devices.map((d) => d.id),
    );
    this.traffic.speed(s.pts.length ? [s.rx, s.tx] : 'wait');
  }
}
