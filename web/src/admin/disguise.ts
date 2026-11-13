// The disguise methods in words: what each does to the traffic, which apps
// take it, what the router needs for it, and how a switch to it is said (the
// Server page's presets and the new server's sheet draw them). No DOM.

import type { AwgCaps } from '../shared/types';

export type Method = 'balanced' | 'max' | 'off';
/** The router features a method may need (the boolean ones of AwgCaps). */
type AwgNeed = 'v2' | 'v3';

export interface MethodInfo {
  id: Method;
  title: string;
  /** What it does, and what it costs. */
  text: string;
  /** Which apps connect with it. */
  apps: string;
  /** Router capability it needs. */
  needs?: AwgNeed;
  /** The question before switching to it. */
  ask: string;
}

/** The methods in the presets' order, in the page's language. */
export function methods(): MethodInfo[] {
  return [
    {
      id: 'off',
      title: _('Off'),
      text: _('Plain WireGuard. Fast, but easy to recognise and block.'),
      apps: _('Any WireGuard app'),
      ask: _('Turn the disguise off?'),
    },
    {
      id: 'balanced',
      title: _('Balanced'),
      text: _('Traffic does not look like a VPN. About the same speed.'),
      apps: _('AmneziaWG 2.0+, AmneziaVPN 4.8.12+'),
      needs: 'v2',
      ask: _('Switch the disguise to Balanced?'),
    },
    {
      id: 'max',
      title: _('Maximum'),
      text: _('For networks that block everything. Slower.'),
      apps: _('AmneziaWG 3.1+, not V2RayTun'),
      needs: 'v3',
      ask: _('Switch the disguise to Maximum?'),
    },
  ];
}

export const methodInfo = (id: string): MethodInfo | undefined => methods().find((x) => x.id === id);

/** The disguise a new server gets: the strongest this router can run. */
export const defaultMethod = (caps: AwgCaps): Method => (caps.v3 ? 'max' : caps.v2 ? 'balanced' : 'off');

/** A method this router can run. */
export const runs = (m: MethodInfo, caps: AwgCaps): boolean => !m.needs || !!caps[m.needs];

/**
 * Servers made before 0.8 may carry the old Standard or Strong disguise
 * (1.0-style junk only, which networks learned to spot). They keep running;
 * the presets offer Balanced or Maximum instead. The title for such a server, or null.
 */
export const legacyTitle = (preset: string): string | null =>
  preset === 'standard' ? _('Standard (old)') : preset === 'strong' ? _('Strong (old)') : null;

/** The disguise's name as a server has it: a method, an old one, or set by hand. */
export const presetName = (preset: string): string => methodInfo(preset)?.title ?? legacyTitle(preset) ?? _('Custom', 'disguise');

/**
 * Why a method is not available. `installed` is false while no AmneziaWG is
 * installed at all ("newer" would be misleading then).
 */
export function needsText(need: AwgNeed, installed: boolean): string {
  if (!installed) return need === 'v2' ? _('Needs AmneziaWG on the router.') : _('Needs AmneziaWG 3.1 on the router: install it first.');
  return need === 'v2'
    ? _('Needs AmneziaWG 2.0 or newer on the router (kmod-amneziawg and amneziawg-tools from July 2025 on).')
    : _('Needs AmneziaWG 3.1 on the router (kmod-amneziawg and amneziawg-tools 3.1).');
}
