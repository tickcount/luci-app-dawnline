// Components → AmneziaWG: the installed build, its update, and the builds for
// this firmware with the Russian translation (Build and translation).

import type { AwgSource, UpdateComponent } from '../../api';
import { E } from '../../e';
import { button } from '../../ui/button';
import { confirmDialog } from '../../ui/modal';
import { sw } from '../../ui/controls';
import { pill } from '../../ui/badges';
import { icon } from '../../../shared/icons';
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
      label: 'Reinstall this build',
      warn: true,
      ic: 'reset',
      run: () => page.op(`amneziawg:${cur}${ru ? ':ru' : ''}`, 'Reinstalling AmneziaWG', installed),
    });
  if (kept)
    actions.push({
      label: `Roll back to ${kept.version}`,
      ic: 'archive',
      warn: true,
      run: async () => {
        if (
          await confirmDialog(
            `Roll back AmneziaWG to ${kept.version}?`,
            'The build kept on the router is installed again. Every AmneziaWG tunnel restarts for a few seconds.',
            'Roll back',
          )
        )
          void page.op('amneziawg:rollback', 'Rolling back AmneziaWG', installed ?? undefined);
      },
    });
  const menu: (MenuEntry | null)[] = [
    w?.release
      ? {
          label: 'What’s new',
          ic: 'file',
          run: () => whatsNew('amneziawg', w.release!, `What’s new in the ${curSrc?.label ?? 'AmneziaWG'} build`, cur ?? 'slava'),
        }
      : null,
    {
      label: 'Open on GitHub',
      ic: 'globe',
      run: () => window.open(`https://github.com/${curSrc?.repo ?? 'Slava-Shchipunov/awg-openwrt'}`, '_blank', 'noopener'),
    },
    ...(actions.length ? [null, ...actions] : []),
  ].filter((x, k, a) => x !== null || (k > 0 && a[k - 1] !== null));
  const tun = st.tunnels ?? [];
  const restarts = tun.length
    ? `Switching restarts ${tun.length === 1 ? 'the tunnel' : `${tun.length} tunnels`} for a few seconds: ${tun.join(', ')}. Devices keep their configurations.`
    : 'Switching takes a few seconds. Devices keep their configurations.';
  // The notice under the builds: "Switching restarts Home and Family for a few seconds."
  const names = tun.length > 1 ? `${tun.slice(0, -1).join(', ')} and ${tun[tun.length - 1]}` : tun[0];
  const notice = tun.length ? `Switching restarts ${names} for a few seconds.` : 'Switching takes a few seconds.';
  const switchTo = async (id: AwgSource) => {
    const x = srcs[id]!;
    const ok = await confirmDialog(
      installed ? `Switch to AmneziaWG ${x.gen}?` : `Install AmneziaWG ${x.gen}?`,
      `The ${x.label} build, ${x.version}. ${restarts}${x.gen === '3.1' ? ' Devices need AmneziaVPN 3.1 or newer.' : ''}`,
      installed ? 'Switch' : 'Install',
    );
    if (ok)
      void page.op(
        `amneziawg:${id}${ru ? ':ru' : ''}`,
        installed ? `Switching to AmneziaWG ${x.gen}` : 'Installing AmneziaWG',
        installed ?? undefined,
      );
  };
  const build = (id: AwgSource) => {
    const x = srcs[id]!;
    const on = cur === id && !!installed;
    return E('div', { class: 'dl-row' }, [
      E('span', { class: 'dl-row-main dl-stack' }, [
        E('b', {}, x.gen ? `AmneziaWG ${x.gen}` : 'AmneziaWG'),
        E('span', { class: 'dl-sub' }, `${x.label} · ${x.gen === '3.1' ? 'AmneziaVPN 3.1+' : 'every app'}`),
      ]),
      E('span', { class: 'dl-mono dl-faint dl-comp-bver' }, x.version ?? 'none yet'),
      E(
        'span',
        { class: 'dl-comp-bact' },
        on
          ? pill('ok', 'Active')
          : x.version
            ? button(installed ? 'Switch' : 'Install', () => switchTo(id), installed ? 'neutral' : 'positive', { disabled: page.busy })
            : pill('', 'No build'),
      ),
    ]);
  };
  const newer = ids
    .map((id) =>
      srcs[id]?.newer ? `${srcs[id]!.label} moves to ${srcs[id]!.newer!.gen} with OpenWrt ${srcs[id]!.newer!.tag.replace(/^v/, '')}.` : '',
    )
    .filter(Boolean);
  const ruSw = sw(ru, 'Russian translation', (v) => {
    if (!cur) return;
    void page.op(
      `amneziawg:${cur}${v ? ':ru' : ''}`,
      v ? 'Adding the Russian translation' : 'Removing the Russian translation',
      installed ?? undefined,
    );
  });
  ruSw.disabled = !cur || !installed || page.busy;
  const open = page.awgOpen ?? !installed;
  const fold = E('details', { class: 'dl-params dl-comp-fold', open: open ? 'open' : null }, [
    E('summary', {}, [icon('chevron'), E('span', {}, 'Build and translation')]),
    E('div', { class: 'dl-params-body' }, [
      // The builds and the translation in one list.
      E('div', { class: 'dl-list' }, [
        ...(ids.length
          ? ids.map(build)
          : [E('div', { class: 'dl-row' }, E('span', { class: 'dl-sub' }, 'Check for updates to see the builds for this router.'))]),
        E('div', { class: 'dl-row' }, [
          E('span', { class: 'dl-row-main dl-stack' }, [
            E('b', {}, 'Russian translation'),
            E('span', { class: 'dl-sub' }, 'LuCI pages for AmneziaWG'),
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
      button(`Update to ${w.latest}`, () => page.op(`amneziawg:${cur}${ru ? ':ru' : ''}`, 'Updating AmneziaWG', installed), 'neutral', {
        disabled: page.busy,
      }),
    );
  else right.push((w || missing.length) && !installed ? pill('warn', 'Not installed') : page.state('amneziawg', w, w?.latest ?? ''));
  right.push(page.round(() => page.op('check:amneziawg', 'Checking AmneziaWG', installed ?? undefined), menu));
  return [
    page.row(
      'shield',
      'AmneziaWG',
      [
        installed
          ? `${installed}${w?.release ? ` · ${w.release} build` : ''}`
          : missing.length
            ? `missing ${missing.join(', ')}`
            : w
              ? 'not installed'
              : 'version not checked',
      ],
      right,
    ),
    E('div', { class: 'dl-comp-foldwrap' }, fold),
  ];
}
