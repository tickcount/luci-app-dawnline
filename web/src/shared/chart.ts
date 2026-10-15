// Tiny SVG bar chart for daily traffic (download stacked over upload).

import type { DayUsage } from './types';
import { bytes } from './format';

export function trafficChart(series: DayUsage[], height = 120): string {
  const w = 600;
  const pad = 2;
  const n = Math.max(series.length, 1);
  const bw = w / n;
  const max = Math.max(1, ...series.map((d) => d.rx + d.tx));
  let bars = '';
  series.forEach((d, i) => {
    const x = i * bw + pad / 2;
    // From the person's point of view: router tx = download, rx = upload.
    const hDown = (d.tx / max) * (height - 4);
    const hUp = (d.rx / max) * (height - 4);
    const title = `${d.day}: ↓ ${bytes(d.tx)} · ↑ ${bytes(d.rx)}`;
    bars +=
      `<g><title>${title}</title>` +
      `<rect x="${x.toFixed(1)}" y="${(height - hDown - hUp).toFixed(1)}" width="${(bw - pad).toFixed(1)}" height="${hDown.toFixed(1)}" rx="1.5" class="dl-bar-down"/>` +
      `<rect x="${x.toFixed(1)}" y="${(height - hUp).toFixed(1)}" width="${(bw - pad).toFixed(1)}" height="${hUp.toFixed(1)}" rx="1.5" class="dl-bar-up"/>` +
      `<rect x="${(i * bw).toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${height}" fill="transparent"/></g>`;
  });
  return `<svg class="dl-chart" viewBox="0 0 ${w} ${height}" preserveAspectRatio="none" role="img" aria-label="Traffic per day">${bars}</svg>`;
}
