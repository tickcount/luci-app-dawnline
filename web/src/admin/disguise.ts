// Disguise methods: one picker for the Server page and the setup wizard.

import type { AwgCaps } from '../shared/types';
import { E } from './e';
import { icon } from '../shared/icons';
import { fmt } from '../shared/i18n';

export type Method = 'balanced' | 'max' | 'off';
/** The router features a method may need (the boolean ones of AwgCaps). */
type AwgNeed = 'v2' | 'v3';

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
  needs?: AwgNeed;
}

/** The methods in picker order, in the page's language. */
function methods(): MethodInfo[] {
  return [
    {
      id: 'off',
      title: _('Off'),
      ic: 'zap',
      stealth: 0,
      speed: 4,
      text: _('Plain WireGuard-compatible traffic. Fastest, but easy to recognise and block.'),
      apps: _('Any WireGuard app'),
      short: _('Any WireGuard app'),
    },
    {
      id: 'balanced',
      title: _('Balanced'),
      ic: 'shield',
      stealth: 3,
      speed: 4,
      needs: 'v2',
      text: _(
        'AmneziaWG 2.0: junk packets, padded packets and a first packet that looks like DNS. For networks that learned to spot 1.0-style junk.',
      ),
      apps: _('AmneziaVPN 4.8.12 or newer, AmneziaWG 2.0+ apps'),
      short: _('AmneziaWG 2.0+ apps'),
    },
    {
      id: 'max',
      title: _('Maximum'),
      ic: 'lock',
      stealth: 4,
      speed: 3,
      needs: 'v3',
      text: _('AmneziaWG 3.1: encrypted packet headers, random tails and sizes, jittered timing, and a first packet that looks like DNS.'),
      apps: _('Apps with AmneziaWG 3.1 (current AmneziaVPN)'),
      short: _('AmneziaWG 3.1 apps'),
    },
  ];
}

export const methodInfo = (id: string): MethodInfo | undefined => methods().find((x) => x.id === id);

/** The disguise a new server gets: the strongest this router can run. */
export const defaultMethod = (caps: AwgCaps): Method => (caps.v3 ? 'max' : caps.v2 ? 'balanced' : 'off');

/**
 * Servers made before 0.8 may carry the old Standard or Strong disguise
 * (1.0-style junk only, which networks learned to spot). They keep running;
 * the picker offers Balanced or Maximum instead. The title for such a server, or null.
 */
export const legacyTitle = (preset: string): string | null =>
  preset === 'standard' ? _('Standard (old)') : preset === 'strong' ? _('Strong (old)') : null;

/**
 * Why a method is not available. `installed` is false while no AmneziaWG is
 * installed at all ("newer" would be misleading then).
 */
function needsText(need: AwgNeed, installed: boolean): string {
  if (!installed) return need === 'v2' ? _('Needs AmneziaWG on the router.') : _('Needs AmneziaWG 3.1 on the router: install it first.');
  return need === 'v2'
    ? _('Needs AmneziaWG 2.0 or newer on the router (kmod-amneziawg and amneziawg-tools from July 2025 on).')
    : _('Needs AmneziaWG 3.1 on the router (kmod-amneziawg and amneziawg-tools 3.1).');
}

function dots(n: number, label: string): HTMLElement {
  return E('span', { class: 'dl-dots', title: fmt(_('%s: %s of 4'), label, n) }, [
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
 * `installed` is false while the router has no AmneziaWG tools at all.
 */
export function methodPicker(
  caps: AwgCaps,
  selected: Method,
  onSelect: (m: Method) => void,
  current?: string,
  installed = true,
): HTMLElement {
  const el = E('div', { class: 'dl-methods', role: 'radiogroup', 'aria-label': _('Disguise method') });
  const paint = () =>
    dom.content(
      el,
      methods().map((m) => {
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
              m.id === current ? E('span', { class: 'dl-pill ok' }, _('Current')) : '',
            ]),
            E('p', {}, m.text),
            E('div', { class: 'dl-method-meters' }, [dots(m.stealth, _('Stealth')), dots(m.speed, _('Speed'))]),
            E(
              'div',
              { class: 'dl-method-foot' },
              ok
                ? [icon(m.id === 'off' ? 'wireguard' : 'amneziawg'), E('span', {}, m.apps)]
                : [icon('alert'), E('span', {}, needsText(m.needs!, installed))],
            ),
          ],
        );
      }),
    );
  paint();
  return el;
}
