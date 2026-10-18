// The live revision: one small `rev` call every 2 s while the page is visible.
// The agent moves it the moment a device connects, goes away or roams, or
// something is logged; pollers that opt in refresh then, so pages follow the
// router within seconds without fetching the full status that often.

import { api } from '../api';
import { notify } from '../ui/toast';

const EVERY = 2;

const listeners = new Set<() => void>();
let last: number | null = null;
let version: string | null = null;

async function tick(): Promise<void> {
  if (document.visibilityState !== 'visible' || !listeners.size) return;
  const r = await api.rev().catch(() => null);
  if (!r) return;
  const moved = last != null && r.rev !== last;
  last = r.rev;
  // The router's Dawnline changed under this page (an update): its bundle
  // and RPC shapes may not match any more.
  if (r.version) {
    if (version && r.version !== version) {
      notify(`Dawnline was updated to ${r.version}: reload the page.`, 'warning', 15000);
      version = null;
    } else version ??= r.version;
  }
  if (moved) listeners.forEach((f) => f());
}

/**
 * Call `f` whenever the revision moves; returns the unsubscribe. The tick is
 * (re)added on every subscription: Outline's same-document router flushes the
 * poll queue on navigation, and poll.add is a no-op while it is queued.
 */
export function onLiveChange(f: () => void): () => void {
  listeners.add(f);
  poll.add(tick, EVERY);
  return () => {
    listeners.delete(f);
    if (!listeners.size) poll.remove(tick);
  };
}
