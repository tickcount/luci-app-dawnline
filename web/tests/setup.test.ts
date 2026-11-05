import { describe, expect, it } from 'vitest';
import { awgLink, v2rFits } from '../src/shared/awglink';
import {
  addLink,
  appsFor,
  appName,
  appsOn,
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

  it('lists the apps a disguise allows, the tunnel apps first, V2RayTun short of 3.1', () => {
    expect(appsFor('max').map((a) => a.id)).toEqual(['awg', 'vpn']);
    expect(appsFor('balanced').map((a) => a.id)).toEqual(['awg', 'vpn', 'v2r']);
    expect(appsFor('legacy').map((a) => a.id)).toEqual(['awg', 'vpn', 'v2r']);
    expect(appsFor('off').map((a) => a.id)).toEqual(['awg', 'wg', 'vpn', 'v2r']);
  });

  it('offers V2RayTun on Android and Windows only, and a router its packages', () => {
    // V2RayTun on Windows as when its flag is on (shared/flags.ts); off, below.
    const ids = (kind: Parameters<typeof appsOn>[0], os: Parameters<typeof appsOn>[2] = null) =>
      appsOn(kind, appsFor('off'), os, true).map((a) => a.id);
    expect(ids('router')).toEqual(['awg', 'wg']);
    expect(ids('computer', 'windows')).toEqual(['awg', 'vpn', 'v2r']);
    expect(ids('computer', 'mac')).not.toContain('v2r');
    expect(ids('computer', 'linux')).not.toContain('v2r');
    expect(ids('computer')).not.toContain('v2r');
    expect(ids('phone')).toContain('v2r');
    expect(ids('phone', 'android')).toContain('v2r');
    expect(ids('phone', 'ios')).not.toContain('v2r');
    expect(ids('other', 'android')).toContain('v2r');
    expect(ids('other', 'windows')).toContain('v2r');
    expect(ids('other', 'mac')).not.toContain('v2r');
    const off = (kind: Parameters<typeof appsOn>[0], os: Parameters<typeof appsOn>[2]) =>
      appsOn(kind, appsFor('off'), os, false).map((a) => a.id);
    expect(off('computer', 'windows')).not.toContain('v2r');
    expect(off('other', 'windows')).not.toContain('v2r');
    expect(off('phone', 'android')).toContain('v2r');
    expect(off('phone', null)).toContain('v2r');
    expect(storeFor('v2r', 'android')?.href).toContain('com.v2raytun.android');
    expect(storeFor('v2r', 'android')?.alt?.href).toBe('https://t.me/v2raytun');
    expect(storeFor('v2r', 'ios')).toBeNull();
    expect(storeFor('v2r', 'windows')?.href).toBe('https://storage.v2raytun.com/v2RayTun_Setup.exe');
    expect(storeFor('v2r', 'mac')).toBeNull();
    expect(importPath('v2r', 'windows')).toBe('+ → Import from clipboard');
    expect(scanPath('v2r', 'android')).toBe('+ → Import config from QRcode');
    expect(importPath('v2r')).toBe('+ → Import config from Clipboard');
  });

  it('writes the .conf as V2RayTun’s awg:// link, word for word as its own', () => {
    const conf = [
      '[Interface]',
      'PrivateKey = To5H+v75ph8CwYDGaWIV+rpmLfig46SzvpJYucuyRp8=',
      'Address = 10.8.48.141/32',
      'DNS = 1.1.1.1, 1.0.0.1',
      'MTU = 1380',
      'Jc = 6',
      'Jmin = 40',
      'Jmax = 1000',
      'S1 = 67',
      'S2 = 41',
      'H1 = 1225345823',
      'H2 = 1000314123',
      'H3 = 827179548',
      'H4 = 962210412',
      '',
      '[Peer]',
      'PublicKey = Aif5mPmmTkPNf3uUOH1TSWnerLIV6hRgxC8oXyqTFDM=',
      'AllowedIPs = 0.0.0.0/0, ::/0',
      'Endpoint = hel-01.v2tun.net:51820',
      'PersistentKeepalive = 25',
      '',
    ].join('\n');
    expect(awgLink(conf, '1793854167195')).toBe(
      'awg://To5H%2Bv75ph8CwYDGaWIV%2BrpmLfig46SzvpJYucuyRp8%3D@hel-01.v2tun.net:51820' +
        '?publickey=Aif5mPmmTkPNf3uUOH1TSWnerLIV6hRgxC8oXyqTFDM%3D&address=10.8.48.141%2F32&dns=1.1.1.1%2C1.0.0.1' +
        '&mtu=1380&allowedips=0.0.0.0%2F0%2C%3A%3A%2F0&persistentkeepalive=25&jc=6&jmin=40&jmax=1000&s1=67&s2=41' +
        '&h1=1225345823&h2=1000314123&h3=827179548&h4=962210412#1793854167195',
    );
  });

  it('keeps the preshared key, AmneziaWG 2.0 lines and an IPv6 endpoint in the link', () => {
    const conf =
      '[Interface]\nPrivateKey = a/b=\nAddress = 10.0.0.2/32\nS3 = 20\nH1 = 100-200\nI1 = <r 2><b 0x8580>\n\n' +
      '[Peer]\nPublicKey = c+d=\nPresharedKey = e=\nAllowedIPs = 0.0.0.0/0\nEndpoint = [2001:db8::1]:51820\n';
    const url = awgLink(conf, 'Home Server');
    expect(url.startsWith('awg://a%2Fb%3D@[2001:db8::1]:51820?publickey=c%2Bd%3D&address=10.0.0.2%2F32&presharedkey=e%3D&')).toBe(true);
    expect(url).toContain('&s3=20&h1=100-200&i1=%3Cr%202%3E%3Cb%200x8580%3E');
    expect(url.endsWith('#Home%20Server')).toBe(true);
  });

  it('names the server by its IP in the link where one is given (V2RayTun’s core takes no name)', () => {
    const conf = '[Interface]\nPrivateKey = k=\n\n[Peer]\nPublicKey = p=\nEndpoint = engage.example.eu:4500\n';
    expect(awgLink(conf, 'Home', '203.0.113.7')).toBe('awg://k%3D@203.0.113.7:4500?publickey=p%3D#Home');
    expect(awgLink(conf, 'Home', '2001:db8::7')).toContain('@[2001:db8::7]:4500?');
    expect(awgLink(conf, 'Home', null)).toContain('@engage.example.eu:4500?');
  });

  it('offers V2RayTun for AmneziaWG 2.0 and plain WireGuard, never for 3.1 (Maximum)', () => {
    const v2 = '[Interface]\nPrivateKey = k=\nJc = 4\nS3 = 20\nI1 = <r 2>\n\n[Peer]\nPublicKey = p=\n';
    expect(v2rFits(v2)).toBe(true);
    expect(v2rFits('[Interface]\nPrivateKey = k=\n')).toBe(true);
    expect(v2rFits(v2.replace('S3 = 20', 'HeaderProtectionKey = h=\nRandomTrailers = on'))).toBe(false);
    expect(v2rFits(v2.replace('S3 = 20', 'ContentPaddingAddition = 10-100'))).toBe(false);
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

  it('gives WireGuard AmneziaWG’s choice where the disguise is off, and a router both packages', () => {
    const ids = (kind: Parameters<typeof appsOn>[0]) => appsOn(kind, appsFor('off'), 'android').map((a) => a.id);
    expect(ids('phone')).not.toContain('wg');
    expect(ids('computer')).not.toContain('wg');
    expect(ids('router')).toEqual(['awg', 'wg']);
    expect(appName('awg', true)).toBe('AmneziaWG or WireGuard');
    expect(appName('awg')).toBe('AmneziaWG');
    expect(appName('vpn', true)).toBe('AmneziaVPN');
    expect(importSteps('awg', 'mac', 'Home.conf', false, true)[0]).toEqual(['Open AmneziaWG or WireGuard', '']);
    expect(importSteps('awg', 'linux', 'Home.conf', false, true)[2]).toEqual([
      'Or, with wireguard-tools, ',
      'sudo wg-quick up ./Home.conf',
    ]);
    expect(importSteps('awg', 'linux', 'Home.conf', false)).toHaveLength(2);
  });

  it('spots in-app browsers', () => {
    expect(inWebview(`${ANDROID} Telegram-Android/10.0`)).toBe(true);
    expect(inWebview(IPHONE)).toBe(false);
  });
});
