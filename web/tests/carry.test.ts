import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { carryControls, carryOn, flippedNow } from '../src/portal/ui/carry';

/** A control as far as the carry reads it: its class `on`, its ARIA state, its title, and the moves under way on it. */
class Ctl {
  on: boolean;
  attrs = new Map<string, string>();
  isConnected = true;
  offsetWidth = 0;
  tagName = 'BUTTON';
  textContent: string;
  /** How many times it was given a state to show (its class set). */
  turns = 0;
  moves: { currentTime: number }[] = [];
  constructor(title: string, on: boolean, aria: 'aria-checked' | 'aria-pressed' = 'aria-checked', role: string | null = 'switch') {
    this.textContent = title;
    this.on = on;
    this.attrs.set(aria, String(on));
    if (role) this.attrs.set('role', role);
  }
  classList = {
    contains: (c: string) => c === 'on' && this.on,
    toggle: (c: string, v: boolean) => {
      if (c === 'on') this.on = v;
      this.turns++;
    },
  };
  /** What it shows now. */
  get says() {
    return `${this.on ? 'on' : 'off'}/${this.attrs.get('aria-checked') ?? this.attrs.get('aria-pressed')}`;
  }
  getAttribute = (a: string) => this.attrs.get(a) ?? null;
  hasAttribute = (a: string) => this.attrs.has(a);
  setAttribute(a: string, v: string) {
    this.attrs.set(a, v);
  }
  querySelector = () => null;
  querySelectorAll = () => [];
  matches = () => true;
  getAnimations = () => this.moves;
}
/** A region: the controls in it. */
const region = (...list: Ctl[]) => ({ querySelectorAll: () => list }) as unknown as ParentNode;
const el = (c: Ctl) => c as unknown as HTMLElement;
/** The task ends: what waits for the controls to be in the page runs. */
const settle = () => new Promise<void>((r) => queueMicrotask(r));

describe('the controls of a region drawn again', () => {
  beforeEach(() => {
    vi.stubGlobal('HTMLElement', Ctl);
    vi.stubGlobal('CSSTransition', Object);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('one that shows another state starts as the old one stood, then turns to its own', async () => {
    const old = new Ctl('Mirrors', false);
    const neu = new Ctl('Mirrors', true);
    carryControls(region(old), [el(neu)]);
    expect(neu.says).toBe('off/false');
    await settle();
    expect(neu.says).toBe('on/true');
  });
  it('one that shows the same and was not just pressed is left alone', async () => {
    const neu = new Ctl('Mirrors', true);
    carryControls(region(new Ctl('Mirrors', true)), [el(neu)]);
    await settle();
    expect(neu.turns).toBe(0);
  });
  it('one whose old one moved its knob itself a moment ago goes on with that move', async () => {
    const old = new Ctl('Mirrors', true);
    flippedNow(el(old));
    const neu = new Ctl('Mirrors', true);
    neu.moves = [{ currentTime: 0 }, { currentTime: 0 }];
    await new Promise((r) => setTimeout(r, 30));
    carryControls(region(old), [el(neu)]);
    expect(neu.says).toBe('off/false');
    await settle();
    expect(neu.says).toBe('on/true');
    // as far into the move as the old one was
    for (const m of neu.moves) expect(m.currentTime).toBeGreaterThanOrEqual(25);
  });
  it('pairs by name, not by place: a control that came in between takes nobody else’s state', async () => {
    const [a, b] = [new Ctl('Keep the previous version', true), new Ctl('Mirrors', false)];
    const [x, y, z] = [new Ctl('Keep the previous version', true), new Ctl('New one', true), new Ctl('Mirrors', true)];
    carryControls(region(a, b), [el(x), el(y), el(z)]);
    await settle();
    expect([x.turns, y.turns, z.turns]).toEqual([0, 0, 2]);
    expect(z.says).toBe('on/true');
  });
  it('leaves a control that was carried by its own name', async () => {
    const old = new Ctl('AmneziaWG', false, 'aria-pressed', null);
    const neu = new Ctl('AmneziaWG', true, 'aria-pressed', null);
    carryOn('test-chip', el(old), false);
    carryOn('test-chip', el(neu), true);
    carryControls(region(old), [el(neu)]);
    await settle();
    // turned once: from the old state to its own
    expect([neu.turns, neu.says]).toEqual([2, 'on/true']);
  });
});
