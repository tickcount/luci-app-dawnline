// AmneziaWG's build in the portal's sheet (a choice with consequences): the
// builds made for this firmware as options (their generation, who makes them,
// the version and which apps can connect), the one installed marked and not
// pressable, a build that has none for this firmware said so. A pick asks
// first (every AmneziaWG tunnel restarts for a few seconds; 3.1 needs
// AmneziaVPN 3.1 on the devices), then the updater installs it in the same
// sheet (flows/operation.ts). Under them: what a build will bring with a
// newer OpenWrt.

import type { AwgSource, UpdateComponent, UpdatesStatus } from '../api';
import { h } from '../../portal/dom';
import { go, head, openSheet, sub, type View } from '../../portal/ui/sheet';
import { fmt, num } from '../../shared/i18n';
import { glass } from '../ui/glass';
import { ic } from '../ui/icons';
import { operationView, type Operation } from './operation';

/** "Restarts Home and Family for a few seconds": the tunnels a new kernel module restarts. */
export function restartsText(tunnels: string[]): string {
  if (!tunnels.length) return _('Switching takes a few seconds. Devices keep their configurations.');
  if (tunnels.length === 1)
    return fmt(_('Switching restarts the tunnel for a few seconds: %s. Devices keep their configurations.'), tunnels[0]);
  return fmt(
    N_(
      tunnels.length,
      'Switching restarts %s tunnel for a few seconds: %s. Devices keep their configurations.',
      'Switching restarts %s tunnels for a few seconds: %s. Devices keep their configurations.',
    ),
    num(tunnels.length),
    tunnels.join(', '),
  );
}

/** What switching to (or installing) `id` asks and runs; `done` reads the page again. */
function switchBuild(st: UpdatesStatus, w: UpdateComponent, id: AwgSource, installed: string | null, done: () => void): Operation {
  const x = w.sources![id]!;
  return {
    what: `amneziawg:${id}${w.ru ? ':ru' : ''}`,
    title: installed ? fmt(_('Switching to AmneziaWG %s'), x.gen ?? '') : _('Installing AmneziaWG'),
    ask: {
      icon: 'amneziawg',
      tone: 'orange',
      title: installed ? fmt(_('Switch to AmneziaWG %s?'), x.gen ?? '') : fmt(_('Install AmneziaWG %s?'), x.gen ?? ''),
      text: [
        [
          fmt(_('The %s build, %s.'), x.label, x.version ?? ''),
          restartsText(st.tunnels ?? []),
          x.gen === '3.1' ? _('Devices need AmneziaVPN 3.1 or newer.') : '',
        ]
          .filter(Boolean)
          .join(' '),
      ],
      action: installed ? _('Switch') : _('Install'),
      cls: 'warn',
    },
    done,
  };
}

function view(st: UpdatesStatus, w: UpdateComponent, installed: string | null, done: () => void): View {
  const srcs = w.sources ?? {};
  const ids = Object.keys(srcs) as AwgSource[];
  const opt = (id: AwgSource) => {
    const x = srcs[id]!;
    const on = w.current === id && !!installed;
    const can = !on && !!x.version;
    const b = h(
      'button',
      { type: 'button', class: `opt${on ? ' on' : ''}`, role: 'listitem', disabled: !can },
      glass('amneziawg', on ? 'blue' : 'grey'),
      h(
        'span',
        { class: 'opt-t' },
        h('b', {}, x.gen ? `AmneziaWG ${x.gen}` : 'AmneziaWG', on ? h('span', { class: 'now' }, ` ${_('now')}`) : null),
        h('span', {}, `${x.label} · ${x.gen === '3.1' ? 'AmneziaVPN 3.1+' : _('every app')}`),
        h('span', { class: 'mono' }, x.version ?? _('none yet')),
      ),
      ic(on ? 'check' : 'chevron', `i opt-chev${on ? ' on' : ''}`),
    );
    if (can) b.addEventListener('click', () => go(() => operationView(switchBuild(st, w, id, installed, done))));
    return b;
  };
  const newer = ids
    .map((id) => {
      const n = srcs[id]?.newer;
      return n ? fmt(_('%s moves to %s with OpenWrt %s.'), srcs[id]!.label, n.gen, n.tag.replace(/^v/, '')) : '';
    })
    .filter(Boolean);
  const el = h(
    'div',
    { class: 'view' },
    head(_('AmneziaWG build')),
    sub(_('The kernel module and its tools, made for this firmware.')),
    ids.length
      ? h('div', { class: 'opts', role: 'list' }, ...ids.map(opt))
      : h('p', { class: 'hint' }, _('Check for updates to see the builds for this router.')),
    newer.length ? h('p', { class: 'hint' }, newer.join(' ')) : null,
  );
  return { el, label: _('AmneziaWG build') };
}

/** The builds; a pick asks and installs in the same sheet, `done` after. */
export const awgBuildSheet = (st: UpdatesStatus, w: UpdateComponent, installed: string | null, done: () => void) =>
  openSheet(() => view(st, w, installed, done));
