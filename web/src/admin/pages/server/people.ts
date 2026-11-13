// A server's People and Places: the People page (pages/people) scoped to one server and put inside the server's
// frame. What differs from the page as it stands alone: no section row of its own, the server is not a filter (it
// is where the page stands), and a device does not take its person's place: it opens as a dialog over their page
// (device-dialog.ts), the address staying the person's.

import type { Status } from '../../../shared/types';
import { PeoplePage } from '../people';
import { listOf, type PeopleRoute } from '../../people/route';
import { peopleAt } from '../../shell/routes';
import { DeviceDialog } from './device-dialog';

export class ServerPeople extends PeoplePage {
  private dialog: DeviceDialog | null = null;

  /** `moved`: the page went to another place of its own (its view, a person, Back): the frame's track follows. */
  constructor(
    private srvId: string,
    private moved: () => void,
  ) {
    super();
    this.r = { ...this.r, server: undefined };
  }

  /** Only this server's people, their places and the server itself: it is where the page stands. */
  protected override scope(st: Status): Status {
    const people = st.people.filter((p) => p.server === this.srvId);
    const ids = new Set(people.map((p) => p.id));
    return {
      ...st,
      people,
      servers: st.servers.filter((x) => x.id === this.srvId),
      geo: { ...st.geo, points: st.geo.points.filter((x) => ids.has(x.person)) },
    };
  }

  /** The frame has the admin's row. */
  protected override chrome(): HTMLElement | null {
    return null;
  }

  override render(st: Status): HTMLElement {
    const el = super.render(st);
    el.classList.add('sv-people');
    return el;
  }

  /** A device asked for: its person's page stays (or comes) under it, the device is a dialog. */
  protected override sync(how: 'load' | 'pick' | 'back') {
    const r = this.r;
    if (r.device && r.view !== 'map') {
      const id = r.device;
      const sheet = r.sheet;
      this.r = { ...listOf(r), id: this.owner(r) };
      history.replaceState({ ...(history.state as object | null), people: this.r }, '', peopleAt(this.r));
      super.sync(how);
      if (this.dialog?.id === id) this.dialog.step(sheet);
      else {
        const open = () => {
          this.dialog = new DeviceDialog(id, this, () => (this.dialog = null));
          this.dialog.step(sheet);
        };
        // on arrival the person's page stands first
        if (how === 'load') setTimeout(open, 250);
        else open();
      }
      return;
    }
    super.sync(how);
  }

  protected override arrive(r: PeopleRoute, how: 'pick' | 'back') {
    // another place of the page asked for from inside the dialog (its person, the list): the dialog goes
    if (!r.device && this.dialog) this.dialog.close();
    super.arrive({ ...r, server: undefined }, how);
    this.moved();
  }

  protected override fresh(quiet: boolean) {
    super.fresh(quiet);
    this.dialog?.fresh(quiet);
  }
}
