// Signals: values that tell who read them when they change. The live layer's
// one way to reach the DOM: a text node, an attribute or a list reads the
// signals it shows inside an effect, and only that effect runs again when one
// of them moves. No framework, no virtual DOM, no "render the page again".
//
// Small on purpose (signal, computed, effect, batch): what the pages need to
// follow a stream, not a general reactive library.

/** A value that can be read; reading it inside an effect or a computed subscribes that to it. */
export interface Signal<T> {
  (): T;
  /** The value without subscribing. */
  peek(): T;
}

/** A signal that can be set. Setting an equal value (Object.is) tells nobody. */
export interface Writable<T> extends Signal<T> {
  set(v: T): void;
}

interface Reader {
  sources: Set<Source>;
  /** One of its sources changed. */
  stale(): void;
}

class Source {
  readers = new Set<Reader>();

  track(): void {
    if (!current) return;
    this.readers.add(current);
    current.sources.add(this);
  }

  changed(): void {
    // A copy: a reader that runs subscribes again, to this very set.
    for (const r of Array.from(this.readers)) r.stale();
  }
}

let current: Reader | null = null;
let batching = 0;
const pending = new Set<() => void>();

function flush(): void {
  while (pending.size) {
    const runs = [...pending];
    pending.clear();
    for (const run of runs) run();
  }
}

function unsubscribe(r: Reader): void {
  for (const s of r.sources) s.readers.delete(r);
  r.sources.clear();
}

/** A value to follow. */
export function signal<T>(initial: T): Writable<T> {
  const source = new Source();
  let value = initial;
  const read = (() => {
    source.track();
    return value;
  }) as Writable<T>;
  read.peek = () => value;
  read.set = (v: T) => {
    if (Object.is(v, value)) return;
    value = v;
    source.changed();
    if (!batching) flush();
  };
  return read;
}

/** A computed value that can be let go: it stops listening to what it read. */
export interface Computed<T> extends Signal<T> {
  stop(): void;
}

/** A value worked out from other signals, again only when one of them changed and someone reads it. */
export function computed<T>(fn: () => T): Computed<T> {
  const source = new Source();
  let value!: T;
  let dirty = true;
  const reader: Reader = {
    sources: new Set(),
    stale() {
      if (dirty) return;
      dirty = true;
      source.changed();
    },
  };
  const get = (): T => {
    if (dirty) {
      unsubscribe(reader);
      const outer = current;
      current = reader;
      try {
        value = fn();
      } finally {
        current = outer;
      }
      dirty = false;
    }
    return value;
  };
  const read = (() => {
    source.track();
    return get();
  }) as Computed<T>;
  read.peek = get;
  read.stop = () => {
    unsubscribe(reader);
    dirty = true;
  };
  return read;
}

/**
 * Run `fn` now and again whenever a signal it read changes. Returns the stop:
 * call it when what the effect paints leaves the page, or it keeps running
 * (and keeps its node alive).
 *
 * `later` puts the next run off (to the next frame, say): however many signals changed before it, the
 * effect runs once. It is handed the run each time one is due.
 *
 * A run that answers `false` did not do its work this time (a region left as it is under the keyboard
 * focus): what the last run read still counts, so the effect is told of the same changes as before.
 */
export function effect(fn: () => void | boolean, later?: (run: () => void) => void): () => void {
  let stopped = false;
  let due = false;
  const run = (): void => {
    due = false;
    if (stopped) return;
    const before = reader.sources;
    reader.sources = new Set();
    const outer = current;
    current = reader;
    let done: void | boolean;
    try {
      done = fn();
    } finally {
      current = outer;
    }
    if (done === false) for (const s of before) reader.sources.add(s);
    else for (const s of before) if (!reader.sources.has(s)) s.readers.delete(reader);
  };
  const reader: Reader = {
    sources: new Set(),
    stale() {
      if (!later) return void pending.add(run);
      if (due) return;
      due = true;
      later(run);
    },
  };
  run();
  return () => {
    stopped = true;
    pending.delete(run);
    unsubscribe(reader);
  };
}

/** Set several signals as one change: effects run once, after `fn`. */
export function batch(fn: () => void): void {
  batching++;
  try {
    fn();
  } finally {
    if (!--batching) flush();
  }
}
