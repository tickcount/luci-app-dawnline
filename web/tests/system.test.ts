import { describe, expect, it } from 'vitest';
import { checkChoice, checkValues, installChoice, installValues, nextCheck, autoInstalls } from '../src/admin/updater/policy';
import { addPhase, phaseSteps } from '../src/admin/updater/jobs';
import { routerDate, whenAt, zoneLabel } from '../src/admin/events/clock';
import {
  certDays,
  certPart,
  certSoon,
  defaultsWord,
  fallbackRefetch,
  historyWord,
  isIp,
  linkBase,
  portalHealth,
  portalState,
  portalWord,
  reasonLabel,
  shortPoint,
  storage,
  updatesHealth,
  updatesTone,
  updatesWord,
  type PortalFacts,
} from '../src/admin/system/model';
import type { LogsInfo, UpdatesStatus } from '../src/admin/api';
import type { HealthCheck, Person } from '../src/shared/types';

const NOW = Date.UTC(2026, 10, 8, 9, 40) / 1000;

describe('automatic updates as choices', () => {
  it('reads and saves the Check row', () => {
    expect(checkChoice({ check: false, interval: '1d' })).toBe('off');
    expect(checkChoice({ check: true, interval: '12h' })).toBe('12h');
    expect(checkValues('off')).toEqual({ update_check: '0' });
    expect(checkValues('7d')).toEqual({ update_check: '1', update_interval: '7d' });
  });
  it('reads and saves the Install row', () => {
    expect(installChoice({ auto: false, mode: 'scheduled' })).toBe('off');
    expect(installChoice({ auto: true, mode: 'immediate' })).toBe('immediate');
    expect(installValues('off')).toEqual({ update_auto: '0' });
    expect(installValues('scheduled')).toEqual({ update_auto: '1', update_mode: 'scheduled' });
  });
  it('knows the next check and what installs on its own', () => {
    expect(nextCheck({ check: true, interval: '6h' }, 1000)).toBe(1000 + 6 * 3600);
    expect(nextCheck({ check: false, interval: '6h' }, 1000)).toBe(0);
    expect(nextCheck({ check: true, interval: '1d' }, undefined)).toBe(0);
    expect(autoInstalls({ auto: true, targets: ['app', 'packages'] }, 'app')).toBe(true);
    expect(autoInstalls({ auto: true, targets: ['packages'] }, 'amneziawg')).toBe(false);
    expect(autoInstalls({ auto: false, targets: ['app'] }, 'app')).toBe(false);
  });
});

describe('a job as steps', () => {
  it('adds each new phase once and leaves out the end', () => {
    let seen: string[] = [];
    seen = addPhase(seen, 'Downloading', 'Finished');
    expect(addPhase(seen, 'Downloading', 'Finished')).toBe(seen);
    seen = addPhase(seen, 'Installing', 'Finished');
    expect(addPhase(seen, 'Finished', 'Finished')).toBe(seen);
    expect(addPhase(seen, '', 'Finished')).toBe(seen);
    expect(seen).toEqual(['Downloading', 'Installing']);
  });
  it('marks the last step by how the job stands', () => {
    // under way is where the job is, not a warning
    expect(phaseSteps(['a', 'b'], 'running').map((s) => s.state)).toEqual(['ok', 'run']);
    expect(phaseSteps(['a', 'b'], 'done').map((s) => s.state)).toEqual(['ok', 'ok']);
    expect(phaseSteps(['a', 'b'], 'failed').map((s) => s.state)).toEqual(['ok', 'bad']);
  });
});

describe('the router clock', () => {
  it('says when, in the router’s time', () => {
    // 09:40 UTC is 12:40 at UTC+3
    expect(whenAt(NOW - 600, NOW, 180)).toBe('today at 12:30');
    expect(whenAt(NOW - 86400, NOW, 180)).toBe('yesterday at 12:40');
    expect(whenAt(NOW - 3 * 86400, NOW, 180)).toMatch(/at 12:40$/);
    expect(routerDate(NOW, 180)).toMatch(/12:40$/);
  });
  it('names the zone', () => {
    expect(zoneLabel(180)).toBe('UTC+3');
    expect(zoneLabel(330)).toBe('UTC+5:30');
    expect(zoneLabel(-240)).toBe('UTC−4');
    expect(zoneLabel(0)).toBe('UTC');
  });
});

describe('the router sections’ words', () => {
  it('names why a backup was made', () => {
    expect(reasonLabel('auto')).toBe('Nightly');
    expect(reasonLabel('pre-remove')).toBe('Before removing Dawnline');
    expect(reasonLabel('later-kind')).toBe('later-kind');
  });
  it('counts the devices a fallback DNS change rewrites', () => {
    const p = (access: Person['access'], dns: Person['dns_mode'], devs: Partial<Person['devices'][number]>[]) =>
      ({
        access,
        dns_mode: dns,
        devices: devs.map((d) => ({ disabled: false, handshake: 0, config_issued: 0, ...d })),
      }) as unknown as Person;
    const people = [
      p('lan', 'home', [{ handshake: 1 }, { config_issued: 1 }, {}, { handshake: 1, disabled: true }]),
      p('lan', 'device', [{ handshake: 1 }]),
      p('both', 'home', [{ handshake: 1 }]),
    ];
    expect(fallbackRefetch({ people })).toBe(2);
  });
  it('shortens a release note’s point', () => {
    expect(shortPoint('Portal: **faster** sign-in; keys stay')).toBe('Portal: faster sign-in');
    expect(shortPoint('Short one')).toBe('Short one');
    expect(shortPoint('x '.repeat(60)).endsWith('…')).toBe(true);
  });
  it('builds a link’s base on an address', () => {
    expect(linkBase('vpn.example.com', 8443)).toBe('https://vpn.example.com:8443/');
    expect(linkBase('vpn.example.com', 443)).toBe('https://vpn.example.com/');
    expect(linkBase('91.203.14.7', 8443)).toBe('http://91.203.14.7:8444/');
    expect(linkBase('91.203.14.7', 79)).toBe('http://91.203.14.7/');
  });
  it('counts the certificate’s days', () => {
    expect(certDays(null, NOW)).toBeNull();
    expect(certDays({ self_signed: true, expires: '2026-12-01' }, NOW)).toBeNull();
    expect(certDays({ self_signed: false, expires: '2026-11-17T09:40:00Z' }, NOW)).toBe(9);
  });
});

const check = (id: string, status: HealthCheck['status'], fix: string | null = null, problem?: string): HealthCheck => ({
  id,
  title: id,
  status,
  detail: '',
  fix,
  problem: problem ?? null,
});

describe('a certificate’s term', () => {
  it('is soon under 21 days, and never without an end', () => {
    expect(certSoon(20)).toBe(true);
    expect(certSoon(21)).toBe(false);
    expect(certSoon(-3)).toBe(true);
    expect(certSoon(null)).toBe(false);
  });
  it('measures what is left of 90 days', () => {
    expect(certPart(9)).toBeCloseTo(0.1);
    expect(certPart(365)).toBe(1);
    expect(certPart(-2)).toBe(0);
    expect(certPart(null)).toBeNull();
  });
  it('tells an address from a name', () => {
    expect(isIp('91.203.14.7')).toBe(true);
    expect(isIp('vpn.example.com')).toBe(false);
    expect(isIp('2001:db8::1')).toBe(false);
  });
});

describe('the checks a section shows', () => {
  const checks = [
    check('awg', 'error', 'updates'),
    check('portal', 'ok'),
    check('portal_dns', 'warn'),
    check('portal_reply', 'skip'),
    check('cert', 'error'),
    check('clock', 'error', 'restart'),
    check('tunnel_s1', 'warn'),
  ];
  it('takes the portal’s by their ids', () => {
    const p = portalHealth(checks);
    expect(p.failed.map((k) => k.id)).toEqual(['portal_dns', 'cert']);
    expect(p.passed).toBe(1);
    expect(portalHealth([])).toEqual({ failed: [], passed: 0 });
  });
  it('takes those fixed in Updates, without the fix that would lead to itself', () => {
    expect(updatesHealth(checks)).toEqual([{ ...checks[0], fix: null }]);
    expect(updatesHealth([check('awg', 'ok', 'updates')])).toEqual([]);
  });
});

describe('what is stored against its limits', () => {
  const logs = (o: Partial<LogsInfo> = {}, policy: Partial<LogsInfo['policy']> = {}): LogsInfo => ({
    policy: { keep_days: 30, max: 5000, categories: ['connections'], persist: 'hourly', usage_days: 365, usage_months: 24, ...policy },
    events: 1284,
    oldest: NOW - 29 * 86400 - 3600,
    by_category: { connections: 1012, people: 214, problems: 58 },
    log_ram: 1000,
    log_flash: 160_000,
    usage_flash: 40_000,
    usage_since: '2026-01-04',
    usage_days: 309,
    geo_flash: 6000,
    ...o,
  });
  it('measures the log and the traffic history', () => {
    const s = storage(logs(), NOW);
    expect(s.age).toBe(29);
    expect(s.events).toBeCloseTo(1284 / 5000);
    expect(s.depth).toBeCloseTo(29 / 30);
    expect(s.usage).toBeCloseTo(309 / 365);
    expect(s.flash).toBe(206_000);
  });
  it('has no measure without a limit, and no age in an empty log', () => {
    expect(storage(logs({}, { keep_days: 0 }), NOW).depth).toBeNull();
    const empty = storage(logs({ events: 0, oldest: 0 }), NOW);
    expect(empty.age).toBe(0);
    expect(empty.depth).toBe(0);
  });
});

describe('a section on the rail', () => {
  const upd = (o: Partial<UpdatesStatus> = {}): UpdatesStatus => ({ version: '0.18.0', check: null, job: null, ...o }) as UpdatesStatus;
  const app = (latest: string) => ({ time: NOW, components: { app: { update: true, latest } } });
  const job = (action: string) => ({ state: 'running', action }) as UpdatesStatus['job'];
  it('says how Updates stand', () => {
    expect(updatesWord(upd())).toEqual({ text: 'Dawnline 0.18.0' });
    expect(updatesWord(upd({ check: app('0.19.0') }))).toEqual({ text: '0.19.0 is available' });
    expect(updatesWord(upd({ check: app('0.19.0'), needs: { awg: ['kmod-amneziawg'], https: [], acme: [], home: [] } }))).toEqual({
      text: 'AmneziaWG not installed',
      tone: 'warn',
    });
    expect(updatesWord(upd({ job: job('install') })).text).toBe('an update is running');
    expect(updatesWord(upd({ job: job('check') })).text).toBe('a check is running');
  });
  it('names a check that is fixed in Updates before anything but a job', () => {
    const awg = { ...check('awg', 'error', null, 'AmneziaWG’s kernel module doesn’t load') };
    expect(updatesWord(upd({ check: app('0.19.0') }), [awg])).toEqual({ text: 'AmneziaWG’s kernel module doesn’t load', tone: 'bad' });
    expect(updatesWord(upd({ job: job('install') }), [awg]).text).toBe('an update is running');
    expect(updatesTone(upd({ check: app('0.19.0') }), [awg])).toBe('red');
    expect(updatesTone(upd(), [{ ...awg, status: 'warn' }])).toBe('orange');
  });
  it('tones Updates’ glass', () => {
    expect(updatesTone(upd())).toBe('grey');
    expect(updatesTone(upd({ check: app('0.19.0') }))).toBe('blue');
    expect(updatesTone(upd({ job: job('check') }))).toBe('blue');
    expect(updatesTone(upd({ check: app('0.19.0'), needs: { awg: ['awg'], https: [], acme: [], home: [] } }))).toBe('orange');
  });

  const portal = (o: Partial<PortalFacts> = {}): PortalFacts => ({
    enabled: true,
    host: 'vpn.example.com',
    blocked: false,
    days: 60,
    failed: [],
    ...o,
  });
  it('says how the portal stands, the most pressing first', () => {
    expect(portalWord(portal())).toEqual({ text: 'vpn.example.com' });
    expect(portalWord(portal({ host: '' }))).toEqual({ text: 'on' });
    expect(portalWord(portal({ enabled: false, blocked: true, days: 3 }))).toEqual({ text: 'off', tone: 'off' });
    expect(portalWord(portal({ blocked: true, days: 3 }))).toEqual({ text: 'can’t start', tone: 'bad' });
    expect(portalWord(portal({ days: 9 }))).toEqual({ text: 'certificate: 9 d', tone: 'warn' });
    expect(portalWord(portal({ days: -2 })).text).toBe('certificate: 0 d');
  });
  it('names what did not pass, and counts several', () => {
    const dns = check('portal_dns', 'warn', null, 'Portal address doesn’t point here');
    const down = check('portal', 'error', 'restart', 'Personal portal isn’t working');
    const cert = check('cert', 'warn', null, 'Portal certificate needs attention');
    expect(portalWord(portal({ failed: [dns] }))).toEqual({ text: 'Portal address doesn’t point here', tone: 'warn' });
    expect(portalWord(portal({ failed: [dns, down] }))).toEqual({ text: '2 problems', tone: 'bad' });
    expect(portalWord(portal({ failed: [dns, cert] }))).toEqual({ text: '2 warnings', tone: 'warn' });
    // the certificate's own check gives way to its days; without days (self-signed) it is named
    expect(portalState(portal({ failed: [cert], days: 9 }))).toEqual({ state: 'cert', tone: 'warn' });
    expect(portalState(portal({ failed: [cert, dns], days: 9 })).state).toBe('failed');
    expect(portalWord(portal({ failed: [cert], days: null })).text).toBe('Portal certificate needs attention');
    expect(portalState(portal())).toEqual({ state: 'fine', tone: '' });
  });
  it('says what new people start with and how long the log is kept', () => {
    expect(defaultsWord(1).text).toBe('up to 1 device');
    expect(defaultsWord(3).text).toBe('up to 3 devices');
    expect(historyWord(30).text).toBe('log: 30 d');
    expect(historyWord(0).text).toBe('log: no limit');
  });
});
