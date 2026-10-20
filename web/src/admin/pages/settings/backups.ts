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
import { fmt, locale, plural } from '../../../shared/i18n';

/** After a change: `true` when everything changed (restore, import), else only the list. */
type Done = (all?: boolean) => void;

/** Why a backup was made, from its reason id; an unknown id as it is. */
function reasonLabel(r: string): string {
  const label: Record<string, string> = {
    manual: _('Manual'),
    auto: _('Nightly'),
    'pre-restore': _('Before restore'),
    'pre-import': _('Before import'),
    'pre-delete': _('Before removing a server'),
    'pre-update': _('Before update'),
  };
  return label[r] ?? r;
}
const SHOWN = 3;

/** "Today, 03:00", "Yesterday, 03:00" or "12 Oct, 03:00". */
function when(ts: number): string {
  const d = new Date(ts * 1000);
  const t = d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((new Date(new Date().toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  if (days === 0) return fmt(_('Today, %s'), t);
  if (days === 1) return fmt(_('Yesterday, %s'), t);
  return `${d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' })}, ${t}`;
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
      E('span', { class: 'dl-sub' }, `${reasonLabel(b.reason)} · ${bytes(b.size)}`),
    ]),
    E('span', { class: 'dl-pcard-actions' }, [
      iconButton('download', _('Download'), () => download(b), 'neutral', 'dl-icon-only'),
      iconButton(
        'more',
        _('More'),
        (ev: MouseEvent) =>
          dropdown(ev.currentTarget as HTMLElement, [
            {
              label: _('Restore'),
              icon: icon('reset'),
              run: async () => {
                const ok = await confirmDialog(
                  _('Restore this backup?'),
                  fmt(_('Everything returns to %s. The current state is backed up first.'), when(b.created)),
                  _('Restore'),
                  true,
                );
                if (ok && (await attempt(() => api.backupRestore(b.name), _('Restored')))) done(true);
              },
            },
            {
              label: _('Delete'),
              icon: icon('trash'),
              danger: true,
              run: async () => {
                if (
                  !(await confirmDialog(
                    _('Delete this backup?'),
                    fmt(_('The backup from %s is removed from the router.'), when(b.created)),
                    _('Delete'),
                    true,
                  ))
                )
                  return;
                if (await attempt(() => api.backupDelete(b.name), _('Backup deleted'))) done();
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
              E('summary', {}, [icon('chevron'), plural(older.length, '%s older backup', '%s older backups')]),
              ...older.map((b) => backupRow(b, done)),
            ])
          : '',
      ])
    : E('div', { class: 'dl-list' }, [E('div', { class: 'dl-row dl-muted' }, _('No backups yet.'))]);

  const restoreFile = button(_('Restore from file'), async () => {
    const f = await pickFile('.tar.gz,.tgz,application/gzip', 'base64');
    if (!f) return;
    const ok = await confirmDialog(
      _('Restore from file?'),
      fmt(_('Replace the current Dawnline configuration with %s? The current state is backed up first.'), f.name),
      _('Restore'),
      true,
    );
    if (ok && (await attempt(() => api.backupUpload(f.data), _('Restored')))) done(true);
  });
  const exportJson = button(_('Export JSON'), async () => {
    const r = await attempt(() => api.exportJson());
    if (r) downloadFile(`dawnline-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(r, null, 2), 'application/json');
  });
  const importJson = button(_('Import JSON'), async () => {
    const f = await pickFile('.json,application/json', 'text');
    if (!f) return;
    let data: unknown;
    try {
      data = JSON.parse(f.data);
    } catch {
      notify(_('Not a JSON file.'), 'error');
      return;
    }
    const ok = await confirmDialog(
      _('Import?'),
      _('This replaces the whole Dawnline configuration on this router. The current state is backed up first.'),
      _('Import'),
      true,
    );
    if (ok && (await attempt(() => api.importJson(data), _('Imported')))) done(true);
  });

  return E('section', { class: 'dl-setsec', id: 'dl-set-backups' }, [
    E('div', { class: 'dl-setsec-body' }, [
      E('div', { class: 'dl-setsec-head' }, [
        E('div', { class: 'dl-stack' }, [
          E('h3', {}, _('Backups')),
          E(
            'span',
            { class: 'dl-sub' },
            _('Nightly when something changed, and before every restore, import or update. The last 10 are kept.'),
          ),
        ]),
        E('span', { class: 'dl-spacer' }),
        button(
          [icon('plus'), ' ', _('Back up now')],
          async () => {
            if (await attempt(() => api.backupCreate(), _('Backup created'))) done();
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
        _('Backups contain private keys: keep downloads safe. JSON moves everything except usage history to another router.'),
      ),
      E('span', { class: 'dl-row-actions dl-bk-actions' }, [restoreFile, exportJson, importJson]),
    ]),
  ]);
}
