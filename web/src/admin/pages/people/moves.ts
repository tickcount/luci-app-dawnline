// Moving inside the People page without a page load. The page's address says where it is (people/route.ts); a move
// writes the address and tells the page: opening a person or a device pushes a history entry (Back returns to the
// list where it was), filters and the order replace it. The way back of a page («‹ People», «‹ Dima», ×, Escape)
// steps back in history when the entry before is where it leads, so it never piles up entries. Every way to an address of this view ends here: a plain click on a
// link in the page or in the layer (a name in a feed, a device's icon, the way back; in a sheet, once the sheet has
// gone), visit() from code (shell/visit.ts), and Back or Forward between the view's own entries. The section row's
// links are the browser's (a section is opened afresh). All of it is let go when LuCI leaves the page.

import { onSheetEntry, sheetOpen } from '../../../portal/ui/sheet';
import { layer } from '../../../portal/ui/layer';
import { onNavigate } from '../../ui/nav';
import { href, peopleAt } from '../../shell/routes';
import { leaveTo, plain } from '../../shell/sheets';
import { ownVisits } from '../../shell/visit';
import { follow, parseRoute, type PeopleRoute } from '../../people/route';

export interface Moves {
  go(r: PeopleRoute, how?: 'push' | 'replace'): void;
  /** The way back to `r`: a step back in history when the entry before is `r`, else a move there. */
  back(r: PeopleRoute): void;
}

/** What the page keeps in each of its history entries: its route, and where the entry stands among the page's own. */
interface Entry {
  people: PeopleRoute;
  n: number;
}

const search = (s: string): string => s.replace(/^\?/, '');

/** `route`: where the page is; `arrive`: the page at another route, by a pick or a traversal (Back). */
export function pageMoves(page: HTMLElement, route: () => PeopleRoute, arrive: (r: PeopleRoute, how: 'pick' | 'back') => void): Moves {
  /** The route this view has for an address; null: the address is another page's. */
  const own = (url: string): PeopleRoute | null => {
    const u = new URL(url, location.href);
    const mine = new URL(href({ view: 'people' }), location.href);
    return u.origin === mine.origin && u.pathname === mine.pathname ? follow(route(), parseRoute(search(u.search))) : null;
  };
  /** This tab's entries of the page by their place (state.n): the address of each, to know where Back leads. */
  let n = (history.state as Partial<Entry> | null)?.n ?? 0;
  const trail: string[] = [];
  const go = (r: PeopleRoute, how: 'push' | 'replace' = 'push') => {
    // A sheet is closing under us (its own history entry is still the current one): the page moves once it is off
    // it, or the new entry would land on top of the sheet's.
    if (onSheetEntry()) {
      let done = false;
      const run = () => {
        if (done) return;
        done = true;
        removeEventListener('popstate', run);
        go(r, how);
      };
      addEventListener('popstate', run);
      setTimeout(run, 400);
      return;
    }
    const url = peopleAt(r);
    if (how === 'push' && url !== peopleAt(route())) {
      trail[n] = peopleAt(route());
      n++;
      history.pushState({ people: r, n } satisfies Entry, '', url);
    } else history.replaceState({ people: r, n } satisfies Entry, '', url);
    arrive(r, 'pick');
  };
  const back = (r: PeopleRoute) => {
    if (n > 0 && trail[n - 1] === peopleAt(r) && !onSheetEntry()) history.back();
    else go(r);
  };
  const click = (inLayer: boolean) => (e: Event) => {
    if (e.defaultPrevented || !plain(e)) return;
    const a = e.composedPath().find((x): x is HTMLAnchorElement => x instanceof HTMLAnchorElement);
    if (!a || a.target || a.hasAttribute('download') || a.closest('.dl-nav')) return;
    const to = own(a.href);
    if (!to) return;
    e.preventDefault();
    if (inLayer && sheetOpen()) leaveTo(a.href);
    else if (a.classList.contains('back-a')) back(to);
    else go(to);
  };
  const inPage = click(false);
  const inLayer = click(true);
  const lay = layer();
  page.addEventListener('click', inPage);
  lay.addEventListener('click', inLayer);
  const offVisits = ownVisits((url) => {
    const to = page.isConnected ? own(url) : null;
    if (to) go(to);
    return !!to;
  });
  // Back and Forward between this view's own entries. A sheet's entry is not a place of the page.
  const pop = (e: PopStateEvent) => {
    const s = e.state as ({ sheet?: boolean } & Partial<Entry>) | null;
    if (s?.sheet || !page.isConnected) return;
    n = s?.n ?? 0;
    arrive(s?.people ?? parseRoute(search(location.search)), 'back');
  };
  addEventListener('popstate', pop);
  // the entry the page stands on says its route too (a traversal reads it back)
  history.replaceState({ ...(history.state as object | null), people: route(), n }, '', location.href);
  const off = onNavigate(() => {
    off();
    offVisits();
    removeEventListener('popstate', pop);
    lay.removeEventListener('click', inLayer);
  });
  return { go, back };
}
