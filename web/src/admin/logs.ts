// Activity log helpers shared by Activity, Settings, the person page and the
// device drawer: categories, export, and the clear / reset dialogs.

import type { LogEvent, Status } from '../shared/types';
import { E } from './e';
import { api, type LogCategory, type LogFilter, type ServiceLogEntry } from './api';
import { attempt, button, closeModal, downloadFile, modal, notify } from './ui';
import { eventBy } from './pages/overview';

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

function names(st: Pick<Status, 'people'>) {
  const people = new Map(st.people.map((p) => [p.id, p.name]));
  const devices = new Map(st.people.flatMap((p) => p.devices.map((d) => [d.id, d.name] as [string, string])));
  return { people, devices };
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const SYSTEM_SOURCE: Record<ServiceLogEntry['src'], string> = { awg: 'AmneziaWG', dawnline: 'Dawnline', portal: 'Portal' };

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
      where: SYSTEM_SOURCE[e.src] ?? e.src,
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
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n');
  downloadFile(name, csv, 'text/csv');
}

const AGES: [string, string][] = [
  ['', 'Everything'],
  ['7', 'Older than 7 days'],
  ['30', 'Older than 30 days'],
  ['90', 'Older than 90 days'],
];

/**
 * Ask what to clear and do it. `base` pins person/device; the dialog lets you
 * pick a category (unless `category` is given) and an age.
 */
export function clearLogDialog(
  title: string,
  what: string,
  base: LogFilter,
  done: () => unknown,
  category?: LogCategory | 'system',
  withSystem = false,
) {
  const cat = E('select', { class: 'cbi-input-select' }, [
    E('option', { value: '' }, 'All categories'),
    ...CATEGORIES.map((c) => E('option', { value: c, selected: c === category ? 'selected' : null }, CATEGORY_LABEL[c])),
    withSystem ? E('option', { value: 'system', selected: category === 'system' ? 'selected' : null }, 'System') : '',
  ]) as HTMLSelectElement;
  const age = E(
    'select',
    { class: 'cbi-input-select' },
    AGES.map(([v, t]) => E('option', { value: v }, t)),
  ) as HTMLSelectElement;
  modal(
    title,
    [
      E('p', { class: 'dl-muted' }, `${what} This cannot be undone; export first if you want a copy.`),
      E('label', { class: 'dl-fld' }, [E('span', { class: 'dl-fld-label' }, 'Category'), cat]),
      E('label', { class: 'dl-fld' }, [E('span', { class: 'dl-fld-label' }, 'Which events'), age]),
    ],
    [
      E('button', { class: 'cbi-button cbi-button-neutral', click: closeModal }, 'Cancel'),
      ' ',
      button(
        'Clear',
        async () => {
          // System is the service log; "All categories" clears it too where it is shown.
          const r = await attempt(async () => {
            const sys = withSystem && (cat.value === 'system' || cat.value === '') ? await api.serviceLogClear(age.value) : { removed: 0 };
            const ev =
              cat.value === 'system' ? { removed: 0 } : await api.logsClear({ ...base, category: cat.value, older_days: age.value });
            return { removed: sys.removed + ev.removed };
          });
          if (!r) return;
          closeModal();
          notify(r.removed ? `${r.removed} event${r.removed === 1 ? '' : 's'} removed` : 'Nothing matched', 'success', 3000);
          done();
        },
        'negative',
      ),
    ],
  );
}

/** Confirm and reset traffic history for everyone, a person or a device. */
export function resetUsageDialog(scope: 'all' | 'person' | 'device', id: string, label: string, done: () => unknown) {
  const body =
    scope === 'device'
      ? `Clears ${label}'s daily and monthly traffic history. Their person's totals and data limit are not changed.`
      : scope === 'person'
        ? `Clears ${label}'s traffic history and that of their devices. Their data limit starts again from zero.`
        : 'Clears traffic history for everyone. Data limits start again from zero.';
  modal(
    scope === 'all' ? 'Reset all traffic history?' : `Reset traffic history for ${label}?`,
    [E('p', { class: 'dl-muted' }, body)],
    [
      E('button', { class: 'cbi-button cbi-button-neutral', click: closeModal }, 'Cancel'),
      ' ',
      button(
        'Reset',
        async () => {
          if (!(await attempt(() => api.usageClear(scope, id), 'Traffic history reset'))) return;
          closeModal();
          done();
        },
        'negative',
      ),
    ],
  );
}
