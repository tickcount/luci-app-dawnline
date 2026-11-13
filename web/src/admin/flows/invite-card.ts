// The invite card as a picture: the person's QR code, link and greeting,
// drawn in the browser into a PNG to share (Telegram, AirDrop) or print. The
// sheet that offers it is flows/invite.ts.

import type { Person } from '../../shared/types';
import { loadQr } from '../shell/qr';
import { fmt } from '../../shared/i18n';

const W = 1080,
  H = 1512;
/** One margin for everything: header, greeting and the QR tile share both edges. */
const M = 96;
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function cardSvg(p: Pick<Person, 'name'>, server: string, link: string, qrSvg: (text: string, margin: number) => string): string {
  const url = new URL(link);
  const word = url.pathname.slice(1);
  const hi = fmt(_('Hi, %s'), p.name);
  // Long names shrink to stay on one line (roughly 0.58 em per character).
  const nameSize = Math.min(92, Math.floor((W - 2 * M) / (0.58 * hi.length)));
  const tile = W - 2 * M,
    top = 392,
    pad = 40;
  const qr = qrSvg(link, 2).replace('<svg ', `<svg x="${M + pad}" y="${top + pad}" width="${tile - 2 * pad}" height="${tile - 2 * pad}" `);
  const text = (x: number, y: number, size: number, fill: string, body: string, extra = '') =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-family="${SANS}" ${extra}>${body}</text>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" rx="72" fill="#0b0b0b"/>` +
    // Mark and server name
    `<g transform="translate(${M} ${M})"><rect width="60" height="60" rx="15" fill="#fff"/>` +
    `<g transform="scale(.9375)"><path d="M14 38a18 18 0 0 1 36 0z" fill="#0b0b0b"/><rect x="12" y="43" width="40" height="4" rx="2" fill="#0b0b0b" opacity=".5"/></g></g>` +
    text(M + 82, M + 42, 36, '#a3a3a3', esc(server)) +
    // Greeting
    text(M, 276, nameSize, '#ffffff', esc(hi), 'font-weight="600"') +
    text(M, 340, 40, '#8a8a8a', esc(fmt(_('Scan to connect to %s'), server))) +
    // Big QR on a white tile, edge to edge with the text above
    `<rect x="${M}" y="${top}" width="${tile}" height="${tile}" rx="52" fill="#ffffff"/>` +
    qr +
    // The link: three words, then the host
    `<text x="${W / 2}" y="${top + tile + 100}" font-size="58" fill="#ffffff" font-family="${MONO}" text-anchor="middle">${esc(word)}</text>` +
    text(W / 2, top + tile + 156, 34, '#737373', esc(url.host), 'text-anchor="middle"') +
    `</svg>`
  );
}

/** The card for `p` on `server` with its `link`, as a PNG file. */
export async function inviteCardFile(p: Pick<Person, 'id' | 'name'>, server: string, link: string): Promise<File> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(cardSvg(p, server, link, (await loadQr()).qrSvg))}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  canvas.getContext('2d')!.drawImage(img, 0, 0, W, H);
  const png = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(_('Could not draw the card')))), 'image/png'),
  );
  return new File([png], `${p.id}-invite.png`, { type: 'image/png' });
}
