// The admin's place on the backend's stream (docs/backend.md): one store and one follower for the page,
// started with the first question and paused while the tab is hidden. Pages that still read whole answers
// get them from here (`streamStatus`, `streamMeter`) instead of asking the router: the backend asks it once
// for every open tab, and only when something changed.
//
// The backend may not be there (a package without it, an older router, a session opened before its access
// was granted): then `streamReady()` is false, and state/live.ts and api.ts fall back to asking the router
// as they always did. That fallback goes when every release carries the backend (docs/backend.md › Stages).

import { effect } from '../../shared/live/signal';
import { LiveStore } from '../../shared/live/store';
import { Follower } from '../../shared/live/follow';
import type { Status } from '../../shared/types';
import type { Meter, MeterPoint } from '../api';
import { STATUS_TOPICS, joinStatus } from './join';
import { luciTransport } from './transport';

/** Topics older than this were read from the router before the page looked: it waits for the read its look starts (s). */
const FRESH = 40;
/** How long a page waits for that read before it asks the router itself (ms). */
const PATIENCE = 3000;
/** While it waits, the backend's snapshot is asked for this often (ms). */
const ASK_EVERY = 700;
/** The meter is watched this long after it was last asked for (ms). */
const METER_IDLE = 5000;

const store = new LiveStore();
let follower: Follower | null = null;
let ready: Promise<boolean> | null = null;
let version: ((v: string) => void) | null = null;
/** The backend is not answering (its `hello`, or the status it should have read): it is starting, or was just restarted. */
let silent = false;
/** A `hello` unanswered this long is a backend not answering yet (ms): a restarted one keeps it waiting, it does not refuse. */
const HELLO_SLOW = 1000;

/** Whether the backend is not answering yet: what a page that waits for it says (shell/waiting.ts). */
export const backendSilent = (): boolean => silent;

/** How far the page's start has come: the backend answered its `hello` (1), the router's state is in hand (2). */
let phase: 0 | 1 | 2 = 0;
export const startPhase = (): 0 | 1 | 2 => phase;

/** The backend's version changed under the page: called with the new one. */
export function onBackendVersion(f: (v: string) => void): void {
  version = f;
}

/**
 * Whether the page follows the stream. The first call finds out (one `hello`). A backend that does not answer
 * (it is starting, or was just restarted) is asked again after a moment: there is nobody else to ask.
 */
export function streamReady(): Promise<boolean> {
  ready ??= (async () => {
    let transport;
    const slow = setTimeout(() => (silent = true), HELLO_SLOW);
    try {
      transport = luciTransport();
      await transport.hello();
    } catch {
      silent = true;
      setTimeout(() => (ready = null), 2000);
      return false;
    } finally {
      clearTimeout(slow);
    }
    silent = false;
    phase = 1;
    follower = new Follower(store, transport, { onVersion: (v) => version?.(v) });
    const show = () => (document.visibilityState === 'visible' ? follower!.start() : follower!.pause());
    document.addEventListener('visibilitychange', show);
    show();
    return true;
  })();
  return ready;
}

/** Call `f` when what a status is made of changed on the stream; returns the stop. */
export function onStreamChange(f: () => void): () => void {
  let first = true;
  let queued = false;
  return effect(() => {
    // the clock ticks with every read of the router: it is no change of anything shown
    for (const t of STATUS_TOPICS) if (t !== 'clock') store.at(t)();
    if (first) return void (first = false);
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      f();
    });
  });
}

let wrote = false;

/** The page changed something on the router: the next status is read after the backend has looked again. */
export function markWritten(): void {
  wrote = true;
}

function fresh(): boolean {
  const at = store.peek<{ ok?: boolean; at?: number }>('backend');
  const now = follower?.routerNow();
  return !!at?.ok && at.at != null && now != null && now - at.at < FRESH;
}

/**
 * The status as the stream has it, or null when the page should ask the router itself (no backend, or its
 * topics did not come in time). A page that opens on topics read long ago waits for the read its own look
 * starts, a moment later.
 */
export async function streamStatus(): Promise<Status | null> {
  if (!(await streamReady())) return null;
  if (wrote) {
    wrote = false;
    // a backend that cannot (an older one) or does not answer: the page asks the router itself
    try {
      await follower!.fresh();
    } catch {
      return null;
    }
  }
  const have = () => (fresh() ? joinStatus((t) => store.peek(t)) : null);
  const now = have();
  if (now) {
    phase = 2;
    return now;
  }
  return new Promise<Status | null>((done) => {
    let stop: (() => void) | null = null;
    let over = false;
    const end = (v: Status | null) => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      stop?.();
      silent = !v;
      // no state in time: the backend is back to reading the router (a restart under an open page)
      phase = v ? 2 : 1;
      done(v);
    };
    const timer = setTimeout(() => end(null), PATIENCE);
    stop = effect(() => {
      store.at('backend')();
      for (const t of STATUS_TOPICS) store.at(t)();
      const st = have();
      if (st) queueMicrotask(() => end(st));
    });
    // A backend just started tells its first topics on the stream only after a long while (measured after a
    // deploy: every question answered by 2.6 s, the stream's first events at 22 s). So the snapshot is asked for
    // too, again and again while the page waits: whichever brings the topics first ends the wait.
    void (async () => {
      while (!over) {
        await new Promise((t) => setTimeout(t, ASK_EVERY));
        if (over) return;
        try {
          await follower!.fresh();
        } catch {
          return;
        }
        const st = have();
        if (st) end(st);
      }
    })();
  });
}

let meterHeld: (() => void) | null = null;
let meterIdle: ReturnType<typeof setTimeout> | null = null;

/**
 * The live meter's points after `since` as the stream has them, or null without the backend. Asking keeps
 * the meter watched for a few seconds more (the backend's file for pages that ask the old way; the stream itself
 * carries the two minutes always, so the first asking has them at once).
 */
export async function streamMeter(since: number): Promise<Meter | null> {
  if (!(await streamReady()) || !follower) return null;
  meterHeld ??= follower.watch('meter');
  if (meterIdle) clearTimeout(meterIdle);
  meterIdle = setTimeout(() => {
    meterHeld?.();
    meterHeld = null;
  }, METER_IDLE);
  const all = store.peek<MeterPoint[]>('meter') ?? [];
  const points = all.filter((p) => p.ts > since);
  return { now: follower.routerNow() ?? Date.now() / 1000, want: 10, keep: 120, ts: all.length ? all[all.length - 1].ts : 0, points };
}
