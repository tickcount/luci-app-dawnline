import { describe, expect, it } from 'vitest';
import { batch, computed, effect, signal } from '../src/shared/live/signal';
import { appended, merge, rows } from '../src/shared/live/patch';
import { LiveStore, type LiveEvent } from '../src/shared/live/store';
import { Follower, type Answer, type Hello, type StreamMessage, type Transport } from '../src/shared/live/follow';
import { share } from '../src/shared/live/share';
import { LiveDoc } from '../src/shared/live/doc';

describe('signals', () => {
  it('runs an effect again only for what it read', () => {
    const a = signal(1);
    const b = signal(10);
    const seen: number[] = [];
    const stop = effect(() => void seen.push(a()));
    b.set(11);
    a.set(2);
    a.set(2);
    stop();
    a.set(3);
    expect(seen).toEqual([1, 2]);
  });

  it('works a computed out again only when read after a change', () => {
    const a = signal(2);
    let runs = 0;
    const double = computed(() => (runs++, a() * 2));
    expect(runs).toBe(0);
    expect(double()).toBe(4);
    expect(double()).toBe(4);
    a.set(3);
    expect(runs).toBe(1);
    expect(double()).toBe(6);
    expect(runs).toBe(2);
  });

  it('follows a computed from an effect, and drops what a branch no longer reads', () => {
    const on = signal(true);
    const name = signal('Myata');
    const label = computed(() => (on() ? name() : 'off'));
    const seen: string[] = [];
    effect(() => void seen.push(label()));
    name.set('Guest');
    on.set(false);
    name.set('Nobody');
    expect(seen).toEqual(['Myata', 'Guest', 'off']);
  });

  it('runs effects once for a batch', () => {
    const a = signal(1);
    const b = signal(1);
    let runs = 0;
    effect(() => void (a(), b(), runs++));
    batch(() => {
      a.set(2);
      b.set(2);
    });
    expect(runs).toBe(2);
  });

  it('puts an effect off, once, however much changed; a run that did nothing keeps what it read', () => {
    const a = signal(1);
    const b = signal(1);
    const due: (() => void)[] = [];
    const seen: string[] = [];
    let skip = false;
    const stop = effect(
      () => {
        if (skip) return false;
        seen.push(`${a()}/${b()}`);
      },
      (run) => void due.push(run),
    );
    a.set(2);
    b.set(2);
    expect([seen, due.length]).toEqual([['1/1'], 1]);
    due.splice(0).forEach((run) => run());
    expect(seen).toEqual(['1/1', '2/2']);
    // skipped: it read nothing this time, and is still told when `a` changes
    skip = true;
    a.set(3);
    due.splice(0).forEach((run) => run());
    skip = false;
    b.set(3);
    due.splice(0).forEach((run) => run());
    expect(seen).toEqual(['1/1', '2/2', '3/3']);
    stop();
    a.set(4);
    expect(due.length).toBe(0);
  });

  it('lets a computed go', () => {
    const a = signal(1);
    let runs = 0;
    const c = computed(() => (runs++, a()));
    c();
    c.stop();
    a.set(2);
    expect(runs).toBe(1);
    expect(c()).toBe(2);
  });
});

describe('an answer laid over the last one', () => {
  it('keeps every part that did not change the object it was', () => {
    const old = {
      people: [
        { id: 'a', online: 0, devices: [{ id: 'd1' }] },
        { id: 'b', online: 1 },
      ],
      tz: 'UTC',
    };
    const next = {
      people: [
        { id: 'a', online: 1, devices: [{ id: 'd1' }] },
        { id: 'b', online: 1 },
      ],
      tz: 'UTC',
    };
    const got = share(old, next);
    expect(got).toEqual(next);
    expect(got.people[1]).toBe(old.people[1]);
    expect(got.people[0]).not.toBe(old.people[0]);
    expect(got.people[0].devices).toBe(old.people[0].devices);
    expect(share(old, structuredClone(old))).toBe(old);
  });

  it('knows a thing by its id wherever it stands, and a list that grew or shrank', () => {
    const a = { id: 'a', n: 1 };
    const b = { id: 'b', n: 2 };
    const got = share(
      [a, b],
      [
        { id: 'b', n: 2 },
        { id: 'c', n: 3 },
        { id: 'a', n: 1 },
      ],
    );
    expect([got[0], got[2]]).toEqual([b, a]);
    expect(got[0]).toBe(b);
    expect(got[2]).toBe(a);
    expect(share([1, 2], [1, 2, 3])).toEqual([1, 2, 3]);
    expect(share({ a: 1, b: 2 }, { a: 1 })).toEqual({ a: 1 });
    expect(share(null, { a: 1 })).toEqual({ a: 1 });
    expect(share([1], { 0: 1 })).toEqual({ 0: 1 });
  });

  it("tells a field's readers only when that field changed", () => {
    const doc = new LiveDoc<{ servers: { id: string; up: boolean }[]; now: number; tz?: string }>();
    doc.feed({ servers: [{ id: 's1', up: true }], now: 1, tz: 'UTC' });
    const seen: string[] = [];
    const stop = effect(() => void seen.push(doc.view.servers.map((s) => `${s.id}:${s.up}`).join()));
    const first = doc.view.servers[0];
    doc.feed({ servers: [{ id: 's1', up: true }], now: 2, tz: 'UTC' });
    expect(seen).toEqual(['s1:true']);
    expect(doc.view.servers[0]).toBe(first);
    doc.feed({ servers: [{ id: 's1', up: false }], now: 3 });
    expect(seen).toEqual(['s1:true', 's1:false']);
    expect('tz' in doc.view).toBe(false);
    expect({ ...doc.view }).toEqual({ servers: [{ id: 's1', up: false }], now: 3 });
    expect(doc.plain()).toEqual({ servers: [{ id: 's1', up: false }], now: 3 });
    stop();
  });
});

describe('merge patch', () => {
  it('applies a patch and shares what it did not touch', () => {
    const doc = { p1: { name: 'Myata', devices: { d1: { online: false }, d2: { online: true } } }, p2: { name: 'Guest' } };
    const next = merge(doc, { p1: { devices: { d1: { online: true } } } }) as typeof doc;
    expect(next.p1.devices.d1.online).toBe(true);
    expect(doc.p1.devices.d1.online).toBe(false);
    expect(next.p2).toBe(doc.p2);
    expect(next.p1.devices.d2).toBe(doc.p1.devices.d2);
    expect(next.p1).not.toBe(doc.p1);
  });

  it('removes with null, replaces lists whole, and returns the same object for no change', () => {
    const doc = { a: 1, l: [1, 2, 3], t: { x: 1 } };
    expect(merge(doc, { a: null, l: [9] })).toEqual({ l: [9], t: { x: 1 } });
    expect(merge(doc, { t: { x: 1 }, gone: null })).toBe(doc);
    expect(merge('text', { a: 1 })).toEqual({ a: 1 });
    expect(merge(doc, [1])).toEqual([1]);
  });

  it('keeps the newest entries of a list, and reads a keyed list in order', () => {
    expect(appended([1, 2], [3, 4], 3)).toEqual([2, 3, 4]);
    expect(appended(undefined, [1], 0)).toEqual([1]);
    expect(rows({ order: ['b', 'a', 'gone'], items: { a: 1, b: 2 } })).toEqual([2, 1]);
    expect(rows(undefined)).toEqual([]);
  });
});

describe('store', () => {
  it('tells a place only when that place changed', () => {
    const store = new LiveStore();
    const online = store.at<boolean>('people', 'items', 'p1', 'online');
    const name = store.at<string>('people', 'items', 'p1', 'name');
    const seen: unknown[] = [];
    let names = 0;
    effect(() => void seen.push(online()));
    effect(() => void (name(), names++));
    store.apply({ seq: 1, topic: 'people', op: 'put', data: { items: { p1: { name: 'Myata', online: false } } } });
    store.apply({ seq: 2, topic: 'people', op: 'patch', data: { items: { p1: { online: true } } } });
    store.apply({ seq: 3, topic: 'people', op: 'patch', data: { items: { p2: { name: 'Guest' } } } });
    expect(seen).toEqual([undefined, false, true]);
    expect(names).toBe(2);
  });

  it('knows pending from ready from stale', () => {
    const store = new LiveStore();
    const st = store.state('people');
    expect(st()).toBe('pending');
    store.reset({ people: { items: {} } });
    expect(st()).toBe('ready');
    store.offline(true);
    expect(st()).toBe('stale');
    expect(store.state('meter')()).toBe('pending');
    store.offline(false);
    store.reset({});
    expect(st()).toBe('pending');
    expect(store.peek('people')).toBeUndefined();
  });

  it('appends to a list and drops a topic', () => {
    const store = new LiveStore();
    store.apply({ seq: 1, topic: 'meter', op: 'append', data: { items: [1, 2], keep: 3 } });
    store.apply({ seq: 2, topic: 'meter', op: 'append', data: { items: [3, 4], keep: 3 } });
    expect(store.peek('meter')).toEqual([2, 3, 4]);
    store.apply({ seq: 3, topic: 'meter', op: 'drop' });
    expect(store.state('meter')()).toBe('pending');
  });
});

/** A backend to follow: a hub in a few lines, and a clock the test moves. */
function stand(mode: 'sse' | 'poll') {
  let seq = 0;
  let epoch = 'run1';
  let docs: Record<string, unknown> = {};
  const journal: LiveEvent[] = [];
  const waiters: (() => void)[] = [];
  const streams = new Set<(m: StreamMessage) => void>();
  const calls = { hello: 0, sync: 0, wait: 0, watch: [] as string[][], streams: 0, refresh: 0 };
  let onRefresh: (() => void) | null = null;
  const timers: { at: number; f: () => void; id: number }[] = [];
  let now = 0;
  let ids = 0;
  let failing = false;
  let dropNext = false;

  const answer = (at: { epoch?: string; seq?: number }): Answer => {
    if (at.epoch === epoch && at.seq != null && at.seq <= seq) return { epoch, seq, events: journal.filter((e) => e.seq > at.seq!) };
    return { epoch, seq, docs: structuredClone(docs) };
  };
  const transport: Transport = {
    async hello(): Promise<Hello> {
      calls.hello++;
      if (failing) throw new Error('down');
      return { version: '1', stream: mode, epoch, seq, lease: 30 };
    },
    async sync(at) {
      calls.sync++;
      if (failing) throw new Error('down');
      return answer(at);
    },
    wait(at, stop) {
      calls.wait++;
      return new Promise<Answer>((done, fail) => {
        const settle = (): void => (failing ? fail(new Error('down')) : done(answer(at)));
        if (answer(at).docs || answer(at).events!.length) return settle();
        waiters.push(settle);
        stop.addEventListener('abort', () => fail(new Error('aborted')));
      });
    },
    async watch(topics) {
      calls.watch.push(topics);
    },
    async refresh() {
      calls.refresh++;
      onRefresh?.();
    },
    stream(on, stop) {
      calls.streams++;
      return new Promise<void>((_done, fail) => {
        if (failing) return fail(new Error('down'));
        streams.add(on);
        stop.addEventListener('abort', () => {
          streams.delete(on);
          fail(new Error('aborted'));
        });
      });
    },
  };
  return {
    transport,
    calls,
    put(topic: string, doc: unknown): void {
      docs[topic] = doc;
      const e: LiveEvent = { seq: ++seq, topic, op: 'put', data: structuredClone(doc) };
      journal.push(e);
      waiters.splice(0).forEach((w) => w());
      if (dropNext) dropNext = false;
      else streams.forEach((s) => s({ kind: 'event', epoch, event: e }));
    },
    ping: (): void => streams.forEach((s) => s({ kind: 'ping', epoch, seq })),
    /** What the backend finds on the router when it is asked to look now. */
    whenRefreshed: (f: () => void): void => void (onRefresh = f),
    /** The next event is not sent down the stream. */
    loseNext: (): void => void (dropNext = true),
    restart(): void {
      epoch = 'run2';
      seq = 0;
      docs = {};
      journal.length = 0;
    },
    fail(on: boolean): void {
      failing = on;
      if (on) waiters.splice(0).forEach((w) => w());
    },
    options: {
      setTimeout: (f: () => void, ms: number): unknown => (timers.push({ at: now + ms, f, id: ++ids }), ids),
      clearTimeout: (id: unknown): void => {
        const i = timers.findIndex((t) => t.id === id);
        if (i >= 0) timers.splice(i, 1);
      },
    },
    /** Let the promises settle, then move the clock and run what is due. */
    async pass(ms = 0): Promise<void> {
      for (let i = 0; i < 20; i++) await Promise.resolve();
      now += ms;
      for (const t of timers.filter((x) => x.at <= now)) {
        timers.splice(timers.indexOf(t), 1);
        t.f();
      }
      for (let i = 0; i < 20; i++) await Promise.resolve();
    },
  };
}

describe.each(['poll', 'sse'] as const)('following by %s', (mode) => {
  it('takes a snapshot, then every change', async () => {
    const s = stand(mode);
    s.put('people', { n: 1 });
    const store = new LiveStore();
    const f = new Follower(store, s.transport, s.options);
    f.start();
    await s.pass();
    expect(f.link()).toBe('live');
    expect(store.peek('people')).toEqual({ n: 1 });
    s.put('people', { n: 2 });
    s.put('servers', { up: true });
    await s.pass();
    expect(store.peek('people')).toEqual({ n: 2 });
    expect(store.state('servers')()).toBe('ready');
    f.pause();
  });

  it('keeps what it shows when the backend goes away, and catches up when it is back', async () => {
    const s = stand(mode);
    s.put('people', { n: 1 });
    const store = new LiveStore();
    const f = new Follower(store, s.transport, s.options);
    f.start();
    await s.pass();
    s.fail(true);
    if (mode === 'sse') {
      f.pause();
      f.start();
    }
    await s.pass();
    expect(f.link()).toBe('offline');
    expect(store.state('people')()).toBe('stale');
    expect(store.peek('people')).toEqual({ n: 1 });
    s.fail(false);
    s.put('people', { n: 2 });
    await s.pass(1000);
    await s.pass(2000);
    expect(f.link()).toBe('live');
    expect(store.peek('people')).toEqual({ n: 2 });
    expect(store.state('people')()).toBe('ready');
    f.pause();
  });

  it('starts over after the backend restarted', async () => {
    const s = stand(mode);
    s.put('people', { n: 1 });
    s.put('old', { x: 1 });
    const store = new LiveStore();
    const f = new Follower(store, s.transport, s.options);
    f.start();
    await s.pass();
    f.pause();
    s.restart();
    s.put('people', { n: 5 });
    f.start();
    await s.pass();
    expect(store.peek('people')).toEqual({ n: 5 });
    expect(store.state('old')()).toBe('pending');
    f.pause();
  });

  it('follows nothing while paused, and renews what is watched while it runs', async () => {
    const s = stand(mode);
    const store = new LiveStore();
    const f = new Follower(store, s.transport, s.options);
    const release = f.watch('meter');
    f.start();
    await s.pass();
    expect(s.calls.watch).toEqual([['meter']]);
    await s.pass(10_000);
    expect(s.calls.watch.length).toBe(2);
    release();
    await s.pass(10_000);
    expect(s.calls.watch.length).toBe(2);
    f.pause();
    s.put('people', { n: 1 });
    await s.pass();
    expect(store.peek('people')).toBeUndefined();
    f.start();
    await s.pass();
    expect(store.peek('people')).toEqual({ n: 1 });
    f.pause();
  });

  it('reads what was just written: the store holds it when the question returns', async () => {
    const b = stand(mode);
    const store = new LiveStore();
    const f = new Follower(store, b.transport, b.options);
    b.put('people', { n: 1 });
    f.start();
    await b.pass();
    // the page wrote; the backend sees it on disk only when it looks
    b.loseNext();
    b.whenRefreshed(() => b.put('people', { n: 2 }));
    await f.fresh();
    expect([b.calls.refresh, store.peek('people')]).toEqual([1, { n: 2 }]);
    // the answers that crossed it add nothing twice, and the next change is followed as before
    await b.pass();
    b.put('people', { n: 3 });
    await b.pass();
    expect(store.peek('people')).toEqual({ n: 3 });
    f.pause();
  });
});

describe('the event stream', () => {
  it('asks for what it missed when a number is skipped, or a ping is ahead', async () => {
    const s = stand('sse');
    const store = new LiveStore();
    const f = new Follower(store, s.transport, s.options);
    f.start();
    await s.pass();
    s.loseNext();
    s.put('a', { n: 1 });
    s.put('b', { n: 1 });
    await s.pass();
    expect(store.peek('a')).toEqual({ n: 1 });
    expect(store.peek('b')).toEqual({ n: 1 });
    s.loseNext();
    s.put('a', { n: 2 });
    await s.pass();
    expect(store.peek('a')).toEqual({ n: 1 });
    s.ping();
    await s.pass();
    expect(store.peek('a')).toEqual({ n: 2 });
    f.pause();
  });

  it('gives a silent stream up, and the stream itself after two failures', async () => {
    const s = stand('sse');
    const store = new LiveStore();
    const f = new Follower(store, s.transport, s.options);
    f.start();
    await s.pass();
    expect(s.calls.streams).toBe(1);
    await s.pass(40_000);
    expect(f.link()).toBe('offline');
    await s.pass(1000);
    expect(s.calls.streams).toBe(2);
    await s.pass(40_000);
    await s.pass(2000);
    expect(s.calls.streams).toBe(2);
    expect(s.calls.wait).toBeGreaterThan(0);
    expect(f.link()).toBe('live');
    f.pause();
  });
});
