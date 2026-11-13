// An old address that leads elsewhere now (redirects.ts): the view goes
// there at once and loads nothing meanwhile. Every view's factory asks it
// first (main.ts).

import { here, href } from './routes';
import { target } from './redirects';

/** A promise that never settles while the browser goes on, or null: this address is a page of its own. */
export function redirected(): Promise<never> | null {
  const at = here();
  const to = target(at.view, at.query ?? '');
  if (!to) return null;
  ui.menu?.flushCache();
  location.replace(href(to));
  return new Promise(() => {});
}
