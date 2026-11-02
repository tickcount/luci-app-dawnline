// The speed chart (Speed now, an online person's hover card): download as the
// map's live line over its zone, upload as a recent grey dashed line on the same
// scale, the newest second a live marker that breathes. Read point by point
// (shared/scrub.ts): the picked second gets the replay's tick and a marker on each
// line. Waiting, an unreadable meter and a server that is off are the tile's.

import type { Rate } from '../state/meter';
import type { Readable } from '../../shared/scrub';
import { Plot, marker, picked, smooth, tick, zone } from '../ui/plot';

/** Room at the ends for the markers. */
const PAD = 5;

export class SpeedLines extends Plot implements Readable {
  private pts: Rate[] = [];
  private xs: number[] = [];
  private hov = -1;

  /** `small`: the hover card's, with smaller marks, at a known `width`. */
  constructor(
    height: number,
    private small = false,
    width?: number,
  ) {
    super('dl-lines', height, width);
  }

  get points(): Rate[] {
    return this.pts;
  }

  /** The points ([ts, rx, tx], oldest first) and where each sits across (0–1, the newest at 1). */
  set(pts: Rate[], xs: number[]): void {
    this.pts = pts;
    this.xs = xs;
    this.draw();
  }

  mark(i: number): void {
    this.hov = i;
    this.draw();
  }

  private x(i: number): number {
    return PAD + this.xs[i] * (this.W - 2 * PAD);
  }

  indexAt(clientX: number): number {
    if (this.pts.length < 2 || !this.W) return -1;
    const f = (clientX - this.el.getBoundingClientRect().left - PAD) / (this.W - 2 * PAD);
    // Left of the first point (the meter still filling its two minutes) is nothing.
    if (f < this.xs[0] - 0.02) return -1;
    let best = 0;
    this.xs.forEach((x, i) => {
      if (Math.abs(x - f) < Math.abs(this.xs[best] - f)) best = i;
    });
    return best;
  }

  draw(): void {
    const { W, H, pts } = this;
    const n = pts.length;
    if (!W || n < 2) return this.put('');
    const max = Math.max(1, ...pts.map((p) => Math.max(p[1], p[2])));
    const y = (v: number) => H - 3 - (v / max) * (H - 3 - PAD);
    const dn = pts.map((p, i): [number, number] => [this.x(i), y(p[2])]);
    const up = pts.map((p, i): [number, number] => [this.x(i), y(p[1])]);
    const d = smooth(dn);
    const r = this.small ? 3 : 3.5;
    let s = `<defs>${zone(`${this.id}z`, 'live')}</defs>`;
    s += `<path class="area" fill="url(#${this.id}z)" d="${d} L${dn[n - 1][0]},${H} L${dn[0][0]},${H}Z"/>`;
    s += `<path class="ln past dash thin" d="${smooth(up)}"/><path class="ln live" d="${d}"/>`;
    const h = this.hov >= 0 && this.hov < n ? this.hov : -1;
    if (h >= 0) {
      s += tick(dn[h][0], 1, H - 1) + marker(up[h][0], up[h][1], false, r) + picked(dn[h][0], dn[h][1], r + 0.5);
    }
    // The newest second, breathing while nothing is picked.
    if (h !== n - 1) s += marker(dn[n - 1][0], dn[n - 1][1], true, r, h < 0);
    this.put(s);
  }
}
