// Clearing the log: a question in the portal's sheet (its icon, what happens,
// Cancel and Clear), with what to clear (a kind, the one the log shows by
// default) and how old. The activity log and the service log ("System") are
// cleared on the router each on its own; what each did is said in a toast.
// One device's or one person's log clears only theirs.

import type { LogCategory, LogFilter } from '../../api';
import { api } from '../../api';
import { h } from '../../../portal/dom';
import { closeSheet, openSheet, type View } from '../../../portal/ui/sheet';
import { once } from '../../../portal/ui/feedback';
import { glass } from '../../ui/glass';
import { tabs } from '../../ui/tabs';
import { errorText, notify } from '../../ui/toast';
import { fmt, plural } from '../../../shared/i18n';
import type { LogKind } from '../../events/find';
import { KIND_ICON, kindLabel } from './filters';

type What = 'all' | LogCategory | 'system';
/** The ages offered, in days ('' = everything). */
const AGES = ['', '7', '30', '90'] as const;
type Age = (typeof AGES)[number];

/** Short, for the track under "Which events": everything, or "7+ days" old. */
const ageLabel = (v: Age) => (v ? plural(Number(v), '%s+ day', '%s+ days') : _('All'));
const removed = (n: number) => (n ? plural(n, '%s event removed', '%s events removed') : _('Nothing matched'));

/**
 * Ask and clear. `base`: one person's or device's log (then the service log
 * stays: it is no one's); `kind`: what the log shows now, picked first.
 */
export function clearLog(base: LogFilter, kind: LogKind, done: () => unknown) {
  const whole = !base.person && !base.device;
  const kinds: What[] = whole ? ['all', 'connections', 'people', 'problems', 'system'] : ['all', 'connections', 'people', 'problems'];
  let what: What = kinds.includes(kind) ? kind : 'all';
  let age: Age = '';
  const view = (): View => {
    // The kinds as in the log's bar: icons, the picked one with its word (a sheet is narrow).
    const whatTrack = tabs(
      kinds.map((k) => ({ id: k, label: kindLabel(k), icon: KIND_ICON[k] })),
      what,
      (k) => (what = k),
      { cls: 'icons', label: _('Category') },
    );
    const ageTrack = tabs(
      AGES.map((a) => ({ id: a || 'all', label: ageLabel(a) })),
      age || 'all',
      (a) => (age = a === 'all' ? '' : (a as Age)),
      { label: _('Which events') },
    );
    const ok = h(
      'button',
      { type: 'button', class: 'btn red', onclick: (ev: Event) => once(ev.currentTarget as HTMLButtonElement, () => run(what, age)) },
      h('span', {}, _('Clear')),
    ) as HTMLButtonElement;
    const el = h(
      'div',
      { class: 'view' },
      h(
        'div',
        { class: 'ask clear-log' },
        glass('trash', 'red', 'gi xl'),
        h('h3', {}, _('Clear the log')),
        h('p', {}, `${_('Removes events from the log on the router.')} ${_('This cannot be undone; export first if you want a copy.')}`),
        h(
          'div',
          { class: 'ask-picks' },
          h('span', { class: 'ask-pick-l' }, _('Category')),
          whatTrack.el,
          h('span', { class: 'ask-pick-l' }, _('Which events')),
          ageTrack.el,
        ),
        h('div', { class: 'btnrow' }, h('button', { type: 'button', class: 'btn soft', onclick: () => closeSheet() }, _('Cancel')), ok),
      ),
    );
    return { el, label: _('Clear the log'), asks: true };
  };

  // The activity log first, then the service log ("System"; "All" clears it too on the whole log).
  async function run(w: What, a: Age) {
    let n = 0;
    if (w !== 'system') {
      try {
        n += (await api.logsClear({ ...base, category: w === 'all' ? '' : w, older_days: a })).removed;
      } catch (e) {
        notify(errorText(e), 'error', 10000);
        return;
      }
    }
    if (whole && (w === 'system' || w === 'all')) {
      try {
        n += (await api.serviceLogClear(a)).removed;
      } catch (e) {
        closeSheet();
        // The router's reason last, as it came.
        const failed = fmt(_('The service log was not cleared: %s'), errorText(e));
        notify(w === 'system' ? failed : `${fmt(_('Activity: %s.'), removed(n).toLowerCase())} ${failed}`, 'error', 10000);
        done();
        return;
      }
    }
    closeSheet();
    notify(removed(n), 'success', 3000);
    done();
  }

  openSheet(view);
}
