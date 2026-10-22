// The demo's set-up state switch: a pill beside the set-up sheet's ×, so a visitor can see each state the way
// shows (waiting, knocks that never finish, no data, connected) without a device: a pick pill (ui/pick.ts), its
// popup above it. Only on the set-up view:
// another view in the same sheet (a question, a device's page) fades it out. Picking holds the device in that
// state on the demo's router and polls at once; Auto is the demo's own timing, and where each opening starts.

import { h } from '../dom';
import { EASE_IN, SMOOTH, play } from '../motion';
import { pollNow } from '../flows/wait';
import { pickPill, type PickPill } from '../ui/pick';
import { onSheetChange } from '../ui/sheet';
import type { DemoWay } from './data';
import type { DemoRouter } from './router';

type Pick = DemoWay | 'connected' | 'auto';
type Tone = 'neutral' | 'warn' | 'ok';

const PICKS: [Pick, () => string, Tone][] = [
  ['auto', () => _('Auto'), 'neutral'],
  ['waiting', () => _('Waiting'), 'neutral'],
  ['trying', () => _('Trying'), 'warn'],
  ['nodata', () => _('No data'), 'warn'],
  ['connected', () => _('Online'), 'ok'],
];

/** Gone from where it stands, so one leaving while it still comes in turns back from there. */
function leave(el: Element, frames: Keyframe, ms: number) {
  const s = getComputedStyle(el);
  el.getAnimations().forEach((a) => a.cancel());
  const a = play(
    el,
    [
      { opacity: s.opacity, transform: s.transform, filter: s.filter },
      { opacity: 0, ...frames },
    ],
    {
      duration: ms,
      easing: EASE_IN,
      fill: 'forwards',
    },
  );
  a.onfinish = () => el.remove();
}

export function mountWayPick(router: DemoRouter) {
  /** What each device's pill says: what was picked here, else what the router holds it in. */
  const shown = new Map<string, Pick>();
  /** The pill on the sheet now. */
  let live: PickPill<Pick> | null = null;

  function makePill(id: string): HTMLElement {
    live = pickPill<Pick>({
      cls: 'dm-way',
      label: () => _('Set-up state'),
      options: PICKS.map(([value, label, tone]) => ({ value, label, lead: () => h('span', { class: `dot ${tone}` }) })),
      value: shown.get(id) ?? router.wayOf(id),
      pick: (p) => {
        shown.set(id, p);
        router.holdWay(id, p);
        pollNow();
        // Its width glides with its words (SMOOTH): the title makes room for where it ends.
        setTimeout(place, SMOOTH.duration + 40);
      },
    });
    return live.el;
  }

  function place() {
    const sheet = document.querySelector<HTMLElement>('.sheet-root.open .sheet');
    const id = router.settingUp();
    const setup = !!sheet && !!id && !!sheet.querySelector('.way') && !sheet.classList.contains('asks');
    document.querySelectorAll<HTMLElement>('.dm-way:not(.gone)').forEach((el) => {
      if (setup && el.parentElement === sheet && el.dataset.id === id) return;
      el.classList.add('gone');
      el.parentElement?.querySelectorAll<HTMLElement>('.vhead').forEach((hd) => (hd.style.paddingRight = ''));
      if (live?.el === el) {
        live.close();
        live = null;
      }
      leave(el, { transform: 'scale(.9)', filter: 'blur(3px)' }, 160);
    });
    if (!sheet || !setup || !id) return;
    let pill = sheet.querySelector<HTMLElement>('.dm-way:not(.gone)');
    if (!pill) {
      // A set-up opened anew starts from the default: the demo's own timing, nothing held from the last time.
      shown.delete(id);
      if (router.wayOf(id) !== 'auto') router.holdWay(id, 'auto');
      pill = makePill(id);
      pill.dataset.id = id;
      sheet.append(pill);
    }
    // Left of × and of the view's own buttons, whatever they are; into their place once the sheet hides them
    // (the device arrived), gliding there as they fade.
    const acts = sheet.querySelector<HTMLElement>('.sheet-acts');
    const arrived = sheet.classList.contains('arrived');
    const right = (arrived ? 22 : 58) + (!arrived && acts?.offsetWidth ? acts.offsetWidth + 6 : 0);
    if (pill.style.right !== `${right}px`) pill.style.right = `${right}px`;
    // The title keeps clear of the pill as it does of ×: a long device name ends in an ellipsis before it. Worked
    // out from where the pill goes, not where it is gliding through.
    const sr = sheet.getBoundingClientRect();
    const scale = sr.width / sheet.offsetWidth || 1;
    for (const head of sheet.querySelectorAll<HTMLElement>('.vhead')) {
      const inset = (sr.right - head.getBoundingClientRect().right) / scale;
      const pad = `${Math.max(0, right + pill.offsetWidth + 8 - inset)}px`;
      if (head.style.paddingRight !== pad) head.style.paddingRight = pad;
    }
  }

  // The sheet says when it changes (a view shown, the device arrived, the sheet gone): nothing to watch.
  onSheetChange(place);
}
