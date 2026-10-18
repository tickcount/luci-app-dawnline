// Person page (admin/network/dawnline/person?id=…): devices as cards,
// locations, activity, and access & limits that apply immediately.
// The parts live in ./header, ./devices, ./limits, ./pickers, ./activity and
// ./dialogs; this class holds the state, the poller and the edits.

import type { DayUsage, LogEvent, Person, Status } from '../../../shared/types';
import { E } from '../../e';
import { api, type PersonPatch } from '../../api';
import { attempt } from '../../ui/toast';
import { todayOf } from '../../../shared/format';
import { ConnectionMap } from '../../map';
import { peopleUrl } from '../../urls';
import { addDevice, openDevice, type DeviceOpts } from '../../device';
import { coreFor, type Core } from '../../cores';
import { createPoller, repaint, type Poller } from '../../state/poller';
import { headPart, trafficPart } from './header';
import { devicesPart } from './devices';
import { limitsPart } from './limits';
import { activityPart, placesPart } from './activity';

type Part = 'head' | 'devices' | 'traffic' | 'places' | 'activity' | 'limits';

interface Loaded {
  st: Status;
  ev: LogEvent[] | null;
  use: { person: DayUsage[]; devices: Record<string, DayUsage[]> } | null;
}

export class PersonPage {
  st!: Status;
  id = '';
  p!: Person;
  events: LogEvent[] = [];
  /** The map stays folded into one line until asked for. */
  mapOpen = false;
  map: ConnectionMap | null = null;
  parts = {} as Record<Part, HTMLElement>;
  /** Daily traffic for the last 30 days. */
  series: DayUsage[] = [];
  /** The same per device. */
  devSeries: Record<string, DayUsage[]> = {};
  poller?: Poller<Loaded>;
  /** Status every 15 s; the log and the traffic history every fourth time (and after a change). */
  private ticks = 0;
  private fullNext = false;

  /** Status, and (`full`) the activity log and traffic history. */
  async fetch(full: boolean): Promise<Loaded> {
    const [st, ev, use] = await Promise.all([
      api.status(30),
      full ? api.events(5000).catch(() => null) : Promise.resolve(null),
      full ? api.personUsage(this.id, 30).catch(() => null) : Promise.resolve(null),
    ]);
    return { st, ev: ev?.events ?? null, use };
  }

  async load(): Promise<Loaded> {
    this.id = new URLSearchParams(location.search).get('id') ?? '';
    return this.fetch(true);
  }

  render(d: Loaded): HTMLElement {
    this.take(d);
    const p = this.st.people.find((x) => x.id === this.id);
    if (!p)
      return E('div', { class: 'dl-empty' }, [
        E('h3', {}, 'Person not found'),
        E('p', {}, 'They may have been removed.'),
        E('a', { class: 'cbi-button', href: L.url('admin/network/dawnline/server') }, 'Back to Servers'),
      ]);
    this.p = p;
    for (const k of ['head', 'devices', 'traffic', 'places', 'activity', 'limits'] as Part[]) this.parts[k] = E('div', {});
    this.parts.devices.className = 'dl-person-devices';
    const root = E('div', {}, [
      E('nav', { class: 'dl-crumbs', 'aria-label': 'Breadcrumb' }, [
        E('a', { href: peopleUrl(p.server) }, this.st.servers.find((x) => x.id === p.server)?.name ?? 'Servers'),
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
    const dev = q.get('device') && p.devices.find((x) => x.id === q.get('device'));
    if (dev) setTimeout(() => openDevice(this.p, dev, this.deviceOpts()), 50);
    else if (q.get('add')) setTimeout(() => addDevice(this.p, this.deviceOpts()), 50);
    this.poller = createPoller({
      // The activity log comes with every fourth tick, and whenever something just happened.
      fetch: (live) => {
        const full = live || this.fullNext || ++this.ticks % 4 === 0;
        this.fullNext = false;
        return this.fetch(full);
      },
      every: 15,
      live: true,
      active: () => root.isConnected,
      apply: (data, quiet) => this.apply(data, quiet),
    });
    return root;
  }

  private take(d: Loaded) {
    this.st = d.st;
    if (d.ev) this.events = d.ev;
    if (d.use) {
      this.series = d.use.person;
      this.devSeries = d.use.devices;
    }
  }

  private apply(d: Loaded, quiet: boolean) {
    this.take(d);
    const p = this.st.people.find((x) => x.id === this.id);
    if (!p) {
      if (!quiet) location.href = peopleUrl(this.p?.server);
      return;
    }
    this.p = p;
    this.paint(quiet);
    this.map?.update(this.mapData());
  }

  /** Everything again, the log and traffic too (after a change). Newest answer wins. */
  async refresh() {
    this.fullNext = true;
    await this.poller?.refresh();
  }

  /**
   * Apply a change now and repaint from the router's answer. Answers of
   * refreshes already on their way are dropped, so they can't paint the old state over it.
   */
  /** Save a change; true when the router took it (a refusal is already a toast). */
  async patch(patch: PersonPatch, ok?: string): Promise<boolean> {
    this.poller?.claim();
    const r = await attempt(() => api.personUpdate(this.p.id, patch), ok);
    if (!r) return false;
    this.poller?.claim();
    const i = this.st.people.findIndex((x) => x.id === this.p.id);
    r.person.rate ??= this.p.rate;
    if (i >= 0) this.st.people[i] = r.person;
    this.p = r.person;
    this.paint();
    return true;
  }

  /** Today on the router (the last day of its traffic series). */
  get today(): string {
    return todayOf(this.series.length ? this.series : this.st.series);
  }

  get core(): Core {
    return coreFor(this.st.servers, this.p.server);
  }

  /** What a device drawer opened from here gets: this page's log, clock and core. */
  deviceOpts(): DeviceOpts {
    return {
      refresh: () => this.refresh(),
      geo: this.st.geo,
      now: this.st.now,
      today: this.today,
      core: this.core,
      events: () => this.events,
    };
  }

  mapData() {
    return { geo: this.st.geo, people: this.st.people, now: this.st.now, person: this.p.id };
  }

  /** Every part; a `quiet` (periodic) repaint leaves alone the parts that have the keyboard focus. */
  paint(quiet = false) {
    repaint(this.parts.head, headPart(this), quiet);
    repaint(this.parts.traffic, trafficPart(this), quiet);
    repaint(this.parts.devices, devicesPart(this), quiet);
    repaint(this.parts.limits, limitsPart(this), quiet);
    this.paintPlaces(quiet);
    repaint(this.parts.activity, activityPart(this), quiet);
  }

  paintPlaces(quiet = false) {
    const el = placesPart(this);
    // A new map card always goes in (the map instance is made with it).
    if (el) repaint(this.parts.places, el, quiet && !this.mapOpen);
  }
}
