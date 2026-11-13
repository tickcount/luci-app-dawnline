// The admin's chart curve (the connection map's language, map.ts): a monotone
// cubic through the points, drawn as an SVG path (widgets/line-chart.ts).

const f = (n: number) => n.toFixed(1);

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
