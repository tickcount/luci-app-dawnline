// The OpenWrt packages Dawnline adds, by the feature that needs them (the
// home-like link; HTTPS and certificates while the portal is on), and a
// close-up of them in the portal's sheet: each feature with its packages, the
// version installed and the one the feeds offer.

import type { Needs, UpdateComponent } from '../api';
import { h } from '../../portal/dom';
import { head, openSheet, sub, type View } from '../../portal/ui/sheet';
import { glass } from '../ui/glass';

export interface SysItem {
  /** Its glass: what the feature is (a home, a lock, a certificate). */
  icon: string;
  title: string;
  sub: string;
  pkgs: string[];
  feature: Exclude<keyof Needs, 'awg'>;
  optional?: boolean;
}

export function sysItems(): SysItem[] {
  return [
    {
      icon: 'home',
      title: _('Home-like link'),
      sub: _('Policy routing and the veth pair'),
      pkgs: ['ip-full', 'kmod-veth'],
      feature: 'home',
    },
    {
      icon: 'lock',
      title: _('HTTPS for the portal'),
      sub: _('OpenSSL for uhttpd'),
      pkgs: ['libustream-openssl', 'openssl-util'],
      feature: 'https',
    },
    {
      icon: 'cert',
      title: _('Certificates (ACME)'),
      sub: _('Let’s Encrypt certificate for the portal'),
      pkgs: ['acme', 'acme-acmesh-dnsapi'],
      feature: 'acme',
      optional: true,
    },
  ];
}

function view(items: SysItem[], pkgs: NonNullable<UpdateComponent['pkgs']>): View {
  const el = h(
    'div',
    { class: 'view' },
    head(_('Packages and versions')),
    sub(_('From the OpenWrt feeds, for what Dawnline uses on this router.')),
    h(
      'div',
      { class: 'pks' },
      ...items.map((it) =>
        h(
          'div',
          { class: 'pks-f' },
          h('div', { class: 'chk' }, glass(it.icon, 'grey'), h('span', { class: 'chk-t' }, h('b', {}, it.title), h('span', {}, it.sub))),
          h(
            'ul',
            { class: 'pks-l' },
            ...it.pkgs.map((name) => {
              const x = pkgs[name];
              return h(
                'li',
                {},
                h('span', { class: 'mono' }, name),
                !x?.installed
                  ? h('span', { class: 'pks-v' }, _('not installed'))
                  : h('span', { class: `pks-v mono${x.latest ? ' new' : ''}` }, x.latest ? `${x.installed} → ${x.latest}` : x.installed),
              );
            }),
          ),
        ),
      ),
    ),
  );
  return { el, label: _('Packages and versions') };
}

export const packagesSheet = (items: SysItem[], pkgs: NonNullable<UpdateComponent['pkgs']>) => openSheet(() => view(items, pkgs));
