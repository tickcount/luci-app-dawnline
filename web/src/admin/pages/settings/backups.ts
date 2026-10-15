// Settings → Backups. The three newest are rows, the rest fold away; moving
// to another router lives in the footer.

import { E } from '../../e';
import { api, type Backup } from '../../api';
import { button, iconButton } from '../../ui/button';
import { confirmDialog } from '../../ui/modal';
import { downloadFile, pickFile } from '../../ui/files';
import { dropdown } from '../../ui/menu';
import { attempt, notify } from '../../ui/toast';
import { icon } from '../../../shared/icons';
import { bytes } from '../../../shared/format';

/** After a change: `true` when everything changed (restore, import), else only the list. */
type Done = (all?: boolean) => void;

const REASON: Record<string, string> = {
  manual: 'Manual',
  auto: 'Nightly',
  'pre-restore': 'Before restore',
  'pre-import': 'Before import',
  'pre-delete': 'Before removing a server',
  'pre-update': 'Before update',
};
const SHOWN = 3;

/** "Today, 03:00", "Yesterday, 03:00" or "12 Oct, 03:00". */
function when(ts: number): string {
  const d = new Date(ts * 1000);
  const t = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((new Date(new Date().toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  return `${days === 0 ? 'Today' : days === 1 ? 'Yesterday' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${t}`;
}

async function download(b: Backup) {
  const r = await attempt(() => api.backupRead(b.name));
  if (!r) return;
  const bin = atob(r.data);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const g = globalThis as unknown as { Blob: typeof Blob };
  downloadFile(b.name, new g.Blob([arr], { type: 'application/gzip' }));
}

function backupRow(b: Backup, done: Done): HTMLElement {
  return E('div', { class: 'dl-row dl-bk-row' }, [
    E('span', { class: 'dl-group-ic' }, icon('archive')),
    E('span', { class: 'dl-row-main dl-stack' }, [
      E('b', {}, when(b.created)),
      E('span', { class: 'dl-sub' }, `${REASON[b.reason] ?? b.reason} · ${bytes(b.size)}`),
    ]),
    E('span', { class: 'dl-pcard-actions' }, [
      iconButton('download', 'Download', () => download(b), 'neutral', 'dl-icon-only'),
      iconButton(
        'more',
        'More',
        (ev: MouseEvent) =>
          dropdown(ev.currentTarget as HTMLElement, [
            {
              label: 'Restore',
              icon: icon('reset'),
              run: async () => {
                const ok = await confirmDialog(
                  'Restore this backup?',
                  `Everything returns to ${when(b.created)}. The current state is backed up first.`,
                  'Restore',
                  true,
                );
                if (ok && (await attempt(() => api.backupRestore(b.name), 'Restored'))) done(true);
              },
            },
            {
              label: 'Delete',
              icon: icon('trash'),
              danger: true,
              run: async () => {
                if (
                  !(await confirmDialog(
                    'Delete this backup?',
                    `The backup from ${when(b.created)} is removed from the router.`,
                    'Delete',
                    true,
                  ))
                )
                  return;
                if (await attempt(() => api.backupDelete(b.name), 'Backup deleted')) done();
              },
            },
          ]),
        'neutral',
        'dl-icon-only',
      ),
    ]),
  ]);
}

/** The Backups section; `done` reloads the list (and the page data after a restore). */
export function backupsSection(list: Backup[], done: Done): HTMLElement {
  const rows = list.slice(0, SHOWN).map((b) => backupRow(b, done));
  const older = list.slice(SHOWN);
  const body = list.length
    ? E('div', { class: 'dl-list' }, [
        ...rows,
        older.length
          ? E('details', { class: 'dl-bk-older' }, [
              E('summary', {}, [icon('chevron'), `${older.length} older backup${older.length === 1 ? '' : 's'}`]),
              ...older.map((b) => backupRow(b, done)),
            ])
          : '',
      ])
    : E('div', { class: 'dl-list' }, [E('div', { class: 'dl-row dl-muted' }, 'No backups yet.')]);

  const restoreFile = button('Restore from file', async () => {
    const f = await pickFile('.tar.gz,.tgz,application/gzip', 'base64');
    if (!f) return;
    const ok = await confirmDialog(
      'Restore from file?',
      `Replace the current Dawnline configuration with ${f.name}? The current state is backed up first.`,
      'Restore',
      true,
    );
    if (ok && (await attempt(() => api.backupUpload(f.data), 'Restored'))) done(true);
  });
  const exportJson = button('Export JSON', async () => {
    const r = await attempt(() => api.exportJson());
    if (r) downloadFile(`dawnline-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(r, null, 2), 'application/json');
  });
  const importJson = button('Import JSON', async () => {
    const f = await pickFile('.json,application/json', 'text');
    if (!f) return;
    let data: unknown;
    try {
      data = JSON.parse(f.data);
    } catch {
      notify('Not a JSON file.', 'error');
      return;
    }
    const ok = await confirmDialog(
      'Import?',
      'This replaces the whole Dawnline configuration on this router. The current state is backed up first.',
      'Import',
      true,
    );
    if (ok && (await attempt(() => api.importJson(data), 'Imported'))) done(true);
  });

  return E('section', { class: 'dl-setsec', id: 'dl-set-backups' }, [
    E('div', { class: 'dl-setsec-body' }, [
      E('div', { class: 'dl-setsec-head' }, [
        E('div', { class: 'dl-stack' }, [
          E('h3', {}, 'Backups'),
          E(
            'span',
            { class: 'dl-sub' },
            'Nightly when something changed, and before every restore, import or update. The last 10 are kept.',
          ),
        ]),
        E('span', { class: 'dl-spacer' }),
        button(
          [icon('plus'), ' Back up now'],
          async () => {
            if (await attempt(() => api.backupCreate(), 'Backup created')) done();
          },
          'positive',
        ),
      ]),
      body,
    ]),
    E('div', { class: 'dl-setsec-foot' }, [
      E(
        'span',
        { class: 'dl-sub' },
        'Backups contain private keys: keep downloads safe. JSON moves everything except usage history to another router.',
      ),
      E('span', { class: 'dl-row-actions dl-bk-actions' }, [restoreFile, exportJson, importJson]),
    ]),
  ]);
}
