// The live meter as a page keeps it (rpc meter, polled once a second while a
// speed is on screen): the answers merged into the last two minutes, and the
// router's part of them (every server), one server's, or one person's devices,
// for Speed now. No DOM and no RPC here: the poller is the page's
// (state/meterpoll.ts).

import type { Meter, MeterPoint } from '../api';

/** [ts, rx, tx] in bytes/s, as Server.rate: rx = from the devices, tx = to them. */
type Rate = [number, number, number];

/** One call's outcome: the meter, or why there is none. */
export type MeterAnswer = { meter: Meter } | { error: string };

/** Page milliseconds after the last answer when what is kept stops counting as live: the next call asks for everything again. */
const STALE_MS = 5000;
/** Router seconds the newest point is "now": an agent that stopped leaves its last one behind. */
const FRESH_S = 5;
/**
 * Seconds the speed's words stand for: a page says them every third second, so they are the mean of those three.
 * One second alone reads «0 B/s» between two bursts of a device that is moving traffic.
 */
const SAID_S = 3;
/** Failed calls in a row before the tile says so (one may just be slow). */
const LOST_AFTER = 3;
/**
 * Answers with no points before the tile says it is collecting: the first call of a look finds none, and the
 * router writes out the two minutes it kept within a second.
 */
const EARLY = 3;

/** One server's live speed, ready for the tile. */
export interface LiveSpeed {
  /** Its points, oldest first. */
  pts: Rate[];
  /** Where each one sits across the chart: 1 is the newest point the meter has, 0 two minutes before it. */
  xs: number[];
  /** Bytes/s now: the mean of its newest seconds (SAID_S) while the newest is fresh, else 0. */
  rx: number;
  tx: number;
  /** Why the meter could not be read, once that happened a few times in a row; null otherwise. */
  error: string | null;
  /** No points yet, a moment after asking: the router is writing out what it kept (the tile waits without words). */
  early: boolean;
}

export class LiveMeter {
  private points: MeterPoint[] = [];
  /** Page clock (ms) of the last answer. */
  private at = 0;
  /** Router clock of the last answer. */
  private now = 0;
  private keep = 120;
  private failed = 0;
  private error = '';
  /** Answers in a row that left nothing kept. */
  private empty = 0;

  /** Still live at page time `ms`: kept points from an answer a moment ago. */
  private live(ms: number): boolean {
    return this.points.length > 0 && ms - this.at < STALE_MS;
  }

  /** What to ask for: the points after the newest one kept, or all of them (0) when nothing live is kept. */
  since(ms: number): number {
    return this.live(ms) ? this.points[this.points.length - 1].ts : 0;
  }

  /** An answer at page time `ms`: new points appended, those over two minutes behind the newest dropped. */
  take(r: MeterAnswer, ms: number): void {
    if ('error' in r) {
      this.failed++;
      this.error = r.error;
      return;
    }
    const m = r.meter;
    let kept = this.live(ms) ? this.points : [];
    // The router's clock went back: its points are now behind what is kept, and asking for those after the newest
    // kept would never bring them. Start over: the next call asks for everything.
    if (kept.length && m.ts > 0 && m.ts < kept[kept.length - 1].ts) kept = [];
    const last = kept.length ? kept[kept.length - 1].ts : 0;
    const all = [...kept, ...m.points.filter((p) => p.ts > last)];
    this.keep = m.keep > 1 ? m.keep : 120;
    const end = all.length ? all[all.length - 1].ts : 0;
    this.points = all.filter((p) => p.ts > end - this.keep);
    this.empty = this.points.length ? 0 : this.empty + 1;
    this.at = ms;
    this.now = m.now;
    this.failed = 0;
    this.error = '';
  }

  /**
   * Server `id`'s points at page time `ms` (none once they are not live), placed against the meter's newest point;
   * `id` null: every server's added up (the router's speed); with `devices`, only theirs added up (a person's speed).
   */
  speed(id: string | null, ms: number, devices?: string[]): LiveSpeed {
    const error = this.failed >= LOST_AFTER ? this.error : null;
    const live = this.live(ms) ? this.points : [];
    const sum = (p: MeterPoint): Rate => {
      if (id === null && !devices) {
        const r: Rate = [p.ts, 0, 0];
        for (const v of Object.values(p.servers)) {
          r[1] += v[0];
          r[2] += v[1];
        }
        return r;
      }
      if (!devices) return [p.ts, p.servers[id!][0], p.servers[id!][1]];
      const r: Rate = [p.ts, 0, 0];
      for (const d of devices) {
        const v = p.dev?.[d];
        if (!v) continue;
        r[1] += v[0];
        r[2] += v[1];
      }
      return r;
    };
    // A second its tunnel was not read has no point of its own (none of them: the router's).
    const read = (p: MeterPoint) => (id === null ? Object.keys(p.servers).length > 0 : !!p.servers[id]);
    const pts = live.flatMap((p): Rate[] => (read(p) ? [sum(p)] : []));
    const end = live.length ? live[live.length - 1].ts : 0;
    const span = this.keep - 1;
    const last = pts[pts.length - 1];
    // A point dated after the router's now (its clock went back) is no speed now either.
    const age = last ? this.now - last[0] : -1;
    const fresh = age >= 0 && age < FRESH_S;
    const said = last ? pts.filter((p) => p[0] > last[0] - SAID_S) : [];
    const mean = (i: 1 | 2) => Math.round(said.reduce((n, p) => n + p[i], 0) / said.length);
    return {
      pts,
      xs: pts.map((p) => 1 - (end - p[0]) / span),
      rx: fresh ? mean(1) : 0,
      tx: fresh ? mean(2) : 0,
      error,
      early: !live.length && this.empty < EARLY,
    };
  }
}
