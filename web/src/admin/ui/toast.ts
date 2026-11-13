// Toasts and the helpers that turn failures into one. They go to the portal's
// toast in the pages' layer (shell/toast.ts): the pollers, the live revision
// and the actions below say things the same way on every page.

import type { Child } from '../luci.d';
import { sayNotice } from '../shell/toast';
import { failureText } from '../failure';

export type Tone = 'info' | 'error' | 'warning' | 'success';

/** A toast; errors and warnings stay longer. */
export function notify(message: Child, tone: Tone = 'info', timeout = 0) {
  sayNotice(message, tone, timeout);
}

/** A failure as a person reads it (failure.ts): the router's or the page's own sentence, else plain words for what happened. */
export const errorText = (e: unknown): string => failureText(e);

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
