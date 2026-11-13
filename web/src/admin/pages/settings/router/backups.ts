// Settings › Backups: the copies Dawnline keeps on the router (nightly when
// something changed, and before every restore, import, update or server
// removal; the last 10), as a table: when (in the router's time) with the
// file, why, how big; every copy in sight, each with Restore (in the sheet),
// download and delete (asked first) on its row. Over the table: a copy made
// now and a restore from a file. None yet: one row says so. Then moving
// everything to another router (JSON export and import, in the sheet). A
// read-only login sees the table only (the copies hold private keys).

import type { Backup } from '../../../api';
import { api } from '../../../api';
import { h } from '../../../../portal/dom';
import { closeSheet, openSheet } from '../../../../portal/ui/sheet';
import { once } from '../../../../portal/ui/feedback';
import { bytes } from '../../../../shared/format';
import { fmt } from '../../../../shared/i18n';
import { glass } from '../../../ui/glass';
import { ic } from '../../../ui/icons';
import { compList, compRow } from '../../../ui/comp-row';
import { downloadFile } from '../../../ui/files';
import { cap, card, note, section } from '../../../ui/section';
import { errorText, notify } from '../../../ui/toast';
import { say } from '../../../shell/toast';
import { whenAt } from '../../../events/clock';
import { askView } from '../../../flows/ask';
import { restoreSheet } from '../../../flows/restore';
import { reasonLabel } from '../../../system/model';
import type { RouterCtx } from './ctx';

const button = (cls: string, icon: string | null, label: string, run?: () => void): HTMLButtonElement =>
  h(
    'button',
    { type: 'button', class: `btn ${cls} sm`, onclick: run ?? null },
    icon ? ic(icon) : null,
    h('span', {}, label),
  ) as HTMLButtonElement;

async function download(b: Backup) {
  try {
    const r = await api.backupRead(b.name);
    const bin = atob(r.data);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const g = globalThis as unknown as { Blob: typeof Blob };
    downloadFile(b.name, new g.Blob([arr], { type: 'application/gzip' }));
  } catch (e) {
    notify(errorText(e), 'error', 10000);
  }
}

/** Make one now; the table reads again. */
async function backupNow(y: RouterCtx) {
  try {
    await api.backupCreate();
    say(_('Backup created'));
    await y.reload();
  } catch (e) {
    notify(errorText(e), 'error', 10000);
  }
}

/** Asked first: the copy is gone from the router. */
function remove(y: RouterCtx, b: Backup, when: string) {
  openSheet(() =>
    askView({
      icon: 'trash',
      tone: 'red',
      title: _('Delete this backup?'),
      text: [fmt(_('The backup from %s is removed from the router.'), when)],
      action: _('Delete'),
      cls: 'red',
      run: async () => {
        await api.backupDelete(b.name);
        closeSheet();
        say(_('Backup deleted'));
        void y.reload();
      },
    }),
  );
}

/** A copy's row: when and its file, why, how big, and what can be done with it. */
function row(y: RouterCtx, b: Backup, newest: boolean): HTMLElement {
  const when = whenAt(b.created, y.now(), y.st.tz);
  const why = reasonLabel(b.reason);
  const knob = (icon: string, label: string, run: () => void, cls = '') =>
    h('button', { type: 'button', class: `knob${cls}`, 'aria-label': fmt(_('%s: %s'), label, when), title: label, onclick: run }, ic(icon));
  return h(
    'div',
    { class: 'st-bk-r', role: 'row' },
    h('span', { class: 'st-bk-ic', role: 'presentation' }, glass('backup', newest ? 'blue' : 'grey')),
    h('span', { class: 'st-bk-w', role: 'cell' }, h('b', { class: 'num' }, when), h('span', { class: 'st-bk-f', title: b.name }, b.name)),
    h('span', { class: 'st-bk-why', role: 'cell', title: why }, why),
    h('span', { class: 'st-bk-sz num', role: 'cell' }, bytes(b.size)),
    y.write
      ? h(
          'span',
          { class: 'st-bk-a', role: 'cell' },
          button('soft', null, _('Restore'), () =>
            restoreSheet({ kind: 'backup', backup: b, when: `${when} · ${why}` }, () => void y.reload()),
          ),
          knob('download', _('Download'), () => void download(b)),
          knob('trash', _('Delete'), () => remove(y, b, when), ' st-bk-del'),
        )
      : null,
  );
}

/** Every copy as a table, the newest first; none yet: one row that says so. */
function table(y: RouterCtx): HTMLElement {
  if (!y.backups.length)
    return compList(
      compRow({
        icon: 'backup',
        title: _('No backups yet'),
        line: _('Dawnline makes one itself before an update and before a restore. You can make one now too.'),
      }),
    );
  return h(
    'div',
    { class: `st-bk${y.write ? '' : ' still'}`, role: 'table', 'aria-label': _('Backups') },
    h(
      'div',
      { class: 'st-bk-h', role: 'row' },
      h('span', { role: 'presentation' }),
      h('span', { role: 'columnheader' }, _('When')),
      h('span', { role: 'columnheader' }, _('Why')),
      h('span', { role: 'columnheader', class: 'st-bk-sz' }, _('Size')),
      y.write ? h('span', { role: 'presentation' }) : null,
    ),
    ...y.backups.map((b, i) => row(y, b, !i)),
  );
}

export function backupsSection(y: RouterCtx): HTMLElement {
  const reread = () => void y.reload();
  const make = button('tint', 'archive', _('Back up now'));
  make.addEventListener('click', () => void once(make, () => backupNow(y)));
  const exportJson = button('soft', 'download', _('Export JSON'));
  exportJson.addEventListener('click', () =>
    once(exportJson, async () => {
      try {
        const r = await api.exportJson();
        downloadFile(`dawnline-export-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(r, null, 2), 'application/json');
      } catch (e) {
        notify(errorText(e), 'error', 10000);
      }
    }),
  );
  return section(
    {
      id: 'backups',
      icon: 'backup',
      title: _('Backups'),
      aside: y.backups.length
        ? h('span', { class: 'kt-sx-st' }, h('span', {}, fmt(_('latest %s'), whenAt(y.backups[0].created, y.now(), y.st.tz))))
        : null,
    },
    card(
      y.write
        ? h(
            'div',
            { class: 'st-bk-bar' },
            make,
            button('soft', 'archive', _('Restore from file'), () => restoreSheet({ kind: 'file' }, reread)),
          )
        : null,
      table(y),
      note(
        `${_('Nightly when something changed, and before every restore, import or update. The last 10 are kept.')} ${_('Backups contain private keys: keep downloads safe.')}`,
      ),
    ),
    y.write
      ? card(
          cap(
            _('Moving to another router'),
            exportJson,
            button('soft', 'file', _('Import JSON'), () => restoreSheet({ kind: 'json' }, reread)),
          ),
          note(_('JSON moves everything except usage history to another router.')),
        )
      : null,
  );
}
