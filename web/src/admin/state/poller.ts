// Live pages: a poller with "newest answer wins", and repaints that leave a
// region alone while the keyboard focus is inside it (typing, a picker, a
// focused button), so a background refresh never takes it away.

/**
 * Request tickets: an answer is shown only if nothing newer was shown before
 * it. `claim()` invalidates everything in flight (an edit's own answer wins).
 */
export class Sequence {
  private n = 0;
  private shown = 0;
  next(): number {
    return ++this.n;
  }
  /** True (and marks `t` shown) unless a newer answer was shown already. */
  take(t: number): boolean {
    if (t < this.shown) return false;
    this.shown = t;
    return true;
  }
  claim(): void {
    this.shown = ++this.n;
  }
}

export interface PollerOptions<T> {
  /** One request; rejections and null count as "no answer". */
  fetch: () => Promise<T | null>;
  /** Paint an answer; `quiet` for the periodic ones. */
  apply: (data: T, quiet: boolean) => void;
  /** Seconds between ticks. */
  every: number;
  /** Ticks are skipped while this is false (e.g. the page is not on screen). */
  active?: () => boolean;
}

export interface Poller<T> {
  /** Fetch and apply now (unless a newer answer arrives first); resolves with what was applied. */
  refresh(quiet?: boolean): Promise<T | null>;
  /** An edit is about to repaint: answers already on their way are dropped. */
  claim(): void;
  stop(): void;
}

export function createPoller<T>(o: PollerOptions<T>): Poller<T> {
  const seq = new Sequence();
  const refresh = async (quiet = false): Promise<T | null> => {
    const t = seq.next();
    const d = await o.fetch().catch(() => null);
    if (d == null || !seq.take(t)) return null;
    o.apply(d, quiet);
    return d;
  };
  const tick = () => ((o.active?.() ?? true) ? refresh(true) : Promise.resolve(null));
  poll.add(tick, o.every);
  return { refresh, claim: () => seq.claim(), stop: () => poll.remove(tick) };
}

/** The keyboard focus (or an open native picker's input) is inside `el`. */
export function focusInside(el: Element | null | undefined): boolean {
  const a = document.activeElement;
  return !!el && !!a && a !== document.body && el.contains(a);
}

/**
 * Replace a region's content, unless this is a quiet repaint and the focus is
 * inside it; then it keeps what is on screen until the next one.
 */
export function repaint(el: HTMLElement, content: Parameters<typeof dom.content>[1], quiet = false): boolean {
  if (quiet && focusInside(el)) return false;
  dom.content(el, content);
  return true;
}
