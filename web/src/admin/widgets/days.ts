// Days as charts: stacked rounded bars (download at the base, upload on top, in
// the colours of the tiles' ↓ and ↑ numbers), and the strip of the device
// panel's places (a track with a segment for each day used, today the map's live
// blue). The picked day (shared/scrub.ts) stays bright over a soft band while the
// others dim, or gets the replay's tick on a strip. Days are [rx, tx] oldest
// first, today last.

import type { Pair } from '../../shared/types';
import type { Readable } from '../../shared/scrub';
import { Plot, tick } from '../ui/plot';

const f = (n: number) => n.toFixed(1);

/** A chart with a column per day: which column a pointer is over, where a column's top stands. */
abstract class DayPlot extends Plot implements Readable {
  protected hov = -1;
  /** Each day's top (box y) in the last paint, for the tooltip's anchor. */
  protected tops: number[] = [];

  constructor(
    cls: string,
    height: number,
    protected days: Pair[],
  ) {
    super(cls, height);
  }

  mark(i: number): void {
    this.hov = i;
    this.draw();
  }

  protected cx(i: number): number {
    return ((i + 0.5) * this.W) / this.days.length;
  }

  /** The day under a pointer: each column's share of the width, the gaps included. */
  indexAt(clientX: number): number {
    const i = Math.floor(((clientX - this.el.getBoundingClientRect().left) / Math.max(1, this.W)) * this.days.length);
    return i >= 0 && i < this.days.length ? i : -1;
  }

  anchor(i: number): [number, number] {
    return this.page(this.cx(i), this.tops[i] ?? 0);
  }

  /** The picked day's soft band, under everything. */
  protected band(): string {
    if (this.hov < 0) return '';
    const w = this.W / this.days.length;
    return `<rect class="band" x="${f(this.cx(this.hov) - w / 2)}" y="0" width="${f(w)}" height="${this.H}" rx="4"/>`;
  }
}

/**
 * Days as stacked rounded bars, one a day on one scale: the download at the base
 * and the upload on top, in the colours of the tile's ↓ and ↑ numbers, so a
 * bar's height is the day's total and its colours the split. The picked day
 * stays bright over a soft band while the others dim. `maxW`: the widest a bar
 * gets (px).
 */
export class DayStack extends DayPlot {
  constructor(
    days: Pair[],
    height: number,
    private maxW = 14,
  ) {
    super('dl-stack-bars', height, days);
  }

  draw(): void {
    const { W, H, days } = this;
    if (!W) return;
    const max = Math.max(1, ...days.map((d) => d[0] + d[1]));
    const w = Math.min(this.maxW, Math.max(3, (W / days.length) * 0.62));
    const r = Math.min(2.5, w / 2);
    let s = this.band();
    days.forEach(([rx, tx], i) => {
      const x = this.cx(i) - w / 2;
      const cls = i === this.hov ? ' on' : this.hov >= 0 ? ' dim' : '';
      const down = (tx / max) * H,
        up = (rx / max) * H;
      // A gap of 1 px between the parts when both show.
      const gap = down >= 1 && up >= 1 ? 1 : 0;
      this.tops[i] = H - down - up - gap;
      if (!rx && !tx) {
        s += `<rect class="none" x="${f(x)}" y="${H - 2}" width="${f(w)}" height="2" rx="1"/>`;
        return;
      }
      if (down)
        s += `<rect class="dn${cls}" x="${f(x)}" y="${f(H - Math.max(2, down))}" width="${f(w)}" height="${f(Math.max(2, down))}" rx="${r}"/>`;
      if (up) s += `<rect class="up${cls}" x="${f(x)}" y="${f(this.tops[i])}" width="${f(w)}" height="${f(Math.max(2, up))}" rx="${r}"/>`;
    });
    this.put(s);
  }
}

/**
 * Which days a device was used, as the device panel's places strip: a 6 px track,
 * a segment on each day used (stronger the more), today live blue; the picked
 * day gets the replay's tick.
 */
export class DayStrip extends DayPlot {
  constructor(days: Pair[], height: number) {
    super('dl-dstrip', height, days);
  }

  draw(): void {
    const { W, H, days } = this;
    if (!W) return;
    const n = days.length;
    const vals = days.map((d) => d[0] + d[1]);
    const max = Math.max(1, ...vals);
    const y0 = H / 2 - 3,
      w = W / n;
    let s = `<rect class="track" x="0" y="${f(y0)}" width="${W}" height="6" rx="3"/>`;
    vals.forEach((v, i) => {
      this.tops[i] = y0 - 4;
      if (!v) return;
      const live = i === n - 1;
      s += `<rect class="seg${live ? ' live' : ''}" x="${f(i * w + 0.5)}" y="${f(y0)}" width="${f(Math.max(2, w - 1))}" height="6" rx="2"${
        live ? '' : ` opacity="${(0.35 + 0.65 * Math.sqrt(v / max)).toFixed(2)}"`
      }/>`;
    });
    if (this.hov >= 0) s += tick(this.cx(this.hov), y0 - 4, y0 + 10);
    this.put(s);
  }
}
