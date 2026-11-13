// The admin's demo router (src/admin/demo: past.ts, status.ts, router.ts): the README's pictures are taken from its answers, so they
// hold a cast of the size the README says, the same every time, with nobody's real address in it.
import { describe, expect, it } from 'vitest';
import { joinStatus } from '../src/admin/state/join';
import { PEOPLE } from '../src/admin/demo/cast';
import { NOW } from '../src/admin/demo/past';
import { config, events, health, interfaces, meter, serviceLog } from '../src/admin/demo/router';
import { status, usage } from '../src/admin/demo/status';

const LANGS = ['en', 'ru'] as const;

/** Every IPv4 address written anywhere in a value. */
function addresses(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(...(v.match(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g) ?? []));
  else if (v && typeof v === 'object') for (const x of Object.values(v)) addresses(x, out);
  return out;
}

/** Private, or kept for documentation (RFC 5737): nobody's. */
const nobodys = (ip: string) => /^(10\.|192\.168\.|203\.0\.113\.|198\.51\.100\.|0\.0\.0\.0$)/.test(ip);

describe('the admin demo router', () => {
  it('shows eight people with fifteen devices, six of them online', () => {
    for (const lang of LANGS) {
      const st = status(lang);
      const devices = st.people.flatMap((p) => p.devices);
      expect([st.people.length, devices.length, devices.filter((d) => d.online).length]).toEqual([8, 15, 6]);
      expect(st.totals).toMatchObject({ people: 8, devices: 15, online: 6 });
      expect(new Set(devices.map((d) => d.address)).size).toBe(15);
    }
  });

  it('puts people in the states the pictures are about', () => {
    const state = Object.fromEntries(status('en').people.map((p) => [p.id, p.state]));
    expect(state).toMatchObject({ p_misha: 'quota', p_kirill: 'paused', p_artem: 'active', p_lena: 'active' });
  });

  it('answers the same every time', () => {
    expect(JSON.stringify(events('ru', 5000))).toBe(JSON.stringify(events('ru', 5000)));
    expect(status('en').now).toBe(NOW);
  });

  it('gives no address that is somebody’s', () => {
    for (const lang of LANGS) {
      const said = [status(lang), events(lang, 5000), health(lang), serviceLog(), interfaces('s_home'), config('d_a1', lang), meter()];
      const all = addresses(said);
      expect(all.length).toBeGreaterThan(100);
      expect(all.filter((ip) => !nobodys(ip))).toEqual([]);
    }
  });

  it('keeps a device’s log, usage and places about that device', () => {
    const mine = events('en', 5000, undefined, undefined, 'd_a1').events;
    expect(mine.length).toBeGreaterThan(20);
    expect(mine.every((e) => e.device === 'd_a1' && e.ts <= NOW)).toBe(true);
    // online now: its last event is a connection with no end
    expect(mine[mine.length - 1].type).toBe('connect');
    const u = usage('p_artem', 31);
    expect(u?.person.length).toBe(31);
    expect(Object.keys(u?.devices ?? {})).toEqual(PEOPLE.find((p) => p.id === 'p_artem')?.devices.map((d) => d.id));
    expect(usage('nobody', 31)).toBeNull();
  });

  it('cuts into the topics a status is joined from', () => {
    const { now, tz, servers, people, circles, services, geo, events: recent, totals, series, hours, ...router } = status('en');
    const docs: Record<string, unknown> = {
      router,
      clock: { now, tz },
      traffic: { totals, series, hours },
      servers,
      people,
      circles,
      services,
      places: geo,
      recent,
    };
    expect(joinStatus((t) => docs[t])).toEqual(status('en'));
  });
});
