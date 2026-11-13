// A Settings section's own health (the Health checks that are about it,
// servers/path.ts for a stage, the portal's by their ids): the state in a few
// words after the section's title, and, when a check did not pass, that check
// at the top of the section in the router's words with its fix as a button
// (health.uc's `fix`) or, where there is none, its advice. The fix lives
// here, where the problem is; Overview lists the same check as a link to this
// section, without a second button. A read-only login reads the words.

import type { HealthCheck } from '../../../shared/types';
import { h, type Kid } from '../../../portal/dom';
import { once } from '../../../portal/ui/feedback';
import { plural } from '../../../shared/i18n';
import { glass } from '../../ui/glass';
import { ic } from '../../ui/icons';
import { fixLabel } from '../../servers/fixes';

const worst = (failed: HealthCheck[]): 'bad' | 'warn' => (failed.some((k) => k.status === 'error') ? 'bad' : 'warn');

/**
 * After a section's title: turned off with its server (`off`), what did not pass (one: its problem; several: how
 * many), a state the status alone says (`state`: a tunnel down with every check passed), else how many passed.
 */
export function healthAside(o: {
  failed: HealthCheck[];
  passed: number;
  off?: boolean;
  state?: { tone: 'bad' | 'warn'; text: string } | null;
}): Kid {
  if (o.off) return h('span', { class: 'kt-sx-st off' }, _('the server is off'));
  if (o.failed.length) {
    const one = o.failed.length === 1 ? (o.failed[0].problem ?? o.failed[0].title) : null;
    const bad = o.failed.filter((k) => k.status === 'error').length;
    return h(
      'span',
      { class: `kt-sx-st ${worst(o.failed)}-t` },
      ic('alert'),
      h(
        'span',
        {},
        one ?? (bad ? plural(o.failed.length, '%s problem', '%s problems') : plural(o.failed.length, '%s warning', '%s warnings')),
      ),
    );
  }
  if (o.state) return h('span', { class: `kt-sx-st ${o.state.tone}-t` }, ic('alert'), h('span', {}, o.state.text));
  return o.passed
    ? h('span', { class: 'kt-sx-st ok' }, ic('check'), h('span', {}, plural(o.passed, '%s check passed', '%s checks passed')))
    : null;
}

/** The checks of a section that did not pass, errors first: the router's words, and the fix or the advice in place. */
export function healthBlock(failed: HealthCheck[], o: { write: boolean; fix(fix: string): Promise<void> }): HTMLElement | null {
  if (!failed.length) return null;
  const rows = [...failed]
    .sort((a, b) => Number(b.status === 'error') - Number(a.status === 'error'))
    .map((k) => {
      const bad = k.status === 'error';
      const fix = k.fix;
      const b =
        o.write && fix
          ? (h('button', { type: 'button', class: `btn ${bad ? 'tint' : 'soft'} sm` }, h('span', {}, fixLabel(fix))) as HTMLButtonElement)
          : null;
      b?.addEventListener('click', () => void once(b, () => o.fix(fix!)));
      return h(
        'div',
        { class: `srv-note ${bad ? 'bad' : 'warn'}`, 'data-check': k.id },
        glass('pulse', bad ? 'red' : 'orange'),
        h('span', { class: 'sn-t' }, h('b', {}, k.problem ?? k.title), k.detail ? h('span', {}, k.detail) : null),
        b,
      );
    });
  return h('div', { class: 'st-health', role: 'group', 'aria-label': _('Needs attention') }, ...rows);
}
