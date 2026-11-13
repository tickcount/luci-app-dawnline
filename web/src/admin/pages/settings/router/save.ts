// A setting of a router-wide section handed to the page: it waits for «Apply»
// in the dock with the others (pages/settings/changes.ts), the section drawn
// at once with the waiting value. `said` was the toast of the time it was
// saved on the spot: nothing is said now, the dock and «not applied» say it.

import { errorText, notify } from '../../../ui/toast';
import type { RouterCtx } from './ctx';

/** Resolves with whether it took. */
export async function put(y: RouterCtx, values: Record<string, string | string[]>, _said?: string): Promise<boolean> {
  try {
    await y.save(values);
    return true;
  } catch (e) {
    notify(errorText(e), 'error', 10000);
    return false;
  }
}
