// Setting up a device: which app, where it comes from, and whether the page
// is open on the device being set up. Pure: the sheet in main.ts draws it.

import type { Kind } from '../shared/types';

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

/** Is the page open on the device being set up? A router never is; an unknown platform never counts. */
export function sameDevice(kind: Kind, platform: Platform): boolean {
  if (kind === 'router' || platform === 'unknown') return false;
  if (kind === 'phone' || kind === 'tablet') return platform === 'ios' || platform === 'android';
  if (kind === 'computer') return platform === 'windows' || platform === 'mac' || platform === 'linux';
  return true;
}

/**
 * The systems a kind may run, when that is the person's call: a computer's
 * desktop systems, any system for an "other" device (a TV box runs Android, a
 * NAS Linux). A phone's or a tablet's is read from the browser.
 */
export const osGroup = (kind: Kind): Platform[] =>
  kind === 'computer' ? ['windows', 'mac', 'linux'] : kind === 'other' ? ['ios', 'android', 'windows', 'mac', 'linux'] : [];

export interface AppChoice {
  id: AppId;
  name: string;
  /** The version this server needs, as "4.8.12" or ""; "current" when only the newest will do. */
  need: string;
  sub: string;
}

/** The apps that connect to a server with this disguise, the recommended one first. */
export function appsFor(preset: Preset): AppChoice[] {
  const need = {
    off: { vpn: '', awg: '' },
    balanced: { vpn: '4.8.12', awg: '2.0' },
    max: { vpn: 'current', awg: '3.1' },
    legacy: { vpn: '', awg: '' },
  }[preset];
  const out: AppChoice[] = [
    { id: 'vpn', name: APP_NAME.vpn, need: need.vpn, sub: 'Connects from a link, no files' },
    { id: 'awg', name: APP_NAME.awg, need: need.awg, sub: 'The light client: a file or a QR code' },
  ];
  if (preset === 'off') out.push({ id: 'wg', name: APP_NAME.wg, need: '', sub: 'Any WireGuard app: this server has no disguise' });
  return out;
}

/** "This server needs AmneziaVPN 4.8.12 or newer. …", or "" when any version will do. */
export function updateLine(app: AppChoice): string {
  if (!app.need) return '';
  const what = app.need === 'current' ? `the current version of ${app.name}` : `${app.name} ${app.need} or newer`;
  return `This server needs ${what}. Installed a while ago? Update it in the store.`;
}

export type Mark = 'appstore' | 'googleplay' | 'windows' | 'apple' | 'linux' | 'openwrt' | 'github' | 'site';

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
const APK: NonNullable<Store['alt']> = {
  href: GH_CLIENT,
  top: 'APK file on',
  main: 'GitHub',
  mark: 'github',
  why: 'The APK is for phones without Google Play, or where the store hides the app.',
};

/** Where the app comes from on a platform: the store first, the official GitHub release where no store has it. */
export function storeFor(app: AppId, platform: Platform): Store | null {
  const S: Record<AppId, Partial<Record<Platform, Store>>> = {
    vpn: {
      ios: { href: 'https://apps.apple.com/app/amneziavpn/id1600529900', top: 'Download on the', main: 'App Store', mark: 'appstore' },
      android: {
        href: 'https://play.google.com/store/apps/details?id=org.amnezia.vpn',
        top: 'Get it on',
        main: 'Google Play',
        mark: 'googleplay',
        alt: APK,
      },
      windows: { href: GH_CLIENT, top: 'Official release on GitHub', main: 'Download for Windows', mark: 'windows' },
      mac: { href: GH_CLIENT, top: 'Official release on GitHub', main: 'Download for Mac', mark: 'apple' },
      linux: { href: GH_CLIENT, top: 'Official release on GitHub', main: 'Download for Linux', mark: 'linux' },
    },
    awg: {
      ios: { href: 'https://apps.apple.com/us/app/amneziawg/id6478942365', top: 'Download on the', main: 'App Store', mark: 'appstore' },
      android: {
        href: 'https://play.google.com/store/apps/details?id=org.amnezia.awg',
        top: 'Get it on',
        main: 'Google Play',
        mark: 'googleplay',
        alt: { ...APK, href: 'https://github.com/amnezia-vpn/amneziawg-android/releases' },
      },
      windows: {
        href: 'https://github.com/amnezia-vpn/amneziawg-windows-client/releases',
        top: 'Official release on GitHub',
        main: 'Download for Windows',
        mark: 'windows',
      },
      mac: {
        href: 'https://apps.apple.com/us/app/amneziawg/id6478942365',
        top: 'Download on the',
        main: 'Mac App Store',
        mark: 'appstore',
      },
      linux: { href: 'https://github.com/amnezia-vpn/amneziawg-tools', top: 'On GitHub', main: 'amneziawg-tools', mark: 'linux' },
    },
    wg: {
      ios: { href: 'https://apps.apple.com/app/wireguard/id1441195209', top: 'Download on the', main: 'App Store', mark: 'appstore' },
      android: {
        href: 'https://play.google.com/store/apps/details?id=com.wireguard.android',
        top: 'Get it on',
        main: 'Google Play',
        mark: 'googleplay',
      },
      windows: { href: 'https://www.wireguard.com/install/', top: 'Download from', main: 'wireguard.com', mark: 'windows' },
      mac: { href: 'https://apps.apple.com/app/wireguard/id1451685025', top: 'Download on the', main: 'Mac App Store', mark: 'appstore' },
      linux: { href: 'https://www.wireguard.com/install/', top: 'Install from', main: 'wireguard.com', mark: 'linux' },
    },
  };
  return S[app][platform] ?? null;
}

/** Where a router gets its client: OpenWrt packages. */
export const routerStore = (app: AppId): Store =>
  app === 'wg'
    ? {
        href: 'https://openwrt.org/docs/guide-user/services/vpn/wireguard/start',
        top: 'OpenWrt packages',
        main: 'wireguard-tools',
        mark: 'openwrt',
      }
    : { href: 'https://openwrt.org/packages/start', top: 'OpenWrt packages', main: 'amneziawg-tools + kmod', mark: 'openwrt' };

/**
 * Does AmneziaVPN here open a `vpn://` link? Only the Android app registers the
 * scheme: on iOS, macOS and Windows the link opens nothing ("the address is
 * invalid"), or another app that claims vpn:// gets the key.
 */
export const opensKeyLinks = (platform: Platform): boolean => platform === 'android';

/** The key as a file for the share sheet: AmneziaVPN on iOS imports `.vpn` files (the key as text). */
export const keyFileName = (confName: string): string => `${confName.replace(/\.conf$/i, '')}.vpn`;

/*
 * Inside the app: where the scanner and the importer are, as each platform's
 * app words it. The WireGuard apps are the same apps as AmneziaWG (it is
 * their fork), menus included.
 */
const TUNNEL_MENU: Partial<Record<Platform, { file: string; qr?: string }>> = {
  ios: { file: '+ → Create from file or archive', qr: '+ → Create from QR code' },
  android: { file: '+ → Import from file or archive', qr: '+ → Scan from QR code' },
  mac: { file: '+ → Import tunnel(s) from file' },
  windows: { file: 'Add Tunnel → Import tunnel(s) from file' },
};

/** Where the app scans a code; a phone of either kind gets both wordings. */
export function scanPath(app: AppId, platform: Platform = 'unknown'): string {
  if (app === 'vpn') return 'Add server → Scan QR';
  const qr = TUNNEL_MENU[platform]?.qr;
  return qr ?? `${TUNNEL_MENU.ios!.qr} (Android: ${TUNNEL_MENU.android!.qr!.replace(/^.* → /, '')})`;
}

/** Where the app takes a file (AmneziaVPN: the key). */
export function importPath(app: AppId, platform: Platform = 'unknown'): string {
  if (app === 'vpn') return 'Add server → Insert key';
  return TUNNEL_MENU[platform]?.file ?? 'Add tunnel → Import from file';
}

/**
 * The file into the app, step by step: [text, the part in bold]. Linux has no
 * app, only the tools: the file goes up straight from where it was saved
 * (its name is a valid interface name, see tunnel_name on the router).
 */
export function importSteps(app: AppId, platform: Platform, file: string, shared: boolean): [string, string][] {
  if (platform === 'linux')
    return [
      ['Open a terminal in the folder with the file', ''],
      ['Run ', `sudo ${app === 'wg' ? 'wg-quick' : 'awg-quick'} up ./${file}`],
    ];
  const path = importPath(app, platform);
  return [
    [`Open ${APP_NAME[app]}`, ''],
    [path.replace(/ → [^→]*$/, ' → '), path.replace(/^.* → /, '')],
    [shared ? 'Confirm the import and connect' : 'Pick the file and connect', ''],
  ];
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  ios: 'iPhone / iPad',
  android: 'Android',
  windows: 'Windows',
  mac: 'Mac',
  linux: 'Linux',
  unknown: 'this device',
};

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

/**
 * "the phone", "the computer": the device being set up, in a sentence. The
 * sheet's title already names it; the lines under it do not repeat the name.
 */
export const deviceNoun = (kind: Kind): string =>
  ({ phone: 'phone', tablet: 'tablet', computer: 'computer', router: 'router', other: 'device' })[kind];

/** "This iPhone", "This Mac": the pill for the device in hand. */
export const hereLabel = (platform: Platform): string =>
  ({ ios: 'This iPhone', android: 'This phone', windows: 'This PC', mac: 'This Mac', linux: 'This PC', unknown: 'This device' })[platform];
