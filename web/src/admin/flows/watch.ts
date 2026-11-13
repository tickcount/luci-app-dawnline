// The admin's watcher for the set-up sheet's way (portal/ui/wait-way.ts
// Watcher): while the sheet waits for a device's first connection with its
// new configuration, the status is read on the live revision (the agent moves
// it when the device connects) and on a timer for what the revision does not
// carry (its knocks: Device.setup), 5 s for the first minute, then 15 s, ten
// minutes at most, not while the tab is hidden. Each answer is read into the
// way's state (portal/way.ts).

import type { Device, Status } from '../../shared/types';
import type { Watcher } from '../../portal/ui/wait-way';
import { wayState, type WayState } from '../../portal/way';
import { api } from '../api';
import { onLiveChange } from '../state/live';

/** A watcher that counts from `opened` (router clock); `fresh` gets each status it read (the page repaints with it). */
export function statusWatcher(opened: number, fresh?: (st: Status) => void): Watcher {
  return (d: Device, seen, gaveUp) => {
    let done = false;
    let timer = 0;
    let polls = 0;
    let last: WayState = 'waiting';
    const started = Date.now();
    const poll = async () => {
      clearTimeout(timer);
      timer = 0;
      if (done) return;
      if (last !== 'connected' && Date.now() - started > 600_000) {
        done = true;
        off();
        gaveUp();
        return;
      }
      if (document.visibilityState === 'visible') {
        const st = await api.status(1).catch(() => null);
        if (done) return;
        if (st) {
          fresh?.(st);
          const dev = st.people.flatMap((p) => p.devices).find((x) => x.id === d.id);
          const next = wayState(dev, opened);
          if (next !== last) {
            last = next;
            seen(next);
          }
        }
      }
      polls++;
      timer = window.setTimeout(poll, polls < 12 ? 5000 : 15000);
    };
    const off = onLiveChange(() => void poll());
    timer = window.setTimeout(poll, 2000);
    return () => {
      done = true;
      clearTimeout(timer);
      off();
    };
  };
}
