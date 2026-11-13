// The log's feed as rows: a device's connect and its next disconnect are one
// row, its session ("online 09:20 until 11:40", or still online), which stands
// under the day it began; the other events and the service log's lines are a
// row each. Newest first. Pure: no DOM (pages/log draws the rows).
// A device that drops and comes back within a few minutes from the same place
// (a phone switching networks, a tunnel re-keying) stays one session that
// counts its reconnects: on a real router such a phone logs dozens a day.

import type { LogEvent } from '../../shared/types';
import type { ServiceLogEntry } from '../api';
import { routerDay } from './clock';

/** A row of the feed. */
export interface FeedItem {
  ts: number;
  ev?: LogEvent;
  sys?: ServiceLogEntry;
  /**
   * A session (a connect): when it ended (its disconnect), or null while it
   * lasts. Absent from other rows, and from a connect whose end is not known
   * (a newer connect of the same device came first, or the device is not
   * online now although no disconnect was logged).
   */
  until?: number | null;
  /** A session's disconnect itself (exported with it). */
  end?: LogEvent;
  /** A session: how many times the device came back within REJOIN of dropping, folded into it. */
  rejoins?: number;
}

/** A device back within this long from the same place: the same session (seconds). */
const REJOIN = 15 * 60;

/** Where a connect came from, to tell a reconnect from a move. */
const placeKey = (e: LogEvent): string => e.where ?? e.detail ?? '';

/**
 * The feed: `events` (any order) folded into sessions, `system` beside them.
 * `online(device)`: whether a device is online now, so a session with no end
 * logged says "online now" only when it is true.
 */
export function sessions(events: LogEvent[], system: ServiceLogEntry[] = [], online: (device: string) => boolean = () => true): FeedItem[] {
  const out: FeedItem[] = [];
  const open = new Map<string, FeedItem>();
  // Each device's last ended session, to fold a quick return into it.
  const ended = new Map<string, FeedItem>();
  for (const e of [...events].sort((a, b) => a.ts - b.ts)) {
    if (e.type === 'connect' && e.device) {
      // A connect while the last one is open: that one's end was never logged.
      const was = open.get(e.device);
      if (was) delete was.until;
      const last = ended.get(e.device);
      if (!was && last && last.until && e.ts - last.until <= REJOIN && placeKey(last.ev!) === placeKey(e)) {
        last.until = null;
        delete last.end;
        last.rejoins = (last.rejoins ?? 0) + 1;
        open.set(e.device, last);
        ended.delete(e.device);
        continue;
      }
      const it: FeedItem = { ts: e.ts, ev: e, until: null };
      open.set(e.device, it);
      out.push(it);
    } else if (e.type === 'disconnect' && e.device && open.has(e.device)) {
      const it = open.get(e.device)!;
      it.until = e.ts;
      it.end = e;
      open.delete(e.device);
      ended.set(e.device, it);
    } else out.push({ ts: e.ts, ev: e });
  }
  for (const [device, it] of open) if (!online(device)) delete it.until;
  for (const sys of system) out.push({ ts: sys.ts, sys });
  return out.sort((a, b) => b.ts - a.ts);
}

/** Rows grouped by the router's day they began on, newest day first (rows keep their order). */
export function byDay(items: FeedItem[], tz?: number): { day: string; items: FeedItem[] }[] {
  const days: { day: string; items: FeedItem[] }[] = [];
  for (const it of items) {
    const day = routerDay(it.ts, tz);
    const last = days[days.length - 1];
    if (last?.day === day) last.items.push(it);
    else days.push({ day, items: [it] });
  }
  return days;
}
