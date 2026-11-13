import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import {
  checkGroups,
  checkList,
  fixPlace,
  hourBars,
  ownFix,
  serverNumbers,
  stateLine,
  stillWaiting,
  systemNews,
  topMonth,
  topProblem,
  waitRows,
  waiting,
} from '../src/admin/overview/model';
import { scoped } from '../src/admin/people/roster';
import { serverState } from '../src/admin/servers/state';
import type { Device, HealthCheck, Person } from '../src/shared/types';
import type { ServiceLog } from '../src/admin/api';

// The router at 2026-11-08 12:40 UTC+3.
const NOW = Date.UTC(2026, 10, 8, 9, 40) / 1000;
const T = { today: '2026-11-08', now: NOW };

beforeAll(() => {
  Object.assign(globalThis, { L: { url: (p: string) => `/cgi-bin/luci/${p}` } });
});

const check = (id: string, status: HealthCheck['status'], fix: string | null = null): HealthCheck => ({
  id,
  title: id,
  status,
  detail: '',
  fix,
  problem: status === 'ok' ? null : `${id} failed`,
});

const person = (o: Partial<Person> = {}): Person =>
  ({
    id: 'p1',
    name: 'Lena',
    server: 's1',
    state: 'active',
    paused: false,
    expires: '',
    quota_limit: 0,
    quota_used: 0,
    month: [0, 0],
    total: [0, 0],
    online: 0,
    last_seen: NOW - 3600,
    devices: [],
    has_link: true,
    ...o,
  }) as Person;

describe('the router in one phrase and its checks as a list', () => {
  it('counts the checks in the phrase, the worst first', () => {
    expect(stateLine(null)).toEqual({ text: 'Checking…', tone: '' });
    expect(stateLine(null, true)).toEqual({ text: 'The checks did not run', tone: '' });
    expect(stateLine([check('clock', 'ok'), check('cert', 'skip')])).toEqual({ text: 'Everything works', tone: 'ok' });
    expect(stateLine([check('cert', 'warn')])).toEqual({ text: '1 warning', tone: 'warn' });
    expect(stateLine([check('cert', 'warn'), check('flash', 'warn'), check('dns', 'ok')])).toEqual({
      text: '2 warnings',
      tone: 'warn',
    });
    // problems are said alone: the warnings are in the list under them
    expect(stateLine([check('cert', 'warn'), check('up_s1', 'error'), check('flash', 'error')])).toEqual({
      text: '2 problems',
      tone: 'bad',
    });
  });

  it('puts an error before a warning in the notice', () => {
    expect(topProblem([check('cert', 'warn'), check('up_s1', 'error')])?.id).toBe('up_s1');
    expect(topProblem([check('cert', 'warn'), check('flash', 'warn')])?.id).toBe('cert');
    expect(topProblem([check('cert', 'ok'), check('x', 'skip')])).toBeNull();
    expect(topProblem(null)).toBeNull();
  });

  it('splits the checks: the notice, the other failing ones with errors first, and all that passed', () => {
    const l = checkList([
      check('clock', 'ok'),
      check('cert', 'warn'),
      check('srv_s2', 'skip'),
      check('flash', 'warn'),
      check('up_s1', 'error'),
      check('agent', 'error'),
      check('nft', 'ok'),
    ]);
    expect(l.top?.id).toBe('up_s1');
    expect(l.failing.map((c) => c.id)).toEqual(['agent', 'cert', 'flash']);
    // nothing is folded away: the skipped one stays among them
    expect(l.passed.map((c) => c.id)).toEqual(['clock', 'srv_s2', 'nft']);
    expect([l.ok, l.of]).toEqual([2, 6]);
    // every check stands in exactly one place
    expect(1 + l.failing.length + l.passed.length).toBe(7);
    expect(checkList([check('clock', 'ok')])).toEqual({ top: null, failing: [], passed: [check('clock', 'ok')], ok: 1, of: 1 });
  });

  it('groups what passed by what it is about, a server’s checks under its own name', () => {
    const servers = [
      { id: 's1', name: 'Home' },
      { id: 'x_s1', name: 'Cabin' },
    ];
    const t = (c: HealthCheck, title: string): HealthCheck => ({ ...c, title });
    const gs = checkGroups(
      [
        t(check('awg', 'ok'), 'AmneziaWG installed'),
        t(check('clock', 'ok'), 'Clock is set'),
        t(check('up_s1', 'ok'), 'Tunnel running (Home)'),
        t(check('fw_s1', 'error'), 'Firewall rules (Home)'),
        t(check('ep_s1', 'warn'), 'Public address (Home)'),
        // the other server's id ends with the first one's: the check is its own
        t(check('srv_x_s1', 'skip'), 'Server (Cabin)'),
        t(check('portal', 'ok'), 'Personal portal'),
        t(check('cert', 'skip'), 'Portal certificate'),
      ],
      servers,
    );
    expect(gs.map((g) => [g.kind, g.name, g.ok, g.of, g.tone])).toEqual([
      ['router', undefined, 2, 2, 'ok'],
      ['server', 'Home', 1, 3, 'bad'],
      ['server', 'Cabin', 0, 0, 'off'],
      ['portal', undefined, 1, 1, 'ok'],
    ]);
    // what did not pass stands in the notice and the rows above: a group names only what passed or was skipped
    expect(gs[1].passed.map((x) => x.title)).toEqual(['Tunnel running']);
    expect(gs[2].passed.map((x) => [x.title, x.check.status])).toEqual([['Server', 'skip']]);
    expect(gs[3].passed.map((x) => x.title)).toEqual(['Personal portal', 'Portal certificate']);
    // a group with no check is left out
    expect(checkGroups([check('clock', 'ok')], servers).map((g) => g.kind)).toEqual(['router']);
  });

  it('leads each problem to where it is set (a section of Settings, a part of its server’s page), or nowhere', () => {
    const base = '/cgi-bin/luci/admin/services/dawnline';
    expect(fixPlace({ id: 'cert', fix: null }, ['s1'])).toBe(`${base}/settings?p=portal`);
    expect(fixPlace({ id: 'portal_dns', fix: null }, ['s1'])).toBe(`${base}/settings?p=portal`);
    expect(fixPlace({ id: 'app', fix: 'updates' }, ['s1'])).toBe(`${base}/settings?p=updates`);
    expect(fixPlace({ id: 'port_s1', fix: null }, ['s1'])).toBe(`${base}/server?p=general&s=entry`);
    expect(fixPlace({ id: 'up_s2', fix: null }, ['s1', 's2'])).toBe(`${base}/server?server=s2&p=network&s=tunnel`);
    expect(fixPlace({ id: 'srv_s2', fix: null }, ['s1', 's2'])).toBe(`${base}/server?server=s2`);
    expect(fixPlace({ id: 'awg', fix: 'install:awg' }, ['s1', 's2'])).toBe(`${base}/server?p=core&s=disguise`);
    // nothing set anywhere is about the clock, the agent, the flash, the data, or a router with no server
    for (const id of ['clock', 'agent', 'flash', 'data', 'server']) expect(fixPlace({ id, fix: null }, ['s1'])).toBeNull();
  });

  it('keeps a fix in the list only for a check with no Settings section', () => {
    expect(ownFix({ id: 'agent', fix: 'restart' }, ['s1'])).toBe('restart');
    // advice only: no button
    expect(ownFix({ id: 'clock', fix: null }, ['s1'])).toBeNull();
    // fixed where the problem is (its stage, the portal, Updates): a signal here, no second button
    expect(ownFix({ id: 'nft', fix: 'apply' }, ['s1'])).toBeNull();
    expect(ownFix({ id: 'up_s1', fix: 'netrestart' }, ['s1'])).toBeNull();
    expect(ownFix({ id: 'portal', fix: 'install:https' }, ['s1'])).toBeNull();
    expect(ownFix({ id: 'app', fix: 'updates' }, ['s1'])).toBeNull();
  });
});

describe('people and traffic', () => {
  it('lists who waits for a decision (not who is fine or paused)', () => {
    const ps = [
      person({ id: 'a', name: 'Ann', state: 'active', online: 1 }),
      person({ id: 'b', name: 'Bob', state: 'expired', expires: '2026-11-01', last_seen: NOW - 60 }),
      person({ id: 'c', name: 'Cat', state: 'no_server' }),
      person({ id: 'd', name: 'Dan', state: 'paused', paused: true }),
    ];
    const w = waiting(ps, T).map((p) => p.id);
    expect([...w].sort()).toEqual(['b', 'c']);
    // by the weight of what stops them (the cards' matrix): no server before an end date
    expect(w).toEqual(['c', 'b']);
  });

  it('shows the first who wait and counts as People does', () => {
    const ps = [
      person({ id: 'ok', state: 'active', online: 1 }),
      person({ id: 'paused', state: 'paused', paused: true }),
      ...Array.from({ length: 7 }, (_x, i) =>
        person({ id: `w${i}`, name: `W${i}`, state: i < 2 ? 'no_server' : 'expired', expires: '2026-11-01', last_seen: NOW - i }),
      ),
    ];
    const wide = waitRows(ps, T, false);
    expect(wide.rows.map((p) => p.id)).toEqual(['w0', 'w1', 'w2', 'w3', 'w4']);
    expect([wide.total, wide.more]).toEqual([7, 2]);
    const phone = waitRows(ps, T, true);
    expect(phone.rows).toHaveLength(3);
    expect([phone.total, phone.more]).toEqual([7, 4]);
    // «N more» leads to People filtered to them: the same people there
    expect(
      scoped(ps, { group: 'need' }, T)
        .map((p) => p.id)
        .sort(),
    ).toEqual(
      waiting(ps, T)
        .map((p) => p.id)
        .sort(),
    );
    // few enough: nothing is left to People
    expect(waitRows(ps.slice(0, 4), T, false)).toMatchObject({ total: 2, more: 0 });
    expect(waitRows([person()], T, false)).toEqual({ rows: [], total: 0, more: 0 });
  });

  it("says a server card's numbers", () => {
    const srv = {
      id: 's1',
      enabled: true,
      up: true,
      rate: [
        [NOW - 120, 5, 50],
        [NOW - 60, 10, 100],
      ] as [number, number, number][],
      series: [
        { day: '2026-11-07', rx: 1, tx: 1 },
        { day: '2026-11-08', rx: 30, tx: 12 },
      ],
    };
    const st = { now: NOW, people: [person(), person({ id: 'p2' }), person({ id: 'p3', server: 's2' })] };
    expect(serverNumbers(srv, st, T.today)).toEqual({ people: 2, down: 100, today: 42 });
    // the last minute gone stale, a server that is off or down: no speed said
    expect(serverNumbers(srv, { ...st, now: NOW + 600 }, T.today).down).toBeNull();
    expect(serverNumbers({ ...srv, enabled: false }, st, T.today).down).toBeNull();
    expect(serverNumbers({ ...srv, up: false }, st, T.today).down).toBeNull();
    expect(serverNumbers({ ...srv, rate: [] }, st, T.today).down).toBeNull();
    // the newest day counted is not today: nothing moved today; no days at all: nothing said
    expect(serverNumbers(srv, st, '2026-11-09').today).toBe(0);
    expect(serverNumbers({ ...srv, series: [] }, st, T.today).today).toBeNull();
  });

  it('names the first devices of a rollout that still wait', () => {
    const item = (pid: string, did: string, stale: boolean) => ({
      p: person({ id: pid }),
      d: { id: did, name: did, config_stale: stale } as Device,
    });
    const items = [
      item('a', 'a1', true),
      item('a', 'a2', false),
      item('b', 'b1', true),
      item('c', 'c1', true),
      item('c', 'c2', true),
      item('d', 'd1', true),
      item('d', 'd2', true),
    ];
    const w = stillWaiting(items);
    expect(w.named.map((x) => x.d.id)).toEqual(['a1', 'b1', 'c1', 'c2']);
    expect([w.more, w.people]).toEqual([2, 4]);
    expect(stillWaiting(items.slice(0, 3))).toMatchObject({ more: 0, people: 2 });
    expect(stillWaiting([item('a', 'a2', false)])).toEqual({ named: [], more: 0, people: 0 });
  });

  it('names who moved most this month, only those who moved', () => {
    const ps = [
      person({ id: 'a', month: [5, 5] }),
      person({ id: 'b', month: [50, 1] }),
      person({ id: 'c' }),
      person({ id: 'd', month: [1, 0] }),
    ];
    expect(topMonth(ps).map((x) => [x.p.id, x.bytes])).toEqual([
      ['b', 51],
      ['a', 10],
      ['d', 1],
    ]);
    expect(topMonth([person()])).toEqual([]);
  });

  it('draws today as 24 bars, the hours to come empty', () => {
    const bars = hourBars([
      [10, 10],
      [0, 0],
      [30, 10],
    ]);
    expect(bars).toHaveLength(24);
    expect(bars.slice(0, 3).map((b) => b.share)).toEqual([0.5, 0, 1]);
    expect(bars[3]).toEqual({ share: null, bytes: 0 });
    expect(hourBars([]).every((b) => b.share === null)).toBe(true);
  });
});

describe("the watchdog's news and a server's state", () => {
  const sl = (o: Partial<ServiceLog['watchdog']>): ServiceLog => ({
    watchdog: { enabled: true, last: NOW, beat: NOW, now: NOW, targets: [], repairs: [], ...o },
    log: [],
  });
  it("says the watchdog's news, and nothing without it", () => {
    expect(systemNews(null)).toBeNull();
    expect(systemNews(sl({}))).toBeNull();
    expect(systemNews(sl({ beat: NOW - 600 }))).toEqual({ kind: 'quiet', minutes: 10 });
    expect(
      systemNews(
        sl({
          repairs: [
            { ts: NOW - 7200, id: 'up_s1', name: 'Tunnel' },
            { ts: NOW - 600, id: 'portal', name: 'Portal' },
            { ts: NOW - 90000, id: 'nft', name: 'Old' },
          ],
        }),
      ),
    ).toEqual({ kind: 'repair', ts: NOW - 600, name: 'Portal' });
    expect(systemNews(sl({ repairs: [{ ts: NOW - 90000, id: 'nft', name: 'Old' }] }))).toBeNull();
  });
  it('says whether a server runs', () => {
    expect(serverState({ enabled: false, up: false, uptime: 0 })).toEqual({ text: 'Turned off', tone: 'warn' });
    expect(serverState({ enabled: true, up: true, uptime: 0 })).toEqual({ text: 'Running', tone: 'ok' });
    expect(serverState({ enabled: true, up: true, uptime: 7200 }).tone).toBe('ok');
    expect(serverState({ enabled: true, up: false, uptime: 0, blocked: 'awg0 is taken' })).toEqual({ text: 'Can’t start', tone: 'bad' });
    expect(serverState({ enabled: true, up: false, uptime: 0 })).toEqual({ text: 'Not running', tone: 'bad' });
  });
});

describe("LuCI's side: the menu and the views", () => {
  const PKG = '../package/luci-app-dawnline';
  const menu = JSON.parse(fs.readFileSync(`${PKG}/root/usr/share/luci/menu.d/luci-app-dawnline.json`, 'utf8')) as Record<
    string,
    { title?: string; action: { type: string; path: string } }
  >;
  const main = fs.readFileSync('src/admin/main.ts', 'utf8');
  const exported = (main.match(/export \{([^}]*)\}/)?.[1] ?? '').split(',').map((s) => s.trim());

  it('opens Dawnline on Overview, one titled item with untitled sections', () => {
    expect(menu['admin/services/dawnline'].action).toEqual({ type: 'alias', path: 'admin/services/dawnline/overview' });
    expect(
      Object.entries(menu)
        .filter(([, n]) => n.title)
        .map(([k]) => k),
    ).toEqual(['admin/services/dawnline']);
  });

  it('has a view for every node, each on the one module and a factory of it', () => {
    for (const [key, node] of Object.entries(menu)) {
      if (node.action.type !== 'view') continue;
      const name = key.split('/').pop()!;
      expect(node.action.path).toBe(`dawnline/${name}`);
      const view = fs.readFileSync(`${PKG}/htdocs/luci-static/resources/view/dawnline/${name}.js`, 'utf8');
      expect(view).toContain("'require dawnline.app as app'");
      expect(view).toContain(`app.${name}()`);
      expect(exported).toContain(name);
    }
  });
});
