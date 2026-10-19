// A plain-HTTP link (an IP address) shows the page, but keys only travel
// encrypted: adding or setting up a device sends the visitor to the HTTPS twin
// first. Its certificate is the router's own, so the browser warns once; say so.

import { h, ic } from '../dom';
import { httpsTwin } from '../state';
import { glass } from '../ui/glass';
import { head, hint, openSheet, sub, type View } from '../ui/sheet';

function vSecure(url: string): View {
  const el = h(
    'div',
    { class: 'view' },
    head('Open the link securely'),
    sub('Connection settings only travel encrypted'),
    h(
      'div',
      { class: 'center-col secure' },
      glass('lock', 'blue', 'gi xl'),
      h('p', {}, 'This page is open without encryption. To add or set up a device, open the same link over HTTPS:'),
    ),
    // The same tab: the HTTPS page replaces this one.
    h('a', { class: 'btn accent block', href: url }, ic('lock'), h('span', {}, 'Open securely')),
    hint('The browser may warn that the certificate is not trusted: it is this router’s own. Choose to continue (“Advanced” → “Proceed”).'),
  );
  el.lastElementChild!.classList.add('secure-note');
  return { el, label: 'Open the link securely' };
}

/** The HTTPS twin's sheet (here, or the one the router named in a refusal). */
export const showSecure = (url: string) => openSheet(() => vSecure(url));

/** Over plain HTTP: the twin's sheet instead, and true (the caller stops). */
export function secureFirst(): boolean {
  const twin = httpsTwin();
  if (!twin) return false;
  showSecure(twin);
  return true;
}
