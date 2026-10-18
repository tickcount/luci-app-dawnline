import { describe, expect, it } from 'vitest';
import {
  appsFor,
  deviceNoun,
  inWebview,
  platformOf,
  sameDevice,
  setupFromHash,
  setupLink,
  storeFor,
  updateLine,
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

  it('lists the apps a disguise allows, AmneziaVPN first', () => {
    expect(appsFor('max').map((a) => a.id)).toEqual(['vpn', 'awg']);
    expect(appsFor('off').map((a) => a.id)).toEqual(['vpn', 'awg', 'wg']);
    expect(appsFor('balanced')[0].need).toBe('4.8.12');
    expect(updateLine(appsFor('balanced')[0])).toContain('4.8.12 or newer');
    expect(updateLine(appsFor('max')[0])).toContain('the current version');
    expect(updateLine(appsFor('off')[0])).toBe('');
  });

  it('sends people to the store first and to GitHub where no store has the app', () => {
    expect(storeFor('vpn', 'ios')?.mark).toBe('appstore');
    expect(storeFor('vpn', 'android')?.alt?.mark).toBe('github');
    expect(storeFor('vpn', 'windows')?.href).toContain('github.com/amnezia-vpn/amnezia-client');
    expect(storeFor('awg', 'mac')?.main).toBe('Mac App Store');
    expect(storeFor('wg', 'ios')?.alt).toBeUndefined();
    expect(storeFor('vpn', 'unknown')).toBeNull();
  });

  it('spots in-app browsers', () => {
    expect(inWebview(`${ANDROID} Telegram-Android/10.0`)).toBe(true);
    expect(inWebview(IPHONE)).toBe(false);
  });
});
