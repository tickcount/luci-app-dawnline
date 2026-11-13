// The page's stream (backend/portal, GET <link>/api/live): the router sends the page's state once whole
// (`put`), then only what changed (`patch`, a JSON Merge Patch), the moment a device of the person's connects
// or leaves, a set-up moves on, or the admin changes something of theirs; `gone` when the link stops working.
// So the page follows the router without asking: nothing is fetched again on a timer, and nothing is drawn
// again that did not change (main.ts draws from the state in place).
//
// Only where the router offers it (the page's #app carries data-live, set when the Go backend serves the
// portal): elsewhere the page asks once, as it always did. The stream is let go while the page is hidden
// (a phone's tab in the background holds no connection) and opened again, on the whole state, when it shows.

import { merge } from '../shared/live/patch';
import { base, type State } from './state';

/** The router serves a stream for this page. */
export const hasLive = (): boolean => document.getElementById('app')?.dataset.live === '1' && 'EventSource' in window;

export interface LiveHandlers {
  /** The state, whole or with a change laid over the last one. */
  state(st: State): void;
  /** The link stopped working. */
  gone(): void;
  /** The stream could not be opened at all (before any state came): the page asks the router itself. */
  failed(): void;
}

/** Follow the page's stream. */
export function followLive(on: LiveHandlers): void {
  let es: EventSource | null = null;
  let last: State | null = null;
  let ended = false;
  const open = () => {
    if (es || ended || document.hidden) return;
    const mine = (es = new EventSource(`${base()}/api/live`));
    mine.addEventListener('put', (e) => on.state((last = JSON.parse((e as MessageEvent<string>).data) as State)));
    mine.addEventListener('patch', (e) => {
      if (last) on.state((last = merge(last, JSON.parse((e as MessageEvent<string>).data)) as State));
    });
    mine.addEventListener('gone', () => {
      ended = true;
      mine.close();
      on.gone();
    });
    mine.onerror = () => {
      // refused outright (no stream on this router after all): the browser does not try again, nor do we
      if (mine.readyState !== EventSource.CLOSED) return;
      es = null;
      if (!last) {
        ended = true;
        on.failed();
      }
    };
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      es?.close();
      es = null;
    } else open();
  });
  open();
  // a page opened in the background shows nothing until it is looked at: it asks once, as without a stream
  if (!es && !ended) on.failed();
}
