// Downloading the activity log (the Log's ⋯, System › History and storage):
// events and service log lines as CSV or JSON, names resolved, oldest first.
// Clearing it is the Log's sheet (pages/log/clear.ts).

import type { LogEvent, Status } from '../shared/types';
import type { ServiceLogEntry } from './api';
import { downloadFile } from './ui/files';
import { categoryOf, eventBy, sourceName } from './events/model';
import { toCsv } from './events/csv';

function names(st: Pick<Status, 'people'>) {
  const people = new Map(st.people.map((p) => [p.id, p.name]));
  const devices = new Map(st.people.flatMap((p) => p.devices.map((d) => [d.id, d.name] as [string, string])));
  return { people, devices };
}

/** Download events (and service log entries, category "system") as CSV or JSON, names resolved, oldest first. */
export function exportEvents(
  st: Pick<Status, 'people'>,
  events: LogEvent[],
  format: 'csv' | 'json',
  suffix = '',
  system: ServiceLogEntry[] = [],
) {
  const n = names(st);
  const rows = [
    ...events.map((e) => ({
      ts: e.ts,
      category: categoryOf(e.type) as string,
      type: e.type as string,
      person: e.person ? (n.people.get(e.person) ?? e.pname ?? e.person) : '',
      device: e.device ? (n.devices.get(e.device) ?? e.dname ?? e.device) : '',
      detail: e.detail ?? '',
      where: e.where ?? '',
      by: eventBy(e) ?? '',
    })),
    ...system.map((e) => ({
      ts: e.ts,
      category: 'system',
      type: `${e.src}.${e.level}`,
      person: '',
      device: '',
      detail: `${e.who ? `${e.who} ` : ''}${e.msg}${e.detail ? `\n${e.detail}` : ''}`,
      where: sourceName(e.src),
      by: '',
    })),
  ]
    .sort((a, b) => a.ts - b.ts)
    .map(({ ts, ...r }) => ({ time: new Date(ts * 1000).toISOString(), ...r }));
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `dawnline-activity${suffix ? `-${suffix}` : ''}-${stamp}.${format}`;
  if (format === 'json') {
    downloadFile(name, JSON.stringify(rows, null, 2), 'application/json');
    return;
  }
  const cols = ['time', 'category', 'type', 'person', 'device', 'detail', 'where', 'by'] as const;
  // The header row in the page's language; the cells are the log's ids, names and details.
  const head = {
    time: _('Time'),
    category: _('Category'),
    type: _('Type'),
    person: _('Person'),
    device: _('Device'),
    detail: _('Detail'),
    where: _('Where'),
    by: _('By'),
  };
  downloadFile(name, toCsv(cols, rows, head), 'text/csv');
}
