// An answer followed field by field: a document (the router's status, a person's page) whose every top
// field is a signal. `view` reads like the document itself, and reading a field of it inside an effect or a
// computed subscribes that to this field alone. `feed` lays a new answer over the last (share.ts): a field
// that did not change tells nobody, and inside one that did, the parts that did not are the objects they were.
//
// So a region drawn inside an effect is drawn again only when a field it read changed, and a list's row
// only when its own item did (admin/ui/live.ts), whatever the answer's source: the stream, or the router
// asked again.

import { batch, signal, type Writable } from './signal';
import { share } from './share';

export class LiveDoc<T extends object> {
  private fields = new Map<string, Writable<unknown>>();
  /** The document, read through its fields' signals. Not to be kept apart from this: it is always the newest. */
  readonly view: T;

  constructor() {
    this.view = new Proxy({} as T, {
      get: (_t, k) => (typeof k === 'string' ? this.field(k)() : undefined),
      has: (_t, k) => typeof k === 'string' && this.field(k)() !== undefined,
      ownKeys: () => [...this.fields].filter(([, s]) => s() !== undefined).map(([k]) => k),
      getOwnPropertyDescriptor: (_t, k) =>
        typeof k === 'string' && this.field(k)() !== undefined
          ? { enumerable: true, configurable: true, value: this.field(k).peek() }
          : undefined,
    });
  }

  private field(k: string): Writable<unknown> {
    let s = this.fields.get(k);
    if (!s) this.fields.set(k, (s = signal<unknown>(undefined)));
    return s;
  }

  /** A new answer: every field that changed tells its readers, once all of them are in. */
  feed(next: T): void {
    batch(() => {
      for (const [k, s] of this.fields) if (!(k in next)) s.set(undefined);
      for (const [k, v] of Object.entries(next)) {
        const s = this.field(k);
        s.set(share(s.peek(), v));
      }
    });
  }

  /** The document as a plain object, as it stands now, without subscribing. */
  plain(): T {
    const out: Record<string, unknown> = {};
    for (const [k, s] of this.fields) if (s.peek() !== undefined) out[k] = s.peek();
    return out as T;
  }
}
