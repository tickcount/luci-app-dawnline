// When something changed on the router: the backend's stream (state/stream.ts) says so the moment it
// happens, and nothing is asked. While the backend does not answer yet (it is starting), it is looked for
// again every couple of seconds, and followed from then on.

import { notify } from '../ui/toast';
import { fmt } from '../../shared/i18n';
import { onBackendVersion, onStreamChange, streamReady } from './stream';

const EVERY = 2;

const listeners = new Set<() => void>();
/** What the listeners are told through, once the stream is there. */
let offStream: (() => void) | null = null;

/** Looks for the backend again; once it answers, the listeners follow its stream and are told at once. */
async function tick(): Promise<void> {
  if (document.visibilityState !== 'visible' || !listeners.size || offStream) return;
  if (!(await streamReady())) return;
  poll.remove(tick);
  follow();
  listeners.forEach((f) => f());
}

function follow(): void {
  offStream ??= onStreamChange(() => document.visibilityState === 'visible' && listeners.forEach((f) => f()));
}

/**
 * Call `f` whenever something changed on the router; returns the unsubscribe. The tick is
 * (re)added on every subscription: Outline's same-document router flushes the
 * poll queue on navigation, and poll.add is a no-op while it is queued.
 */
export function onLiveChange(f: () => void): () => void {
  listeners.add(f);
  let gone = false;
  void streamReady().then((on) => {
    if (gone) return;
    if (on) follow();
    else poll.add(tick, EVERY);
  });
  return () => {
    gone = true;
    listeners.delete(f);
    if (!listeners.size) {
      poll.remove(tick);
      offStream?.();
      offStream = null;
    }
  };
}

// The backend's version changed under the page (an update): the same word as the revision's.
onBackendVersion((v) => notify(fmt(_('Dawnline was updated to %s: reload the page.'), v), 'warning', 15000));
