// Toasts at the bottom of the screen (above modals) instead of LuCI's banner,
// and the helpers that turn failures into one.

import type { Child } from '../luci.d';
import { E } from '../e';
import { icon } from '../../shared/icons';

export type Tone = 'info' | 'error' | 'warning' | 'success';

/** A small toast; errors stay longer and can be closed. */
export function notify(message: Child, tone: Tone = 'info', timeout = 0) {
  let stack = document.querySelector('.dl-toasts') as HTMLElement | null;
  if (!stack) {
    stack = E('div', { class: 'dl-toasts dl-root', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(stack);
  }
  const ic = tone === 'error' ? 'x' : tone === 'warning' ? 'alert' : tone === 'success' ? 'check' : null;
  const close = () => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 200);
  };
  const t = E('div', { class: `dl-toast ${tone}` }, [
    ic ? icon(ic) : '',
    E('span', {}, message),
    tone === 'error' ? E('button', { type: 'button', 'aria-label': _('Close'), click: close }, icon('x')) : '',
  ]);
  stack.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(close, timeout || (tone === 'error' ? 8000 : tone === 'warning' ? 5000 : 2600));
}

/** A failure's message as it came: the router's own text for RPC failures. */
export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Run an action; failures become a toast. Returns undefined on error. */
export async function attempt<T>(fn: () => Promise<T>, ok?: Child): Promise<T | undefined> {
  try {
    const r = await fn();
    if (ok) notify(ok, 'success', 3500);
    return r;
  } catch (e) {
    notify(errorText(e), 'error', 10000);
    return undefined;
  }
}

/** Call something that may throw or reject without waiting for it; failures become a toast. */
export function run(fn: () => unknown): void {
  try {
    const r = fn();
    if (r && typeof (r as Promise<unknown>).then === 'function') (r as Promise<unknown>).catch((e) => notify(errorText(e), 'error'));
  } catch (e) {
    notify(errorText(e), 'error');
  }
}
