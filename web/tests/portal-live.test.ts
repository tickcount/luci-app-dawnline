import { afterEach, describe, expect, it, vi } from 'vitest';
import { followLive, hasLive } from '../src/portal/live';
import type { State } from '../src/portal/state';

/** A browser to follow in: the page's #app, its visibility, and streams the test speaks through. */
function browser(live: boolean) {
  const streams: Fake[] = [];
  const onShow: (() => void)[] = [];
  class Fake {
    static CLOSED = 2;
    readyState = 0;
    onerror: (() => void) | null = null;
    private on = new Map<string, (e: { data: string }) => void>();
    constructor(readonly url: string) {
      streams.push(this);
    }
    addEventListener(name: string, f: (e: { data: string }) => void) {
      this.on.set(name, f);
    }
    close() {
      this.readyState = 2;
    }
    say(name: string, data: unknown) {
      this.on.get(name)?.({ data: JSON.stringify(data) });
    }
    refuse() {
      this.readyState = 2;
      this.onerror?.();
    }
  }
  const doc = {
    hidden: false,
    getElementById: () => ({ dataset: live ? { base: '/kamiro-telosu-bavine', live: '1' } : { base: '/kamiro-telosu-bavine' } }),
    addEventListener: (_n: string, f: () => void) => void onShow.push(f),
  };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', { EventSource: Fake });
  vi.stubGlobal('EventSource', Fake);
  return {
    streams,
    show(visible: boolean) {
      doc.hidden = !visible;
      onShow.forEach((f) => f());
    },
  };
}

const person = (online: number) => ({ person: { name: 'Anna', online, devices: [] }, can_add: true }) as unknown as State;

describe("the portal's stream", () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is followed only where the router offers one', () => {
    browser(false);
    expect(hasLive()).toBe(false);
    browser(true);
    expect(hasLive()).toBe(true);
  });

  it('takes the state whole, then each change laid over it', () => {
    const b = browser(true);
    const seen: State[] = [];
    followLive({ state: (st) => void seen.push(st), gone: () => undefined, failed: () => undefined });
    expect(b.streams[0].url).toBe('/kamiro-telosu-bavine/api/live');
    b.streams[0].say('put', person(0));
    b.streams[0].say('patch', { person: { online: 1 }, here: 'd1' });
    expect(seen[1]).toEqual({ person: { name: 'Anna', online: 1, devices: [] }, can_add: true, here: 'd1' });
    // what did not change is the object it was: the page draws nothing of it again
    expect(seen[1].person.devices).toBe(seen[0].person.devices);
    // a field the router takes away
    b.streams[0].say('patch', { here: null });
    expect('here' in seen[2]).toBe(false);
  });

  it('lets the stream go while the page is hidden, and opens on the whole state again', () => {
    const b = browser(true);
    followLive({ state: () => undefined, gone: () => undefined, failed: () => undefined });
    b.show(false);
    expect(b.streams[0].readyState).toBe(2);
    b.show(true);
    expect(b.streams.length).toBe(2);
  });

  it('asks the router itself when no stream opens, and stops for good when the link is gone', () => {
    let b = browser(true);
    const said: string[] = [];
    const on = { state: () => void said.push('state'), gone: () => void said.push('gone'), failed: () => void said.push('failed') };
    followLive(on);
    b.streams[0].refuse();
    b.show(true);
    expect([said, b.streams.length]).toEqual([['failed'], 1]);
    b = browser(true);
    said.length = 0;
    followLive(on);
    b.streams[0].say('put', person(0));
    b.streams[0].say('gone', {});
    b.show(true);
    expect([said, b.streams.length, b.streams[0].readyState]).toEqual([['state', 'gone'], 1, 2]);
  });
});
