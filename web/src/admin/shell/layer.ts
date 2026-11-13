// The layer: one more shadow host, straight on <body>, for what floats above
// the page (the sheet, ⋯ menus and pickers, toasts). Not inside the page's
// host: Outline's #maincontent is a container and a scroller, which in some
// engines becomes the box `position: fixed` is measured from, so a sheet in it
// would stand on the content instead of the window. It adopts the page's
// stylesheet and theme (host.ts), sits above Outline's header and sidebar and
// below LuCI's own modal (a login after the session expired stays on top), and
// the sheet locks #maincontent, the scroller in Outline, not the window.
// Leaving the page (Outline's luci-navigate) shuts what is open at once;
// Escape shuts the sheet as its × does.

import { setLayer } from '../../portal/ui/layer';
import { closeSheet, dropSheet, sheetOpen } from '../../portal/ui/sheet';
import { closeDrop, dropOpen } from '../../portal/ui/drop';
import { onNavigate } from '../ui/nav';
import { shadowHost } from './host';

/** Outline: header 25, sidebar and its phone drawer 30–40, #modal_overlay and the ⌘K palette 50. */
const Z = 45;

let root: ShadowRoot | null = null;

/**
 * Escape shuts the sheet as its × does: the same way out (the owner, 2026-11-12: «ESC резко закрывает модалку не
 * как кнопка закрыть»), as on the portal's page (portal/main.ts): a dialog that is there one frame and gone the
 * next read as a fault. A menu or a picker over it takes the key itself (ui/drop.ts), and so does a field that
 * empties or leaves its edit.
 */
function escape(e: KeyboardEvent) {
  if (e.key !== 'Escape' || e.defaultPrevented || dropOpen() || !sheetOpen()) return;
  closeSheet();
  // the key is spent: what is under the sheet (a panel, a pick) stays as it is
  e.preventDefault();
}

/** The layer, made the first time a page asks (once per bundle; it outlives page changes). */
export function useLayer(css: string): ShadowRoot {
  // One listener, set again by every page: Outline's router takes away what the view before added to the document.
  document.removeEventListener('keydown', escape);
  document.addEventListener('keydown', escape);
  if (root?.host.isConnected) return root;
  const made = shadowHost(css, 'dl-layer');
  // No box of its own: what is in it is fixed to the window.
  Object.assign(made.host.style, { position: 'fixed', top: '0', left: '0', width: '0', height: '0', zIndex: String(Z) });
  document.body.append(made.host);
  setLayer(made.root, document.getElementById('maincontent') ?? document.body);
  if (!root)
    onNavigate(() => {
      dropSheet();
      closeDrop(true);
    });
  root = made.root;
  return root;
}
