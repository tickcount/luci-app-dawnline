// Whether a server runs, in words and a tone: the Server page's head and
// Overview's rows say it the same way. Pure: no DOM.

import type { Server } from '../../shared/types';
import { duration } from '../../shared/format';
import { fmt } from '../../shared/i18n';

/** Turned off (warn), running and for how long (ok), or not running and why not (bad). */
export function serverState(s: Pick<Server, 'enabled' | 'up' | 'uptime' | 'blocked'>): { text: string; tone: 'ok' | 'warn' | 'bad' } {
  if (!s.enabled) return { text: _('Turned off'), tone: 'warn' };
  if (s.up) return { text: s.uptime ? fmt(_('Running for %s'), duration(s.uptime)) : _('Running'), tone: 'ok' };
  return { text: s.blocked ? _('Can’t start') : _('Not running'), tone: 'bad' };
}
