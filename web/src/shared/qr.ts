// QR codes rendered in the browser as SVG, with the Dawnline mark in the
// middle. The mark hides about 5% of the code; error correction H (30%) covers
// that for links. A long configuration (an AmneziaVPN key is about 1.5 KB) gets
// no mark and level L: every step up in correction adds modules, and a dense
// code fails on the camera before it fails on damage.
//
// Two looks. `plain`: black squares on white in one path (the admin's cards and
// the invite image). `night`: light dots on black with rounded finder eyes (the
// portal). Light dots on dark lose a dense code to blur sooner, so a dense night
// code gets fuller dots: checked with a QR reader, r 0.42 lost a 1.5 KB key at
// 1.2 px of blur where r 0.48 read as well as the plain code.

import qrcode from 'qrcode-generator';

export type QrLook = 'plain' | 'night';

/** The icon's dome and bar (64×64 viewBox, see portal/icon.svg), in a colour. */
const mark = (fill: string) =>
  `<path d="M14 38a18 18 0 0 1 36 0z" fill="${fill}"/><rect x="12" y="43" width="40" height="4" rx="2" fill="${fill}" opacity=".5"/>`;

const NIGHT_BG = '#0a0a0a';
const NIGHT_FG = '#f2f2f2';

/** Long content: fewer modules matter more than the mark. */
export const denseQr = (text: string): boolean => text.length > 300;

const n2 = (v: number) => +v.toFixed(2);
/** A rounded rectangle as a sub-path. */
function rrect(x: number, y: number, w: number, h: number, r: number): string {
  return (
    `M${n2(x + r)} ${n2(y)}h${n2(w - 2 * r)}a${r} ${r} 0 0 1 ${r} ${r}v${n2(h - 2 * r)}a${r} ${r} 0 0 1 -${r} ${r}` +
    `h-${n2(w - 2 * r)}a${r} ${r} 0 0 1 -${r} -${r}v-${n2(h - 2 * r)}a${r} ${r} 0 0 1 ${r} -${r}z`
  );
}

export function qrSvg(text: string, margin = 3, logo = true, look: QrLook = 'plain'): string {
  const dense = denseQr(text);
  const night = look === 'night';
  const qr = qrcode(0, dense ? 'L' : 'H');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const size = n + margin * 2;
  // A centred, module-aligned hole for the mark (same parity as n).
  let hole = logo && !dense ? Math.round(n * 0.22) : 0;
  if (hole && (n - hole) % 2) hole++;
  const h0 = (n - hole) / 2,
    h1 = h0 + hole;
  const inHole = (x: number, y: number) => hole > 0 && x >= h0 && x < h1 && y >= h0 && y < h1;
  // The three finder patterns, drawn whole as eyes in the night look.
  const inEye = (x: number, y: number) => night && ((y < 7 && x < 7) || (y < 7 && x >= n - 7) || (y >= n - 7 && x < 7));
  let d = '';
  if (night) {
    const r = dense ? 0.48 : 0.42;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        if (qr.isDark(y, x) && !inHole(x, y) && !inEye(x, y))
          d += `M${x + margin + 0.5 - r} ${y + margin + 0.5}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 -${2 * r} 0z`;
  } else
    for (let y = 0; y < n; y++) {
      let x = 0;
      while (x < n) {
        if (!qr.isDark(y, x) || inHole(x, y)) {
          x++;
          continue;
        }
        let w = 1;
        while (x + w < n && qr.isDark(y, x + w) && !inHole(x + w, y)) w++;
        d += `M${x + margin} ${y + margin}h${w}v1h-${w}z`;
        x += w;
      }
    }
  // Each eye: a 7×7 ring around a gap and a 3×3 pupil, one even-odd path.
  let eyes = '';
  if (night)
    for (const [x, y] of [
      [margin, margin],
      [margin + n - 7, margin],
      [margin, margin + n - 7],
    ])
      eyes += rrect(x, y, 7, 7, 2.6) + rrect(x + 1, y + 1, 5, 5, 1.8) + rrect(x + 2, y + 2, 3, 3, 1.5);
  let logoTile = '';
  if (hole) {
    const pad = 0.6,
      s = hole - pad * 2,
      o = h0 + margin + pad;
    logoTile =
      `<rect x="${o}" y="${o}" width="${s}" height="${s}" rx="${s * (night ? 0.28 : 0.25)}" fill="${night ? NIGHT_FG : '#0a0a0a'}"/>` +
      `<g transform="translate(${o} ${o}) scale(${s / 64})">${mark(night ? NIGHT_BG : '#fff')}</g>`;
  }
  const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="QR code">`;
  return night
    ? `${open}<rect width="${size}" height="${size}" fill="${NIGHT_BG}"/><path d="${d}" fill="${NIGHT_FG}"/>` +
        `<path d="${eyes}" fill="${NIGHT_FG}" fill-rule="evenodd"/>${logoTile}</svg>`
    : `${open}<rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000" shape-rendering="crispEdges"/>${logoTile}</svg>`;
}
