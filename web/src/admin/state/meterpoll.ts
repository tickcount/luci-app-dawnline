// The live meter's poller: one meter call a second while a speed is on screen
// (the router keeps the last two minutes and writes them out while someone
// asks). A failed call is said in the tile, not in a second "not answering"
// toast beside the page's status poller.

import { api } from '../api';
import { errorText } from '../ui/toast';
import { createPoller, type Poller } from './poller';
import type { LiveMeter, MeterAnswer } from './meter';

export function pollMeter(meter: LiveMeter, active: () => boolean, paint: () => void): Poller<MeterAnswer> {
  return createPoller<MeterAnswer>({
    fetch: () =>
      api.meter(meter.since(Date.now())).then(
        (m) => ({ meter: m }),
        (e) => ({ error: errorText(e) }),
      ),
    every: 1,
    active,
    apply: (r) => {
      meter.take(r, Date.now());
      paint();
    },
  });
}
