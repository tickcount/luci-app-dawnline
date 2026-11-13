// Live pages: a poller with "newest answer wins", and repaints that leave a
// region alone while the keyboard focus is inside it (typing, a picker, a
// focused button), so a background refresh never takes it away.

import { onLiveChange } from './live';
import { onNavigate } from '../ui/nav';
import { notify } from '../ui/toast';
import { refill } from '../ui/reshape';
import { putChildren } from '../../portal/ui/put';

/** Failed ticks in a row before the page says the router is out of reach. */
const LOST_AFTER = 3;

/**
 * Request tickets: an answer is shown only if nothing newer was shown before
 * it. `claim()` invalidates everything in flight (an edit's own answer wins).
 */
class Sequence {
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
  /** One request (`live`: the live revision moved); rejections and null count as "no answer". */
  fetch: (live: boolean) => Promise<T | null>;
  /** Paint an answer; `quiet` for the periodic ones. */
  apply: (data: T, quiet: boolean) => void;
  /** Seconds between ticks. */
  every: number;
  /** Ticks are skipped while this is false (e.g. the page is not on screen). */
  active?: () => boolean;
  /** Also refresh as soon as the live revision moves (state/live.ts); `every` is then the fallback. */
  live?: boolean;
}

export interface Poller<T> {
  /** Fetch and apply now (unless a newer answer arrives first); resolves with what was applied. */
  refresh(quiet?: boolean): Promise<T | null>;
  /** An edit is about to repaint: answers already on their way are dropped. */
  claim(): void;
  stop(): void;
}

/**
 * A poller lives with its page: it stops itself when Outline navigates away
 * (its DOM is gone, its ticks would keep asking the router), skips ticks while
 * the tab is hidden, and says so once when the router stops answering.
 */
export function createPoller<T>(o: PollerOptions<T>): Poller<T> {
  const seq = new Sequence();
  let failed = 0;
  const load = async (quiet: boolean, live: boolean): Promise<T | null> => {
    const t = seq.next();
    let d: T | null = null;
    try {
      d = await o.fetch(live);
      if (failed >= LOST_AFTER) notify(_('The router answers again.'), 'success', 3000);
      failed = 0;
    } catch {
      if (++failed === LOST_AFTER) notify(_('The router is not answering: what you see may be out of date.'), 'warning', 8000);
      return null;
    }
    if (d == null || !seq.take(t)) return null;
    o.apply(d, quiet);
    return d;
  };
  const refresh = (quiet = false) => load(quiet, false);
  const visible = () => document.visibilityState === 'visible';
  const tick = () => (visible() && (o.active?.() ?? true) ? load(true, false) : Promise.resolve(null));
  poll.add(tick, o.every);
  const off = o.live ? onLiveChange(() => void (visible() && (o.active?.() ?? true) && load(true, true))) : null;
  const stop = () => {
    poll.remove(tick);
    off?.();
    offNav();
  };
  const offNav = onNavigate(stop);
  return { refresh, claim: () => seq.claim(), stop };
}

/**
 * The keyboard focus (or an open native picker's input) is inside `el`. Read
 * in `el`'s own tree: inside a Shadow DOM (the pages) the document's
 * activeElement is the host, the shadow root's is the focused element.
 */
export function focusInside(el: Element | null | undefined): boolean {
  if (!el) return false;
  const root = el.getRootNode() as Document | ShadowRoot;
  const a = root.activeElement ?? null;
  return !!a && a !== document.body && el.contains(a);
}

/**
 * Refill a region in place (ui/reshape.ts: what stays stays, what is new blurs in, what left fades, the region
 * glides to its height), unless this is a quiet repaint and the focus is inside it; then it keeps what is on screen
 * until the next one.
 */
export function repaint(el: HTMLElement, content: Node | Node[], quiet = false, still = false): boolean {
  if (quiet && focusInside(el)) return false;
  const kids = Array.isArray(content) ? content : [content];
  // `still`: what follows typing (a search) is drawn at once, as the letters are
  if (still) putChildren(el, kids);
  else refill(el, kids);
  return true;
}
