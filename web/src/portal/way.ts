// What the set-up sheet's way shows, read off the device in the router's last
// answer (`setup` on every device view: the agent's watcher's; without the
// agent the router counts a session that lives as data flowing): waiting,
// can't finish (its knocks reach the router, no handshake follows), connected
// (a handshake since the sheet opened, and data coming through), no data (a
// handshake since then, but nothing in except handshakes and keep-alives: it
// sends from an address the router does not expect, so the router drops it).
// Pure: flows/wait.ts polls for it and draws it.

import type { Device } from '../shared/types';

export type WayState = 'waiting' | 'trying' | 'connected' | 'nodata';

/**
 * The way's state for `d` (undefined: no longer in the answer), `opened` being when the sheet opened (router
 * clock). Arrival is data flowing, not the first handshake, so no data shows instead of the sheet closing; a
 * handshake from before the sheet is not this set-up's. Knocks that never finish show whenever they come. Anything
 * else (the device gone offline, quiet, or removed) is plain waiting.
 */
export function wayState(d: Device | undefined, opened: number): WayState {
  if (!d) return 'waiting';
  if (d.setup?.state === 'trying') return 'trying';
  if (d.handshake <= opened) return 'waiting';
  if (d.setup?.state === 'flowing') return 'connected';
  return d.setup?.state === 'nodata' ? 'nodata' : 'waiting';
}
