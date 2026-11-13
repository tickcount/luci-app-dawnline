import { describe, expect, it } from 'vitest';
import { monthOn, personLine, share } from '../src/admin/people/lines';
import { groupOf } from '../src/admin/people/card';
import { find, litAt, words } from '../src/admin/people/find';
import { inFilter, lastPlace, onlineAbove, scoped, sortBy, sortOf, sortPeople } from '../src/admin/people/roster';
import { extendAll, pauseAll, resumes } from '../src/admin/people/bulk';
import { refetchCount } from '../src/admin/people/refetch';
import type { Device, Person } from '../src/shared/types';

// The router at 2026-11-08 12:40 UTC+3.
const NOW = Date.UTC(2026, 10, 8, 9, 40) / 1000;
const T = { today: '2026-11-08', now: NOW };
const GB = 2 ** 30;

const dev = (o: Partial<Device> = {}): Device =>
  ({
    id: 'd1',
    name: 'Phone',
    kind: 'phone',
    address: '10.8.0.2',
    disabled: false,
    online: false,
    handshake: NOW - 3600,
    endpoint: '91.1.2.3:51820',
    hostname: 'phone',
    config_stale: false,
    lan_bypass: false,
    link: null,
    spark: [],
    month: [0, 0],
    total: [0, 0],
    ...o,
  }) as Device;
const person = (o: Partial<Person> = {}): Person =>
  ({
    id: 'p1',
    name: 'Lena',
    server: 's1',
    access: 'internet',
    device_limit: 3,
    expires: '',
    quota_gb: 0,
    quota_period: 'month',
    quota_used: 0,
    quota_limit: 0,
    bonus_gb: 0,
    dns_mode: 'device',
    paused: false,
    state: 'active',
    month: [0, 0],
    total: [0, 0],
    online: 0,
    last_seen: NOW - 3600,
    devices: [dev()],
    has_link: true,
    ...o,
  }) as Person;

describe('personLine', () => {
  it('names the backend state in its order, each with the action that fixes it', () => {
    expect(personLine(person({ state: 'no_server' }), T)).toMatchObject({ text: 'No server', tone: 'bad', act: { id: 'server' } });
    expect(personLine(person({ state: 'server_off', paused: true }), T)).toMatchObject({ tone: 'warn', act: { id: 'enable' } });
    expect(personLine(person({ state: 'paused', paused: true }), T)).toMatchObject({ text: 'Paused', act: { id: 'resume' } });
    // paused, and the end date passed while paused: resuming alone would end at once
    expect(personLine(person({ state: 'paused', paused: true, expires: '2026-11-01' }), T).act).toMatchObject({
      id: 'resume',
      extend: true,
    });
    expect(personLine(person({ state: 'expired', expires: '2026-11-03' }), T)).toMatchObject({ tone: 'bad', act: { id: 'extend' } });
  });

  it('offers data that leaves them 10 GB or more (in tens), or the limit itself for a whole-term limit', () => {
    const monthly = personLine(person({ state: 'quota', quota_used: 53 * GB, quota_limit: 50 * GB }), T);
    expect(monthly.act).toMatchObject({ id: 'bonus', gb: 20 });
    const over = personLine(person({ state: 'quota', quota_used: 75 * GB, quota_limit: 50 * GB }), T);
    expect(over.act?.gb).toBe(40);
    expect(personLine(person({ state: 'quota', quota_period: 'total', quota_used: 9 * GB, quota_limit: 5 * GB }), T).act?.id).toBe('limit');
  });

  it('warns of an end date in its last three days, for everyone alike', () => {
    expect(personLine(person({ expires: '2026-11-10' }), T)).toMatchObject({ tone: 'warn', act: { id: 'extend' } });
    expect(personLine(person({ expires: '2026-11-12' }), T).tone).toBe('');
  });

  it('says a device that needs something, and what fixes it', () => {
    const trying = (stale: boolean) =>
      personLine(person({ devices: [dev({ link: { state: 'trying', since: NOW - 600 } as Device['link'], config_stale: stale })] }), T).act;
    expect(trying(false)).toMatchObject({ id: 'tell', device: 'd1' });
    expect(trying(true)).toMatchObject({ id: 'show', device: 'd1' });
    const stale = personLine(person({ devices: [dev({ config_stale: true })] }), T);
    expect(stale).toMatchObject({ tone: 'warn', act: { id: 'show' } });
  });

  it('invites someone without devices where the portal is on, else offers adding one', () => {
    expect(personLine(person({ devices: [] }), T).act?.id).toBe('invite');
    expect(personLine(person({ devices: [], has_link: false }), T).act?.id).toBe('add-device');
    expect(personLine(person({ last_seen: 0 }), T).text).toBe('No connections yet');
    expect(personLine(person({ online: 2 }), T)).toMatchObject({ tone: 'ok', text: 'Online · 2 devices' });
  });
});

describe('groups and order', () => {
  it('puts a person in the group of what they need', () => {
    expect(groupOf(person({ state: 'paused', paused: true }), T)).toBe('paused');
    expect(groupOf(person({ state: 'expired', expires: '2026-11-03' }), T)).toBe('need');
    // waiting on the person to fetch a new configuration is not the admin's decision
    expect(groupOf(person({ devices: [dev({ config_stale: true })] }), T)).toBe('rest');
    expect(groupOf(person({ online: 1 }), T)).toBe('online');
  });

  it('extends a month from the later of today and the end date, clamped to the month', () => {
    expect(monthOn({ expires: '' }, '2026-11-08')).toBe('2026-12-08');
    expect(monthOn({ expires: '2026-11-03' }, '2026-11-08')).toBe('2026-12-08');
    expect(monthOn({ expires: '2027-01-31' }, '2026-11-08')).toBe('2027-02-28');
    expect(share({ quota_used: 45, quota_limit: 50 })).toBe(0.9);
  });
});

describe('find', () => {
  const p = person({
    name: 'Алёна Ким',
    note: 'сестра',
    devices: [
      dev({ id: 'd1', name: 'MacBook Air', address: '10.8.0.7', hostname: 'macbook.alena.lan', endpoint: '[2a02:6b8::1]:4500' }),
      dev({ id: 'd2', name: 'iPhone', address: '10.8.0.8', endpoint: '176.59.46.100:51820' }),
    ],
  });
  const hit = (q: string) => find(p, words(q)).hit;

  it('finds by every word, in names, notes, devices and addresses, ё as е', () => {
    expect(hit('')).toBe(true);
    expect(hit('алена')).toBe(true);
    expect(hit('ким macbook')).toBe(true);
    expect(hit('10.8.0.7')).toBe(true);
    expect(hit('2a02:6b8::1')).toBe(true);
    expect(hit('СЕСТРА')).toBe(true);
    expect(hit('ким ipad')).toBe(false);
  });

  it('says which device a word was found on and by what, not when the person answers it', () => {
    expect(find(p, words('алена сестра')).match).toBeNull();
    expect(find(p, words('176.59')).match).toMatchObject({ device: { id: 'd2' }, what: 'ip', value: '176.59.46.100' });
    expect(find(p, words('10.8.0.7')).match).toMatchObject({ device: { id: 'd1' }, what: 'address' });
    expect(find(p, words('ким alena.lan')).match).toMatchObject({ device: { id: 'd1' }, what: 'hostname', value: 'macbook.alena.lan' });
    expect(find(p, words('iphone')).match).toMatchObject({ device: { id: 'd2' }, what: 'name' });
    // the first device found is the one shown
    expect(find(p, words('macbook iphone')).match).toMatchObject({ device: { id: 'd1' } });
    expect(find(p, words('macbook pixel')).match).toBeNull();
  });

  it('finds where the longest word stands in a text', () => {
    expect(litAt('176.59.46.100', words('176.59'))).toEqual([0, 6]);
    expect(litAt('Алёна Ким', words('ким алена'))).toEqual([0, 5]);
    expect(litAt('MacBook Air', words('pixel'))).toBeNull();
  });
});

describe('the roster', () => {
  const a = person({
    id: 'a',
    name: 'Аня',
    server: 's1',
    online: 1,
    last_seen: NOW,
    month: [GB, GB],
    devices: [dev({ id: 'da', online: true })],
  });
  const b = person({
    id: 'b',
    name: 'Боря',
    server: 's2',
    expires: '2026-11-09',
    last_seen: NOW - 3600,
    devices: [dev({ id: 'db', config_stale: true })],
  });
  const c = person({
    id: 'c',
    name: 'Вика',
    server: 's1',
    state: 'paused',
    paused: true,
    expires: '2026-12-01',
    quota_limit: 10 * GB,
    quota_used: 9 * GB,
  });
  const d = person({
    id: 'd',
    name: 'Гена',
    server: 's1',
    online: 1,
    state: 'quota',
    quota_limit: GB,
    quota_used: GB,
    devices: [dev({ id: 'dd', online: true })],
  });
  const all = [a, b, c, d];
  const ids = (ps: Person[]) => ps.map((p) => p.id).join('');

  it('keeps who the address asks for: the server, a waiting configuration, a chip', () => {
    expect(ids(scoped(all, {}, T))).toBe('abcd');
    expect(ids(scoped(all, { server: 's1' }, T))).toBe('acd');
    expect(ids(scoped(all, { need: 'config' }, T))).toBe('b');
    expect(ids(scoped(all, { group: 'online' }, T))).toBe('ad');
    expect(ids(scoped(all, { group: 'paused' }, T))).toBe('c');
    expect(ids(scoped(all, { group: 'need' }, T))).toBe(ids(all.filter((p) => groupOf(p, T) === 'need')));
    // a chip's count is of the people the other filters leave
    expect(ids(scoped(all, { group: 'paused', server: 's1' }, T, false))).toBe('acd');
    expect(inFilter(d, 'online', T)).toBe(true);
  });

  it('counts online the same in the head and in the groups', () => {
    // Гена is online and needs a decision: «Online» lists Аня alone and owes one more above
    expect(groupOf(d, T)).toBe('need');
    expect(all.filter((p) => groupOf(p, T) === 'online').length + onlineAbove(all, T)).toBe(all.filter((p) => p.online > 0).length);
    expect(onlineAbove(all, T)).toBe(1);
    expect(onlineAbove([a], T)).toBe(0);
  });

  it('sorts by a column, names breaking ties', () => {
    expect(ids(sortPeople(all, { key: 'name', dir: -1 }))).toBe('dcba');
    // no end date sorts as the farthest
    expect(ids(sortPeople(all, { key: 'term', dir: 1 }))).toBe('bcad');
    expect(ids(sortPeople(all, { key: 'traffic', dir: -1 }))).toBe('dcab');
    expect(ids(sortPeople(all, { key: 'seen', dir: -1 })).slice(0, 2)).toBe('ad');
  });

  it('keeps an order in the address: its key, the other way round after a dash', () => {
    expect(sortBy('term')).toBe('term');
    expect(sortBy('traffic')).toBe('-traffic');
    expect(sortOf('-traffic')).toEqual({ key: 'traffic', dir: -1 });
    expect(sortOf('term')).toEqual({ key: 'term', dir: 1 });
    expect(sortOf('nope')).toBeNull();
  });

  it('knows where someone was last: live first, then the newest', () => {
    const pt = (o: object) => ({
      person: 'a',
      device: 'da',
      ip: '1.1.1.1',
      ts: 1,
      online: false,
      lat: 0,
      lon: 0,
      city: 'A',
      country: '',
      cc: '',
      asn: 0,
      org: '',
      ...o,
    });
    const geo = {
      enabled: true,
      points: [pt({ city: 'Old', ts: 5 }), pt({ city: 'Live', ts: 2, online: true }), pt({ person: 'b', city: 'Other', ts: 9 })],
    };
    expect(lastPlace(a, geo as never)?.city).toBe('Live');
    expect(lastPlace(c, geo as never)).toBeNull();
  });
});

describe('picks', () => {
  it('extends only those with an end date, and undoes to what each had', () => {
    const b = extendAll([person({ id: 'a', expires: '2026-11-03' }), person({ id: 'b' })], '2026-11-08');
    expect(b.changes).toEqual([{ id: 'a', patch: { expires: '2026-12-08' } }]);
    expect(b.undo).toEqual([{ id: 'a', patch: { expires: '2026-11-03' } }]);
  });

  it('pauses those not paused yet; resumes when everyone picked is paused', () => {
    const ps = [person({ id: 'a', paused: true }), person({ id: 'b' })];
    expect(resumes(ps)).toBe(false);
    expect(pauseAll(ps, true)).toEqual({ changes: [{ id: 'b', patch: { paused: true } }], undo: [{ id: 'b', patch: { paused: false } }] });
    expect(resumes([ps[0]])).toBe(true);
    expect(pauseAll([ps[0]], false).changes).toEqual([{ id: 'a', patch: { paused: false } }]);
    expect(resumes([])).toBe(false);
  });
});

describe('refetchCount', () => {
  const p = person({
    devices: [dev({ id: 'a' }), dev({ id: 'b', lan_bypass: true }), dev({ id: 'c', handshake: 0 }), dev({ id: 'd', disabled: true })],
  });
  it('counts the devices that have connected whose configuration the change rewrites', () => {
    expect(refetchCount(p, { access: 'both' })).toBe(1);
    expect(refetchCount(p, { access: 'lan' })).toBe(2);
    expect(refetchCount(person({ ...p, access: 'lan' }), { access: 'internet' })).toBe(2);
    expect(refetchCount(p, { dns_mode: 'home' })).toBe(0);
    expect(refetchCount(person({ ...p, access: 'lan' }), { dns_mode: 'home' })).toBe(2);
    expect(refetchCount(person({ ...p, access: 'both' }), { home_nets: ['lan'] })).toBe(1);
    expect(refetchCount(p, { access: 'internet' })).toBe(0);
  });
});
