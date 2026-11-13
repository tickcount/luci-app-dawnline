// People's filters as chips of the filter bar (ui/filter-bar.ts), each kept in the address: who needs a decision,
// who is online, who is paused (the count beside each is of the people the other filters leave; a chip that would
// leave nobody is not offered), counted by the cards' own groups (people/card.ts); the server, with more than one;
// «waiting for a new configuration», which a rollout's «Who waits» sends here; and the order. The map view keeps
// the server alone: its period stands before the chips.

import type { Status } from '../../../shared/types';
import { openMenu, type MenuItem } from '../../../portal/ui/menu';
import { fmt } from '../../../shared/i18n';
import { filterChip } from '../../ui/filter-bar';
import type { Today } from '../../people/lines';
import type { Filter, PeopleRoute } from '../../people/route';
import { inFilter, scoped, sortBy, sortOf, SORTS, type SortKey } from '../../people/roster';

const filterLabel = (f: Filter): string => ({ need: _('Needs a decision'), online: _('Online'), paused: _('Paused') })[f];
const FILTERS: Filter[] = ['need', 'online', 'paused'];
const sortLabel = (k: SortKey): string =>
  ({ name: _('Name'), devices: _('Devices'), traffic: _('Traffic'), term: _('Term'), seen: _('Last online') })[k];

/** The chips for where the page is; `go` moves it to the route with a filter changed. */
export function filterChips(st: Status, r: PeopleRoute, t: Today, go: (patch: Partial<PeopleRoute>) => void): HTMLElement[] {
  const kids: HTMLElement[] = [];
  const list = r.view !== 'map';
  if (list) {
    // a chip's count is of the people the other filters leave
    const base = scoped(st.people, r, t, false);
    for (const f of FILTERS) {
      const n = base.filter((p) => inFilter(p, f, t)).length;
      // no «Needs a decision 0» on a quiet router
      if (!n && r.group !== f) continue;
      kids.push(filterChip({ label: filterLabel(f), n, on: r.group === f, press: () => go({ group: r.group === f ? undefined : f }) }));
    }
  }
  if (st.servers.length > 1) {
    const cur = st.servers.find((s) => s.id === r.server);
    kids.push(
      filterChip({
        label: cur ? fmt(_('Server: %s'), cur.name) : _('Server'),
        on: !!cur,
        menu: true,
        press: (from) =>
          openMenu(
            from,
            [
              { label: _('All'), icon: cur ? 'terminal' : 'check', run: () => go({ server: undefined }) },
              null,
              ...st.servers.map((s): MenuItem => ({
                label: s.name,
                icon: s.id === r.server ? 'check' : 'terminal',
                sub: s.enabled ? undefined : _('Turned off'),
                run: () => go({ server: s.id }),
              })),
            ],
            _('Server'),
          ),
        off: () => go({ server: undefined }),
      }),
    );
  }
  if (r.need) kids.push(filterChip({ label: _('Waiting for a new configuration'), on: true, press: () => go({ need: undefined }) }));
  if (list) {
    const cur = sortOf(r.sort)?.key;
    kids.push(
      filterChip({
        label: cur ? fmt(_('Order: %s'), sortLabel(cur)) : _('Order'),
        on: !!cur,
        menu: true,
        press: (from) =>
          openMenu(
            from,
            [
              { label: _('By attention, in groups'), icon: cur ? 'alert' : 'check', run: () => go({ sort: undefined }) },
              null,
              ...(Object.keys(SORTS) as SortKey[]).map((k): MenuItem => ({
                label: sortLabel(k),
                icon: k === cur ? 'check' : 'arrow',
                run: () => go({ sort: sortBy(k) }),
              })),
            ],
            _('Order'),
          ),
        off: () => go({ sort: undefined }),
      }),
    );
  }
  return kids;
}
