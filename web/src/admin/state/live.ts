// The live revision: one small `rev` call every 2 s while the page is visible.
// The agent moves it the moment a device connects, goes away or roams, or
// something is logged; pollers that opt in refresh then, so pages follow the
// router within seconds without fetching the full status that often.

import { api } from '../api';

const EVERY = 2;

const listeners = new Set<() => void>();
let last: number | null = null;
let started = false;

async function tick(): Promise<void> {
  if (document.visibilityState !== 'visible' || !listeners.size) return;
  const r = await api.rev().catch(() => null);
  if (!r) return;
  const moved = last != null && r.rev !== last;
  last = r.rev;
  if (moved) listeners.forEach((f) => f());
}

/** Call `f` whenever the revision moves; returns the unsubscribe. */
export function onLiveChange(f: () => void): () => void {
  listeners.add(f);
  if (!started) {
    started = true;
    poll.add(tick, EVERY);
  }
  return () => listeners.delete(f);
}
