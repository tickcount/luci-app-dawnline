import { describe, expect, it } from 'vitest';
import { issued, lastChange, meshRewrites, refetch, refetchAny, rollout, rolloutItems } from '../src/admin/servers/rollout';
import { fieldsPatch, netPatch, refetchOf, stage, stagedOf, summary, unstage, type Staged } from '../src/admin/servers/pending';
import { stageChecks, stageOf, stageStates, wanMoved } from '../src/admin/servers/path';
import { homeAccess, whoReaches } from '../src/admin/servers/reach';
import { paramCount, paramGroups, paramsConf } from '../src/admin/servers/params';
import { fixLabel } from '../src/admin/servers/fixes';
import type { ServiceLogEntry } from '../src/admin/api';
import type { Device, HealthCheck, Person, Server } from '../src/shared/types';

const NOW = Date.UTC(2026, 10, 8, 9, 40) / 1000;

const dev = (o: Partial<Device> = {}): Device =>
  ({
    id: 'd1',
    name: 'Phone',
    kind: 'phone',
    disabled: false,
    online: false,
    handshake: NOW - 3600,
    config_stale: false,
    config_issued: NOW - 7200,
    lan_bypass: false,
    mtu: 0,
    keepalive: null,
    ...o,
  }) as Device;
const person = (o: Partial<Person> = {}): Person =>
  ({
    id: 'p1',
    name: 'Lena',
    server: 's1',
    access: 'internet',
    state: 'active',
    services: [],
    home_nets: [],
    devices: [dev()],
    ...o,
  }) as Person;
const server = (o: Partial<Server> = {}): Server =>
  ({ id: 's1', name: 'Home', enabled: true, up: true, endpoint: 'vpn.example.com', lan_like: false, mesh: 'off', ...o }) as Server;

describe('rollout', () => {
  const people = [
    person({
      id: 'a',
      devices: [dev({ id: 'a1', config_stale: true }), dev({ id: 'a2' }), dev({ id: 'a3', disabled: true, config_stale: true })],
    }),
    // never given one: not counted; given one before the router kept the time (stale or a handshake): counted
    person({
      id: 'b',
      devices: [dev({ id: 'b1', config_issued: 0, handshake: 0 }), dev({ id: 'b2', config_issued: 0, config_stale: true, handshake: 0 })],
    }),
    // paused and ended people fetch nothing until they are back
    person({ id: 'c', state: 'paused', devices: [dev({ id: 'c1', config_stale: true })] }),
    person({ id: 'd', server: 's2', devices: [dev({ id: 'd1', config_stale: true })] }),
  ];

  it('counts the devices that hold a configuration, of people the tunnel carries', () => {
    expect(rolloutItems(people, 's1').map((x) => x.d.id)).toEqual(['a1', 'a2', 'b2']);
    expect(rollout(people, 's1')).toEqual({ done: 1, of: 3 });
    expect(rollout([person()], 's1')).toBeNull();
  });

  it('knows a device that was given one', () => {
    expect(issued(dev())).toBe(true);
    expect(issued(dev({ config_issued: 0, handshake: 0 }))).toBe(false);
    expect(issued(dev({ config_issued: 0, handshake: 0, config_stale: true }))).toBe(true);
    expect(issued(dev({ config_issued: 0 }))).toBe(true);
  });
});

describe('refetch (⟳N)', () => {
  const people = [
    person({ id: 'i', access: 'internet', devices: [dev({ id: 'i1', mtu: 1400 }), dev({ id: 'i2', keepalive: 30, lan_bypass: true })] }),
    person({ id: 'l', access: 'lan', devices: [dev({ id: 'l1' }), dev({ id: 'l2', handshake: 0, config_issued: 0 })] }),
    person({ id: 'b', access: 'both', home_nets: ['br-lan'], devices: [dev({ id: 'b1', lan_bypass: true }), dev({ id: 'b2' })] }),
    person({ id: 'p', state: 'expired', devices: [dev({ id: 'p1' })] }),
  ];

  it('counts what a change rewrites', () => {
    expect(refetch(people, 's1', 'all')).toEqual({ n: 6, paused: 1, fresh: 1, people: 4 });
    // their own MTU or keep-alive wins over the server's
    expect(refetch(people, 's1', 'mtu').n).toBe(5);
    expect(refetch(people, 's1', 'keepalive').n).toBe(5);
    // Home-only devices never ask the server's DNS
    expect(refetch(people, 's1', 'dns').n).toBe(5);
    // routes: Home only, and both with LAN Bypass
    expect(refetch(people, 's1', 'routes').n).toBe(2);
    // home networks: the same, unless their page picked networks of their own
    expect(refetch(people, 's1', 'home').n).toBe(1);
  });

  it('rewrites routes only between apart and together', () => {
    expect(meshRewrites('off', 'all')).toBe(true);
    expect(meshRewrites('circles', 'off')).toBe(true);
    expect(meshRewrites('all', 'circles')).toBe(false);
  });
});

describe('pending changes', () => {
  const people = [
    person({ id: 'i', access: 'internet', devices: [dev({ id: 'i1', mtu: 1400 }), dev({ id: 'i2', keepalive: 30, lan_bypass: true })] }),
    person({ id: 'l', access: 'lan', devices: [dev({ id: 'l1' }), dev({ id: 'l2', handshake: 0, config_issued: 0 })] }),
    person({ id: 'b', access: 'both', home_nets: ['br-lan'], devices: [dev({ id: 'b1', lan_bypass: true }), dev({ id: 'b2' })] }),
    person({ id: 'p', state: 'expired', devices: [dev({ id: 'p1' })] }),
  ];
  const mtu: Staged = { kind: 'mtu', label: 'MTU: 1380', value: '1380', values: { mtu: '1380' } };
  const port: Staged = { kind: 'port', label: 'UDP port: 443', value: '443', values: { port: '443' } };
  const dns: Staged = { kind: 'dns', label: 'DNS: 1.1.1.1', value: '1.1.1.1', values: { dns: '1.1.1.1' } };

  it('counts a device once whatever number of changes rewrite it', () => {
    // MTU leaves out i1 (its own MTU), DNS leaves out the Home-only l1: together everyone but nobody twice
    expect(refetchAny(people, 's1', ['mtu']).n).toBe(5);
    expect(refetchAny(people, 's1', ['dns']).n).toBe(5);
    expect(refetchAny(people, 's1', ['mtu', 'dns'])).toEqual({ n: 6, paused: 1, fresh: 1, people: 4 });
    expect(refetchAny(people, 's1', [])).toEqual({ n: 0, paused: 0, fresh: 0, people: 0 });
    expect(refetchOf('mtu', 's1', people)).toBe(5);
    expect(refetchOf('mesh', 's1', people)).toBe(2);
    expect(refetchOf('port', 's2', people)).toBe(0);
  });

  it('keeps one staged change a kind, the later one in the place of the earlier', () => {
    let list = stage(stage(stage([], mtu), port), dns);
    expect(list.map((x) => x.kind)).toEqual(['mtu', 'port', 'dns']);
    list = stage(list, { ...mtu, value: '1300', label: 'MTU: 1300', values: { mtu: '1300' } });
    expect(list.map((x) => x.label)).toEqual(['MTU: 1300', 'UDP port: 443', 'DNS: 1.1.1.1']);
    expect(stagedOf(list, 'mtu')?.value).toBe('1300');
    expect(unstage(list, 'port').map((x) => x.kind)).toEqual(['mtu', 'dns']);
    expect(stagedOf(unstage(list, 'port'), 'port')).toBeUndefined();
  });

  it('holds a disguise and its new values as one, and the home networks choice as one', () => {
    let list = stage([], { kind: 'disguise', label: 'Disguise: Maximum', value: 'Maximum', preset: 'max' });
    list = stage(list, { kind: 'renew', label: 'New disguise values', value: 'Balanced', preset: 'balanced' });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'renew', preset: 'balanced' });
    expect(stagedOf(list, 'disguise')?.kind).toBe('renew');
    list = stage(list, { kind: 'home', label: 'Home networks', value: 'guest', net: { lan_devices: ['br-lan', 'guest'] } });
    // the section hands in the whole choice that differs from the server's: a later one replaces the earlier
    list = stage(list, { kind: 'home', label: 'Home networks', value: 'Off', net: { lan_devices: ['br-lan', 'guest'], auto_lan: false } });
    expect(stagedOf(list, 'home')?.net).toEqual({ lan_devices: ['br-lan', 'guest'], auto_lan: false });
    list = stage(list, { kind: 'home', label: 'Home networks', value: 'On', net: { lan_devices: ['br-lan', 'guest'] } });
    expect(stagedOf(list, 'home')?.net).toEqual({ lan_devices: ['br-lan', 'guest'] });
    expect(list).toHaveLength(2);
  });

  it('holds who sees whom as one whichever way it changes, and what reaches no device counts none', () => {
    let list = stage([], { kind: 'mesh', label: 'Devices see each other: Everyone', value: 'Everyone', values: { mesh: 'all' } });
    list = stage(list, { kind: 'rule', label: 'Devices see each other: In circles', value: 'In circles', values: { mesh: 'circles' } });
    expect(list).toHaveLength(1);
    expect(stagedOf(list, 'mesh')?.kind).toBe('rule');
    expect(refetchOf('rule', 's1', people)).toBe(0);
    expect(refetchOf('route', 's1', people)).toBe(0);
    expect(refetchOf('wan', 's1', people)).toBe(0);
    const route: Staged = {
      kind: 'route',
      label: 'Internet traffic: Like a home device',
      value: 'Like a home device',
      net: { lan_like: true },
    };
    expect(summary([route], people, 's1')).toMatchObject({ changes: 1, breaks: false, refetch: { n: 0, fresh: 0 } });
    expect(summary([route, mtu], people, 's1')).toMatchObject({ changes: 2, refetch: { n: 5 } });
  });

  it('makes one server_interfaces patch of every staged part of that choice', () => {
    expect(netPatch([mtu])).toBeNull();
    expect(
      netPatch([
        { kind: 'route', label: '', value: '', net: { lan_like: true } },
        { kind: 'wan', label: '', value: '', net: { auto_wan: false, wan_device: 'pppoe-wan' } },
        { kind: 'home', label: '', value: '', net: { lan_devices: ['br-lan'] } },
        mtu,
      ]),
    ).toEqual({ lan_like: true, auto_wan: false, wan_device: 'pppoe-wan', lan_devices: ['br-lan'] });
  });

  it('makes one server_update patch of every staged field', () => {
    expect(fieldsPatch([])).toBeNull();
    expect(fieldsPatch([{ kind: 'disguise', label: '', value: '', preset: 'max' }])).toBeNull();
    expect(fieldsPatch([mtu, port, dns, { kind: 'disguise', label: '', value: '', preset: 'max' }])).toEqual({
      mtu: '1380',
      port: '443',
      dns: '1.1.1.1',
    });
  });

  it('says what applying them means: how many devices, and whether they stop connecting', () => {
    expect(summary([mtu], people, 's1')).toMatchObject({ changes: 1, breaks: false, refetch: { n: 5 } });
    expect(summary([mtu, dns], people, 's1')).toMatchObject({ changes: 2, breaks: false, refetch: { n: 6, people: 4 } });
    // a port change rewrites everyone's and cuts them off until they fetch
    expect(summary([mtu, port], people, 's1')).toMatchObject({ changes: 2, breaks: true, refetch: { n: 6, paused: 1, fresh: 1 } });
    expect(summary([], people, 's1')).toMatchObject({ changes: 0, breaks: false, refetch: { n: 0 } });
  });
});

describe('lastChange', () => {
  const e = (o: Partial<ServiceLogEntry>): ServiceLogEntry => ({
    ts: NOW,
    src: 'dawnline',
    level: 'info',
    msg: 'changed',
    by: 'admin',
    kind: 'server',
    ...o,
  });
  it('finds the newest change of this server, by id or by its old name', () => {
    const log = [
      e({ ts: NOW - 300, who: 'Home', note: 'DNS' }),
      e({ ts: NOW - 100, who: 'Home', note: 'name' }),
      e({ ts: NOW - 200, who: 'Renamed', sid: 's1', note: 'disguise: max' }),
      e({ ts: NOW - 50, who: 'Home', sid: 's2', note: 'MTU' }),
      e({ ts: NOW - 10, who: 'Home', msg: 'turned off' }),
    ];
    expect(lastChange(log, server())).toEqual({ note: 'disguise: max', ts: NOW - 200 });
    expect(lastChange([], server())).toBeNull();
  });
});

describe('the path', () => {
  const ck = (id: string, status: HealthCheck['status']): HealthCheck => ({ id, title: id, status, detail: '', fix: null });

  it('puts each check on its stage', () => {
    expect(stageOf('ep_s1', 's1')).toBe('entry');
    expect(stageOf('reply_s1', 's1')).toBe('entry');
    expect(stageOf('up_s1', 's1')).toBe('tunnel');
    expect(stageOf('up_s_home', 's_home')).toBe('tunnel');
    expect(stageOf('homenet_s1', 's1')).toBe('home');
    expect(stageOf('home_s1', 's1')).toBe('internet');
    expect(stageOf('awg', 's1')).toBe('disguise');
    expect(stageOf('resolver', 's1')).toBe('home');
    // another server's, and the router's own that are no stage
    expect(stageOf('up_s2', 's1')).toBeNull();
    expect(stageOf('portal', 's1')).toBeNull();
  });

  it('colours the stages by their checks and what the status says', () => {
    const failed = stageChecks(
      [ck('up_s1', 'ok'), ck('fw_s1', 'error'), ck('homenet_s1', 'warn'), ck('ep_s2', 'error'), ck('policy', 'skip')],
      's1',
    );
    expect(failed.entry.map((c) => c.id)).toEqual(['fw_s1']);
    expect(failed.internet).toEqual([]);
    const st = { wan: '91.1.2.4', like_home: { active: false, error: 'no route' } };
    expect(stageStates(st, server(), failed)).toEqual({
      devices: 'ok',
      disguise: 'ok',
      entry: 'bad',
      tunnel: 'ok',
      internet: 'ok',
      home: 'warn',
    });
    const down = stageStates(st, server({ up: false, endpoint: '91.1.2.3', lan_like: true }), stageChecks([], 's1'));
    expect([down.tunnel, down.entry, down.internet]).toEqual(['bad', 'warn', 'warn']);
    expect(Object.values(stageStates(st, server({ enabled: false }), failed)).every((s) => s === 'off')).toBe(true);
  });

  it('notices the public address left behind', () => {
    expect(wanMoved({ wan: '91.1.2.4' }, server({ endpoint: '91.1.2.3' }))).toBe(true);
    expect(wanMoved({ wan: '91.1.2.4' }, server({ endpoint: 'vpn.example.com' }))).toBe(false);
    expect(wanMoved({ wan: null }, server({ endpoint: '91.1.2.3' }))).toBe(false);
  });
});

describe('who reaches what', () => {
  it('says it by kind of access', () => {
    const people = [
      person({ access: 'internet' }),
      person({ id: 'l', access: 'lan', services: ['sv1'] }),
      person({ id: 'b', access: 'both', home_nets: ['br-lan'] }),
      person({ id: 'x', server: 's2', access: 'both' }),
    ];
    const r = whoReaches(people, server({ lan_like: true, mesh: 'circles' }));
    expect(r.map((x) => [x.access, x.people, x.internet, x.home, x.each])).toEqual([
      ['internet', 1, 'home', null, 'no'],
      ['lan', 1, 'own', ['services'], 'circle'],
      ['both', 1, 'home', ['some'], 'circle'],
    ]);
    expect(homeAccess(person({ access: 'lan', services: ['sv1'] }))).toBe(false);
    expect(homeAccess(person({ access: 'lan' }))).toBe(true);
  });
});

describe('disguise parameters', () => {
  it('groups them and writes them as configuration lines, the key left out', () => {
    const o = { jc: '4', jmin: '40', jmax: '70', s1: '52', h1: '123', i1: '<b 0x85800001>' };
    expect(paramCount(o, true)).toBe(7);
    expect(paramGroups(o, true).map((g) => [g.title, g.items.length])).toEqual([
      ['Junk packets', 3],
      ['Padding', 1],
      ['Packet types', 1],
      ['Signatures', 1],
      ['Protection', 1],
    ]);
    expect(paramsConf(o)).toBe('Jc = 4\nJmin = 40\nJmax = 70\nS1 = 52\nH1 = 123\nI1 = <b 0x85800001>');
  });
});

describe('fixes', () => {
  it('names a fix on its button', () => {
    expect(fixLabel('netrestart')).toBe('Restart network');
    expect(fixLabel('install:awg')).toBe('Install');
    expect(fixLabel('weird')).toBe('Fix');
  });
});
