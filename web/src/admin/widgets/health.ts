// Health checks outside the checklist: the button that fixes a check (shared
// with Diagnostics → Health) and notices for the checks that failed, as the
// server Overview shows them.

import type { HealthCheck } from '../../shared/types';
import { E } from '../e';
import { api, type Health, type Needs } from '../api';
import { installFeature } from '../pkgs';
import { button, type ButtonKind } from '../ui/button';
import { confirmDialog } from '../ui/modal';
import { attempt } from '../ui/toast';
import { needRow } from '../ui/layout';

const FIX_LABEL: Record<string, string> = {
  apply: 'Repair',
  sync: 'Reload devices',
  restart: 'Restart service',
  netrestart: 'Restart network',
  updates: 'Open Components',
};

/** Run a backend fix (a network restart asks first); the checks again, or null. */
export async function runFix(fix: string): Promise<Health | null> {
  if (
    fix === 'netrestart' &&
    !(await confirmDialog('Restart the network?', 'Every interface restarts. Connections drop for a few seconds.', 'Restart network'))
  )
    return null;
  return (await attempt(() => api.healthFix(fix), 'Done')) ?? null;
}

/**
 * The button for a check's fix, or '' when it has none. `run` performs a
 * backend fix; `refresh` runs the checks again after an install.
 */
export function fixAction(c: HealthCheck, run: (fix: string) => void, refresh: () => void, kind: ButtonKind = 'action'): Node | string {
  const fix = c.fix;
  if (!fix) return '';
  // install:awg installs AmneziaWG itself (the build for this firmware), the rest come from the feeds.
  if (fix.startsWith('install:')) return button('Install', () => installFeature(fix.slice(8) as keyof Needs, refresh), kind);
  if (fix === 'updates')
    return E('a', { class: `cbi-button cbi-button-${kind}`, href: L.url('admin/network/dawnline/updates') }, FIX_LABEL.updates);
  return button(FIX_LABEL[fix] ?? 'Fix', () => run(fix), kind);
}

/** The icon tile of a check's notice, by what it is about. */
function checkIcon(id: string): string {
  if (/^(awg|up_|peers_|fw_|reply_|port_|subnet_)/.test(id)) return 'shield';
  if (/^(portal|cert)/.test(id)) return 'link';
  if (/^(ep_|home_|resolver)/.test(id)) return 'globe';
  if (id === 'clock') return 'clock';
  if (id === 'agent') return 'activity';
  if (id === 'nft') return 'lock';
  if (id === 'data') return 'users';
  return 'alert';
}

/**
 * The failed checks as notices (errors first, at most `max`), with their fix
 * and a link to Diagnostics for the rest; '' when everything passed.
 */
export function healthNotices(checks: HealthCheck[], run: (fix: string) => void, refresh: () => void, max = 3): Node | string {
  const bad = checks
    .filter((c) => c.status === 'error' || c.status === 'warn')
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'error' ? -1 : 1));
  if (!bad.length) return '';
  const rest = bad.length - max;
  return E('div', { class: 'dl-list dl-notices' }, [
    ...bad
      .slice(0, max)
      .map((c) =>
        needRow(
          checkIcon(c.id),
          c.status === 'error' ? 'bad' : 'warn',
          c.problem ?? c.title,
          c.detail,
          fixAction(c, run, refresh, c.status === 'error' ? 'positive' : 'neutral'),
        ),
      ),
    rest > 0
      ? E('a', { class: 'dl-row dl-notices-more', href: L.url('admin/network/dawnline/diagnostics') }, [
          `${rest} more in Diagnostics`,
          E('span', { class: 'dl-spacer' }),
          '→',
        ])
      : '',
  ]);
}
