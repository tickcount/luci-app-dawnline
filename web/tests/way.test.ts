import { describe, expect, it } from 'vitest';
import { wayState, type WayState } from '../src/portal/way';
import type { Device, SetupState } from '../src/shared/types';

/** When the sheet opened (router clock). */
const OPENED = 1_792_400_000;

/** A device as the router sends it while it is being set up: never connected, nothing on its link. */
function dev(o: Partial<Device> = {}): Device {
  return {
    id: 'd_1',
    name: 'Pixel 9',
    kind: 'phone',
    address: '10.8.0.5',
    disabled: false,
    created: OPENED - 30,
    created_by: 'portal',
    online: false,
    handshake: 0,
    endpoint: '',
    active: true,
    month: [0, 0],
    total: [0, 0],
    spark: [],
    hostname: 'pixel-9.user.lan',
    browser_key: false,
    config_stale: false,
    lan_bypass: false,
    mtu: 0,
    keepalive: null,
    mtu_used: 1280,
    keepalive_used: 25,
    link: null,
    setup: null,
    ...o,
  };
}

const setup = (state: SetupState, since = OPENED + 5) => ({ state, since });

describe('the set-up sheet’s way', () => {
  it('waits while the device is not heard from', () => {
    expect(wayState(dev(), OPENED)).toBe('waiting');
    // Online with an old handshake, quiet: not this set-up's connection.
    expect(wayState(dev({ online: true, handshake: OPENED - 40 }), OPENED)).toBe('waiting');
  });

  it('shows knocks that never finish whenever they come, before the sheet or after', () => {
    expect(wayState(dev({ setup: setup('trying') }), OPENED)).toBe('trying');
    expect(wayState(dev({ setup: setup('trying', OPENED - 60) }), OPENED)).toBe('trying');
    // An older session still counts online while its rekeys fail: still trying.
    expect(wayState(dev({ online: true, handshake: OPENED + 2, setup: setup('trying') }), OPENED)).toBe('trying');
  });

  it('arrives when data flows after a handshake newer than the sheet', () => {
    expect(wayState(dev({ online: true, handshake: OPENED + 9, setup: setup('flowing') }), OPENED)).toBe('connected');
    // The router's watcher may lag the handshake by a second: data flowing is what counts, not `online`.
    expect(wayState(dev({ online: false, handshake: OPENED + 9, setup: setup('flowing') }), OPENED)).toBe('connected');
  });

  it('does not arrive on a handshake alone', () => {
    expect(wayState(dev({ online: true, handshake: OPENED + 9 }), OPENED)).toBe('waiting');
    expect(wayState(dev({ online: true, handshake: OPENED + 9, setup: setup('nodata') }), OPENED)).toBe('nodata');
  });

  it('keeps what began before the sheet for the sheet before', () => {
    // Already flowing, or already without data, on a handshake older than the sheet: not this set-up's.
    expect(wayState(dev({ online: true, handshake: OPENED, setup: setup('flowing', OPENED - 90) }), OPENED)).toBe('waiting');
    expect(wayState(dev({ online: true, handshake: OPENED - 20, setup: setup('nodata', OPENED - 5) }), OPENED)).toBe('waiting');
  });

  it('goes back to plain waiting when the device goes quiet, offline or away', () => {
    expect(wayState(dev({ online: false, handshake: OPENED + 9, setup: null }), OPENED)).toBe('waiting');
    expect(wayState(undefined, OPENED)).toBe('waiting');
  });

  it('follows a whole set-up: knocks, no data, imported again, connected', () => {
    const seen: WayState[] = [];
    const answers: Partial<Device>[] = [
      {},
      { setup: setup('trying') },
      { setup: setup('trying') },
      // The network let it through, but the phone holds an old configuration.
      { online: true, handshake: OPENED + 40 },
      { online: true, handshake: OPENED + 40, setup: setup('nodata', OPENED + 52) },
      // Gone offline: plain waiting, no line of its own.
      { online: false, handshake: OPENED + 40 },
      { online: true, handshake: OPENED + 300, setup: setup('flowing', OPENED + 300) },
    ];
    for (const a of answers) {
      const st = wayState(dev(a), OPENED);
      if (st !== seen[seen.length - 1]) seen.push(st);
    }
    expect(seen).toEqual(['waiting', 'trying', 'waiting', 'nodata', 'waiting', 'connected']);
  });
});
