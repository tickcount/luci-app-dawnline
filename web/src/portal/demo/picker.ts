// The demo's scenario picker: a drawer with the scenarios in groups (glass
// icon, name, what the page shows) and "Start over". Picking one swaps the page
// in place. Built only from the portal's own parts (sheet, glass icons, toast,
// motion); the "Demo" buttons that open it, and where they sit, are crumbs.ts.

import { h, ic } from '../dom';
import { call } from '../api';
import { repaint, setState, type State } from '../state';
import { closeSheet, head, onSheetEntry, openSheet, sub, type View } from '../ui/sheet';
import { glass, type Tone } from '../ui/glass';
import { toast } from '../ui/feedback';
import { EASE_OUT, play } from '../motion';
import { groups, type Scenario, type ScenarioId } from './data';
import type { DemoRouter } from './router';

/** Each scenario's glass icon and tone (the glass set is smaller than the line icons). */
const LOOK: Record<ScenarioId, [string, Tone]> = {
  normal: ['check', 'green'],
  first: ['plus', 'blue'],
  stale: ['refresh', 'orange'],
  quota: ['chart', 'red'],
  hours: ['clock', 'orange'],
  paused: ['pause', 'orange'],
  expired: ['calendar', 'red'],
  http: ['lock', 'orange'],
  plain: ['shield', 'grey'],
  full: ['phone', 'grey'],
};

/** What opens the scenarios' drawer. */
export function scenarioPicker(router: DemoRouter): () => void {
  const app = document.getElementById('app')!;

  /** Swap the page in place: it dims away and comes back drawn from the scenario, the link saying which. */
  async function pick(s: ScenarioId, done?: string) {
    // The link goes on the page's own history entry, once the sheet's is stepped back off: a reload keeps the scenario.
    const mark = () => {
      const u = new URL(location.href);
      u.searchParams.set('s', s);
      history.replaceState(history.state, '', u);
    };
    if (onSheetEntry()) addEventListener('popstate', mark, { once: true });
    else mark();
    closeSheet();
    router.use(s);
    // The page, not #app: a filter or a transform on #app would carry its fixed edge fades along until it ends.
    const page = app.querySelector<HTMLElement>('.page') ?? app;
    const out = play(page, [{ opacity: 1 }, { opacity: 0, filter: 'blur(4px)' }], { duration: 160, easing: EASE_OUT, fill: 'forwards' });
    const st = await call<State>('state');
    await out.finished;
    setState(st);
    repaint();
    out.cancel();
    play(
      page,
      [
        { opacity: 0, filter: 'blur(4px)', transform: 'translateY(6px)' },
        { opacity: 1, filter: 'none', transform: 'none' },
      ],
      {
        duration: 420,
        easing: EASE_OUT,
      },
    );
    if (done) toast(done);
  }

  function row(s: Scenario): HTMLElement {
    const on = s.id === router.scenario();
    const [icon, tone] = LOOK[s.id];
    return h(
      'button',
      { type: 'button', class: `dm-row${on ? ' on' : ''}`, 'aria-pressed': String(on), onclick: () => pick(s.id) },
      glass(icon, tone),
      h('span', { class: 't' }, h('b', {}, s.label), h('span', {}, s.about)),
      on ? ic('check', 'i dm-tick') : null,
    );
  }

  function scenarios(): View {
    const el = h(
      'div',
      { class: 'view' },
      head(_('Try a scenario')),
      sub(_('How the page looks in each case. Nothing here connects.')),
      ...groups().map((g) =>
        h('div', { class: 'dm-group' }, h('div', { class: 'lbl-s' }, g.title), h('div', { class: 'dm-list' }, ...g.items.map(row))),
      ),
      h(
        'div',
        { class: 'dm-foot' },
        h(
          'button',
          { type: 'button', class: 'btn soft', onclick: () => pick(router.scenario(), _('The demo started over')) },
          ic('reset'),
          h('span', {}, _('Start over')),
        ),
      ),
    );
    return { el, label: _('Try a scenario') };
  }

  return () => openSheet(scenarios);
}
