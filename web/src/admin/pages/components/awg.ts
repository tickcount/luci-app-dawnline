// Components → AmneziaWG: the installed build, its update, and the builds for
// this firmware with the Russian translation (Build and translation).

import type { AwgSource, UpdateComponent } from '../../api';
import { E } from '../../e';
import { button } from '../../ui/button';
import { confirmDialog } from '../../ui/modal';
import { sw } from '../../ui/controls';
import { pill } from '../../ui/badges';
import { icon } from '../../../shared/icons';
import { fmt, num } from '../../../shared/i18n';
import { whatsNew } from '../../updater/notes';
import type { ComponentsPage, MenuEntry } from './index';

export function awgRows(page: ComponentsPage, w: UpdateComponent | undefined): Node[] {
  const st = page.st;
  const kept = st.kept?.amneziawg;
  const srcs = w?.sources ?? {};
  const ids = Object.keys(srcs) as AwgSource[];
  const cur = w?.current ?? null;
  const curSrc = cur ? srcs[cur] : undefined;
  const ru = !!w?.ru;
  // What the router says is missing right now wins over the last check (which may predate a removal).
  const missing = st.needs?.awg ?? [];
  const installed = missing.length ? null : (w?.installed ?? null);
  const actions: MenuEntry[] = [];
  if (cur && installed)
    actions.push({
      label: _('Reinstall this build'),
      warn: true,
      ic: 'reset',
      run: () => page.op(`amneziawg:${cur}${ru ? ':ru' : ''}`, _('Reinstalling AmneziaWG'), installed),
    });
  if (kept)
    actions.push({
      label: fmt(_('Roll back to %s'), kept.version),
      ic: 'archive',
      warn: true,
      run: async () => {
        if (
          await confirmDialog(
            fmt(_('Roll back AmneziaWG to %s?'), kept.version),
            _('The build kept on the router is installed again. Every AmneziaWG tunnel restarts for a few seconds.'),
            _('Roll back'),
          )
        )
          void page.op('amneziawg:rollback', _('Rolling back AmneziaWG'), installed ?? undefined);
      },
    });
  const menu: (MenuEntry | null)[] = [
    w?.release
      ? {
          label: _('What’s new'),
          ic: 'file',
          run: () => whatsNew('amneziawg', w.release!, fmt(_('What’s new in the %s build'), curSrc?.label ?? 'AmneziaWG'), cur ?? 'slava'),
        }
      : null,
    {
      label: _('Open on GitHub'),
      ic: 'globe',
      run: () => window.open(`https://github.com/${curSrc?.repo ?? 'Slava-Shchipunov/awg-openwrt'}`, '_blank', 'noopener'),
    },
    ...(actions.length ? [null, ...actions] : []),
  ].filter((x, k, a) => x !== null || (k > 0 && a[k - 1] !== null));
  const tun = st.tunnels ?? [];
  const restarts = !tun.length
    ? _('Switching takes a few seconds. Devices keep their configurations.')
    : tun.length === 1
      ? fmt(_('Switching restarts the tunnel for a few seconds: %s. Devices keep their configurations.'), tun[0])
      : fmt(
          N_(
            tun.length,
            'Switching restarts %s tunnel for a few seconds: %s. Devices keep their configurations.',
            'Switching restarts %s tunnels for a few seconds: %s. Devices keep their configurations.',
          ),
          num(tun.length),
          tun.join(', '),
        );
  // The notice under the builds: "Switching restarts Home and Family for a few seconds."
  const names = tun.length > 1 ? fmt(_('%s and %s'), tun.slice(0, -1).join(', '), tun[tun.length - 1]) : tun[0];
  const notice = tun.length ? fmt(_('Switching restarts %s for a few seconds.'), names) : _('Switching takes a few seconds.');
  const switchTo = async (id: AwgSource) => {
    const x = srcs[id]!;
    const ok = await confirmDialog(
      installed ? fmt(_('Switch to AmneziaWG %s?'), x.gen) : fmt(_('Install AmneziaWG %s?'), x.gen),
      [fmt(_('The %s build, %s.'), x.label, x.version), restarts, x.gen === '3.1' ? _('Devices need AmneziaVPN 3.1 or newer.') : '']
        .filter(Boolean)
        .join(' '),
      installed ? _('Switch') : _('Install'),
    );
    if (ok)
      void page.op(
        `amneziawg:${id}${ru ? ':ru' : ''}`,
        installed ? fmt(_('Switching to AmneziaWG %s'), x.gen) : _('Installing AmneziaWG'),
        installed ?? undefined,
      );
  };
  const build = (id: AwgSource) => {
    const x = srcs[id]!;
    const on = cur === id && !!installed;
    return E('div', { class: 'dl-row' }, [
      E('span', { class: 'dl-row-main dl-stack' }, [
        E('b', {}, x.gen ? `AmneziaWG ${x.gen}` : 'AmneziaWG'),
        E('span', { class: 'dl-sub' }, `${x.label} · ${x.gen === '3.1' ? 'AmneziaVPN 3.1+' : _('every app')}`),
      ]),
      E('span', { class: 'dl-mono dl-faint dl-comp-bver' }, x.version ?? _('none yet')),
      E(
        'span',
        { class: 'dl-comp-bact' },
        on
          ? pill('ok', _('Active', 'build'))
          : x.version
            ? button(installed ? _('Switch') : _('Install'), () => switchTo(id), installed ? 'neutral' : 'positive', {
                disabled: page.busy,
              })
            : pill('', _('No build')),
      ),
    ]);
  };
  const newer = ids
    .map((id) =>
      srcs[id]?.newer
        ? fmt(_('%s moves to %s with OpenWrt %s.'), srcs[id]!.label, srcs[id]!.newer!.gen, srcs[id]!.newer!.tag.replace(/^v/, ''))
        : '',
    )
    .filter(Boolean);
  const ruSw = sw(ru, _('Russian translation'), (v) => {
    if (!cur) return;
    void page.op(
      `amneziawg:${cur}${v ? ':ru' : ''}`,
      v ? _('Adding the Russian translation') : _('Removing the Russian translation'),
      installed ?? undefined,
    );
  });
  ruSw.disabled = !cur || !installed || page.busy;
  const open = page.awgOpen ?? !installed;
  const fold = E('details', { class: 'dl-params dl-comp-fold', open: open ? 'open' : null }, [
    E('summary', {}, [icon('chevron'), E('span', {}, _('Build and translation'))]),
    E('div', { class: 'dl-params-body' }, [
      // The builds and the translation in one list.
      E('div', { class: 'dl-list' }, [
        ...(ids.length
          ? ids.map(build)
          : [E('div', { class: 'dl-row' }, E('span', { class: 'dl-sub' }, _('Check for updates to see the builds for this router.')))]),
        E('div', { class: 'dl-row' }, [
          E('span', { class: 'dl-row-main dl-stack' }, [
            E('b', {}, _('Russian translation')),
            E('span', { class: 'dl-sub' }, _('LuCI pages for AmneziaWG')),
          ]),
          E('span', { class: 'dl-comp-bact' }, ruSw),
        ]),
      ]),
      // One notice: what switching does, and what the builds will bring.
      (installed && ids.length) || newer.length
        ? E('div', { class: `dl-comp-status ${installed && ids.length ? 'warn' : 'acc'}` }, [
            icon(installed && ids.length ? 'alert' : 'download'),
            E('span', {}, [installed && ids.length ? E('b', {}, notice) : '', ...newer.map((t) => ` ${t}`)]),
          ])
        : '',
    ]),
  ]);
  fold.addEventListener('toggle', () => (page.awgOpen = (fold as HTMLDetailsElement).open));
  const right: Node[] = [];
  if (w?.update && installed && cur)
    right.push(
      button(
        fmt(_('Update to %s'), w.latest),
        () => page.op(`amneziawg:${cur}${ru ? ':ru' : ''}`, _('Updating AmneziaWG'), installed),
        'neutral',
        {
          disabled: page.busy,
        },
      ),
    );
  else right.push((w || missing.length) && !installed ? pill('warn', _('Not installed')) : page.state('amneziawg', w, w?.latest ?? ''));
  right.push(page.round(() => page.op('check:amneziawg', _('Checking AmneziaWG'), installed ?? undefined), menu));
  return [
    page.row(
      'shield',
      'AmneziaWG',
      [
        installed
          ? `${installed}${w?.release ? ` · ${fmt(_('%s build'), w.release)}` : ''}`
          : missing.length
            ? fmt(_('missing %s'), missing.join(', '))
            : w
              ? _('not installed')
              : _('version not checked'),
      ],
      right,
    ),
    E('div', { class: 'dl-comp-foldwrap' }, fold),
  ];
}
