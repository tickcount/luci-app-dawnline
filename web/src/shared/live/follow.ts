// Following the backend's stream: a snapshot once, then every event in order,
// and what to do when that order breaks (a tab that slept, a connection that
// dropped, a backend that restarted). The rules, the same over any transport:
//
//   * events are numbered; the next one is the last seen plus one. Anything
//     else (a gap, another epoch) means "ask where we are" (sync): the
//     backend answers with what was missed, or with a new snapshot;
//   * a page follows by the event stream where the web server can hold one,
//     and by a held call (long poll) where it cannot; a stream that fails
//     twice in a row is given up for the long poll;
//   * a hidden page follows nothing; shown again, it asks where things are;
//   * a failure never clears what the page shows: the store marks it old.
//
// No DOM and no LuCI here: the transport and the clock come from outside
// (admin/state/transport.ts, portal/api.ts), so the rules are tested alone.

import { signal, type Signal } from './signal';
import type { LiveEvent, LiveStore } from './store';
import type { Doc } from './patch';

/** hello's answer: where the stream is and how to follow it. */
export interface Hello {
  version: string;
  stream: 'sse' | 'poll';
  epoch: string;
  seq: number;
  /** Seconds a `watch` holds. */
  lease: number;
  /** The router's clock (seconds), when it said so. */
  now?: number;
  /** The questions this backend answers itself, which the ucode backend is then not asked. */
  methods?: string[];
}

/** sync's and wait's answer: a snapshot (docs) or the events since the number asked with. */
export interface Answer {
  epoch: string;
  seq: number;
  docs?: Record<string, Doc>;
  events?: LiveEvent[];
}

/** What comes down the event stream: a change, or a ping with the number the stream is at. */
export type StreamMessage = { kind: 'event'; epoch: string; event: LiveEvent } | { kind: 'ping'; epoch: string; seq: number };

export interface Transport {
  hello(): Promise<Hello>;
  sync(at: { epoch?: string; seq?: number }): Promise<Answer>;
  /** Held until there is an event, at most `timeout` seconds; rejects when `stop` aborts. */
  wait(at: { epoch: string; seq: number; timeout: number }, stop: AbortSignal): Promise<Answer>;
  watch(topics: string[]): Promise<unknown>;
  /** Have the backend read the router now; resolves once its topics hold what is on disk. Absent: it cannot. */
  refresh?(): Promise<unknown>;
  /** The event stream: resolves when it ends, rejects when it fails or `stop` aborts. Absent: long poll only. */
  stream?(on: (m: StreamMessage) => void, stop: AbortSignal): Promise<void>;
}

/** How the page is connected: `live` follows, `connecting` is about to, `offline` failed and tries again. */
export type Link = 'connecting' | 'live' | 'offline';

export interface FollowOptions {
  /** The backend's version changed under the page (an update): its bundle may not match any more. */
  onVersion?: (version: string) => void;
  /** Timers, so a test can hold the clock. */
  setTimeout?: (f: () => void, ms: number) => unknown;
  clearTimeout?: (id: unknown) => void;
}

/** Seconds a held call waits; under LuCI's own limit for a call (20 s). */
const WAIT = 15;
/** A stream silent this long is dead (the backend pings every 15 s). */
const SILENCE = 40_000;
/** Pauses before trying again, the last one repeated. */
const BACKOFF = [1000, 2000, 5000, 10_000];

export class Follower {
  /** How the page is connected, for a "not connected" notice. */
  readonly link: Signal<Link>;

  private state = signal<Link>('connecting');
  private epoch = '';
  private seq = 0;
  private version = '';
  private mode: 'sse' | 'poll' = 'poll';
  private lease = 30;
  private run = 0;
  private stop: AbortController | null = null;
  private fails = 0;
  private streamFails = 0;
  private watched = new Map<string, number>();
  private renew: unknown = null;
  /** The router's clock at the last hello, and this page's clock then (ms). */
  private clock: { router: number; at: number } | null = null;
  private later: (f: () => void, ms: number) => unknown;
  private cancel: (id: unknown) => void;

  constructor(
    private store: LiveStore,
    private transport: Transport,
    private opts: FollowOptions = {},
  ) {
    this.link = this.state;
    this.later = opts.setTimeout ?? ((f, ms) => setTimeout(f, ms));
    this.cancel = opts.clearTimeout ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  }

  /**
   * Read what was just written: the backend brings its topics to what is on the router's disk now, and the
   * store is caught up to there before this resolves. Without the call (an older backend) it resolves at once.
   */
  async fresh(): Promise<void> {
    if (!this.transport.refresh) return;
    await this.transport.refresh();
    await this.catchUp(this.run);
  }

  /** The router's clock now (seconds), from its last hello; null before one that told it. */
  routerNow(): number | null {
    return this.clock ? this.clock.router + (Date.now() - this.clock.at) / 1000 : null;
  }

  /** Start following (the page is shown). Harmless when already following. */
  start(): void {
    if (this.stop) return;
    const stop = (this.stop = new AbortController());
    const run = ++this.run;
    void this.loop(run, stop.signal);
    this.leases();
  }

  /** Stop following (the page is hidden or left). What the store holds stays. */
  pause(): void {
    this.stop?.abort();
    this.stop = null;
    this.run++;
    if (this.renew != null) this.cancel(this.renew);
    this.renew = null;
  }

  /**
   * "This topic is on screen": the backend keeps producing it (the live
   * meter is read from the tunnels only while someone watches). Returns the
   * release; a topic watched twice needs both.
   */
  watch(topic: string): () => void {
    this.watched.set(topic, (this.watched.get(topic) ?? 0) + 1);
    if (this.stop) this.leases();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const n = (this.watched.get(topic) ?? 1) - 1;
      if (n > 0) this.watched.set(topic, n);
      else this.watched.delete(topic);
    };
  }

  private alive(run: number): boolean {
    return run === this.run;
  }

  /** Renew the leases now, and again at a third of their length while any is held. */
  private leases(): void {
    if (this.renew != null) this.cancel(this.renew);
    this.renew = null;
    if (!this.stop || !this.watched.size) return;
    void this.transport.watch([...this.watched.keys()]).catch(() => undefined);
    this.renew = this.later(() => this.leases(), (this.lease * 1000) / 3);
  }

  private async loop(run: number, stop: AbortSignal): Promise<void> {
    while (this.alive(run)) {
      try {
        const hello = await this.transport.hello();
        if (!this.alive(run)) return;
        if (this.version && hello.version !== this.version) this.opts.onVersion?.(hello.version);
        this.version = hello.version;
        if (hello.now) this.clock = { router: hello.now, at: Date.now() };
        this.lease = hello.lease || this.lease;
        this.mode = hello.stream === 'sse' && this.transport.stream && this.streamFails < 2 ? 'sse' : 'poll';
        if (this.mode === 'sse') await this.followStream(run, stop);
        else await this.followPoll(run, stop);
      } catch {
        // Counted below: the pause grows with every failure in a row.
      }
      if (!this.alive(run)) return;
      this.state.set('offline');
      this.store.offline(true);
      const pause = BACKOFF[Math.min(this.fails++, BACKOFF.length - 1)];
      await new Promise<void>((done) => this.later(done, pause));
    }
  }

  /** Ask where the stream is and take the answer in. */
  private async catchUp(run: number): Promise<void> {
    const a = await this.transport.sync(this.epoch ? { epoch: this.epoch, seq: this.seq } : {});
    if (this.alive(run)) this.take(a);
  }

  private take(a: Answer): void {
    // Two answers may cross (a held call and a catch-up asked meanwhile): the older one adds nothing, and
    // must not set the place in the stream back, or its events would be asked for and applied again.
    const same = a.epoch === this.epoch;
    if (same && a.seq < this.seq) return;
    if (a.docs) this.store.reset(a.docs);
    else for (const e of a.events ?? []) if (e.seq > this.seq || !same) this.store.apply(e);
    this.epoch = a.epoch;
    this.seq = a.seq;
    this.fails = 0;
    this.store.offline(false);
    this.state.set('live');
  }

  private async followPoll(run: number, stop: AbortSignal): Promise<void> {
    await this.catchUp(run);
    while (this.alive(run)) {
      const a = await this.transport.wait({ epoch: this.epoch, seq: this.seq, timeout: WAIT }, stop);
      if (!this.alive(run)) return;
      this.take(a);
    }
  }

  private async followStream(run: number, stop: AbortSignal): Promise<void> {
    // The stream is opened first and its events kept until the snapshot is in:
    // nothing that happens between the two is lost.
    let synced = false;
    let asking = false;
    const early: StreamMessage[] = [];
    const ended = new AbortController();
    const end = (): void => ended.abort();
    stop.addEventListener('abort', end);
    let quiet: unknown = null;
    const heard = (): void => {
      if (quiet != null) this.cancel(quiet);
      quiet = this.later(end, SILENCE);
    };
    const resync = (): void => {
      if (asking) return;
      asking = true;
      this.catchUp(run)
        .catch(end)
        .finally(() => (asking = false));
    };
    const on = (m: StreamMessage): void => {
      if (!this.alive(run)) return;
      heard();
      if (!synced) {
        early.push(m);
        return;
      }
      if (m.epoch !== this.epoch) return resync();
      if (m.kind === 'ping') {
        if (m.seq > this.seq) resync();
        return;
      }
      if (m.event.seq <= this.seq) return;
      if (m.event.seq !== this.seq + 1) return resync();
      this.store.apply(m.event);
      this.seq = m.event.seq;
    };
    heard();
    const stream = this.transport.stream!(on, ended.signal);
    try {
      await this.catchUp(run);
      synced = true;
      early.splice(0).forEach(on);
      await stream;
      // A stream that ends by itself failed: the web server let it go.
      throw new Error('stream ended');
    } catch (e) {
      if (this.alive(run) && !stop.aborted) this.streamFails++;
      throw e;
    } finally {
      stop.removeEventListener('abort', end);
      if (quiet != null) this.cancel(quiet);
      end();
      // Not waited for: it has been told to stop.
      stream.catch(() => undefined);
    }
  }
}
