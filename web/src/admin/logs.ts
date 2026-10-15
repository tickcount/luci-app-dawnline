// Activity log helpers shared by Activity, Settings, the person page and the
// device drawer: categories, export, and the clear / reset dialogs.

import type { LogEvent, Status } from '../shared/types';
import { E } from './e';
import { api, type LogCategory, type LogFilter } from './api';
import { attempt, button, closeModal, downloadFile, modal, notify } from './ui';

/** Mirrors CATEGORY in dawnline.live. */
const CATEGORY: Record<string, LogCategory> = {
  connect: 'connections',
  disconnect: 'connections',
  roam: 'connections',
  device_added: 'devices',
  device_removed: 'devices',
  devices_removed: 'devices',
  person_added: 'people',
  person_removed: 'people',
  person_changed: 'people',
  paused: 'people',
  resumed: 'people',
  paused_all: 'people',
  resumed_all: 'people',
  server_down: 'problems',
  server_up: 'problems',
  portal_blocked: 'problems',
};

export const CATEGORIES: LogCategory[] = ['connections', 'devices', 'people', 'problems'];

export const CATEGORY_LABEL: Record<LogCategory, string> = {
  connections: 'Connections',
  devices: 'Devices',
  people: 'People',
  problems: 'Problems',
};

export const CATEGORY_HELP: Record<LogCategory, string> = {
  connections: 'Connects, disconnects and IP changes',
  devices: 'Devices added and removed',
  people: 'People added, changed, paused',
  problems: 'Tunnel down, blocked portal sign-ins',
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

/** Download events as CSV or JSON (person and device names resolved). */
export function exportEvents(st: Pick<Status, 'people'>, events: LogEvent[], format: 'csv' | 'json', suffix = '') {
  const n = names(st);
  const rows = events.map((e) => ({
    time: new Date(e.ts * 1000).toISOString(),
    category: categoryOf(e.type),
    type: e.type,
    person: e.person ? (n.people.get(e.person) ?? e.person) : '',
    device: e.device ? (n.devices.get(e.device) ?? e.device) : '',
    detail: e.detail ?? '',
    where: e.where ?? '',
  }));
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `dawnline-activity${suffix ? `-${suffix}` : ''}-${stamp}.${format}`;
  if (format === 'json') {
    downloadFile(name, JSON.stringify(rows, null, 2), 'application/json');
    return;
  }
  const cols = ['time', 'category', 'type', 'person', 'device', 'detail', 'where'] as const;
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
export function clearLogDialog(title: string, what: string, base: LogFilter, done: () => unknown, category?: LogCategory) {
  const cat = E('select', { class: 'cbi-input-select' }, [
    E('option', { value: '' }, 'All categories'),
    ...CATEGORIES.map((c) => E('option', { value: c, selected: c === category ? 'selected' : null }, CATEGORY_LABEL[c])),
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
          const r = await attempt(() => api.logsClear({ ...base, category: cat.value, older_days: age.value }));
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
