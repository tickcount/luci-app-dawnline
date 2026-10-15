// Outline's same-document router fires `luci-navigate` once the outgoing view
// is torn down. Anything Dawnline puts on <body> (drawer, tooltip, menus,
// pending dialogs) listens for it, or it would outlive its page.

export function onNavigate(fn: () => void): () => void {
  document.addEventListener('luci-navigate', fn);
  return () => document.removeEventListener('luci-navigate', fn);
}
