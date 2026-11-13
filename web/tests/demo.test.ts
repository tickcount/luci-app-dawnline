import { describe, expect, it } from 'vitest';
import { createRouter, type DemoDb, type Keep } from '../src/portal/demo/router';
import { SCENARIOS, monthDays } from '../src/portal/demo/data';
import { wayState } from '../src/portal/way';
import type { State } from '../src/portal/state';
import type { AwgConfig } from '../src/shared/types';

const SECURE = 'https://demo.example/?s=normal';

/** A router over a kept db in memory, on a clock the test moves. */
function demo(want: string | null = null, kept: unknown = null) {
  let t = 1_792_400_000;
  let saved: unknown = kept;
  const keep: Keep = { load: () => saved, save: (db: DemoDb) => (saved = JSON.parse(JSON.stringify(db))) };
  const r = createRouter({ keep, want, secureUrl: () => SECURE, clock: () => t });
  const state = () => r.answer('GET', 'state').body as State;
  return { r, state, saved: () => saved, later: (s: number) => (t += s) };
}

describe('demo router', () => {
  it('answers every scenario with a page state', () => {
    for (const s of SCENARIOS) {
      const { state } = demo(s.id);
      const st = state();
      expect(st.person.name).toBe('User');
      expect(st.person.devices.length).toBe(s.id === 'first' ? 0 : s.id === 'site' ? 4 : 3);
      expect(st.server).toMatchObject({ routers: 'ask', nets: 'ask' });
    }
    expect(demo('paused').state().person.state).toBe('paused');
    expect(demo('paused').state().locked).toBe(true);
    expect(demo('plain').state().server).toMatchObject({ awg_disguise: false, preset: 'off' });
    expect(demo('full').state().can_add).toBe(false);
    expect(demo('http').state().https_url).toBe(SECURE);
    expect(
      demo('stale')
        .state()
        .person.devices.find((d) => d.name === 'MacBook Pro')?.config_stale,
    ).toBe(true);
  });

  it('starts on the scenario the link asks for, else the one kept', () => {
    const first = demo('quota');
    first.state(); // the page's first call keeps what it showed
    expect(demo(null, first.saved()).r.scenario()).toBe('quota');
    expect(demo('paused', first.saved()).r.scenario()).toBe('paused');
    expect(demo('nonsense').r.scenario()).toBe('normal');
    expect(demo(null, { scenario: 'gone', devs: 3 }).r.scenario()).toBe('normal');
  });

  it('adds a device that connects a few seconds after its settings', () => {
    const { r, state, later } = demo();
    const a = r.answer('POST', 'devices', { name: 'Pixel 9', kind: 'phone' });
    expect(a.status).toBe(200);
    const { id, config } = a.body as { id: string; config: AwgConfig };
    expect(config.conf).toMatch(/^Endpoint = demo\.dawnline\.invalid:51820$/m);
    expect(config.conf).toMatch(/^Jmin = 40$/m);
    expect(state().person.devices.find((d) => d.id === id)?.handshake).toBe(0);
    later(10);
    const d = state().person.devices.find((x) => x.id === id)!;
    expect(d.handshake).toBeGreaterThan(0);
    expect(d.online).toBe(true);
  });

  it('refuses what the router refuses', () => {
    const { r } = demo();
    expect(r.answer('POST', 'devices', { name: 'iphone 16', kind: 'phone' }).status).toBe(409);
    expect(r.answer('POST', 'devices', { name: '  ', kind: 'phone' }).status).toBe(400);
    expect(r.answer('GET', 'devices/d_00000000/config').status).toBe(404);
    expect(r.answer('POST', 'devices/d_00000000', { action: 'rename', name: 'x' }).status).toBe(404);
    expect(demo('paused').r.answer('POST', 'devices', { name: 'New', kind: 'phone' }).body).toEqual({ error: 'Your access is paused.' });
    const http = demo('http');
    const id = http.state().person.devices[0].id;
    expect(http.r.answer('GET', `devices/${id}/config`)).toEqual({
      status: 403,
      body: { error: 'Open this link over HTTPS to get the connection settings.', https_url: SECURE },
    });
  });

  it('renames, reconnects and removes a device', () => {
    const { r, state, later } = demo();
    const id = state().person.devices[0].id;
    r.answer('POST', `devices/${id}`, { action: 'rename', name: 'Work iPhone' });
    expect(state().person.devices[0].name).toBe('Work iPhone');
    const re = r.answer('POST', `devices/${id}`, { action: 'reconnect' }).body as { config: AwgConfig; state: State };
    expect(re.config.conf).toMatch(/^PrivateKey = .{44}$/m);
    expect(re.state.person.devices[0].handshake).toBe(0);
    later(10);
    expect(state().person.devices[0].handshake).toBeGreaterThan(0);
    r.answer('POST', `devices/${id}`, { action: 'delete' });
    expect(state().person.devices.map((d) => d.id)).not.toContain(id);
  });

  it('asks the admin for a router, which waits with its networks and gets no settings', () => {
    const { r, state, later } = demo();
    expect(r.answer('POST', 'devices', { name: 'Tablet', kind: 'tablet', networks: ['192.168.9.0/24'] }).body).toMatchObject({
      error: 'Only a router has networks behind it.',
    });
    expect(r.answer('POST', 'devices', { name: 'Dacha', kind: 'router', networks: ['192.168.1.0/24'] }).status).toBe(400);
    const a = r.answer('POST', 'devices', { name: 'Dacha', kind: 'router', networks: ['192.168.88.7/24', '192.168.88.0/24'] });
    const { id, waiting, config } = a.body as { id: string; waiting?: boolean; config?: AwgConfig };
    expect(a.status).toBe(200);
    expect(waiting).toBe(true);
    expect(config).toBeUndefined();
    later(60);
    expect(state().person.devices.find((d) => d.id === id)).toMatchObject({
      kind: 'router',
      waiting: true,
      ask: ['192.168.88.0/24'],
      handshake: 0,
      online: false,
    });
    expect(r.answer('GET', `devices/${id}/config`).status).toBe(409);
    expect(r.answer('POST', `devices/${id}`, { action: 'reconnect' }).status).toBe(400);
    // what is asked for with it changes while it waits; nothing is its own yet
    r.answer('POST', `devices/${id}`, { action: 'networks', networks: ['192.168.89.0/24'] });
    expect(state().person.devices.find((d) => d.id === id)).toMatchObject({ ask: ['192.168.89.0/24'] });
    expect(state().person.devices.find((d) => d.id === id)?.behind).toBeUndefined();
    // a phone is not made a router by setting it up again
    const phone = state().person.devices.find((d) => d.kind === 'phone')!;
    expect(r.answer('POST', `devices/${phone.id}`, { action: 'reconnect', kind: 'router' }).status).toBe(400);
  });

  it('takes a network away at once, asks for a new one and puts a turned-down one away', () => {
    const { r, state } = demo('site');
    const router = () => state().person.devices.find((d) => d.kind === 'router')!;
    expect(router()).toMatchObject({
      behind: ['192.168.2.0/24'],
      ask: ['192.168.20.0/24'],
      declined: 'overlap',
      declined_nets: ['192.168.1.0/24'],
    });
    const id = router().id;
    // one more asked for, the one that waited taken back, the turned-down one put away
    expect(
      r.answer('POST', `devices/${id}`, {
        action: 'networks',
        networks: ['192.168.2.0/24', '192.168.30.0/24'],
        cleared: ['192.168.1.0/24'],
      }).status,
    ).toBe(200);
    expect(router()).toMatchObject({ behind: ['192.168.2.0/24'], ask: ['192.168.30.0/24'] });
    expect(router().declined).toBeUndefined();
    // its own network taken away: gone at once
    r.answer('POST', `devices/${id}`, { action: 'networks', networks: [] });
    expect(router().behind).toBeUndefined();
    expect(router().ask).toBeUndefined();
    // what the page checks, the router checks too
    expect(r.answer('POST', `devices/${id}`, { action: 'networks', networks: ['8.8.8.0/24'] }).status).toBe(400);
    const phone = state().person.devices.find((d) => d.kind === 'phone')!;
    expect(r.answer('POST', `devices/${phone.id}`, { action: 'networks', networks: ['192.168.9.0/24'] }).body).toMatchObject({
      error: 'Only a router has networks behind it.',
    });
  });

  it('starts a scenario over', () => {
    const { r, state } = demo('normal');
    r.answer('POST', 'devices', { name: 'Pixel 9', kind: 'phone' });
    r.use('first');
    expect(state().person.devices).toEqual([]);
    expect(r.scenario()).toBe('first');
  });
});

describe('demo data', () => {
  it('spreads the last 30 days over their days', () => {
    const t = new Date(2026, 9, 19, 12).getTime() / 1000;
    const days = monthDays(1000, t);
    expect(days).toHaveLength(30);
    expect(Math.abs(days.reduce((a, [rx, tx]) => a + rx + tx, 0) - 1000)).toBeLessThanOrEqual(30);
  });

  it('holds the device being set up in the state the visitor picks', () => {
    const { r, state, later } = demo('normal');
    const { id } = r.answer('POST', 'devices', { name: 'Laptop', kind: 'computer' }).body as { id: string };
    expect(r.settingUp()).toBe(id);
    const opened = (state() as State & { now: number }).now;
    later(1);
    const way = () =>
      wayState(
        state().person.devices.find((d) => d.id === id),
        opened,
      );
    r.holdWay(id, 'trying');
    later(60);
    expect(way()).toBe('trying');
    expect(r.wayOf(id)).toBe('trying');
    r.holdWay(id, 'nodata');
    later(1);
    expect(way()).toBe('nodata');
    r.holdWay(id, 'waiting');
    later(60);
    expect(way()).toBe('waiting');
    r.holdWay(id, 'connected');
    expect(way()).toBe('connected');
    expect(r.wayOf(id)).toBe('auto');
    // Removed: nothing is being set up.
    r.answer('POST', `devices/${id}`, { action: 'delete' });
    expect(r.settingUp()).toBe(null);
  });
});
