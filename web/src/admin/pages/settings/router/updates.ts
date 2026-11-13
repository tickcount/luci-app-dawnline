// Settings › Updates: what is installed and what is new. The block as it
// was on the System page, standing open as a section: the notice of a new
// version of Dawnline over it (notice.ts; the page owns it and hands its slot in), the
// components as rows of one list (updates-rows.ts), when it was checked and
// Check now; under it, panels of their own: how it updates on its own and the
// latest updates (updates-policy.ts). A Health check that is fixed here (AmneziaWG's module
// does not load) is said at the block's top.

import { h } from '../../../../portal/dom';
import { ago, duration } from '../../../../shared/format';
import { fmt, plural } from '../../../../shared/i18n';
import { ic } from '../../../ui/icons';
import { card, section } from '../../../ui/section';
import { nextCheck } from '../../../updater/policy';
import { updatesHealth, updatesTone } from '../../../system/model';
import { healthAside, healthBlock } from '../health';
import type { RouterCtx } from './ctx';
import { componentRows, startable } from './updates-rows';
import { latestUpdates, policyPanel } from './updates-policy';

/** "Checked 3 h ago · next in 21 h" and Check now. */
function checkLine(y: RouterCtx): HTMLElement {
  const u = y.upd;
  const next = nextCheck(u.policy, u.auto?.check);
  const said = u.check
    ? [fmt(_('Checked %s'), ago(u.check.time, u.now)), next > u.now ? fmt(_('next in %s'), duration(next - u.now)) : '']
        .filter(Boolean)
        .join(' · ')
    : _('Not checked yet.');
  return h(
    'div',
    { class: 'row-act' },
    h('p', { class: 'desc' }, said),
    startable(y)
      ? h(
          'button',
          {
            type: 'button',
            class: 'btn soft sm',
            onclick: () => y.op({ what: 'check', title: _('Checking all components') }),
          },
          ic('refresh'),
          h('span', {}, _('Check now')),
        )
      : null,
  );
}

/**
 * After the title, while every check fixed here passes: a job under way, AmneziaWG missing, an update; nothing when
 * all is on its latest version (the rows' marks say so, the owner: «из заголовка убрать dawnline n · latest»).
 */
function aside(y: RouterCtx): HTMLElement | null {
  const u = y.upd;
  const all = u.check?.components ?? {};
  const st = (text: string, tone = '') => h('span', { class: 'kt-sx-st val' }, h('span', { class: tone || null }, text));
  if (u.job?.state === 'running') return st(u.job.action === 'check' ? _('Checking…') : _('Updating…'));
  if ((u.needs?.awg ?? []).length) return st(_('AmneziaWG not installed'), 'warn-t');
  const found = [
    all.app?.update && all.app.latest ? `Dawnline ${all.app.latest}` : '',
    all.amneziawg?.update && all.amneziawg.installed ? `AmneziaWG ${all.amneziawg.latest}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  if (found) return st(fmt(_('Available: %s'), found), 'st-upd-new');
  const n = all.packages?.updates ?? 0;
  if (n) return st(plural(n, '%s package update', '%s package updates'));
  return null;
}

/** `notice`: the slot of the notice of a new version of Dawnline (UpdateNotice.el), kept by the page across repaints. */
export function updatesSection(y: RouterCtx, notice: HTMLElement): HTMLElement {
  const failed = updatesHealth(y.checks ?? []);
  const block = card(healthBlock(failed, { write: y.write, fix: (f) => y.fix(f) }), componentRows(y), checkLine(y));
  block.classList.add('st-upd');
  return section(
    {
      id: 'updates',
      icon: 'update',
      title: _('Updates'),
      tone: updatesTone(y.upd, failed),
      aside: failed.length && y.upd.job?.state !== 'running' ? healthAside({ failed, passed: 0 }) : aside(y),
    },
    notice,
    block,
    // how it updates on its own, and what it did lately: panels of their own
    policyPanel(y),
    latestUpdates(y),
  );
}
