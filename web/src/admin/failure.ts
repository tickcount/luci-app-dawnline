// What a failure says to a person, wherever the admin shows one (a toast, a sheet's line, a field's refusal, What's
// new, the wait): one place, so a programmer's text never reaches the page (the owner, 2026-11-12: «полный текст
// ошибки может появиться не только тут… нужно как-то правильно показывать их по всей админке»).
//
// A failure is shown as it came only when it is a sentence for a person: the backend's refusals (its own words,
// in the page's language) and the page's own (`new Error(_('…'))`). Those begin with a capital letter; what a
// program wrote does not (Go's errors by its own convention, our internal ones), or it is LuCI's report of the bus
// or the network, which is told by its code in plain words instead. What is not shown goes to the console, whole.
//
// Pure: no DOM, no state of the pages'.

/** LuCI's report of a failed call (rpc.js): the object and method, then how it failed. */
const RPC = /^RPC call to \S+ (?:failed with (HTTP error|error|ubus code) (-?\d+)|returned invalid message frame)/;

/** What kind of failure it is, as a person needs to know it. */
export type FailureKind = 'said' | 'away' | 'slow' | 'session' | 'denied' | 'mismatch' | 'offline' | 'server' | 'bug';

/** The kind of `e`. */
export function failureKind(e: unknown): FailureKind {
  const err = e instanceof Error ? e : null;
  const msg = (err ? err.message : typeof e === 'string' ? e : '').trim();
  // the engine's own (a TypeError, a SyntaxError): a fault of the page
  if (err && err.name !== 'Error' && err.name !== 'AbortError')
    return err.name === 'TypeError' && /fetch|network|load failed/i.test(msg) ? 'offline' : 'bug';
  const rpc = RPC.exec(msg);
  if (rpc) {
    const [, how, code] = rpc;
    const n = Number(code);
    if (!how) return 'mismatch';
    if (how === 'HTTP error') return n === 0 ? 'offline' : n === 403 ? 'session' : 'server';
    if (how === 'error') return n === -32002 ? 'session' : n === -32601 || n === -32602 || n === -32600 ? 'mismatch' : 'away';
    // ubus: 4 not found, 5 no data, 10 connection lost — the backend is not on the bus (restarting)
    if (n === 4 || n === 5 || n === 10) return 'away';
    if (n === 7) return 'slow';
    if (n === 6) return 'denied';
    if (n === 1 || n === 2 || n === 3 || n === 8) return 'mismatch';
    return 'bug';
  }
  if (msg.startsWith('XHR request timed out')) return 'slow';
  if (msg.startsWith('XHR request aborted') || /^(Failed to fetch|NetworkError|Load failed)/.test(msg)) return 'offline';
  if (msg.startsWith('Session expired')) return 'session';
  // a sentence: it begins with a capital letter (in any script) and is not a page of something
  return /^\p{Lu}/u.test(msg) && msg.length <= 600 ? 'said' : 'bug';
}

/** The words for each kind that is not said as it came. */
function wordsFor(kind: Exclude<FailureKind, 'said'>): string {
  switch (kind) {
    case 'away':
      return _('Dawnline is not answering on the router right now: it may be restarting. Try again in a moment.');
    case 'slow':
      return _('The router took too long to answer. Try again.');
    case 'session':
      return _('Your session has ended. Reload the page to sign in again.');
    case 'denied':
      return _('This login may not do that.');
    case 'mismatch':
      return _('The page and the router do not agree on this request. Reload the page; if it goes on, update Dawnline.');
    case 'offline':
      return _('The router could not be reached. Check the connection and try again.');
    case 'server':
      return _('The router’s web server could not answer. Try again in a moment.');
    case 'bug':
      return _('Something went wrong on this page. Try again; if it goes on, reload the page.');
  }
}

const told = new WeakSet<object>();

/** A failure as a person reads it; what it was is put in the console (once), for whoever looks into it. */
export function failureText(e: unknown): string {
  const kind = failureKind(e);
  if (kind === 'said') return (e instanceof Error ? e.message : String(e)).trim();
  if (e && typeof e === 'object') {
    if (!told.has(e)) {
      told.add(e);
      console.warn('dawnline:', e);
    }
  } else console.warn('dawnline:', e);
  return wordsFor(kind);
}

/** The backend's words for a failure that has none of its own (backend/methods/words.go Unworded). */
const unworded = (): string => _('Something went wrong on the router. Try again; if it goes on, look at the Log.');

/**
 * A failure the router keeps in its state (a component's check, an update job, the history of updates) as a person
 * reads it: its sentence, or, for a program's text, the plain one; null when it says nothing.
 */
export function routerSaid(text: string | null | undefined): string | null {
  const t = (text ?? '').trim();
  if (!t) return null;
  if (/^\p{Lu}/u.test(t) && t.length <= 600) return t;
  console.warn('dawnline: the router said', t);
  return unworded();
}
