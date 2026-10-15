// Disguise methods: one picker for the Server page and the setup wizard.

import type { AwgCaps } from '../shared/types';
import { E } from './e';
import { icon } from '../shared/icons';

export type Method = 'standard' | 'strong' | 'max' | 'off';

export interface MethodInfo {
  id: Method;
  title: string;
  ic: string;
  text: string;
  /** 0-4, shown as dots. */
  stealth: number;
  speed: number;
  /** Which apps can connect. */
  apps: string;
  /** The same, short (server header). */
  short: string;
  /** Router capability it needs. */
  needs?: keyof AwgCaps;
}

export const METHODS: MethodInfo[] = [
  {
    id: 'off',
    title: 'Off',
    ic: 'zap',
    stealth: 0,
    speed: 4,
    text: 'Plain WireGuard-compatible traffic. Fastest, but easy to recognise and block.',
    apps: 'Any WireGuard app',
    short: 'Any WireGuard app',
  },
  {
    id: 'standard',
    title: 'Standard',
    ic: 'shield',
    stealth: 2,
    speed: 4,
    text: 'Junk packets and random headers. Gets through most VPN blocking with no speed cost.',
    apps: 'Every AmneziaWG and AmneziaVPN app',
    short: 'Any AmneziaWG app',
  },
  {
    id: 'strong',
    title: 'Strong',
    ic: 'shieldplus',
    stealth: 3,
    speed: 3,
    text: 'More and larger junk packets for networks that block VPNs aggressively. Connects a little slower.',
    apps: 'Every AmneziaWG and AmneziaVPN app',
    short: 'Any AmneziaWG app',
  },
  {
    id: 'max',
    title: 'Maximum',
    ic: 'lock',
    stealth: 4,
    speed: 3,
    needs: 'v3',
    text: 'AmneziaWG 3.1: encrypted packet headers, random tails and sizes, jittered timing, and a first packet that looks like DNS.',
    apps: 'Apps with AmneziaWG 3.1 (current AmneziaVPN)',
    short: 'AmneziaWG 3.1 apps',
  },
];

export const methodInfo = (id: string): MethodInfo | undefined => METHODS.find((x) => x.id === id);

const NEEDS: Record<keyof AwgCaps, string> = {
  v2: 'Needs AmneziaWG 1.5 or newer on the router.',
  v3: 'Needs AmneziaWG 3.1 on the router (kmod-amneziawg and amneziawg-tools 3.1).',
};

function dots(n: number, label: string): HTMLElement {
  return E('span', { class: 'dl-dots', title: `${label}: ${n} of 4` }, [
    E('span', { class: 'dl-dots-label' }, label),
    E(
      'span',
      { class: 'dl-dots-row' },
      [0, 1, 2, 3].map((i) => E('i', { class: i < n ? 'on' : '' })),
    ),
  ]);
}

/**
 * Method cards. `current` gets a badge; unavailable methods stay visible but
 * disabled with the reason, so it is clear what an upgrade would bring.
 */
export function methodPicker(caps: AwgCaps, selected: Method, onSelect: (m: Method) => void, current?: string): HTMLElement {
  const el = E('div', { class: 'dl-methods', role: 'radiogroup', 'aria-label': 'Disguise method' });
  const paint = () =>
    dom.content(
      el,
      METHODS.map((m) => {
        const ok = !m.needs || caps[m.needs];
        const on = m.id === selected;
        return E(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': on ? 'true' : 'false',
            'aria-disabled': ok ? null : 'true',
            class: `dl-method${on ? ' on' : ''}${ok ? '' : ' off'}`,
            click: () => {
              if (!ok || on) return;
              selected = m.id;
              paint();
              onSelect(m.id);
            },
          },
          [
            E('div', { class: 'dl-method-head' }, [
              E('span', { class: 'dl-method-ic' }, icon(m.ic)),
              E('b', {}, m.title),
              m.id === current ? E('span', { class: 'dl-pill ok' }, 'Current') : '',
            ]),
            E('p', {}, m.text),
            E('div', { class: 'dl-method-meters' }, [dots(m.stealth, 'Stealth'), dots(m.speed, 'Speed')]),
            E(
              'div',
              { class: 'dl-method-foot' },
              ok ? [icon('phone'), E('span', {}, m.apps)] : [icon('alert'), E('span', {}, NEEDS[m.needs!])],
            ),
          ],
        );
      }),
    );
  paint();
  return el;
}
