// An updater job in the portal's sheet, from its question to its end:
// Dawnline itself, AmneziaWG, the system packages, a check, a translation,
// installing what a feature is missing. The question first where the job
// restarts something (flows/ask.ts); then the job on its stage
// (flows/job-stage.ts): updates_run, followed by updates_status each second,
// its phases as the steps, its time and its log; then what came of it, on the
// same stage. A check ends in what it found, a row a component. Dawnline's
// own job ends in a wait: the router restarts its services under the page,
// which reads itself again once the router answers with the new version (no
// button to press: the owner, 2026-11-12, «сделать автоматический релоад»). Closing
// the sheet leaves the job running on the router: the page picks it up again
// (its row in Settings › Updates opens it here).

import { api, type UpdateJob, type UpdatesStatus } from '../api';
import { h } from '../../portal/dom';
import { closeSheet, go, onLeave, openSheet, showing, type View } from '../../portal/ui/sheet';
import { glass } from '../ui/glass';
import { ic } from '../ui/icons';
import { errorText } from '../ui/toast';
import { fmt } from '../../shared/i18n';
import { routerSaid } from '../failure';
import {
  addPhase,
  checkVerdict,
  isOurJob,
  jobComponent,
  jobIcon,
  mmss,
  phaseSteps,
  runningComponent,
  type Found,
  type Verdict,
} from '../updater/jobs';
import { askView, type Ask } from './ask';
import { stage, type Stage } from './job-stage';

export interface Operation {
  /** What updates_run gets ("amneziawg:slava:ru", "check:packages", "pkgs:a,b"). */
  what: string;
  /** The job as a title ("Updating AmneziaWG"). */
  title: string;
  /** Asked first (the job restarts tunnels or services); without it the job starts at once. */
  ask?: Omit<Ask, 'run'>;
  /** It ended well: the page reads the router again (the job's last status, or null). */
  done?: (st: UpdatesStatus | null) => void;
  /** A check that found one component's update: the operation its "Update" button starts. */
  update?: (st: UpdatesStatus) => Operation | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The admin's translation, added or removed: LuCI's web server restarts after it and the page is read again. */
const LANG = /^app:(lang:|nolang$)/;

const TONE = { new: 'orange', ok: 'blue', bad: 'red', quiet: 'grey' } as const;
const MARK = { new: 'arrow', ok: 'check', bad: 'alert', quiet: 'minus' } as const;

/** What a check found: a row a component, its mark in the tone of where it stands (as its row in Settings). */
function foundRows(rows: Found[]): HTMLElement {
  return h(
    'div',
    { class: 'checks' },
    ...rows.map((r) =>
      h(
        'div',
        { class: 'chk jb-f' },
        glass(r.icon, TONE[r.tone]),
        h('span', { class: 'chk-t' }, h('b', {}, r.name), h('span', { class: r.mono ? 'mono' : null }, r.line)),
        h('span', { class: `jb-fm ${r.tone}` }, ic(MARK[r.tone])),
      ),
    ),
  );
}

const btn = (cls: string, label: string, run: () => void) =>
  h('button', { type: 'button', class: `btn ${cls}`, onclick: run }, h('span', {}, label));
const closeBtn = (accent: boolean) => btn(accent ? 'accent' : 'soft', accent ? _('Done') : _('Close'), () => closeSheet());

function reload() {
  ui.menu?.flushCache();
  location.reload();
}

/** What a check's end shows: its verdict, the rows it found, and the update's own button where one component has one. */
function checkEnd(s: Stage, v: Verdict, next: Operation | null) {
  const alone = v.rows.length === 1 && v.tone === 'bad';
  s.end({
    tone: v.tone === 'bad' ? 'red' : v.tone === 'new' ? 'orange' : 'green',
    title: v.title,
    // one component whose check failed: its reason is the line, there is no list to read
    text: alone ? v.rows[0].line : undefined,
    body: alone || !v.rows.length ? null : foundRows(v.rows),
    acts: next ? [closeBtn(false), btn('accent', _('Update'), () => go(() => operationView(next)))] : [closeBtn(v.tone !== 'bad')],
  });
}

/**
 * Dawnline is installed: the router restarts its services under the page, which reads itself again once the router
 * answers as `target`. Nothing to press meanwhile; only a wait that ran out offers the reload.
 */
async function awaitRestart(s: Stage, target: string, alive: () => boolean) {
  s.end({
    tone: 'green',
    title: target ? fmt(_('Dawnline %s is installed'), target) : _('Dawnline is installed'),
    text: _('The router is restarting its services. The page reloads by itself.'),
  });
  for (let n = 0; n < 30 && alive(); n++) {
    await sleep(1500);
    const st = await api.updatesStatus().catch(() => null);
    if (st && (!target || st.version === target)) return alive() ? reload() : undefined;
  }
  if (!alive()) return;
  s.say(_('The router has not answered with the new version yet. Reload the page to use it.'));
  s.acts([btn('accent', _('Reload now'), reload)]);
}

/** The job under way, then its end. `follow`: a job already running (started elsewhere, or before a reload). */
function progressView(op: Operation, follow?: UpdateJob): View {
  const isCheck = follow ? follow.action === 'check' : op.what.startsWith('check');
  const comp = follow ? runningComponent(follow) : jobComponent(op.what);
  const s = stage({ icon: jobIcon(comp), title: op.title, lead: _('You can close this: the job carries on on the router.') });
  const el = s.view.el;
  let alive = true;
  onLeave(() => (alive = false));
  const here = () => alive && showing(el);

  void (async () => {
    let job: UpdateJob | null = follow ?? null;
    let id = follow?.id;
    let prevId: string | undefined;
    let since = 0;
    if (!follow) {
      try {
        const before = await api.updatesStatus().catch(() => null);
        prevId = before?.job?.id;
        since = before?.now ?? 0;
        const r = await api.updatesRun(op.what);
        // a quick check may be over already: still this press's job (updates_run never returns an older one)
        if (r.job && r.job.id !== prevId) ({ job, id } = { job: r.job, id: r.job.id });
      } catch (e) {
        return s.end({ tone: 'red', title: _('Not started'), text: errorText(e), acts: [closeBtn(false)] });
      }
    }
    const opened = Date.now();
    let seen: string[] = [];
    let state: UpdateJob['state'] | '' = '';
    let st: UpdatesStatus | null = null;
    let misses = 0;
    while (alive) {
      await sleep(1000);
      st = await api.updatesStatus().catch(() => null);
      // rpcd restarts while the network learns AmneziaWG: keep waiting a while
      if (!st) {
        if (++misses > 60) break;
        continue;
      }
      misses = 0;
      const j = st.job;
      if (!j || !isOurJob(j, id, prevId, since)) {
        if (Date.now() - opened > 15000) break;
        continue;
      }
      id = j.id;
      job = j;
      s.log(j.log);
      s.time(mmss((j.finished ?? st.now) - j.started));
      const next = addPhase(seen, j.phase, _('Finished'));
      if (next !== seen || j.state !== state) {
        seen = next;
        state = j.state;
        if (seen.length && showing(el)) s.steps(phaseSteps(seen, j.state));
      }
      if (j.state !== 'running') break;
    }
    if (!here()) {
      if (job?.state === 'done') op.done?.(st);
      return;
    }
    op.done?.(st);
    if (!job || job.state === 'running')
      return s.end({
        tone: 'orange',
        title: _('No answer'),
        text: _('The router stopped answering. The job may still finish: open Settings in a minute.'),
        keep: true,
        acts: [closeBtn(false)],
      });
    if (job.state === 'failed') {
      const why = (routerSaid(job.error) ?? _('Operation failed')).replace(/\.$/, '');
      return s.end({
        tone: 'red',
        title: isCheck ? _('The check failed') : _('Not installed'),
        text: isCheck ? `${why}.` : `${why}. ${_('Nothing else was changed.')}`,
        keep: true,
        acts: [closeBtn(false)],
      });
    }
    const lang = LANG.exec(job.component ?? '');
    if (lang) {
      s.end({
        tone: 'green',
        title: lang[1] === 'nolang' ? _('The translation is removed') : _('The translation is installed'),
        text: _('The page reloads by itself in a few seconds.'),
      });
      await sleep(4000);
      if (alive) reload();
      return;
    }
    if (isCheck)
      return checkEnd(
        s,
        st ? checkVerdict(st, comp) : { tone: 'ok', title: _('Checked'), rows: [] },
        st ? (op.update?.(st) ?? null) : null,
      );
    if (comp === 'app') return awaitRestart(s, job.to ?? '', here);
    const pkgs = [...((job.result?.pkgs?.updated as string[]) ?? []), ...((job.result?.pkgs?.installed as string[]) ?? [])];
    s.end({
      tone: 'green',
      title:
        comp === 'pkgs'
          ? _('System packages are updated')
          : comp === 'amneziawg'
            ? job.to
              ? fmt(_('AmneziaWG %s is installed'), job.to)
              : _('AmneziaWG is installed')
            : _('Done'),
      text: comp === 'pkgs' && pkgs.length ? pkgs.join(', ') : undefined,
      acts: [closeBtn(true)],
    });
  })();
  return s.view;
}

/** The operation's first view: its question, or straight to its progress (a flow that leads into it goes there). */
export function operationView(op: Operation): View {
  if (!op.ask) return progressView(op);
  return askView({ ...op.ask, run: async () => go(() => progressView(op)) });
}

/** Run an updater job in the sheet (asked first where it restarts something). */
export const runOperation = (op: Operation) => openSheet(() => operationView(op));

/** Follow a job that is already running (the page found it), titled by `title`. */
export function followOperation(job: UpdateJob, title: string, done?: (st: UpdatesStatus | null) => void) {
  openSheet(() => progressView({ what: '', title, done }, job));
}
