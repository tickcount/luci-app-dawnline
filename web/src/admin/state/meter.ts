// The live meter as the Servers page keeps it (rpc meter, polled once a
// second while an Overview is on screen): the answers merged into the last two
// minutes, and one server's part of them for its Speed now tile. No DOM and no
// RPC here: the poller is the page's (pages/server.ts), the tile widgets/tiles.

import type { Meter, MeterPoint } from '../api';

/** [ts, rx, tx] in bytes/s, as Server.rate: rx = from the devices, tx = to them. */
export type Rate = [number, number, number];

/** One call's outcome: the meter, or why there is none. */
export type MeterAnswer = { meter: Meter } | { error: string };

/** Page milliseconds after the last answer when what is kept stops counting as live: the next call asks for everything again. */
const STALE_MS = 5000;
/** Router seconds the newest point is "now": an agent that stopped leaves its last one behind. */
const FRESH_S = 5;
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
  /** Bytes/s now: its newest point while that is fresh, else 0. */
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

  /** Server `id`'s points at page time `ms` (none once they are not live), placed against the meter's newest point. */
  speed(id: string, ms: number): LiveSpeed {
    const error = this.failed >= LOST_AFTER ? this.error : null;
    const live = this.live(ms) ? this.points : [];
    // A second its tunnel was not read has no point of its own.
    const pts = live.flatMap((p): Rate[] => (p.servers[id] ? [[p.ts, p.servers[id][0], p.servers[id][1]]] : []));
    const end = live.length ? live[live.length - 1].ts : 0;
    const span = this.keep - 1;
    const last = pts[pts.length - 1];
    // A point dated after the router's now (its clock went back) is no speed now either.
    const age = last ? this.now - last[0] : -1;
    const fresh = age >= 0 && age < FRESH_S;
    return {
      pts,
      xs: pts.map((p) => 1 - (end - p[0]) / span),
      rx: fresh ? last[1] : 0,
      tx: fresh ? last[2] : 0,
      error,
      early: !live.length && this.empty < EARLY,
    };
  }
}
