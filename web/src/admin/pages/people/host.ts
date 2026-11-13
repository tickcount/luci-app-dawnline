// What the People page gives its parts (the list's rows, the map view, a person's and a device's panel): the
// router's answer as it stands, the router's clock, whether this login writes, where the page is and how to move.

import type { Status } from '../../../shared/types';
import type { PeopleRoute } from '../../people/route';

export interface PeopleHost {
  st(): Status;
  /** The router's clock now (seconds) and its day. */
  now(): number;
  today(): string;
  /** This login may change things (shell/role.ts). */
  write: boolean;
  route(): PeopleRoute;
  /** Move inside the page: a new history entry (a panel, the view), or the same one (filters, the order). */
  go(r: PeopleRoute, how?: 'push' | 'replace'): void;
  /** Read the router again now (after a change made here) and draw it. */
  reload(): Promise<void>;
  /** A status read elsewhere (a set-up sheet's own watch): taken and drawn. */
  take(st: Status): void;
  /** The panel is the whole page (a phone). */
  narrow(): boolean;
}
