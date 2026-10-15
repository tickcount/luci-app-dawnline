// Invite card: a picture with the person's QR code, link and three steps,
// made in the browser to share (Telegram, AirDrop) or print.

import type { Person } from '../shared/types';
import { E } from './e';
import { api } from './api';
import { button } from './ui/button';
import { closeModal, modal } from './ui/modal';
import { copyText, downloadFile } from './ui/files';
import { attempt, notify } from './ui/toast';
import { icon } from '../shared/icons';
import { qrSvg } from '../shared/qr';

const W = 1080,
  H = 1512;
/** One margin for everything: header, greeting and the QR tile share both edges. */
const M = 96;
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function cardSvg(p: Pick<Person, 'name'>, server: string, link: string): string {
  const url = new URL(link);
  const word = url.pathname.slice(1);
  // Long names shrink to stay on one line (roughly 0.58 em per character).
  const nameSize = Math.min(92, Math.floor((W - 2 * M) / (0.58 * (4 + p.name.length))));
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
    text(M, 276, nameSize, '#ffffff', `Hi, ${esc(p.name)}`, 'font-weight="600"') +
    text(M, 340, 40, '#8a8a8a', `Scan to connect to ${esc(server)}`) +
    // Big QR on a white tile, edge to edge with the text above
    `<rect x="${M}" y="${top}" width="${tile}" height="${tile}" rx="52" fill="#ffffff"/>` +
    qr +
    // The link: three words, then the host
    `<text x="${W / 2}" y="${top + tile + 100}" font-size="58" fill="#ffffff" font-family="${MONO}" text-anchor="middle">${esc(word)}</text>` +
    text(W / 2, top + tile + 156, 34, '#737373', esc(url.host), 'text-anchor="middle"') +
    `</svg>`
  );
}

async function toPng(svg: string): Promise<Blob> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  canvas.getContext('2d')!.drawImage(img, 0, 0, W, H);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not draw the card'))), 'image/png'),
  );
}

/** Who to invite; without `link` the card asks the router for the person's links (they are not in the status). */
type Invitee = Pick<Person, 'id' | 'name'> & { link?: string | null; links?: string[] };

/** The personal link and its other addresses (person_links); null while the portal is off. */
export async function personLinks(id: string): Promise<{ link: string; links: string[] } | null> {
  const r = await attempt(() => api.personLinks(id));
  if (!r) return null;
  if (!r.link) {
    notify('The personal portal is off. Turn it on in Settings.', 'warning');
    return null;
  }
  return { link: r.link, links: r.links ?? [] };
}

/** Copy a person's personal link. */
export async function copyPersonLink(id: string) {
  const r = await personLinks(id);
  if (r) await copyText(r.link, 'Personal link copied');
}

/**
 * The card with Copy link and Share / Download. Also the "is ready" step
 * after adding someone.
 */
export async function inviteCard(p: Invitee, server: string, opts: { title?: string; lead?: string } = {}) {
  let link = p.link;
  let links = p.links;
  if (link === undefined) {
    const r = await personLinks(p.id);
    if (!r) return;
    link = r.link;
    links = r.links;
  }
  if (!link) {
    notify('The personal portal is off. Turn it on in Settings.', 'warning');
    return;
  }
  const href = link;
  const png = await attempt(() => toPng(cardSvg(p, server, href)));
  if (!png) return;
  const file = new File([png], `${p.id}-invite.png`, { type: 'image/png' });
  const url = URL.createObjectURL(png);
  const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
  const canShare = !!nav.canShare?.({ files: [file] });
  const close = () => {
    URL.revokeObjectURL(url);
    closeModal();
  };
  const share = canShare
    ? button(
        [icon('link'), ' Share card'],
        async () => {
          try {
            await nav.share({ files: [file], title: `Invite ${p.name}` });
          } catch {
            /* cancelled */
          }
        },
        'positive',
      )
    : button([icon('download'), ' Download card'], () => downloadFile(file.name, png), 'positive');
  modal(
    opts.title ?? `Invite ${p.name}`,
    E('div', { class: 'dl-invite' }, [
      E('img', { src: url, alt: `Invite card for ${p.name}` }),
      E('div', { class: 'dl-invite-side' }, [
        E(
          'p',
          { class: 'dl-muted' },
          opts.lead ?? `Send ${p.name} the card or the link. They open it, add their devices and connect — no account needed.`,
        ),
        E('button', { type: 'button', class: 'dl-invite-link', title: 'Copy link', click: () => copyText(href, 'Personal link copied') }, [
          E('span', {}, href.replace(/^https:\/\//, '')),
          icon('copy'),
        ]),
        ...(links ?? [])
          .filter((l) => l !== href)
          .map((l) =>
            E('button', { type: 'button', class: 'dl-invite-link alt', title: 'Copy this link', click: () => copyText(l, 'Link copied') }, [
              E('span', {}, l.replace(/^https?:\/\//, '')),
              E('span', { class: `dl-pill ${l.startsWith('http:') ? 'warn' : ''}` }, l.startsWith('http:') ? 'HTTP' : 'Also'),
              icon('copy'),
            ]),
          ),
        E('ol', { class: 'dl-invite-steps' }, [
          E('li', {}, ['Install ', E('b', {}, 'AmneziaVPN'), ' on the device']),
          E('li', {}, 'Open the link or scan the code'),
          E('li', {}, 'Add the device and connect'),
        ]),
        E('div', { class: 'dl-invite-actions' }, [
          share,
          button([icon('copy'), ' Copy link'], () => copyText(href, 'Personal link copied')),
        ]),
      ]),
    ]),
    [E('button', { class: 'cbi-button cbi-button-neutral', click: close }, 'Done')],
    'wide',
  );
}
