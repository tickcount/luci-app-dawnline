// Overview: does everything work now. The section row; the head with the
// router's state in one phrase that counts the checks and leads down to them
// (head.ts); "now" in numbers over the 30-day line (now.ts); the servers as
// cards, each the door to its people, places and settings, with who waits
// for a decision on it and its rollout in short (servers.ts); Health: the
// checks as a visible list, the one notice among them (health.ts; the
// address `?s=health`, and the old `?at=health`, brings it into view). Who
// waits for a decision is listed on their server's own Overview
// (pages/server). No server yet: the first run (first.ts). The map is
// People's, the log's excerpt the Log's.
//
// Live: the status (60 days: the line and the 30 before it) and the service log
// on the live revision, 30 s as the fallback; the Health checks in the
// background once the page is drawn and at most every 2 minutes after, never
// on the revision; the meter once a second only while the speed tile is on
// screen and a server runs (before its first answer the tile says the router's
// last minute).
//
// Drawing: the page is built once. Every answer is laid over the last one field by field
// (shared/live/doc.ts), and each region is an effect that reads what it shows (state/regions.ts): it is
// drawn again only when a field it read changed, a server's card only when that server or what its card
// read did. A region or a card holding the focus is left alone by a background repaint; the chart is drawn
// once and follows in place.
//
// Opening: every opening asks the router, and the page comes in when the status has come (shell/waiting.ts:
// the section row stands meanwhile). Health is drawn saying its checks are being read, and fills in place
// when they have come (they are asked after the status and take about as long again).

import type { HealthCheck, Status } from '../../../shared/types';
import { LiveDoc } from '../../../shared/live/doc';
import { signal } from '../../../shared/live/signal';
import { share } from '../../../shared/live/share';
import { drawn, fill, live, ownPaint, paintNow } from '../../state/regions';
import { api, type Health, type ServiceLog, type SetupDefaults } from '../../api';
import { h } from '../../../portal/dom';
import { calm } from '../../../portal/motion';
import { rateOf, todayOf } from '../../../shared/format';
import { morphText, textOf } from '../../../portal/ui/morph';
import { createPoller } from '../../state/poller';
import { LiveMeter } from '../../state/meter';
import { pollMeter } from '../../state/meterpoll';
import { routerDay } from '../../events/clock';
import { canWrite } from '../../shell/role';
import { navRow } from '../../shell/nav';
import { RATE_FRESH } from '../../overview/model';
import { firstRun } from '../settings/first';
import type { OverviewCtx } from './ctx';
import { runFix } from '../../flows/health-fix';
import { overviewHead } from './head';
import { healthSection } from './health';
import { DAYS, nowCard, type NowCard, type Speed } from './now';
import { NOW_KEY, serversSection } from './servers';
import { putChildren } from '../../../portal/ui/put';

/** Health checks cost more than a status: at most this often (ms). */
const HEALTH_EVERY = 120_000;
export interface OverviewData {
  st: Status;
  /** No server yet: what a new one would get (null for a login that cannot read it). */
  setup: SetupDefaults | null;
  sl: ServiceLog | null;
}

export class OverviewPage {
  /** The router's answer, followed field by field: what the regions read. */
  private doc = new LiveDoc<Status>();
  private st = this.doc.view;
  private sl = signal<ServiceLog | null>(null);
  private checks = signal<HealthCheck[] | null>(null);
  private checksFailed = signal(false);
  private healthAt = 0;
  private skew = 0;
  private write = canWrite();
  private headBox = h('div');
  private health = healthSection();
  private srvBox = h('section', { class: 'ov-srv' });
  private body = h('div', { class: 'ov-body' });
  private now!: NowCard;
  private meter = new LiveMeter();
  private seen = false;
  private metered = false;
  /** Each server's speed as the meter last said it (bytes/s to its devices). */
  private srvNow = new Map<string, number>();
  private page = h('div', { class: 'page overview ov' }, navRow());

  async load(): Promise<OverviewData> {
    const [st, sl, meter] = await Promise.all([
      api.status(2 * DAYS),
      api.serviceLog().catch(() => null),
      // the stream carries the meter's two minutes always: the live line is drawn with the page and comes in with
      // it, not a second later at the poller's first answer
      api.meter(0).catch(() => null),
    ]);
    if (meter?.points.length) {
      this.meter.take({ meter }, Date.now());
      this.metered = true;
    }
    return { st, sl, setup: st.servers.length ? null : await api.setupDefaults().catch(() => null) };
  }

  render(d: OverviewData): HTMLElement {
    const page = this.page;
    if (!d.st.servers.length) {
      this.firstRun(d.setup);
      return page;
    }
    this.take(d.st, d.sl);
    const c = this.ctx();
    this.now = nowCard(c);
    // «now» in numbers, then the servers (each the door to its people, places and settings), then Health (the
    // owner's order, 2026-11-11)
    this.body.append(h('div', { class: 'ov-now' }, this.now.el), this.srvBox, this.health.el);
    page.append(this.headBox, this.body);
    // each region follows what it reads
    fill(this.headBox, () => overviewHead(c, () => this.toHealth()));
    drawn(this.health.el, () => this.health.update(c, !ownPaint()));
    live(() => this.now.update(c));
    serversSection(c, this.srvBox);
    this.speed(true);
    // drawn whole before it comes in
    paintNow();
    createPoller({
      fetch: () => this.fetch(),
      every: 30,
      live: true,
      active: () => page.isConnected,
      apply: ([st, sl], quiet) => this.land(st, sl, quiet),
    });
    // the Health checks after the page is drawn: they take a moment on the router
    void this.runHealth(true);
    // the meter is read while a speed is on screen: the tile's, or a server's «Now» on its card
    const inView = new Set<Element>();
    const watch = new IntersectionObserver((es) => {
      for (const e of es) inView[e.isIntersecting ? 'add' : 'delete'](e.target);
      this.seen = inView.size > 0;
    });
    watch.observe(this.now.tile);
    watch.observe(this.srvBox);
    pollMeter(
      this.meter,
      () => page.isConnected && this.seen && this.st.servers.some((s) => s.enabled && s.up),
      () => {
        this.metered = true;
        this.speed();
      },
    );
    const q = new URLSearchParams(location.search);
    if (q.get('s') === 'health' || q.get('at') === 'health') requestAnimationFrame(() => this.health.el.scrollIntoView({ block: 'start' }));
    return page;
  }

  private async fetch(): Promise<[Status, ServiceLog | null]> {
    const [st, sl] = await Promise.all([api.status(2 * DAYS), api.serviceLog().catch(() => this.sl.peek())]);
    if (Date.now() - this.healthAt > HEALTH_EVERY) void this.runHealth(true);
    return [st, sl];
  }

  /** No server on the router (yet): the first run's page in this one's place. */
  private firstRun(setup: SetupDefaults | null) {
    this.page.classList.remove('ov');
    putChildren(this.page, [navRow(), firstRun(setup, this.write)]);
  }

  /** A status from the router: drawn in place. */
  private land(st: Status, sl: ServiceLog | null, quiet: boolean) {
    // the last server was removed: the page as it is now (the first run's)
    if (!st.servers.length) return void (location.href = location.pathname);
    this.take(st, sl);
    paintNow(!quiet);
  }

  /** Run the Health checks and say what they found; `quiet`: in the background (asked for here: at once). */
  private async runHealth(quiet: boolean) {
    this.healthAt = Date.now();
    const r = await api.health().catch(() => null);
    this.checksFailed.set(!r);
    if (r) this.tookHealth(r, quiet);
    else paintNow(!quiet);
  }

  /** The checks' answer (a run, or a fix): it brings the watchdog and the service log too. */
  private tookHealth(r: Health, quiet: boolean) {
    this.checks.set(share(this.checks.peek(), r.checks));
    this.checksFailed.set(false);
    this.healthAt = Date.now();
    this.sl.set(share(this.sl.peek(), { watchdog: r.watchdog, log: r.log }));
    paintNow(!quiet);
  }

  private async reload() {
    const r = await this.fetch().catch(() => null);
    if (!r) return;
    this.take(...r);
    paintNow(true);
  }

  /** An answer from the router: laid over the last one, so only what changed tells its readers. */
  private take(st: Status, sl: ServiceLog | null) {
    this.doc.feed(st);
    // the same lines again are the same object: nobody who read them is told
    this.sl.set(share(this.sl.peek(), sl));
    this.skew = st.now - Date.now() / 1000;
  }

  /** What the parts read, made once: its fields are the page's signals, read as plain values. */
  private ctx(): OverviewCtx {
    const { st, checks, checksFailed, sl } = this;
    const now = () => Date.now() / 1000 + this.skew;
    return {
      st,
      get checks() {
        return checks();
      },
      get checksFailed() {
        return checksFailed();
      },
      get sl() {
        return sl();
      },
      write: this.write,
      now,
      speedOf: (id) => this.srvNow.get(id) ?? null,
      today: () => ({ now: now(), today: todayOf(st.series) || routerDay(now(), st.tz) }),
      reload: () => this.reload(),
      recheck: () => this.runHealth(false),
      fix: (fix) =>
        runFix(fix, {
          took: (r) => this.tookHealth(r, false),
          again: () => {
            void this.runHealth(false);
            void this.reload();
          },
        }),
    };
  }

  /** Bring the checks into view (the head's phrase). */
  private toHealth() {
    this.health.el.scrollIntoView({ block: 'start', behavior: calm() ? 'auto' : 'smooth' });
  }

  /** The speed tile: the meter's once it answers, before that the router's last minute (status), else why none. */
  private speed(atOnce = false) {
    const st = this.st;
    const running = st.servers.filter((s) => s.enabled && s.up);
    const ms = Date.now();
    const on = st.people.filter((p) => p.online > 0);
    let s: Speed;
    if (!running.length) s = { down: 0, up: 0, top: [], line: [], why: _('No server is running') };
    else if (this.metered) {
      const all = this.meter.speed(null, ms);
      const top = on
        .map((p) => {
          const v = this.meter.speed(
            null,
            ms,
            p.devices.map((d) => d.id),
          );
          return { p, v: v.rx + v.tx };
        })
        .filter((x) => x.v > 0)
        .sort((a, b) => b.v - a.v)
        .slice(0, 2);
      s = all.error
        ? { down: 0, up: 0, top: [], line: [], why: all.error }
        : { down: all.tx, up: all.rx, top, line: all.pts.map((p) => p[2]) };
    } else {
      // the last minute the agent measured, per server and per person
      const last = (r: [number, number, number][] | undefined) => {
        const p = r?.[r.length - 1];
        return p && st.now - p[0] < RATE_FRESH ? p : null;
      };
      let down = 0;
      let up = 0;
      for (const srv of running) {
        const p = last(srv.rate);
        if (p) {
          up += p[1];
          down += p[2];
        }
      }
      const top = on
        .map((p) => {
          const r = last(p.rate);
          return { p, v: r ? r[1] + r[2] : 0 };
        })
        .filter((x) => x.v > 0)
        .sort((a, b) => b.v - a.v)
        .slice(0, 2);
      s = { down, up, top, line: [] };
    }
    if (this.now.speed(s, atOnce) && this.metered) this.serverSpeeds(running, ms);
  }

  /**
   * Each running server's «Now» on its card, as the meter reads it: its words change with the tile's (the same
   * second, every third: they are the mean of those three, so one server's says what the tile says), and morph
   * where they stand. A card drawn again says the same.
   */
  private serverSpeeds(running: Status['servers'], ms: number) {
    for (const srv of running) {
      const v = this.meter.speed(srv.id, ms);
      if (v.pts.length && !v.error) this.srvNow.set(srv.id, v.tx);
    }
    for (const el of this.srvBox.querySelectorAll<HTMLElement>(`[data-t^="${NOW_KEY}"]`)) {
      const v = this.srvNow.get(el.dataset.t!.slice(NOW_KEY.length));
      if (v == null) continue;
      const text = `↓ ${rateOf(v)}`;
      if (textOf(el) !== text) morphText(el, text);
    }
  }
}
