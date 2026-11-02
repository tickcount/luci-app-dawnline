// A usage meter in the connection map's language (the device panel's places
// strip): a 6 px track and a rounded fill, live blue, orange when nearly full,
// red when full. Past the fill, dashed like an arc, where a week at the recent
// pace takes it (shared/pace.ts). The alert level is the replay's tick. Without a
// limit, the month split by device: a rounded segment each (c0–c4, the swatch
// colours), a gap between. Tooltips are the caller's (ui/glide.ts pointTip).

type MeterTone = 'live' | 'warn' | 'bad';

/** The tone for a share used: full at 100%, nearly full from 90%. */
const toneOf = (pct: number): MeterTone => (pct >= 100 ? 'bad' : pct >= 90 ? 'warn' : 'live');

/** `pct` used of the limit; `ahead`: where a week at this pace takes it (both 0–100); `mark`: the alert (0–1). */
export function limitMeter(pct: number, ahead = 0, mark?: number): HTMLElement {
  const el = document.createElement('div');
  el.className = `dl-smeter ${toneOf(pct)}`;
  const fill = el.appendChild(document.createElement('i'));
  fill.style.width = `${pct}%`;
  if (ahead > pct) {
    const dash = el.appendChild(document.createElement('b'));
    dash.style.left = `${pct}%`;
    dash.style.width = `${ahead - pct}%`;
  }
  if (mark != null) {
    const m = el.appendChild(document.createElement('span'));
    m.className = 'mark';
    m.style.left = `${mark * 100}%`;
  }
  return el;
}

/** The month split by device, largest first (values in bytes; colours c0–c4 in that order). */
export function splitMeter(values: number[]): HTMLElement {
  const el = document.createElement('div');
  el.className = 'dl-smeter parts';
  values.forEach((v, i) => {
    const seg = el.appendChild(document.createElement('i'));
    seg.className = `c${Math.min(i, 4)}`;
    seg.style.flexGrow = String(v);
  });
  return el;
}
