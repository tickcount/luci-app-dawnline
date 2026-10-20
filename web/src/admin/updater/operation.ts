// Component operations (check, update, install, roll back) in one modal with
// the updater's live log. Used by Components and wherever a feature installs
// a missing package.

import { E } from '../e';
import { api, type UpdateJob, type UpdatesStatus } from '../api';
import { icon } from '../../shared/icons';
import { button, iconButton } from '../ui/button';
import { cancelButton, closeModal, modal } from '../ui/modal';
import { copyText } from '../ui/files';
import { errorText, notify } from '../ui/toast';
import { fmt } from '../../shared/i18n';
import { checkVerdict, componentName, isOurJob, jobComponent, mmss, runningComponent, verText } from './jobs';

export interface OpOptions {
  /** Modal title, e.g. "Updating Dawnline". */
  title: string;
  /** Shown before the job reports its versions. */
  version?: string;
  /** After a check that found an update: what the Update button starts. */
  onUpdate?: (st: UpdatesStatus) => void;
  /** The page refreshes its cards with this. */
  onDone?: (st: UpdatesStatus | null) => void;
  /** As soon as the job this operation follows is known (its id). */
  onJob?: (job: UpdateJob) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Start `what` (see updates_run) and follow it in a modal; resolves with the
 * finished job (null when it could not start). `follow` attaches to a job
 * that is already running instead.
 */
export async function runOperation(what: string | null, o: OpOptions, follow?: UpdateJob): Promise<UpdateJob | null> {
  const comp = follow ? runningComponent(follow) : jobComponent(what!);
  const isCheck = follow ? follow.action === 'check' : what!.startsWith('check');
  const opened = Date.now();
  const name = E('b', {}, componentName(comp) ?? (comp === 'all' ? _('All components') : 'Dawnline'));
  const ver = E('span', { class: 'dl-pill dl-mono' }, o.version ?? '');
  const phase = E('span', { class: 'dl-pill info', hidden: true });
  const timer = E('span', {}, '0:00');
  const log = E('pre', { class: 'dl-log' }, _('Operation started. Waiting for log output…'));
  const result = E('div', {});
  const actions = E('div', { class: 'dl-op-actions' });
  let lines: string[] = [];
  const setActions = (nodes: Node[]) => dom.content(actions, nodes);
  const closeBtn = (danger = false) => cancelButton(_('Close'), danger);

  modal(
    o.title,
    E('div', { class: 'dl-op' }, [
      E('div', { class: 'dl-op-head' }, [
        name,
        o.version ? ver : '',
        phase,
        E('span', { class: 'dl-spacer' }),
        E('span', { class: 'dl-faint dl-op-timer' }, [icon('clock'), timer]),
      ]),
      E('div', { class: 'dl-op-loghead' }, [
        E('b', {}, _('Operation log')),
        iconButton('copy', _('Copy log'), () => copyText(lines.join('\n'), _('Log copied'))),
      ]),
      log,
      result,
    ]),
    [actions],
    'wide',
  );
  setActions([
    E(
      'button',
      { class: 'cbi-button cbi-button-neutral spinning', type: 'button', disabled: 'disabled' },
      isCheck ? _('Checking…') : _('Working…'),
    ),
  ]);

  let job: UpdateJob | null = follow ?? null;
  let id = follow?.id;
  // The job before the click and the router's clock then: a finished job from
  // before must never pass for the one this click starts.
  let prevId: string | undefined;
  let since = 0;
  const known = (j: UpdateJob) => {
    if (id === j.id) return;
    id = j.id;
    o.onJob?.(j);
  };
  if (follow) o.onJob?.(follow);
  else {
    try {
      const before = await api.updatesStatus().catch(() => null);
      prevId = before?.job?.id;
      since = before?.now ?? 0;
      const r = await api.updatesRun(what!);
      if (r.job && r.job.state === 'running' && r.job.id !== prevId) {
        job = r.job;
        known(r.job);
      }
    } catch (e) {
      lines = [errorText(e)];
      log.textContent = lines[0];
      dom.content(result, E('div', { class: 'dl-comp-status warn' }, [icon('alert'), E('span', {}, errorText(e))]));
      setActions([closeBtn(true)]);
      notify(errorText(e), 'error');
      return null;
    }
  }
  let st: UpdatesStatus | null = null;
  let errors = 0;
  // Follow the job: log, phase and timer every second.
  for (;;) {
    await sleep(1000);
    st = await api.updatesStatus().catch(() => null);
    if (!st) {
      // rpcd restarts during Dawnline's own update: keep waiting a while.
      if (++errors > 60) break;
      continue;
    }
    errors = 0;
    const j = st.job;
    if (!j || !isOurJob(j, id, prevId, since)) {
      if (Date.now() - opened > 15000) break;
      continue;
    }
    known(j);
    job = j;
    if (j.log.length) {
      lines = j.log;
      const atEnd = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
      log.textContent = lines.join('\n');
      if (atEnd) log.scrollTop = log.scrollHeight;
    }
    ver.textContent = verText(j, o.version ?? '');
    if (!ver.isConnected && ver.textContent) name.after(ver);
    timer.textContent = mmss((j.finished ?? st.now) - j.started);
    if (j.state === 'running') {
      phase.hidden = !j.phase;
      phase.textContent = j.phase;
      continue;
    }
    break;
  }
  log.scrollTop = log.scrollHeight;
  phase.hidden = false;
  if (!job || job.state === 'running') {
    phase.className = 'dl-pill warn';
    phase.textContent = _('No answer');
    dom.content(
      result,
      E('div', { class: 'dl-comp-status warn' }, [
        icon('alert'),
        E('span', {}, _('The router stopped answering. The job may still finish: reopen Components in a minute.')),
      ]),
    );
    setActions([closeBtn()]);
    o.onDone?.(st);
    return job;
  }
  if (job.state === 'failed') {
    phase.className = 'dl-pill bad';
    phase.textContent = _('Failed');
    dom.content(
      result,
      E('div', { class: 'dl-comp-status bad' }, [
        icon('x'),
        // The router's error may end its own sentence: one full stop either way.
        E('span', {}, [
          E('b', {}, (job.error ?? _('Operation failed')).replace(/\.$/, '')),
          isCheck ? '' : `. ${_('Nothing else was changed.')}`,
        ]),
      ]),
    );
    setActions([button(_('Copy log'), () => copyText(lines.join('\n'), _('Log copied'))), closeBtn(true)]);
    notify(`${componentName(comp) ?? _('Update', 'noun')}: ${job.error ?? _('failed')}`, 'error');
    o.onDone?.(st);
    return job;
  }
  phase.className = 'dl-pill ok';
  phase.textContent = _('Finished');
  if (isCheck && st) {
    const v = checkVerdict(st, comp);
    dom.content(
      result,
      E('div', { class: `dl-comp-status ${v.tone}` }, [
        icon(v.tone === 'ok' ? 'check' : v.tone === 'warn' ? 'alert' : 'download'),
        E('span', {}, v.text),
      ]),
    );
    notify(v.text, v.tone === 'warn' ? 'warning' : 'success');
    o.onDone?.(st);
    if (v.update && o.onUpdate) {
      const s = st;
      setActions([closeBtn(), button(fmt(_('Update to %s'), v.update), () => o.onUpdate!(s), 'positive')]);
    } else {
      setActions([closeBtn()]);
      // Nothing to do: the modal goes away on its own (as in the check toast).
      if (v.tone === 'ok') setTimeout(() => result.isConnected && closeModal(), 1200);
    }
    return job;
  }
  // The admin's translation: LuCI's web server restarts two seconds after the
  // job to read it (or forget it); the page then reloads in its new language.
  const lang = /^app:(lang:|nolang$)/.exec(job.component ?? '');
  if (lang) {
    const reload = () => {
      ui.menu?.flushCache();
      location.reload();
    };
    dom.content(
      result,
      E('div', { class: 'dl-comp-status ok' }, [
        icon('check'),
        E('span', {}, [
          E('b', {}, lang[1] === 'nolang' ? _('The translation is removed.') : _('The translation is installed.')),
          ' ',
          _('Reloading the page…'),
        ]),
      ]),
    );
    setActions([closeBtn(), button(_('Reload now'), reload, 'positive')]);
    await sleep(4000);
    if (result.isConnected) reload();
    return job;
  }
  // Dawnline itself: rpcd and the service restart; reload the page once they answer with the new version.
  if (comp === 'app' && job.to) {
    const target = job.to;
    const msg = E('span', {}, _('Waiting for the router to restart its services…'));
    dom.content(
      result,
      E('div', { class: 'dl-comp-status ok' }, [
        icon('check'),
        E('span', {}, [E('b', {}, fmt(_('Dawnline %s is installed.'), target)), ' ', msg]),
      ]),
    );
    const reload = () => {
      ui.menu?.flushCache();
      location.reload();
    };
    setActions([closeBtn(), button(_('Reload now'), reload, 'positive')]);
    notify(fmt(_('Dawnline updated to %s'), target), 'success', 6000);
    for (let n = 1; n <= 30; n++) {
      msg.textContent = fmt(_('Waiting for the router to restart its services (%s of 30)…'), n);
      await sleep(1500);
      const s = await api.updatesStatus().catch(() => null);
      if (s?.version === target) {
        msg.textContent = _('Services are back. Reloading…');
        setTimeout(reload, 800);
        return job;
      }
    }
    msg.textContent = _('Services restarted. Reload the page to use the new version.');
    return job;
  }
  const changed = [...((job.result?.pkgs?.updated as string[]) ?? []), ...((job.result?.pkgs?.installed as string[]) ?? [])];
  const done =
    comp === 'pkgs'
      ? changed.length
        ? fmt(_('Updated %s'), changed.join(', '))
        : _('Updated system packages')
      : comp === 'amneziawg'
        ? job.to
          ? fmt(_('AmneziaWG %s is installed'), job.to)
          : _('AmneziaWG is installed')
        : _('Operation completed');
  dom.content(result, E('div', { class: 'dl-comp-status ok' }, [icon('check'), E('span', {}, done)]));
  setActions([closeBtn()]);
  notify(done, 'success');
  o.onDone?.(st);
  return job;
}
