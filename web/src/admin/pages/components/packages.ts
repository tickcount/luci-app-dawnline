// Components → system packages: one row per feature in use (the home-like
// link; HTTPS and certificates while the portal is on).

import type { UpdateComponent } from '../../api';
import { button } from '../../ui/button';
import { confirmDialog } from '../../ui/modal';
import { E } from '../../e';
import { fmt } from '../../../shared/i18n';
import type { ComponentsPage, MenuEntry } from './index';

interface SysItem {
  title: string;
  sub: string;
  pkgs: string[];
  feature: 'home' | 'https' | 'acme';
  optional?: boolean;
}

function sysItems(): SysItem[] {
  return [
    { title: _('Home-like link'), sub: _('Policy routing and the veth pair'), pkgs: ['ip-full', 'kmod-veth'], feature: 'home' },
    { title: _('HTTPS for the portal'), sub: _('OpenSSL for uhttpd'), pkgs: ['libustream-openssl', 'openssl-util'], feature: 'https' },
    {
      title: _('Certificates (ACME)'),
      sub: _('Let’s Encrypt certificate for the portal'),
      pkgs: ['acme', 'acme-acmesh-dnsapi'],
      feature: 'acme',
      optional: true,
    },
  ];
}

const ICONS: Record<string, string> = { home: 'network', https: 'lock', acme: 'file' };

export function packageRows(page: ComponentsPage, p: UpdateComponent | undefined): { rows: Node[]; updates: number; total: number } {
  const st = page.st;
  const pkgs = p?.pkgs ?? {};
  const items = sysItems().filter((it) => (it.feature === 'home' ? st.home : st.portal));
  const runPkgs = async (names: string[], what: string, shown = names) => {
    const ok = await confirmDialog(
      fmt(_('Update %s?'), what),
      fmt(_('%s from the OpenWrt feeds. Services that use them restart for a moment.'), shown.join(', ')),
      _('Update'),
    );
    if (ok) void page.op(`pkgs:${names.join(',')}`, fmt(_('Updating %s'), what));
  };
  const menu: (MenuEntry | null)[] = [
    { label: _('Check system packages'), ic: 'refresh', run: () => page.op('check:packages', _('Checking system packages')) },
    {
      label: _('Open the OpenWrt package list'),
      ic: 'globe',
      run: () => window.open('https://openwrt.org/packages/start', '_blank', 'noopener'),
    },
  ];
  let updates = 0;
  const rows = items.map((it) => {
    const present = it.pkgs.filter((x) => pkgs[x]?.installed);
    const upd = [...new Set(present.flatMap((x) => [...(pkgs[x]?.latest ? [x] : []), ...(pkgs[x]?.with ?? [])]))];
    const lacks = st.needs?.[it.feature] ?? it.pkgs.filter((x) => !pkgs[x]?.installed);
    const main = present.find((x) => pkgs[x]?.latest);
    const vers = present.map((x) => `${x} ${pkgs[x]?.installed ?? ''}`).join(', ');
    if (lacks.length)
      return page.row(
        ICONS[it.feature],
        it.title,
        [it.optional ? _('not installed') : fmt(_('missing %s'), lacks.join(', '))],
        [
          button(
            _('Install'),
            () => page.op(`pkgs:${lacks.join(',')}`, fmt(_('Installing %s'), it.title)),
            it.optional ? 'neutral' : 'positive',
            {
              disabled: page.busy,
            },
          ),
          E('span', { class: 'dl-comp-ic' }, page.more(menu)),
        ],
      );
    if (p && upd.length) {
      updates++;
      return page.row(
        ICONS[it.feature],
        it.title,
        main ? [`${pkgs[main]!.installed} → ${pkgs[main]!.latest}`, upd.length > 1 ? ` · +${upd.length - 1}` : ''] : [upd.join(', ')],
        [
          button(
            _('Update'),
            () =>
              runPkgs(
                present.filter((x) => pkgs[x]?.latest || pkgs[x]?.with?.length),
                it.title,
                upd,
              ),
            'neutral',
            { disabled: page.busy },
          ),
          E('span', { class: 'dl-comp-ic' }, page.more(menu)),
        ],
      );
    }
    return page.row(
      ICONS[it.feature],
      it.title,
      [vers || it.sub],
      [page.state('pkgs', p, ''), E('span', { class: 'dl-comp-ic' }, page.more(menu))],
    );
  });
  return { rows, updates, total: items.length };
}
