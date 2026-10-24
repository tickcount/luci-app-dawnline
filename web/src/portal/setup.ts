// Setting up a device: which app, where it comes from, and whether the page
// is open on the device being set up. Pure: the set-up sheet (flows/) draws it.

import type { Kind } from '../shared/types';
import { fmt } from '../shared/i18n';

export type Platform = 'ios' | 'android' | 'windows' | 'mac' | 'linux' | 'unknown';
export type AppId = 'vpn' | 'awg' | 'wg';
/** The server's disguise generation as the portal sees it. */
export type Preset = 'off' | 'balanced' | 'max' | 'legacy';

export const APP_NAME: Record<AppId, string> = { vpn: 'AmneziaVPN', awg: 'AmneziaWG', wg: 'WireGuard' };

/** The platform the page is open on. iPadOS Safari calls itself a Mac; touch points tell. */
export function platformOf(ua: string, touchPoints = 0): Platform {
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Macintosh/.test(ua) && touchPoints > 1) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Windows/.test(ua)) return 'windows';
  if (/Mac OS X|Macintosh/.test(ua)) return 'mac';
  if (/CrOS/.test(ua)) return 'unknown';
  if (/Linux|X11/.test(ua)) return 'linux';
  return 'unknown';
}

/** A browser inside another app (Telegram, Instagram…): vpn:// and the share sheet do not work there. */
export const inWebview = (ua: string): boolean => /Telegram|FBAN|FBAV|Instagram|VKClient|Line\//i.test(ua);

/**
 * Is the page open on the device being set up? A router never is; an unknown
 * platform never counts. Something else (a TV, a box, a NAS) counts when the
 * page came from its own set-up link (`here`: it is open there, an Android TV
 * included) or on a computer's system: added from a phone, it is not the
 * phone in hand.
 */
export function sameDevice(kind: Kind, platform: Platform, here = false): boolean {
  if (kind === 'router' || platform === 'unknown') return false;
  if (kind === 'phone' || kind === 'tablet') return platform === 'ios' || platform === 'android';
  if (kind === 'computer') return platform === 'windows' || platform === 'mac' || platform === 'linux';
  return here || platform === 'windows' || platform === 'mac' || platform === 'linux';
}

export interface AppChoice {
  id: AppId;
  name: string;
}

/** The apps that connect to a server with this disguise, the recommended one first; any WireGuard app without one. */
export function appsFor(preset: Preset): AppChoice[] {
  const out: AppChoice[] = [
    { id: 'vpn', name: APP_NAME.vpn },
    { id: 'awg', name: APP_NAME.awg },
  ];
  if (preset === 'off') out.push({ id: 'wg', name: APP_NAME.wg });
  return out;
}

type Mark = 'appstore' | 'googleplay' | 'windows' | 'apple' | 'linux' | 'openwrt' | 'github' | 'site';

export interface Store {
  href: string;
  /** The small line and the bold line of the badge. */
  top: string;
  main: string;
  mark: Mark;
  /** A second source shown beside the first, where the store can fail (Android). */
  alt?: { href: string; top: string; main: string; mark: Mark; why: string };
}

const GH_CLIENT = 'https://github.com/amnezia-vpn/amnezia-client/releases/latest';
const apk = (href: string): NonNullable<Store['alt']> => ({
  href,
  top: _('APK file on'),
  main: 'GitHub',
  mark: 'github',
  why: _('The APK is for phones without Google Play, or where the store hides the app.'),
});

/** Where the app comes from on a platform: the store first, the official GitHub release where no store has it. */
export function storeFor(app: AppId, platform: Platform): Store | null {
  const onAppStore = _('Download on the');
  const onPlay = _('Get it on');
  const onGitHub = _('Official release on GitHub');
  const S: Record<AppId, Partial<Record<Platform, Store>>> = {
    vpn: {
      ios: { href: 'https://apps.apple.com/app/amneziavpn/id1600529900', top: onAppStore, main: 'App Store', mark: 'appstore' },
      android: {
        href: 'https://play.google.com/store/apps/details?id=org.amnezia.vpn',
        top: onPlay,
        main: 'Google Play',
        mark: 'googleplay',
        alt: apk(GH_CLIENT),
      },
      windows: { href: GH_CLIENT, top: onGitHub, main: _('Download for Windows'), mark: 'windows' },
      mac: { href: GH_CLIENT, top: onGitHub, main: _('Download for Mac'), mark: 'apple' },
      linux: { href: GH_CLIENT, top: onGitHub, main: _('Download for Linux'), mark: 'linux' },
    },
    awg: {
      ios: { href: 'https://apps.apple.com/us/app/amneziawg/id6478942365', top: onAppStore, main: 'App Store', mark: 'appstore' },
      android: {
        href: 'https://play.google.com/store/apps/details?id=org.amnezia.awg',
        top: onPlay,
        main: 'Google Play',
        mark: 'googleplay',
        alt: apk('https://github.com/amnezia-vpn/amneziawg-android/releases'),
      },
      windows: {
        href: 'https://github.com/amnezia-vpn/amneziawg-windows-client/releases',
        top: onGitHub,
        main: _('Download for Windows'),
        mark: 'windows',
      },
      mac: {
        href: 'https://apps.apple.com/us/app/amneziawg/id6478942365',
        top: onAppStore,
        main: 'Mac App Store',
        mark: 'appstore',
      },
      linux: { href: 'https://github.com/amnezia-vpn/amneziawg-tools', top: _('On GitHub'), main: 'amneziawg-tools', mark: 'linux' },
    },
    wg: {
      ios: { href: 'https://apps.apple.com/app/wireguard/id1441195209', top: onAppStore, main: 'App Store', mark: 'appstore' },
      android: {
        href: 'https://play.google.com/store/apps/details?id=com.wireguard.android',
        top: onPlay,
        main: 'Google Play',
        mark: 'googleplay',
      },
      windows: { href: 'https://www.wireguard.com/install/', top: _('Download from'), main: 'wireguard.com', mark: 'windows' },
      mac: { href: 'https://apps.apple.com/app/wireguard/id1451685025', top: onAppStore, main: 'Mac App Store', mark: 'appstore' },
      linux: { href: 'https://www.wireguard.com/install/', top: _('Install from'), main: 'wireguard.com', mark: 'linux' },
    },
  };
  return S[app][platform] ?? null;
}

/** Where a router gets its client: OpenWrt packages. */
export const routerStore = (app: AppId): Store =>
  app === 'wg'
    ? {
        href: 'https://openwrt.org/docs/guide-user/services/vpn/wireguard/start',
        top: _('OpenWrt packages'),
        main: 'wireguard-tools',
        mark: 'openwrt',
      }
    : // One line on a phone: the kernel module goes on top.
      { href: 'https://openwrt.org/packages/start', top: _('OpenWrt packages + kmod'), main: 'amneziawg-tools', mark: 'openwrt' };

/**
 * Does AmneziaVPN here open a `vpn://` link? Only the Android app registers the
 * scheme: on iOS, macOS and Windows the link opens nothing ("the address is
 * invalid"), or another app that claims vpn:// gets the key.
 */
export const opensKeyLinks = (platform: Platform): boolean => platform === 'android';

/** The key as a file for the share sheet: AmneziaVPN on iOS imports `.vpn` files (the key as text). */
export const keyFileName = (confName: string): string => `${confName.replace(/\.conf$/i, '')}.vpn`;

/** A path through an app's menus: its items in order. */
const menu = (...items: string[]) => items.join(' → ');

/*
 * Inside the app: where the scanner and the importer are, word for word as
 * each platform's app labels them, in its own Russian when the page is in
 * Russian (every one of these apps has it). Checked against the apps'
 * sources in October 2026: wireguard-apple, wireguard-android and
 * wireguard-windows, their amneziawg forks (the same apps, menus included)
 * and amnezia-client. The context keeps the apps' words apart from the
 * portal's own. AmneziaVPN opens its "Connection" screen from the + in its
 * bottom bar (no label there); the scanner is on it on phones only.
 */
function tunnelMenu(platform: Platform): { file: string; qr?: string } | undefined {
  const menus: Partial<Record<Platform, { file: string; qr?: string }>> = {
    ios: { file: menu('+', _('Create from file or archive', 'WireGuard app')), qr: menu('+', _('Create from QR code', 'WireGuard app')) },
    android: { file: menu('+', _('Import from file or archive', 'WireGuard app')), qr: menu('+', _('Scan from QR code', 'WireGuard app')) },
    mac: { file: menu('+', _('Import Tunnel(s) from File…', 'WireGuard app')) },
    windows: { file: menu(_('Add Tunnel', 'WireGuard app'), _('Import tunnel(s) from file…', 'WireGuard app')) },
  };
  return menus[platform];
}

/** Where the app scans a code; a phone of either kind gets both wordings. */
export function scanPath(app: AppId, platform: Platform = 'unknown'): string {
  if (app === 'vpn') return menu('+', _('QR code', 'AmneziaVPN app'));
  const qr = tunnelMenu(platform)?.qr;
  return qr ?? fmt(_('%s (Android: %s)'), tunnelMenu('ios')!.qr, tunnelMenu('android')!.qr!.replace(/^.* → /, ''));
}

/** Where the app takes a file (AmneziaVPN: the key, pasted by its Insert button); elsewhere, the Android app's words. */
export function importPath(app: AppId, platform: Platform = 'unknown'): string {
  if (app === 'vpn') return menu('+', _('Insert', 'AmneziaVPN app'));
  return (tunnelMenu(platform) ?? tunnelMenu('android')!).file;
}

/** The last step in AmneziaVPN, once the key is in: its Continue button. */
export const vpnContinue = () => fmt(_('Tap “%s” and connect'), _('Continue', 'AmneziaVPN app'));

/**
 * The file into the app, step by step: [text, the part in bold]. Linux has no
 * app, only the tools: the file goes up straight from where it was saved
 * (its name is a valid interface name, see tunnel_name on the router).
 */
export function importSteps(app: AppId, platform: Platform, file: string, shared: boolean): [string, string][] {
  if (platform === 'linux')
    return [
      [_('Open a terminal in the folder with the file'), ''],
      // The command comes after the word, in bold: "Run sudo awg-quick up …".
      [`${_('Run')} `, `sudo ${app === 'wg' ? 'wg-quick' : 'awg-quick'} up ./${file}`],
    ];
  const path = importPath(app, platform);
  return [
    [fmt(_('Open %s', 'step'), APP_NAME[app]), ''],
    [path.replace(/ → [^→]*$/, ' → '), path.replace(/^.* → /, '')],
    [shared ? _('Confirm the import and connect') : _('Pick the file and connect'), ''],
  ];
}

/** The platform in a sentence: its name, or "this device". */
export function platformLabel(p: Platform): string {
  return { ios: 'iPhone / iPad', android: 'Android', windows: 'Windows', mac: 'Mac', linux: 'Linux', unknown: _('this device') }[p];
}

/**
 * The personal link that opens straight on one device's set-up: the page then
 * starts it by itself. In the fragment, which never reaches the router: the
 * link stays the key, the device only says where to start.
 */
export const setupLink = (page: string, id: string): string => `${page}#setup=${id}`;

/** The device a link asks to set up (`#setup=d_…`), or null; anything else in the fragment is ignored. */
export function setupFromHash(hash: string): string | null {
  return /^#setup=(d_[0-9a-f]{8})$/.exec(hash)?.[1] ?? null;
}

/** The personal link that opens straight on "Add a device": for the device itself to add, from its own browser. */
export const addLink = (page: string): string => `${page}#add`;

/** Does the link ask to add a device (`#add`)? */
export const wantsAdd = (hash: string): boolean => hash === '#add';

/**
 * "the phone", "the computer": the device being set up, in a sentence. The
 * sheet's title already names it; the lines under it do not repeat the name.
 * `on`: the word after "on the" ("open it on the phone"), which other
 * languages decline (Russian: на телефоне, but на телефон after "to the").
 */
export const deviceNoun = (kind: Kind, on = false): string =>
  (on
    ? {
        phone: _('phone', 'on the'),
        tablet: _('tablet', 'on the'),
        computer: _('computer', 'on the'),
        router: _('router', 'on the'),
        other: _('device', 'on the'),
      }
    : { phone: _('phone'), tablet: _('tablet'), computer: _('computer'), router: _('router'), other: _('device') })[kind];
