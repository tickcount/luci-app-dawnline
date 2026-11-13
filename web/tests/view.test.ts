import { describe, expect, it } from 'vitest';
import { pageView, type Page } from '../src/admin/shell/view';

/** A page that, like the real ones, keeps what it drew in its own fields. */
class Counting implements Page<number> {
  static made = 0;
  drawn = 0;
  constructor() {
    Counting.made++;
  }
  load() {
    return Promise.resolve(Counting.made);
  }
  render() {
    this.drawn++;
    return {} as HTMLElement;
  }
}

const view = () =>
  pageView(
    () => new Counting(),
    () => null,
    (page) => {
      page.render(0);
      return (page as Counting).drawn;
    },
    () => Promise.resolve('css'),
  );

describe('pageView', () => {
  it('gives every visit a page of its own (LuCI shares one load and render between visits)', async () => {
    Counting.made = 0;
    const v = view();
    // first visit
    expect(v.render(await v.load())).toBe(1);
    // back to the same view: a new page, drawn once, not the old one drawn into again
    expect(v.render(await v.load())).toBe(1);
    expect(Counting.made).toBe(2);
  });

  it('never waits for the router: a page that does is handed over still waiting, to be drawn in its waiting state', async () => {
    let answer: (n: number) => void = () => undefined;
    const slow: Page<number> = { load: () => new Promise((done) => (answer = done)), render: () => ({}) as HTMLElement };
    const v = pageView(
      () => slow,
      () => null,
      (_page, got) => got,
      () => Promise.resolve(''),
    );
    const got = await v.load();
    expect('pending' in got).toBe(true);
    answer(7);
    expect('pending' in got && (await got.pending)).toBe(7);
    // one that answers at once (it draws itself from a sample) is rendered from its answer
    const fast = pageView(
      () => new Counting(),
      () => null,
      (_page, g) => g,
      () => Promise.resolve(''),
    );
    expect('data' in (await fast.load())).toBe(true);
    // a refusal is the waiting page's to tell, not an error of the load
    const failing = pageView(
      (): Page<number> => ({
        load: () => new Promise((_ok, no) => setTimeout(() => no(new Error('down')), 5)),
        render: () => ({}) as HTMLElement,
      }),
      () => null,
      (_page, g) => g,
      () => Promise.resolve(''),
    );
    const f = await failing.load();
    await expect('pending' in f ? f.pending : null).rejects.toThrow('down');
  });

  it('does not load a page that only sends the browser on', () => {
    Counting.made = 0;
    const away = new Promise<never>(() => {});
    const v = pageView(
      () => new Counting(),
      () => away,
      () => 0,
      () => Promise.resolve(''),
    );
    expect(v.load()).toBe(away);
    expect(Counting.made).toBe(0);
  });
});
