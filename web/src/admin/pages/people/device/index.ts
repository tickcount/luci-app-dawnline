// A device as a panel (people?device=; it takes its person's panel's place, the way back returns to them). First
// what works and what does not, exactly as before: the Connection card (the portal's way between the device and the
// router, the link timeline for 24 h / 7 days / 30 days, the brief diagnosis with its fix: link.ts,
// widgets/timeline.ts) and the Traffic tiles (traffic.ts, with the live speed). Then its set-up as a card
// (widgets/config-card.ts), its places as the close-up's rows with strips (the close-up itself one press away) and
// its latest events. ?sheet=setup opens its set-up on arrival (a device just added elsewhere), ?sheet=places its
// places' close-up.
//
// Live: the status comes from the page; its and its person's events (after the newest it has) and the service log
// are read on opening, with every status the page takes and after a change made here; the meter once a second
// only while it is online and the panel is in the page. A part holding the focus is left alone by a background
// repaint.

import { grown } from '../../../../portal/ui/grown';
import { refill } from '../../../ui/reshape';
import type { ClientConfig, LogEvent } from '../../../../shared/types';
import { api, type DeviceLinkPatch, type ServiceLogEntry } from '../../../api';
import { h } from '../../../../portal/dom';
import { openMenu } from '../../../../portal/ui/menu';
import { go, openSheet, sheetOpen } from '../../../../portal/ui/sheet';
import { DEVICE_NAME_MAX, kindLabel, todayOf } from '../../../../shared/format';
import { fmt, locale } from '../../../../shared/i18n';
import { deviceNameHelp } from '../../../netcheck';
import { glass } from '../../../ui/glass';
import { ic } from '../../../ui/icons';
import { blockHead, fact, knob, pageHead } from '../../../ui/page-head';
import { pageBar } from '../../../ui/subpage';
import { copyText } from '../../../ui/files';
import { errorText, notify } from '../../../ui/toast';
import { focusInside, type Poller } from '../../../state/poller';
import { LiveMeter } from '../../../state/meter';
import { pollMeter } from '../../../state/meterpoll';
import { briefDiagnosis, deviceLine, diagnose, otherNetAdvice, type Fix } from '../../../people/diagnosis';
import { endpointHost } from '../../../people/find';
import { listOf } from '../../../people/route';
import type { DeviceCtx } from '../../../people/ctx';
import { linkTimeline, type TimelineInput } from '../../../events/timeline';
import { timelineWidget, type TimelineWidget } from '../../../widgets/timeline';
import { configCard, setupHead } from '../../../widgets/config-card';
import { devicePlaces, type DevicePlaces } from '../../../widgets/place-rows';
import { feedShort, logLink } from '../../../widgets/feed';
import { routerDay } from '../../../events/clock';
import { say } from '../../../shell/toast';
import { peopleAt, settingsUrl } from '../../../shell/routes';
import { visit } from '../../../shell/visit';
import { askView } from '../../../flows/ask';
import { removeDevice, resetDeviceTraffic, toggleDevice, type DeviceActCtx } from '../../../flows/device-acts';
import { setupView, showSetup, type SetupCtx } from '../../../flows/setup';
import { addDevice } from '../../../flows/add-device';
import { newKeys } from '../../../flows/new-keys';
import { textSheet } from '../../../flows/text-sheet';
import { openCloseUp } from '../../../flows/places-closeup';
import type { PeopleHost } from '../host';
import { diagnosisEl, wayEl } from './link';
import { trafficCard, type TrafficCard } from './traffic';
import { putChildren } from '../../../../portal/ui/put';

const LIMIT = 5000;
/** For this long after it is made a panel settles: what lands meanwhile is not a repaint, the panel is still coming in (ms). */
const SETTLES = 2500;
const DAYS30 = 30 * 86400;

export class DevicePanel {
  readonly kind = 'device';
  el = h('article', { class: 'kt-panel pp-device' });
  private c!: DeviceCtx;
  private events: LogEvent[] = [];
  private system: ServiceLogEntry[] = [];
  private cfg: ClientConfig | null = null;
  private gone = false;
  /** Reading again after a change made here: the status that comes meanwhile is drawn with the events, once. */
  private batching = false;
  private okay: boolean;
  private headBox = h('div', { class: 'kt-phead' });
  private linkBox = h('div', { class: 'card link' });
  private trafficBox = h('div');
  private confBox = h('section', { class: 'kt-b b-conf' });
  private placesBox = h('section', { class: 'kt-b b-places' });
  private logBox = h('section', { class: 'kt-b b-log' });
  private wayKey = '';
  private tl: TimelineWidget | null = null;
  private traffic: TrafficCard | null = null;
  private places: DevicePlaces | null = null;
  /**
   * Its log, its configuration and its places' rows have been read: nothing more lands in it by itself. A dialog
   * waits for this to open whole (pages/server/device-dialog.ts).
   */
  ready: Promise<void> = Promise.resolve();
  /** When the panel was made: it settles for a while after (paint). */
  private born = performance.now();
  private meter = new LiveMeter();
  private poll: Poller<unknown>;
  private open = new Set<string>();

  constructor(
    readonly id: string,
    private host: PeopleHost,
    close: () => void,
  ) {
    const ok = (this.okay = this.take());
    const p = this.c?.p;
    this.el.append(
      pageBar({ back: p?.name ?? _('People'), to: peopleAt({ ...listOf(host.route()), id: p?.id }), close }),
      this.headBox,
      h(
        'div',
        { class: 'kt-blocks' },
        h('section', { class: 'kt-b b-link' }, blockHead(_('Connection', 'section')), this.linkBox),
        h('section', { class: 'kt-b b-traffic' }, blockHead(_('Traffic')), this.trafficBox),
        this.confBox,
        this.placesBox,
        this.logBox,
      ),
    );
    if (ok) {
      this.paint(false);
      // read once, and the places' rows in: it can be shown whole then (a failure of either is no reason to wait on)
      this.ready = Promise.allSettled([this.load(false), this.places?.ready]).then(() => undefined);
    }
    this.poll = pollMeter(
      this.meter,
      () => ok && this.el.isConnected && !this.gone && this.c.d.online,
      () => this.paintSpeed(),
    );
  }

  /** What the address asks to open on arrival: its set-up, its places' close-up. */
  arrive(_s?: string, sheet?: string) {
    if (!this.okay) return;
    if (sheet === 'setup' && this.c.write) void this.showSetup();
    else if (sheet === 'places') this.openPlaces();
  }

  /** The person it belongs to (the list marks them). */
  get person(): string | undefined {
    return this.c?.p.id;
  }

  destroy() {
    this.gone = true;
    this.poll.stop();
  }

  private take(): boolean {
    const st = this.host.st();
    const p = st.people.find((x) => x.devices.some((d) => d.id === this.id));
    const d = p?.devices.find((x) => x.id === this.id);
    if (!p || !d) return false;
    this.c = {
      st,
      p,
      d,
      srv: st.servers.find((s) => s.id === p.server),
      events: this.events,
      system: this.system,
      cfg: this.cfg,
      write: this.host.write,
      now: this.host.now,
      refresh: () => this.reload(),
    };
    return true;
  }

  /** Its and its person's events (after the newest it has when `live`), the service log and, once, its configuration. */
  private async load(live: boolean) {
    const st = this.host.st();
    const p = this.c.p;
    const newest = this.events.length ? this.events[this.events.length - 1].ts : 0;
    const since = live && newest ? newest - 1 : st.now - DAYS30 - 1;
    const [a, b, sys, cfg] = await Promise.all([
      api.events(LIMIT, undefined, since, this.id).then(
        (r) => r.events,
        () => [] as LogEvent[],
      ),
      api.events(LIMIT, p.id, since).then(
        (r) => r.events,
        () => [] as LogEvent[],
      ),
      api.serviceLog().then(
        (s) => s.log,
        () => this.system,
      ),
      this.host.write && !this.cfg ? api.deviceConfig(this.id).catch(() => null) : Promise.resolve(this.cfg),
    ]);
    if (this.gone) return;
    const fresh = merge(a, b);
    this.events = (live && newest ? merge(this.events, fresh) : fresh).filter((e) => e.ts >= st.now - DAYS30);
    this.system = sys;
    this.cfg = cfg;
    if (!this.take()) return;
    this.paint(live);
  }

  /** Read everything again now (after a change made here). */
  private async reload() {
    // one repaint for the change: the page's new status is taken in, drawn once its events are read too
    this.batching = true;
    try {
      await this.host.reload();
    } finally {
      this.batching = false;
    }
    if (this.okay) await this.load(false);
  }

  /** A new status from the page; `quiet`: a periodic one (drawn once, with its new events). */
  fresh(quiet: boolean) {
    if (!this.okay || !this.take() || this.batching) return;
    if (quiet) void this.load(true);
    else this.paint(false);
  }

  private clock() {
    const c = this.c;
    return { now: c.now(), today: todayOf(c.st.series) || routerDay(c.now(), c.st.tz), tz: c.st.tz };
  }

  /**
   * Draw the panel. While it settles (its first seconds: its log, its configuration and the service log land one
   * after another, a moment after it stood) a block that is another height for what landed goes there from the
   * one it has (ui/reshape.ts grown), and a dialog follows: not a jump (the owner, 2026-11-12: «модалка все ещё
   * снапает»: it grew 148 px in one frame while still opening), no fade of blocks that stood there already, and
   * each landing takes the block on from where the last one left it. After that a reading is drawn in place.
   */
  private paint(quiet: boolean) {
    if (performance.now() - this.born > SETTLES) return this.draw(quiet);
    const blocks = [this.confBox, this.logBox, this.placesBox];
    const was = blocks.map((b) => b.offsetHeight);
    this.draw(quiet);
    blocks.forEach((b, i) => grown(b, was[i]));
  }

  private draw(quiet: boolean) {
    const c = this.c;
    const steps = diagnose(c.d, c.p, c.srv, this.clock());
    const brief = briefDiagnosis(steps);
    const fixShows = brief.some((s) => s.fix?.includes('show'));
    if (!quiet || !focusInside(this.headBox)) refill(this.headBox, [this.head(fixShows)]);
    this.el.setAttribute('aria-label', `${c.d.name} · ${c.p.name}`);
    this.paintLink(steps, brief, quiet);
    // the card stays across repaints: its numbers morph when they change
    if (this.traffic) this.traffic.set(c.d);
    else {
      this.traffic = trafficCard(c.d, `t:${c.d.id}`, c.d.name);
      putChildren(this.trafficBox, [this.traffic.el]);
    }
    this.paintSpeed();
    if (!quiet || !focusInside(this.confBox))
      refill(this.confBox, [
        setupHead(c),
        h('div', { class: 'card kt-confcard' }, configCard(c, { change: (w, v, p) => this.change(w, v, p) })),
      ]);
    if (c.st.geo.enabled) {
      if (!this.places) {
        this.places = devicePlaces(c.st, c.p, c.d, this.events.length ? this.events.filter((e) => e.device === c.d.id) : null);
        putChildren(this.placesBox, [
          blockHead(_('Places'), undefined, this.places.range),
          h('div', { class: 'card pp-plcard' }, this.places.el),
        ]);
      } else
        this.places.update(
          c.st,
          c.p,
          c.d,
          this.events.filter((e) => e.device === c.d.id),
        );
    }
    refill(this.logBox, [
      blockHead(_('Latest'), undefined, logLink({ device: c.d.id })),
      feedShort(c.st, c.events, { own: c.p.id, device: c.d.id, open: this.open, toggled: () => this.paint(false) }),
    ]);
  }

  /** pages/device/index.ts head(), in the panel. */
  private head(fixShows: boolean): HTMLElement {
    const { d, p } = this.c;
    const line = deviceLine(d, p, this.clock());
    const ip = endpointHost(d.endpoint);
    const added = new Date(d.created * 1000).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
    const acts: HTMLElement[] = [];
    if (this.c.write) {
      if (!fixShows)
        acts.push(
          h(
            'button',
            { type: 'button', class: 'btn soft', onclick: () => void this.showSetup() },
            ic('qr'),
            h('span', {}, _('Show set-up')),
          ),
        );
      const more = knob('more', _('Set-up, rename, turn off, reset traffic, new keys, remove'));
      more.setAttribute('aria-haspopup', 'menu');
      more.addEventListener('click', () => this.menu(more));
      acts.push(more);
    }
    const head = pageHead({ icon: glass(d.kind, d.online ? 'blue' : 'grey'), title: d.name, acts });
    const facts = [
      fact(h('span', { class: `ph-state ${line.tone ? `${line.tone}-t` : ''}`, title: line.why ?? null }, line.text)),
      fact(kindLabel(d.kind)),
      ip
        ? fact(h('span', { class: 'mono' }, ip.length > 24 ? `${ip.slice(0, 10)}…${ip.slice(-10)}` : ip), {
            title: fmt(_('Client IP: where its last connection came from · %s'), ip),
          })
        : null,
      fact(d.created_by === 'portal' ? fmt(_('added on the portal %s'), added) : fmt(_('added by you %s'), added)),
      this.c.write ? null : fact([ic('eye'), _('View only')]),
    ];
    head.querySelector('.ph-sub')?.replaceChildren(...facts.filter((f): f is HTMLElement => !!f));
    return head;
  }

  private paintLink(steps: ReturnType<typeof diagnose>, brief: ReturnType<typeof briefDiagnosis>, quiet: boolean) {
    if (quiet && focusInside(this.linkBox)) return;
    const c = this.c;
    const input: TimelineInput = { device: c.d, person: c.p, server: c.srv, events: c.events, system: c.system, now: c.now(), tz: c.st.tz };
    const t = linkTimeline(input);
    const way = wayEl(c, steps);
    const key = way.outerHTML;
    const diag = brief.length ? diagnosisEl(c, brief, (f, from) => void this.fix(f, from)) : null;
    if (!this.tl) {
      this.tl = timelineWidget(input, t);
      putChildren(this.linkBox, [way, this.tl.el, ...(diag ? [diag] : [])]);
    } else {
      this.tl.update(input, t);
      // a new way, the diagnosis coming, going or changing: they change in place, the timeline kept as it is, and
      // the card glides to its new height (ui/reshape.ts)
      const old = this.linkBox.querySelector(':scope > .dg');
      if (key !== this.wayKey || old?.outerHTML !== diag?.outerHTML) refill(this.linkBox, [way, this.tl.el, ...(diag ? [diag] : [])]);
    }
    this.wayKey = key;
  }

  private paintSpeed() {
    const c = this.c;
    if (!this.traffic) return;
    if (!c.d.online || !c.srv) return this.traffic.speed(null);
    const s = this.meter.speed(c.srv.id, Date.now(), [c.d.id]);
    this.traffic.speed(s.pts.length ? [s.rx, s.tx] : 'wait');
  }

  /* ---------- actions (pages/device/index.ts) ---------- */

  private setupCtx(): SetupCtx {
    return {
      person: this.c.p,
      device: this.c.d,
      now: this.c.now,
      fresh: (st) => this.host.take(st),
      done: () => void this.reload(),
    };
  }

  async showSetup() {
    await showSetup(this.setupCtx());
    void this.reload();
  }

  openPlaces() {
    if (this.c.st.geo.enabled) openCloseUp(this.id, this.c.st);
  }

  private change(what: string, value: string, patch: DeviceLinkPatch): Promise<boolean> {
    const d = this.c.d;
    const save = () => api.deviceUpdate(this.id, undefined, undefined, patch);
    if (!d.handshake || d.disabled)
      return save().then(
        () => {
          say(fmt(_('%s: %s'), what, value));
          void this.reload();
          return true;
        },
        (e) => {
          notify(errorText(e), 'error', 10000);
          return false;
        },
      );
    return new Promise((res) => {
      let took = false;
      openSheet(() =>
        askView({
          icon: 'refresh',
          tone: 'orange',
          title: fmt(_('%s · %s: %s?'), d.name, what, value),
          text: [
            _('The device’s configuration changes. Until the new one is fetched on it, it works the old way. The new one opens next.'),
          ],
          action: _('Change'),
          cls: 'warn',
          run: async () => {
            await save();
            took = true;
            res(true);
            const cfg = await api.deviceConfig(this.id);
            void this.reload();
            go(() => setupView(this.setupCtx(), cfg, 'top'));
          },
        }),
      );
      const watch = window.setInterval(() => {
        if (took) return clearInterval(watch);
        if (!sheetOpen()) {
          clearInterval(watch);
          res(false);
        }
      }, 300);
    });
  }

  private async fix(f: Fix, from: HTMLButtonElement) {
    const { d, p } = this.c;
    switch (f) {
      case 'show':
        return this.showSetup();
      case 'resume':
        try {
          from.disabled = true;
          await api.personPause(p.id, false);
          say(fmt(_('%s: access resumed'), p.name));
          await this.reload();
        } catch (e) {
          notify(errorText(e), 'error', 10000);
        } finally {
          from.disabled = false;
        }
        return;
      case 'person':
        return this.host.go({ ...listOf(this.host.route()), id: p.id });
      case 'server':
        return visit(settingsUrl(undefined, p.server));
      case 'device-on':
        return toggleDevice(this.deviceActs(), false);
      case 'tell':
        void copyText(otherNetAdvice(d), _('Advice copied: send it to them'));
        return;
      case 'add-device':
        addDevice({
          person: p,
          server: this.c.srv,
          now: this.c.now,
          added: () => void this.reload(),
          people: this.c.st.people,
          servers: this.c.st.servers,
        });
        return;
    }
  }

  private deviceActs(): DeviceActCtx {
    return {
      device: this.c.d,
      reload: () => void this.reload(),
      // its person's panel takes its place (the entry of a device that is no more is not kept)
      removed: () => {
        const id = this.c.p.id;
        void this.host.reload().then(() => this.host.go({ ...listOf(this.host.route()), id }, 'replace'));
      },
    };
  }

  /** Its name, typed in a sheet (the router's rule for a device's name; one name once per person). */
  private rename() {
    const { d, p } = this.c;
    textSheet({
      title: _('Rename'),
      value: d.name,
      placeholder: _('Name'),
      max: DEVICE_NAME_MAX,
      refuse: (v) => {
        const r = deviceNameHelp(
          v,
          p.devices.filter((x) => x.id !== d.id).map((x) => x.name),
        );
        return r.bad ? r.text : null;
      },
      save: async (v) => {
        if (v === d.name) return;
        await api.deviceUpdate(this.id, v);
        say(fmt(_('Renamed: %s'), v));
        void this.reload();
      },
    });
  }

  private menu(anchor: HTMLElement) {
    const { d, p } = this.c;
    openMenu(
      anchor,
      [
        // calm to grave: what only shows it; its name; what resets something of it; what stops it: off in warn,
        // then Remove, last
        { label: _('Show set-up'), icon: 'qr', run: () => void this.showSetup() },
        null,
        { label: _('Rename'), icon: 'edit', run: () => this.rename() },
        null,
        { label: _('Reset traffic'), icon: 'reset', run: () => resetDeviceTraffic(this.deviceActs()) },
        {
          label: _('New keys'),
          icon: 'key',
          run: () =>
            newKeys({
              person: p,
              device: d,
              server: this.c.srv,
              now: this.c.now,
              made: () => void this.reload(),
              setup: { done: () => void this.reload() },
            }),
        },
        null,
        d.disabled
          ? { label: _('Turn on'), icon: 'play', run: () => void toggleDevice(this.deviceActs(), false) }
          : { label: _('Turn off'), icon: 'pause', tone: 'warn', run: () => void toggleDevice(this.deviceActs(), true) },
        { label: _('Remove'), icon: 'trash', tone: 'bad', run: () => removeDevice(this.deviceActs()) },
      ],
      d.name,
    );
  }
}

/** Two event lists as one, oldest first, without the ones both have. */
function merge(a: LogEvent[], b: LogEvent[]): LogEvent[] {
  const key = (e: LogEvent) => `${e.ts}|${e.type}|${e.device ?? ''}|${e.person ?? ''}|${e.detail ?? ''}`;
  const seen = new Set<string>();
  return [...a, ...b]
    .filter((e) => {
      const k = key(e);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((x, y) => x.ts - y.ts);
}
