// A job in the portal's sheet as one view from its start to its end (DESIGN.md
// › Admin kit › «A job's stage»): the question's own anatomy held through,
// so nothing is laid over anything. On top the picture of what the job is
// about (a component's mark) in the tone of where it stands, its title and
// one line; under them the steps it went through, the one under way last
// with its time; its log folded in the portal's inset row; the actions at
// the foot, once there is something to decide. The end changes the same
// parts in place: the picture's tone, the words, and what stands under them
// (the steps stay where a job failed, give way to what a check found, or go).
// Nothing is slid to a new place: each part goes to its new height where it
// stands (portal/ui/grown.ts) and what is under it travels with its edge, so
// the log's row never crosses a button that has just come.
// This module only draws: who runs the job and what its words are is the
// flow's (flows/operation.ts, flows/restore.ts).

import { h } from '../../portal/dom';
import { accordion } from '../../portal/ui/accordion';
import { EASE_OUT, POP, calm, play } from '../../portal/motion';
import { grown } from '../../portal/ui/grown';
import { putChildren } from '../../portal/ui/put';
import type { View } from '../../portal/ui/sheet';
import { tip } from '../../portal/ui/tip';
import { copyText } from '../ui/files';
import { glass } from '../ui/glass';
import { ic } from '../ui/icons';

type StageTone = 'blue' | 'green' | 'orange' | 'red';

/** A step of the job: done, under way, where it failed, or not reached yet (a job whose steps are known ahead). */
export interface StageStep {
  title: string;
  state: 'ok' | 'run' | 'bad' | 'wait';
}

interface StageEnd {
  tone: StageTone;
  title: string;
  /** One line under the title (why it failed, what happens next); none when the title says it all. */
  text?: string;
  /** What stands in the steps' place (what a check found); the steps stay with `keep`, else they go. */
  body?: HTMLElement | null;
  keep?: boolean;
  /** None while the stage only waits (a page that reads itself again). */
  acts?: HTMLElement[];
}

export interface Stage {
  view: View;
  /** The steps so far, the last one under way (or where it failed). */
  steps(list: StageStep[]): void;
  /** The time the job has taken, at the end of its last step. */
  time(text: string): void;
  log(lines: string[]): void;
  /** The line under the title says something else (a wait after the end). */
  say(text: string): void;
  /** The actions at the foot change (a wait that ran out offers the way on). */
  acts(list: HTMLElement[]): void;
  end(o: StageEnd): void;
}

const MARK = { ok: 'check', bad: 'x' } as const;

/** What changed comes into focus, as the sheet's own glide brings a changed block in. */
const focus = (...els: Element[]) =>
  els.forEach((el) =>
    play(
      el,
      [
        { opacity: 0, filter: 'blur(4px)' },
        { opacity: 1, filter: 'none' },
      ],
      { duration: 280, easing: EASE_OUT },
    ),
  );

/** `steps`: the job's steps when they are known ahead (else it starts at «Starting…»); `log: false`: it keeps none. */
export function stage(o: { icon: string; title: string; lead: string; steps?: StageStep[]; log?: boolean }): Stage {
  const pic = h('span', { class: 'jb-pic' }, glass(o.icon, 'blue', 'gi xl'));
  const title = h('h3', {}, o.title);
  const lead = h('p', {}, o.lead);
  const clock = h('span', { class: 'jb-time num' }, '0:00');
  const list = h('ol', { class: 'jb-steps' });
  const body = h('div', { class: 'jb-body', hidden: true });
  const row = h('div', { class: 'btnrow' });

  let lines: string[] = [];
  const pre = h('pre', { class: 'jb-log' }, _('Waiting for log output…'));
  const copy = h('button', { type: 'button', class: 'hp-b', 'aria-label': _('Copy log') }, ic('copy'));
  copy.addEventListener('click', () => void copyText(lines.join('\n'), _('Log copied')));
  tip(copy, () => _('Copy log'));
  const log =
    o.log === false
      ? null
      : accordion([{ icon: glass('log', 'grey'), title: _('Operation log'), aside: h('div', { class: 'hpill' }, copy), body: [pre] }], {
          inset: true,
        }).el;

  let done = 0;
  const draw = (steps: StageStep[]) => {
    putChildren(
      list,
      steps.map((s, i) =>
        h(
          'li',
          { class: `jb-s ${s.state}` },
          h('span', { class: 'jb-m' }, s.state === 'ok' || s.state === 'bad' ? ic(MARK[s.state]) : h('i')),
          h('span', { class: 'jb-t' }, s.title),
          i === steps.length - 1 ? clock : null,
        ),
      ),
    );
    // a check that has just come turns in as the portal's after a copy (POP from s.6, b3), one after another
    const ok = steps.filter((s) => s.state === 'ok').length;
    if (!calm())
      [...list.querySelectorAll('.jb-s.ok > .jb-m')].slice(done).forEach((m, i) =>
        play(
          m,
          [
            { opacity: 0, transform: 'scale(.6)', filter: 'blur(3px)' },
            { opacity: 1, transform: 'none', filter: 'blur(0px)' },
          ],
          { duration: POP.duration, delay: i * 60, easing: POP.easing, fill: 'backwards' },
        ),
      );
    done = ok;
  };
  draw(o.steps ?? [{ title: _('Starting…'), state: 'run' }]);

  // the top is the sheet's handle on a phone, as a view's head is (portal/ui/sheet.ts)
  const top = h('div', { class: 'ask vgrab' }, pic, title, lead);
  const mid = h('div', { class: 'jb-mid' }, list, body);
  const foot = h('div', { class: 'jb-foot' });
  const el = h('div', { class: `view jb${log ? '' : ' nolog'}` }, top, mid, log, foot);
  const parts = [top, mid, foot];
  /** A change of what the parts hold: each goes to its new height where it stands, what is under it with its edge. */
  const reshape = (change: () => void) => {
    const was = parts.map((x) => x.offsetHeight);
    change();
    parts.forEach((x, i) => grown(x, was[i]));
  };
  const setActs = (next: HTMLElement[]) => {
    putChildren(row, next);
    putChildren(foot, next.length ? [row] : []);
  };

  return {
    view: { el, label: o.title },
    steps: (steps) => reshape(() => draw(steps)),
    time: (text) => {
      if (clock.textContent !== text) clock.textContent = text;
    },
    log(next) {
      if (!next.length || next.join('\n') === lines.join('\n')) return;
      lines = next;
      const atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 8;
      pre.textContent = lines.join('\n');
      if (atEnd) pre.scrollTop = pre.scrollHeight;
    },
    say(text) {
      reshape(() => {
        lead.textContent = text;
        lead.hidden = !text;
      });
      focus(lead);
    },
    acts(next) {
      reshape(() => setActs(next));
      focus(row);
    },
    end(e) {
      const g = glass(o.icon, e.tone, 'gi xl');
      reshape(() => {
        putChildren(pic, [g]);
        title.textContent = e.title;
        lead.textContent = e.text ?? '';
        lead.hidden = !e.text;
        list.hidden = !e.keep;
        if (e.body) putChildren(body, [e.body]);
        body.hidden = !e.body;
        setActs(e.acts ?? []);
      });
      focus(g, title, lead, body, row);
    },
  };
}
