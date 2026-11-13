// A person's presence, from the log: each device's runs in the network (the link timeline's own, events/timeline.ts)
// and the person's as their union: since when they are online now, how long they were online over the last 7 days
// (from the router's midnight six days ago to now). People reads one log request for everyone and hands each person
// their own events; a person's page reads the 24 hours of each device from the same runs. Pure: no DOM.

import type { Device, LogEvent, Person, Server } from '../../shared/types';
import { linkTimeline, type Run } from '../events/timeline';

const DAY = 86400;
/** The newest run still counts as «now» while it ended this recently (the status' clock and the log's differ). */
const LIVE = 90;

/** A device and its runs over the last 7 days, oldest first. */
interface DeviceRuns {
  d: Device;
  runs: Run[];
}

export interface Presence {
  /** When the stretch they are online in now began (0: offline, or not in the log). */
  since: number;
  /** Seconds online over the last 7 days (any device). */
  week: number;
  devices: DeviceRuns[];
}

/** The events of each person (the log's order kept). */
export function byPerson(events: LogEvent[]): Map<string, LogEvent[]> {
  const m = new Map<string, LogEvent[]>();
  for (const e of events) {
    if (!e.person) continue;
    const l = m.get(e.person);
    if (l) l.push(e);
    else m.set(e.person, [e]);
  }
  return m;
}

/** The router's midnight of the day `ts` is in (`tz`: minutes east of UTC). */
export const midnight = (ts: number, tz = 0): number => Math.floor((ts + tz * 60) / DAY) * DAY - tz * 60;

/** Seconds of `runs` inside [a, b). */
export const timeIn = (runs: Pick<Run, 'a' | 'b'>[], a: number, b: number): number =>
  runs.reduce((n, r) => n + Math.max(0, Math.min(r.b, b) - Math.max(r.a, a)), 0);

/**
 * The stretches in which any of the devices was in the network, merged where they touch. A failing link's run is
 * left out: it may be a device knocking without a session (trying), which is not being online.
 */
function union(devs: DeviceRuns[]): Pick<Run, 'a' | 'b'>[] {
  const all = devs.flatMap((v) => v.runs.filter((r) => r.s !== 'warn').map((r) => ({ a: r.a, b: r.b }))).sort((x, y) => x.a - y.a);
  const out: { a: number; b: number }[] = [];
  for (const r of all) {
    const last = out[out.length - 1];
    if (last && r.a <= last.b + 1) last.b = Math.max(last.b, r.b);
    else out.push({ ...r });
  }
  return out;
}

/**
 * `p`'s presence; `events`: theirs (any order, the last 7 days or more), `now` and `tz` the router's. Their devices
 * come online first, then by the latest handshake.
 */
export function presence(p: Person, server: Server | undefined, events: LogEvent[], now: number, tz?: number): Presence {
  const from = now - 7 * DAY;
  const devices = [...p.devices]
    .sort((a, b) => Number(b.online) - Number(a.online) || b.handshake - a.handshake)
    .map((d) => ({ d, runs: linkTimeline({ device: d, person: p, server, events, now, tz }).runs.filter((r) => r.b > from) }));
  const runs = union(devices);
  const last = runs[runs.length - 1];
  return {
    since: p.online > 0 && last && last.b >= now - LIVE ? last.a : 0,
    week: timeIn(runs, midnight(now, tz) - 6 * DAY, now),
    devices,
  };
}
