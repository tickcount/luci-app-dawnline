import { describe, expect, it } from 'vitest';
import type { Device, Person } from '../src/shared/types';
import { draftCount, draftParts, draftRefetch, preview, split, stageDraft } from '../src/admin/people/draft';

const GIB = 1073741824;
const dev = (o: Partial<Device>): Device =>
  ({ id: 'd', name: 'Phone', kind: 'phone', handshake: 100, disabled: false, lan_bypass: false, ...o }) as Device;
const person = (o: Partial<Person> = {}): Person =>
  ({
    id: 'p',
    name: 'Lena',
    server: 's1',
    access: 'both',
    device_limit: 4,
    expires: '',
    quota_gb: 100,
    quota_period: 'month',
    quota_used: 30 * GIB,
    quota_limit: 110 * GIB,
    bonus_gb: 10,
    dns_mode: 'home',
    paused: false,
    state: 'active',
    month: [10 * GIB, 20 * GIB],
    total: [100 * GIB, 200 * GIB],
    online: 1,
    last_seen: 0,
    devices: [dev({ id: 'a' }), dev({ id: 'b', lan_bypass: true }), dev({ id: 'c', handshake: 0 })],
    services: ['nas'],
    home_nets: [],
    circle: 'c1',
    ...o,
  }) as Person;

describe("a person's changes that wait", () => {
  it('splits a patch into what waits and what is saved at once', () => {
    expect(split({ name: 'Lena K', access: 'lan', quota_gb: '', paused: true, note: undefined })).toEqual({
      waits: { access: 'lan', quota_gb: '' },
      now: { name: 'Lena K', paused: true },
    });
  });

  it('keeps one value a field and lets go of one put back', () => {
    const p = person();
    let d = stageDraft({}, p, { access: 'lan' });
    d = stageDraft(d, p, { quota_gb: '50', services: ['nas', 'printer'] });
    expect(d).toEqual({ access: 'lan', quota_gb: '50', services: ['nas', 'printer'] });
    expect(draftCount(d)).toBe(3);
    expect([...draftParts(d)].sort()).toEqual(['limit', 'reach']);
    d = stageDraft(d, p, { access: 'both', quota_gb: '100', services: ['nas'] });
    expect(d).toEqual({});
    // no limit is '' or 0, a list is the same in any order, no circle is ''
    expect(stageDraft({}, person({ quota_gb: 0 }), { quota_gb: '' })).toEqual({});
    expect(stageDraft({}, person({ home_nets: ['br-lan', 'guest'] }), { home_nets: ['guest', 'br-lan'] })).toEqual({});
    expect(stageDraft({}, person({ circle: undefined }), { circle: '' })).toEqual({});
    expect(stageDraft({}, p, { device_limit: '4' })).toEqual({});
    expect(stageDraft({}, p, { device_limit: '5' })).toEqual({ device_limit: '5' });
  });

  it('shows the person as they would be', () => {
    const p = person();
    expect(preview(p, {})).toBe(p);
    const q = preview(p, { access: 'internet', quota_gb: '50', device_limit: '6', circle: '' });
    expect(q).toMatchObject({ access: 'internet', quota_gb: 50, device_limit: 6, circle: '' });
    // this month's 10 GB extra stays on top of the new limit
    expect(q.quota_limit).toBe(60 * GIB);
    expect(preview(p, { quota_gb: '' }).quota_limit).toBe(0);
    expect(preview(p, { quota_period: 'total' })).toMatchObject({ quota_period: 'total', quota_used: 300 * GIB });
    // the person the router answered with is not touched
    expect(p.access).toBe('both');
  });

  it('counts the devices that fetch again once, whatever of their access changes', () => {
    const p = person();
    // both → internet: only the one with LAN Bypass; to Home only: every one that has connected
    expect(draftRefetch(p, { access: 'internet' })).toBe(1);
    expect(draftRefetch(p, { access: 'lan' })).toBe(2);
    expect(draftRefetch(p, { access: 'lan', home_nets: ['br-lan'], dns_mode: 'device' })).toBe(2);
    expect(draftRefetch(p, { home_nets: ['br-lan'] })).toBe(1);
    expect(draftRefetch(p, { quota_gb: '50', device_limit: '6', services: [] })).toBe(0);
  });
});
