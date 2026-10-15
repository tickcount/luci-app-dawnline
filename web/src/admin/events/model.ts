// The activity log's vocabulary: categories, who did what, problems, retention.
// No DOM and no RPC here (see ./render for rows).

import type { LogEvent } from '../../shared/types';
import type { LogCategory, LogsInfo, ServiceLogEntry } from '../api';

/** Mirrors CATEGORY in dawnline.live. */
const CATEGORY: Record<string, LogCategory> = {
  connect: 'connections',
  disconnect: 'connections',
  roam: 'connections',
  device_added: 'people',
  device_removed: 'people',
  devices_removed: 'people',
  device_changed: 'people',
  device_keys: 'people',
  link_changed: 'people',
  person_added: 'people',
  person_removed: 'people',
  person_changed: 'people',
  paused: 'people',
  resumed: 'people',
  paused_all: 'people',
  resumed_all: 'people',
  portal_blocked: 'problems',
};

export const CATEGORIES: LogCategory[] = ['connections', 'people', 'problems'];

export const CATEGORY_LABEL: Record<LogCategory, string> = {
  connections: 'Connections',
  people: 'People',
  problems: 'Problems',
};

export const CATEGORY_HELP: Record<LogCategory, string> = {
  connections: 'Connects, disconnects and IP changes',
  people: 'People and their devices added, changed, paused, removed',
  problems: 'Blocked portal sign-ins (tunnels and services are in the service log)',
};

export const categoryOf = (type: string): LogCategory => CATEGORY[type] ?? 'problems';

export const SYSTEM_SOURCE: Record<ServiceLogEntry['src'], string> = { awg: 'AmneziaWG', dawnline: 'Dawnline', portal: 'Portal' };

const ADMIN_TYPES = ['person_added', 'person_removed', 'person_changed', 'paused_all', 'resumed_all'];

/** Who did it. Older events have no `by`: LuCI and the portal marked it in the detail. */
export function eventBy(e: LogEvent): 'admin' | 'portal' | null {
  if (e.by) return e.by;
  if (ADMIN_TYPES.includes(e.type) || e.detail === 'by admin' || e.detail?.endsWith(' (admin)')) return 'admin';
  if (e.detail?.endsWith(' (portal)')) return 'portal';
  return null;
}

/** The detail without the old "(admin)" / "(portal)" / "by admin" marks. */
export function plainDetail(e: LogEvent): string {
  return (e.detail ?? '').replace(/ \((admin|portal)\)$/, '').replace(/^by admin$/, '');
}

/** One line of the Log: an activity event or a service log entry. */
export type LogItem = { ts: number; ev?: LogEvent; sys?: ServiceLogEntry };

export const isProblem = (x: LogItem) =>
  x.sys ? ['error', 'repair', 'down'].includes(x.sys.level) : categoryOf(x.ev!.type) === 'problems';

export function retentionText(p: LogsInfo['policy']): string {
  const age = p.keep_days > 0 ? `${p.keep_days} day${p.keep_days === 1 ? '' : 's'}` : 'no age limit';
  const where =
    p.persist === 'off'
      ? 'kept in memory only (lost on reboot)'
      : `saved to flash ${p.persist === '10min' ? 'every 10 minutes' : 'hourly'}`;
  return `Kept for ${age}, up to ${p.max.toLocaleString('en-GB')} events, ${where}.`;
}
