import { describe, expect, it } from 'vitest';
import {
  asksNow,
  asksOf,
  askCount,
  behindRefetch,
  netsOf,
  reachers,
  routerAsks,
  routerDeclined,
  routersOf,
  takenFor,
  wishOf,
} from '../src/admin/servers/behind';
import { netRefusal, normNet, tooMany } from '../src/shared/nets';
import { deviceChangedText } from '../src/admin/events/model';
import type { Device, Person } from '../src/shared/types';

const dev = (o: Partial<Device> = {}): Device =>
  ({
    id: 'd1',
    name: 'Phone',
    kind: 'phone',
    disabled: false,
    handshake: 100,
    config_stale: false,
    config_issued: 100,
    lan_bypass: false,
    ...o,
  }) as Device;
const person = (o: Partial<Person> = {}): Person =>
  ({ id: 'p1', name: 'Lena', server: 's1', access: 'both', state: 'active', services: [], home_nets: [], devices: [], ...o }) as Person;

describe('what a router has and asks for', () => {
  const has = dev({ id: 'r1', kind: 'router', behind: ['192.168.2.0/24'], ask: ['192.168.3.0/24', '192.168.2.0/24'] });
  const waits = dev({ id: 'r2', kind: 'router', waiting: true, ask: ['192.168.4.0/24'] });
  const turned = dev({ id: 'r3', kind: 'router', waiting: true, declined: 'talk', ask: ['192.168.5.0/24'] });
  const phone = dev({ behind: ['192.168.9.0/24'], ask: ['192.168.8.0/24'], waiting: true });
  it('only a router has networks or asks', () => {
    expect(netsOf(has)).toEqual(['192.168.2.0/24']);
    expect(netsOf(phone)).toEqual([]);
    expect(asksNow(phone)).toBe(false);
  });
  it('a network asked for is one it does not have', () => {
    expect(asksOf(has)).toEqual(['192.168.3.0/24']);
    expect(asksNow(has)).toBe(true);
    expect(asksNow(dev({ kind: 'router', behind: ['192.168.2.0/24'] }))).toBe(false);
  });
  it('a router asked for is the whole question, its networks with it', () => {
    expect(routerAsks(waits)).toBe(true);
    expect(asksOf(waits)).toEqual([]);
    expect(wishOf(waits)).toEqual(['192.168.4.0/24']);
    expect(asksNow(waits)).toBe(true);
  });
  it('one turned down asks for nothing and is no router of the server', () => {
    expect(routerAsks(turned)).toBe(false);
    expect(routerDeclined(turned)).toBe(true);
    expect(asksNow(turned)).toBe(false);
    const people = [
      person({ devices: [has, waits, turned, phone] }),
      person({ id: 'p2', server: 's2', devices: [dev({ id: 'r9', kind: 'router', waiting: true })] }),
    ];
    expect(routersOf(people, 's1').map((x) => x.d.id)).toEqual(['r1', 'r2']);
    expect(askCount(people, 's1')).toBe(2);
    expect(askCount(people, 's2')).toBe(1);
  });
});

describe('a network typed', () => {
  const taken = [{ cidr: '10.77.0.0/24', who: 'the tunnel network of Home' }];
  it('is kept from its first address', () => {
    expect(normNet(' 192.168.2.7/24 ')).toBe('192.168.2.0/24');
    expect(normNet('10.5.200.1/16')).toBe('10.5.0.0/16');
  });
  it('is a private network of a site’s size', () => {
    expect(netRefusal('192.168.2.0/24', taken)).toBeNull();
    expect(netRefusal('10.5.0.0/16', taken)).toBeNull();
    expect(netRefusal('192.168.2.0', taken)).toContain('is not a network like');
    expect(netRefusal('8.8.8.0/24', taken)).toContain('not a private network');
    expect(netRefusal('172.32.0.0/24', taken)).toContain('not a private network');
    expect(netRefusal('10.0.0.0/8', taken)).toContain('too wide');
    expect(netRefusal('10.4.0.0/15', taken)).toContain('too wide');
  });
  it('shares no address with what something has', () => {
    expect(netRefusal('10.77.0.128/25', taken)).toBe(
      '10.77.0.0/24 is taken: it is the tunnel network of Home. The two ends need different ranges.',
    );
    expect(netRefusal('10.77.0.0/16', taken)).toContain('10.77.0.0/24 is taken');
  });
  it('is one of eight at the most', () => {
    expect(tooMany(8)).toBeNull();
    expect(tooMany(9)).toContain('8 networks behind one router');
  });
  it('is held against tunnels, the router’s own and other devices’ networks, a staged list included', () => {
    const r1 = dev({ id: 'r1', kind: 'router', behind: ['192.168.2.0/24'] });
    const r2 = dev({ id: 'r2', name: 'Dacha', kind: 'router', behind: ['192.168.3.0/24'] });
    const people = [person({ devices: [r1, r2] })];
    const t = takenFor([{ name: 'Home', subnet: '10.77.0.0/24' }], [{ name: 'br-lan', nets: ['192.168.1.0/24'] }], people, r1, (o) =>
      o.id === 'r2' ? ['192.168.30.0/24'] : (o.behind ?? []),
    );
    expect(t.map((x) => x.cidr)).toEqual(['10.77.0.0/24', '192.168.1.0/24', '192.168.30.0/24']);
    expect(t[2].who).toBe('the network behind Dacha');
  });
});

describe('who fetches again when a router’s networks change', () => {
  const router = dev({ id: 'r1', kind: 'router' });
  const owner = person({ id: 'boris', circle: 'fam', devices: [router, dev({ id: 'b2', lan_bypass: true })] });
  const people = [
    owner,
    // sends everything into the tunnel: no word of any network in its configuration
    person({
      id: 'anna',
      circle: 'fam',
      devices: [dev({ id: 'a1' }), dev({ id: 'a2', lan_bypass: true }), dev({ id: 'a3', lan_bypass: true, disabled: true })],
    }),
    person({ id: 'dima', access: 'lan', circle: 'work', devices: [dev({ id: 'd1' }), dev({ id: 'd2', config_issued: 0, handshake: 0 })] }),
    person({ id: 'eva', access: 'lan', services: ['nas'], devices: [dev({ id: 'e1' })] }),
    person({ id: 'clara', access: 'internet', devices: [dev({ id: 'c1', lan_bypass: true })] }),
    person({ id: 'far', server: 's2', devices: [dev({ id: 'f1', lan_bypass: true })] }),
  ];
  const ids = (mesh: 'off' | 'all' | 'circles') => reachers(people, { id: 's1', mesh }, owner, router).map((x) => x.d.id);
  it('everyone who is part of home, where everyone reaches everyone; never the router itself', () => {
    expect(ids('all')).toEqual(['b2', 'a2', 'd1', 'd2']);
  });
  it('the circle, where devices are kept within circles', () => {
    expect(ids('circles')).toEqual(['b2', 'a2']);
  });
  it('nobody while devices are kept apart, or when its owner is no part of home', () => {
    expect(ids('off')).toEqual([]);
    expect(reachers(people, { id: 's1', mesh: 'all' }, people[4], dev({ id: 'c1' }))).toEqual([]);
  });
  it('counts those that hold a configuration, each once', () => {
    expect(behindRefetch(people, { id: 's1', mesh: 'all' }, [{ p: owner, d: router }])).toBe(3);
    expect(
      behindRefetch(people, { id: 's1', mesh: 'all' }, [
        { p: owner, d: router },
        { p: people[1], d: dev({ id: 'a1' }) },
      ]),
    ).toBe(3);
    expect(behindRefetch(people, { id: 's1', mesh: 'off' }, [{ p: owner, d: router }])).toBe(0);
  });
});

describe('what the log says of a router’s networks and requests', () => {
  it('words each change the router writes', () => {
    expect(deviceChangedText('networks=192.168.2.0/24 172.20.0.0/16')).toBe('networks behind it: 192.168.2.0/24, 172.20.0.0/16');
    expect(deviceChangedText('networks=none')).toBe('no networks behind it');
    expect(deviceChangedText('asked=router, asked=192.168.88.0/24')).toBe('the router is asked for, asked for: 192.168.88.0/24');
    expect(deviceChangedText('withdrew=192.168.3.128/25')).toBe('no longer asked for: 192.168.3.128/25');
    expect(deviceChangedText('accepted=router, accepted=192.168.88.0/24')).toBe('the router accepted, accepted: 192.168.88.0/24');
    expect(deviceChangedText('declined=192.168.89.0/24, reason=overlap')).toBe(
      'declined: 192.168.89.0/24, reason: It shares addresses with a network here',
    );
    expect(deviceChangedText('declined=router, reason=plain')).toBe('the router declined, no reason given');
    expect(deviceChangedText('reopened=router')).toBe('the router is asked for again');
    expect(deviceChangedText('kind=phone, networks=none')).toBe('type: Phone, no networks behind it');
  });
});
