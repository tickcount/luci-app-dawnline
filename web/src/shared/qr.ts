// QR codes rendered in the browser as a single-path SVG, with the Dawnline
// mark in the middle. The mark hides about 5% of the code; error correction
// H (30%) covers that for links, Q (25%) keeps long configurations scannable.

import qrcode from 'qrcode-generator';

/** The icon's dome and bar (64×64 viewBox, see portal/icon.svg). */
const MARK = '<path d="M14 38a18 18 0 0 1 36 0z" fill="#fff"/><rect x="12" y="43" width="40" height="4" rx="2" fill="#fff" opacity=".5"/>';

export function qrSvg(text: string, margin = 3, logo = true): string {
  const qr = qrcode(0, text.length > 300 ? 'Q' : 'H');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const size = n + margin * 2;
  // A centred, module-aligned hole for the mark (same parity as n).
  let hole = logo ? Math.round(n * 0.22) : 0;
  if (hole && (n - hole) % 2) hole++;
  const h0 = (n - hole) / 2,
    h1 = h0 + hole;
  const inHole = (x: number, y: number) => hole > 0 && x >= h0 && x < h1 && y >= h0 && y < h1;
  let d = '';
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
  let mark = '';
  if (hole) {
    const pad = 0.6,
      s = hole - pad * 2,
      o = h0 + margin + pad;
    mark =
      `<rect x="${o}" y="${o}" width="${s}" height="${s}" rx="${s * 0.25}" fill="#0a0a0a"/>` +
      `<g transform="translate(${o} ${o}) scale(${s / 64})">${MARK}</g>`;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="QR code">` +
    `<rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000" shape-rendering="crispEdges"/>${mark}</svg>`
  );
}
