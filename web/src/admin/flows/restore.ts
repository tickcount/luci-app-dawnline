// Restoring a backup (one of the list's, or a file) and importing a JSON
// export, in the portal's sheet: what is in it and the question, then the
// work, then what came of it, in the same sheet. The
// router does it in one call (backup_restore, backup_upload, import): its
// steps stand on the job's stage (flows/job-stage.ts) in their order while
// the call runs, with the time it has taken, and fill when it answers. The
// result counts what Dawnline has now (the status read again) and names the
// backup made just before.

import { api, type Backup } from '../api';
import { h } from '../../portal/dom';
import { closeSheet, glide, go, head, onLeave, openSheet, showing, sub, type View } from '../../portal/ui/sheet';
import { once } from '../../portal/ui/feedback';
import { badLine } from '../../portal/ui/bad-line';
import { calm } from '../../portal/motion';
import { bytes } from '../../shared/format';
import { fmt, plural } from '../../shared/i18n';
import { ic } from '../ui/icons';
import { errorText } from '../ui/toast';
import { mmss } from '../updater/jobs';
import { reasonLabel } from '../system/model';
import { putChildren } from '../../portal/ui/put';
import { stage } from './job-stage';

export type Source = { kind: 'backup'; backup: Backup; when: string } | { kind: 'file' } | { kind: 'json' };

interface Picked {
  name: string;
  size: number;
  /** base64 (an archive) or the parsed export. */
  data: unknown;
}

/** The router's steps, in its order (backup.uc backup_restore / import_json). */
const steps = (json: boolean): string[] =>
  json
    ? [_('Check the file'), _('Back up the current state'), _('Replace people, devices and servers'), _('Apply the settings')]
    : [_('Check the backup'), _('Back up the current state'), _('Restore the files'), _('Apply the settings')];

/** The call under way, then its end; `after` reads the page again. */
function workView(src: Source, file: Picked | null, title: string, after: () => void): View {
  const json = src.kind === 'json';
  const list = steps(json);
  const s = stage({
    icon: 'backup',
    title,
    lead: _('Takes up to a minute. Keep this open.'),
    steps: list.map((t) => ({ title: t, state: 'wait' })),
    log: false,
  });
  const el = s.view.el;
  const t0 = Date.now();
  const tick = window.setInterval(() => s.time(mmss((Date.now() - t0) / 1000)), 1000);
  onLeave(() => clearInterval(tick));
  const close = (accent: boolean) =>
    h(
      'button',
      { type: 'button', class: `btn ${accent ? 'accent' : 'soft'}`, onclick: () => closeSheet() },
      h('span', {}, accent ? _('Done') : _('Close')),
    );
  void (async () => {
    try {
      if (src.kind === 'backup') await api.backupRestore(src.backup.name);
      else if (src.kind === 'file') await api.backupUpload(file!.data);
      else await api.importJson(file!.data);
    } catch (e) {
      clearInterval(tick);
      after();
      if (!showing(el)) return;
      return s.end({
        tone: 'red',
        title: json ? _('Not imported') : _('Not restored'),
        text: `${errorText(e).replace(/\.$/, '')}. ${_('Nothing was changed.')}`,
        acts: [close(false)],
      });
    }
    clearInterval(tick);
    after();
    // the steps fill top to bottom as the answer lands, then make way for what came of it
    if (showing(el)) {
      s.steps(list.map((t) => ({ title: t, state: 'ok' })));
      await new Promise((r) => setTimeout(r, calm() ? 0 : 520));
    }
    const [st, bk] = await Promise.all([api.status(1).catch(() => null), api.backupList().catch(() => null)]);
    if (!showing(el)) return;
    const made = bk?.backups.find((b) => b.reason === (json ? 'pre-import' : 'pre-restore'));
    const counts = st
      ? fmt(
          _('Dawnline has %s, %s and %s now.'),
          plural(st.people.length, '%s person', '%s people'),
          plural(
            st.people.reduce((n, p) => n + p.devices.length, 0),
            '%s device',
            '%s devices',
          ),
          plural(st.servers.length, '%s server', '%s servers'),
        )
      : '';
    const kept = made ? fmt(_('What was there before is kept in the backup “%s”.'), reasonLabel(made.reason)) : '';
    s.end({
      tone: 'green',
      title: json ? _('Imported') : _('Restored'),
      text: [counts, kept].filter(Boolean).join(' '),
      acts: [close(true)],
    });
  })();
  return { ...s.view, asks: true };
}

function view(src: Source, after: () => void): View {
  const json = src.kind === 'json';
  const title = json ? _('Import JSON') : _('Restore a backup');
  let file: Picked | null = null;
  const input = h('input', {
    type: 'file',
    accept: json ? '.json,application/json' : '.tar.gz,.tgz,application/gzip',
    class: 'vh',
    'aria-label': _('File'),
  }) as HTMLInputElement;
  const pick = h('label', { class: 'btn soft block fpick' }, input, ic(json ? 'file' : 'archive'), h('span', {}, _('Choose a file')));
  const what = h('div', { class: 'fsum', hidden: true });
  const { el: bad, say, unsay } = badLine();
  const ok = h(
    'button',
    { type: 'button', class: 'btn warn', disabled: src.kind !== 'backup' },
    h('span', {}, json ? _('Import') : _('Restore')),
  ) as HTMLButtonElement;
  const show = (name: string, size: number, line: string) => {
    putChildren(what, [
      h(
        'div',
        { class: 'filecard' },
        h(
          'div',
          { class: 'fc-row' },
          h('span', { class: 'filecard-ic' }, json ? '.json' : '.tgz'),
          h('span', { class: 't' }, h('span', { class: 'mono' }, name), h('span', {}, `${bytes(size)} · ${line}`)),
        ),
      ),
    ]);
    what.hidden = false;
    pick.hidden = true;
    ok.disabled = false;
  };
  if (src.kind === 'backup') show(src.backup.name, src.backup.size, src.when);
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (!f) return;
    unsay();
    const r = new FileReader();
    r.onload = () => {
      const res = String(r.result ?? '');
      let data: unknown = res.replace(/^data:[^,]*,/, '');
      if (json) {
        try {
          data = JSON.parse(res);
        } catch {
          input.value = '';
          return say(_('Not a JSON file.'));
        }
      }
      file = { name: f.name, size: f.size, data };
      glide(() => show(f.name, f.size, json ? _('Dawnline export') : _('Dawnline backup')), [what]);
    };
    r.onerror = () => say(_('The file could not be read.'));
    if (json) r.readAsText(f);
    else r.readAsDataURL(f);
  });
  ok.addEventListener('click', () => void once(ok, async () => go(() => workView(src, file, title, after))));
  const el = h(
    'div',
    { class: 'view' },
    head(title),
    sub(
      json
        ? _('People, devices and servers from a Dawnline export (usage history is not in it).')
        : _('A Dawnline backup: people, devices, servers and their keys.'),
    ),
    pick,
    what,
    bad,
    h('p', { class: 'hint op-warn' }, _('Replaces everything Dawnline has now. The current state is backed up first.')),
    h('div', { class: 'btnrow' }, h('button', { type: 'button', class: 'btn soft', onclick: () => closeSheet() }, _('Cancel')), ok),
  );
  return { el, label: title, asks: true };
}

/** Restore `src` (a backup of the list, a file to pick) or import JSON; `after` reads the page again once it is done. */
export const restoreSheet = (src: Source, after: () => void) => openSheet(() => view(src, after));
