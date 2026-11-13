// A page of the admin goes: Outline's same-document router fires `luci-navigate` once the outgoing view is torn
// down, and a move between Dawnline's own pages inside one view (shell/pages.ts) says the same with its own event.
// Anything Dawnline puts on <body> (drawer, tooltip, menus, pending dialogs), and what a page keeps running (its
// pollers, its regions), listens for it, or it would outlive its page.

/** The event of a page of Dawnline's going while its view stays (shell/pages.ts). */
export const LEAVE = 'dawnline-leave';

export function onNavigate(fn: () => void): () => void {
  document.addEventListener('luci-navigate', fn);
  document.addEventListener(LEAVE, fn);
  return () => {
    document.removeEventListener('luci-navigate', fn);
    document.removeEventListener(LEAVE, fn);
  };
}
