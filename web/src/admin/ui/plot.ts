// Charts drawn in the connection map's language (map.ts, styles/map.css): an SVG
// sized to its box in real pixels (so the arcs' dashes and the markers stay true
// at any width), and the map's marks: the person marker (a ringed circle, a halo
// while live), the replay's tick for a picked moment, the soft accuracy zone
// under a line. Colours and strokes are CSS (styles/charts.css), so a theme
// switch needs no redraw. What a chart draws is the subclass's.

let ids = 0;

export abstract class Plot {
  readonly el: HTMLElement;
  protected svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  /** The box in CSS pixels; 0 until it is laid out. */
  protected W = 0;
  protected H = 0;
  /** Unique within the page, for the gradients a chart defines. */
  protected id = `dl-plot${++ids}`;

  /**
   * `width`: a box whose size is known up front (a tooltip's chart, built anew
   * each time it shows) is drawn at once, without waiting to be laid out.
   */
  constructor(cls: string, height: number, width?: number) {
    this.el = document.createElement('div');
    this.el.className = `dl-plot ${cls}`;
    this.el.style.height = `${height}px`;
    this.svg.setAttribute('aria-hidden', 'true');
    this.el.appendChild(this.svg);
    if (width) {
      this.el.style.width = `${width}px`;
      this.W = width;
      this.H = height;
      this.svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      return;
    }
    const ro = new ResizeObserver(() => {
      // A chart a repaint replaced lets go of its observer.
      if (!this.el.isConnected && this.W) return ro.disconnect();
      const r = this.el.getBoundingClientRect();
      const w = Math.round(r.width),
        h = Math.round(r.height);
      if (!w || (w === this.W && h === this.H)) return;
      this.W = w;
      this.H = h;
      this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      this.draw();
    });
    ro.observe(this.el);
  }

  /** Draw what the chart holds now (nothing before it has a size). */
  abstract draw(): void;

  protected put(markup: string): void {
    this.svg.innerHTML = markup;
  }

  /** Page x of a point at x inside the box, and page y of a y inside it. */
  protected page(x: number, y: number): [number, number] {
    const r = this.el.getBoundingClientRect();
    return [r.left + x, r.top + y];
  }
}

const f = (n: number) => n.toFixed(1);

/** A marker: the map's person circle, live blue or the recent grey; `halo`: it breathes. */
export const marker = (x: number, y: number, live: boolean, r = 4, halo = false): string =>
  (halo && live ? `<circle class="halo" cx="${f(x)}" cy="${f(y)}" r="${r}"/>` : '') +
  `<circle class="mk${live ? ' live' : ''}" cx="${f(x)}" cy="${f(y)}" r="${r}"/>`;

/** The picked point on a chart: a marker in the text colour with a ring of the card. */
export const picked = (x: number, y: number, r = 4.5): string => `<circle class="mk on" cx="${f(x)}" cy="${f(y)}" r="${r}"/>`;

/** The replay's tick: 2 px in the text colour, a ring of the card around it. */
export const tick = (x: number, y0: number, y1: number): string =>
  `<line class="tick-ring" x1="${f(x)}" x2="${f(x)}" y1="${y0}" y2="${y1}"/><line class="tick" x1="${f(x)}" x2="${f(x)}" y1="${y0}" y2="${y1}"/>`;

/** A vertical soft zone (the accuracy circle's fill fading to nothing), as a gradient `id` of class `cls`. */
export const zone = (id: string, cls: string): string =>
  `<linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop class="${cls} z0" offset="0"/><stop class="${cls} z1" offset="1"/></linearGradient>`;

/** A smooth path through points that never overshoots them (monotone cubic): a quiet stretch stays flat, never dips. */
export function smooth(p: [number, number][]): string {
  const n = p.length;
  if (n < 2) return n ? `M${f(p[0][0])},${f(p[0][1])}` : '';
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((p[i + 1][1] - p[i][1]) / Math.max(1e-6, p[i + 1][0] - p[i][0]));
  const m = [d[0], ...d.slice(1).map((v, i) => (d[i] * v <= 0 ? 0 : (d[i] + v) / 2)), d[n - 2]];
  // Fritsch–Carlson: tangents scaled down where they would overshoot.
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i],
      b = m[i + 1] / d[i],
      s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  let out = `M${f(p[0][0])},${f(p[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const h = (p[i + 1][0] - p[i][0]) / 3;
    out += ` C${f(p[i][0] + h)},${f(p[i][1] + m[i] * h)} ${f(p[i + 1][0] - h)},${f(p[i + 1][1] - m[i + 1] * h)} ${f(p[i + 1][0])},${f(p[i + 1][1])}`;
  }
  return out;
}
