import { describe, expect, it } from 'vitest';
import {
  addLink,
  appsFor,
  deviceNoun,
  importPath,
  importSteps,
  inWebview,
  keyFileName,
  opensKeyLinks,
  platformOf,
  sameDevice,
  scanPath,
  setupFromHash,
  setupLink,
  storeFor,
  wantsAdd,
} from '../src/portal/setup';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

describe('setup', () => {
  it('reads the platform from the browser, iPad included', () => {
    expect(platformOf(IPHONE)).toBe('ios');
    expect(platformOf(IPAD_AS_MAC, 5)).toBe('ios');
    expect(platformOf(IPAD_AS_MAC, 0)).toBe('mac');
    expect(platformOf(ANDROID)).toBe('android');
    expect(platformOf(WINDOWS)).toBe('windows');
    expect(platformOf(LINUX)).toBe('linux');
    expect(platformOf('Mozilla/5.0 (X11; CrOS x86_64)')).toBe('unknown');
  });

  it('links straight to the set-up of a device through the fragment, and reads only that back', () => {
    const page = 'https://engage.example.eu:4500/abcdef-ghijkl-mnopqr';
    expect(setupLink(page, 'd_bf0b30e9')).toBe(`${page}#setup=d_bf0b30e9`);
    expect(setupFromHash('#setup=d_bf0b30e9')).toBe('d_bf0b30e9');
    expect(setupFromHash('')).toBeNull();
    expect(setupFromHash('#setup=')).toBeNull();
    expect(setupFromHash('#setup=d_bf0b30e9&x=1')).toBeNull();
    expect(setupFromHash('#setup=../../api')).toBeNull();
  });

  it('links to "Add a device" for the device itself, and reads only that back', () => {
    const page = 'https://engage.example.eu:4500/abcdef-ghijkl-mnopqr';
    expect(addLink(page)).toBe(`${page}#add`);
    expect(wantsAdd('#add')).toBe(true);
    expect(wantsAdd('#add=1')).toBe(false);
    expect(wantsAdd('')).toBe(false);
  });

  it('names the device being set up by its kind, not its name', () => {
    expect(deviceNoun('phone')).toBe('phone');
    expect(deviceNoun('computer')).toBe('computer');
    expect(deviceNoun('other')).toBe('device');
  });

  it('knows whether the page is open on the device being set up', () => {
    expect(sameDevice('phone', 'ios')).toBe(true);
    expect(sameDevice('phone', 'mac')).toBe(false);
    expect(sameDevice('computer', 'windows')).toBe(true);
    expect(sameDevice('computer', 'android')).toBe(false);
    expect(sameDevice('router', 'linux')).toBe(false);
    expect(sameDevice('phone', 'unknown')).toBe(false);
  });

  it('sets something else (a TV, a NAS) up from a phone as a device elsewhere, and on a computer’s system as itself', () => {
    expect(sameDevice('other', 'ios')).toBe(false);
    expect(sameDevice('other', 'android')).toBe(false);
    expect(sameDevice('other', 'windows')).toBe(true);
    expect(sameDevice('other', 'mac')).toBe(true);
    expect(sameDevice('other', 'linux')).toBe(true);
    expect(sameDevice('other', 'unknown')).toBe(false);
  });

  it('sets something else up as itself when the page came from its own set-up link (an Android TV)', () => {
    expect(sameDevice('other', 'android', true)).toBe(true);
    expect(sameDevice('other', 'ios', true)).toBe(true);
    expect(sameDevice('other', 'unknown', true)).toBe(false);
    // A phone's, a computer's or a router's link opened elsewhere: the platform still decides.
    expect(sameDevice('phone', 'mac', true)).toBe(false);
    expect(sameDevice('computer', 'android', true)).toBe(false);
    expect(sameDevice('router', 'linux', true)).toBe(false);
  });

  it('lists the apps a disguise allows, AmneziaVPN first', () => {
    expect(appsFor('max').map((a) => a.id)).toEqual(['vpn', 'awg']);
    expect(appsFor('off').map((a) => a.id)).toEqual(['vpn', 'awg', 'wg']);
  });

  it('sends people to the store first and to GitHub where no store has the app', () => {
    expect(storeFor('vpn', 'ios')?.mark).toBe('appstore');
    expect(storeFor('vpn', 'android')?.alt?.mark).toBe('github');
    expect(storeFor('vpn', 'windows')?.href).toContain('github.com/amnezia-vpn/amnezia-client');
    expect(storeFor('awg', 'mac')?.main).toBe('Mac App Store');
    expect(storeFor('wg', 'ios')?.alt).toBeUndefined();
    expect(storeFor('vpn', 'unknown')).toBeNull();
  });

  it('opens vpn:// links only where AmneziaVPN registers them, and names the key file for the rest', () => {
    expect(opensKeyLinks('android')).toBe(true);
    expect(opensKeyLinks('ios')).toBe(false);
    expect(opensKeyLinks('windows')).toBe(false);
    expect(opensKeyLinks('mac')).toBe(false);
    expect(keyFileName('outline-iphone.conf')).toBe('outline-iphone.vpn');
    expect(keyFileName('home')).toBe('home.vpn');
  });

  it('words the import as each platform’s app does', () => {
    expect(importPath('awg', 'ios')).toBe('+ → Create from file or archive');
    expect(importPath('awg', 'android')).toBe('+ → Import from file or archive');
    expect(importPath('wg', 'windows')).toBe('Add Tunnel → Import tunnel(s) from file…');
    expect(importPath('vpn', 'ios')).toBe('+ → Insert');
    expect(scanPath('vpn')).toBe('+ → QR code');
    expect(importPath('awg', 'unknown')).toBe('+ → Import from file or archive');
    expect(scanPath('awg', 'android')).toBe('+ → Scan from QR code');
    expect(scanPath('awg')).toBe('+ → Create from QR code (Android: Scan from QR code)');
    expect(importSteps('awg', 'mac', 'Outline-Home.conf', false)).toEqual([
      ['Open AmneziaWG', ''],
      ['+ → ', 'Import Tunnel(s) from File…'],
      ['Pick the file and connect', ''],
    ]);
    expect(importSteps('awg', 'linux', 'Outline-Home.conf', false)[1]).toEqual(['Run ', 'sudo awg-quick up ./Outline-Home.conf']);
    expect(importSteps('wg', 'linux', 'Outline-Home.conf', false)[1][1]).toContain('wg-quick up');
  });

  it('spots in-app browsers', () => {
    expect(inWebview(`${ANDROID} Telegram-Android/10.0`)).toBe(true);
    expect(inWebview(IPHONE)).toBe(false);
  });
});
