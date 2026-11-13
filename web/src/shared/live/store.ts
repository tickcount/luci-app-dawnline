// The page's copy of the live state: the topics' documents as the stream last
// left them, read through signals. A reader asks for one place in one topic
// (`at('people', 'items', id, 'online')`) and is told when that place changed,
// not when anything else in the topic did.
//
// The store knows no transport: follow.ts feeds it. It also holds what a page
// needs to show honestly while it has nothing or old data: each topic's state.

import { batch, signal, type Signal, type Writable } from './signal';
import { appended, merge, type Doc } from './patch';

/**
 * Where a topic stands:
 *   pending  nothing has come yet: the page waits for it (it comes in once it has), not "empty"
 *   ready    the document is the router's, followed live
 *   stale    the document is the last one seen, and the stream is down: show
 *            it, marked as old; never hide data the page has
 */
export type TopicState = 'pending' | 'ready' | 'stale';

/** One change of one topic, as the backend numbers and sends it (hub.Event). */
export interface LiveEvent {
  seq: number;
  topic: string;
  op: 'put' | 'patch' | 'append' | 'drop';
  data?: Doc;
}

function dig(doc: Doc, path: string[]): Doc {
  let v = doc;
  for (const k of path) {
    if (typeof v !== 'object' || v === null) return undefined;
    v = (v as Record<string, unknown>)[k];
  }
  return v;
}

interface Place {
  path: string[];
  value: Writable<Doc>;
}

export class LiveStore {
  private docs = new Map<string, Doc>();
  private places = new Map<string, Map<string, Place>>();
  private states = new Map<string, Writable<TopicState>>();
  private down = false;

  /** The value at a place in a topic (undefined while it is not there), as a signal. */
  at<T = unknown>(topic: string, ...path: string[]): Signal<T | undefined> {
    let of = this.places.get(topic);
    if (!of) this.places.set(topic, (of = new Map()));
    // A separator no key holds: ids and field names are printable.
    const key = path.join('\u0000');
    let place = of.get(key);
    if (!place) of.set(key, (place = { path, value: signal(dig(this.docs.get(topic), path)) }));
    return place.value as Signal<T | undefined>;
  }

  /** Where a topic stands (see TopicState). */
  state(topic: string): Signal<TopicState> {
    return this.stateOf(topic);
  }

  /** The whole document of a topic right now, without subscribing. */
  peek<T = unknown>(topic: string): T | undefined {
    return this.docs.get(topic) as T | undefined;
  }

  /** A snapshot: these are all the topics there are; one not among them is gone. */
  reset(docs: Record<string, Doc>): void {
    batch(() => {
      this.down = false;
      for (const topic of Array.from(this.docs.keys())) if (!(topic in docs)) this.set(topic, undefined);
      for (const [topic, doc] of Object.entries(docs)) this.set(topic, doc);
      // A topic the snapshot does not hold has nothing behind it now: back to waiting.
      for (const [topic, st] of this.states) if (!this.docs.has(topic)) st.set('pending');
    });
  }

  /** One event of the stream. */
  apply(e: LiveEvent): void {
    const doc = this.docs.get(e.topic);
    if (e.op === 'put') this.set(e.topic, e.data);
    else if (e.op === 'patch') this.set(e.topic, merge(doc, e.data));
    else if (e.op === 'drop') this.set(e.topic, undefined);
    else if (e.op === 'append') {
      const d = e.data as { items?: unknown[]; keep?: number } | undefined;
      this.set(e.topic, appended(doc, d?.items ?? [], d?.keep ?? 0));
    }
  }

  /** The stream is down (true) or back: what is shown is old until it is back. */
  offline(down: boolean): void {
    if (down === this.down) return;
    this.down = down;
    batch(() => {
      for (const [topic, st] of this.states) if (this.docs.has(topic)) st.set(down ? 'stale' : 'ready');
    });
  }

  private stateOf(topic: string): Writable<TopicState> {
    let st = this.states.get(topic);
    if (!st) this.states.set(topic, (st = signal<TopicState>(this.docs.has(topic) ? (this.down ? 'stale' : 'ready') : 'pending')));
    return st;
  }

  private set(topic: string, doc: Doc): void {
    if (doc === undefined) this.docs.delete(topic);
    else this.docs.set(topic, doc);
    batch(() => {
      this.stateOf(topic).set(doc === undefined ? 'pending' : this.down ? 'stale' : 'ready');
      const of = this.places.get(topic);
      if (!of) return;
      // Every place asked for in this topic looks again; an unchanged part is
      // the same object as before (patch.ts), so its signal tells nobody.
      for (const place of of.values()) place.value.set(dig(doc, place.path));
    });
  }
}
