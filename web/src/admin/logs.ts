// Activity log actions shared by Diagnostics, Settings, the person page and
// the device drawer: export, and the clear / reset dialogs.

import type { LogEvent, Status } from '../shared/types';
import { E } from './e';
import { api, type LogCategory, type LogFilter, type ServiceLogEntry } from './api';
import { button } from './ui/button';
import { cancelButton, closeModal, modal } from './ui/modal';
import { downloadFile } from './ui/files';
import { attempt, errorText, notify } from './ui/toast';
import { CATEGORIES, CATEGORY_LABEL, SYSTEM_SOURCE, categoryOf, eventBy } from './events/model';
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
  downloadFile(name, toCsv(cols, rows), 'text/csv');
}

const AGES: [string, string][] = [
  ['', 'Everything'],
  ['7', 'Older than 7 days'],
  ['30', 'Older than 30 days'],
  ['90', 'Older than 90 days'],
];

const removed = (n: number) => (n ? `${n} event${n === 1 ? '' : 's'} removed` : 'Nothing matched');

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
      cancelButton(),
      ' ',
      button(
        'Clear',
        async () => {
          // The activity log first, then the service log ("System"; "All categories"
          // clears it too where it is shown). Each result is reported on its own.
          let n = 0;
          if (cat.value !== 'system') {
            try {
              n += (await api.logsClear({ ...base, category: cat.value, older_days: age.value })).removed;
            } catch (e) {
              notify(errorText(e), 'error', 10000);
              return;
            }
          }
          if (withSystem && (cat.value === 'system' || cat.value === '')) {
            try {
              n += (await api.serviceLogClear(age.value)).removed;
            } catch (e) {
              closeModal();
              notify(
                `${cat.value === 'system' ? '' : `Activity: ${removed(n).toLowerCase()}. `}The service log was not cleared: ${errorText(e)}`,
                'error',
                10000,
              );
              done();
              return;
            }
          }
          closeModal();
          notify(removed(n), 'success', 3000);
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
      cancelButton(),
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
