// The status as seen from one server.

import type { Person, Status } from '../../shared/types';

/**
 * The status as seen from one server: its people, their devices, traffic,
 * map points and events (plus router-wide events without a person).
 */
export function scoped(st: Status, srvId: string): Status {
  const srv = st.servers.find((s) => s.id === srvId) ?? st.servers[0];
  const people = st.people.filter((p) => p.server === srv.id);
  const ids = new Set(people.map((p) => p.id));
  const devices = people.flatMap((p) => p.devices);
  const sum = (f: (p: Person) => [number, number]) =>
    people.reduce<[number, number]>(
      (a, p) => {
        const v = f(p);
        return [a[0] + v[0], a[1] + v[1]];
      },
      [0, 0],
    );
  const today = srv.series?.[srv.series.length - 1];
  return {
    ...st,
    servers: [srv],
    people,
    series: srv.series ?? st.series,
    events: st.events.filter((e) => (e.person ? ids.has(e.person) : true)),
    geo: { ...st.geo, points: st.geo.points.filter((g) => ids.has(g.person)) },
    totals: {
      people: people.length,
      devices: devices.length,
      online: devices.filter((d) => d.online).length,
      active: people.filter((p) => p.state === 'active').length,
      today: today ? [today.rx, today.tx] : [0, 0],
      month: sum((p) => p.month),
    },
  };
}
