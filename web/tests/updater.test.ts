import { beforeAll, describe, expect, it } from 'vitest';
import { El, installFakeDom } from './fakedom';
import { checkVerdict, isOurJob, jobComponent, jobIcon, jobTitle, verText } from '../src/admin/updater/jobs';
import { forRouter, markdown, safeHref } from '../src/admin/updater/markdown';
import type { UpdatesStatus } from '../src/admin/api';

beforeAll(installFakeDom);

describe('jobs', () => {
  it('names the component of a job', () => {
    expect(jobComponent('app@0.3.1')).toBe('app');
    expect(jobComponent('check:amneziawg')).toBe('amneziawg');
    expect(jobComponent('check')).toBe('all');
    expect(jobComponent('pkgs:a,b')).toBe('pkgs');
    expect(jobComponent('amneziawg:auto')).toBe('amneziawg');
  });
  it('shows versions', () => {
    expect(verText({ from: '0.3.0', to: '0.3.1' }, 'x')).toBe('0.3.0 → 0.3.1');
    expect(verText({ from: null, to: null }, 'x')).toBe('x');
    expect(verText({ from: '1', to: '1' }, 'x')).toBe('1');
  });
  it('accepts only the job this click started', () => {
    const since = 1000;
    // The previous job, finished: never.
    expect(isOurJob({ id: 'old', state: 'done', started: 900 }, undefined, 'old', since)).toBe(false);
    // A finished job from before the click without a known previous id: no.
    expect(isOurJob({ id: 'x', state: 'done', started: 900 }, undefined, undefined, since)).toBe(false);
    // Running, or started at/after the click: yes.
    expect(isOurJob({ id: 'new', state: 'running', started: 999 }, undefined, 'old', since)).toBe(true);
    expect(isOurJob({ id: 'new', state: 'done', started: 1001 }, undefined, 'old', since)).toBe(true);
    // Once the id is known, only that one.
    expect(isOurJob({ id: 'other', state: 'running', started: 1001 }, 'new', 'old', since)).toBe(false);
  });
  it('sums up a check as a row a component', () => {
    const st = (components: Record<string, unknown>) => ({ check: { time: 1, components } }) as unknown as UpdatesStatus;
    // one component with an update: its versions, and the version on offer for the sheet's own button
    expect(checkVerdict(st({ app: { update: true, installed: '0.3.0', latest: '0.3.1' } }), 'app')).toEqual({
      tone: 'new',
      title: 'There is an update',
      rows: [{ icon: 'dawnline', name: 'Dawnline', tone: 'new', line: '0.3.0 → 0.3.1', mono: true }],
      update: '0.3.1',
    });
    // all of them: a row each, the title counts what has an update, and no single version is on offer
    const all = checkVerdict(
      st({ app: { installed: '0.3.1' }, amneziawg: { update: true, installed: '1.0', latest: '1.1' }, packages: { updates: 2 } }),
      'all',
    );
    expect(all.tone).toBe('new');
    expect(all.title).toBe('There are updates');
    expect(all.update).toBeUndefined();
    expect(all.rows.map((r) => [r.icon, r.tone, r.line])).toEqual([
      ['dawnline', 'ok', '0.3.1'],
      ['amneziawg', 'new', '1.0 → 1.1'],
      ['openwrt', 'new', '2 updates'],
    ]);
    // a check that failed is the worst of it, whatever the others found
    const failed = checkVerdict(
      st({ app: { error: 'GitHub is unreachable' }, amneziawg: { update: true, installed: '1.0', latest: '1.1' } }),
      'all',
    );
    expect(failed.tone).toBe('bad');
    expect(failed.title).toBe('Not everything was checked');
    expect(failed.rows[0]).toMatchObject({ tone: 'bad', line: 'GitHub is unreachable' });
    expect(checkVerdict(st({ app: { error: 'GitHub is unreachable' } }), 'app').title).toBe('The check failed');
    expect(checkVerdict(st({ app: { status: 'dev', installed: '0.4.0', latest: '0.3.0' } }), 'app').rows[0].line).toContain(
      'Newer than the release',
    );
    expect(checkVerdict(st({ amneziawg: {} }), 'amneziawg').rows[0]).toMatchObject({ tone: 'quiet', line: 'Not installed' });
    expect(checkVerdict(st({ app: { installed: '1' }, amneziawg: { installed: '2' }, packages: {} }), 'all')).toMatchObject({
      tone: 'ok',
      title: 'Everything is up to date',
    });
    expect(checkVerdict(st({ app: { installed: '1' } }), 'app').title).toBe('Latest version is installed');
  });
  it('draws a job by its component', () => {
    expect(jobIcon('app')).toBe('dawnline');
    expect(jobIcon('amneziawg')).toBe('amneziawg');
    expect(jobIcon('pkgs')).toBe('openwrt');
    expect(jobIcon('all')).toBe('update');
  });
  it('titles a job found running', () => {
    expect(jobTitle({ action: 'check', component: 'all' })).toBe('Checking all components');
    expect(jobTitle({ action: 'check', component: 'amneziawg' })).toBe('Checking AmneziaWG');
    expect(jobTitle({ action: 'update', component: 'app@v0.3.1' })).toBe('Updating Dawnline');
    expect(jobTitle({ action: 'update', component: 'app:nolang' })).toBe('Removing the Russian translation');
    expect(jobTitle({ action: 'update', component: 'app:lang:ru' })).toBe('Adding the Russian translation');
    expect(jobTitle({ action: 'update', component: 'amneziawg:slava:ru' })).toBe('Updating AmneziaWG');
    expect(jobTitle({ action: 'update', component: 'pkgs:ip-full' })).toBe('Updating system packages');
  });
});

describe('release notes', () => {
  it('drops the What’s new heading and the Install section', () => {
    const md = "## What's new\n- One\n- Two\n\n## Install\nopkg install x\n\n**Full Changelog**: a...b";
    expect(forRouter(md)).toBe('- One\n- Two\n\n**Full Changelog**: a...b');
  });
  it('builds headings, lists, code, bold and safe links', () => {
    const out = markdown('# Title\n- `code` and **bold**\n- [site](https://example.com)\n\nSee javascript:alert(1)') as unknown as El[];
    expect(out.map((n) => n.tag)).toEqual(['h5', 'ul', 'p']);
    const items = out[1].children as El[];
    expect(items[0].children.map((c) => (typeof c === 'string' ? c : c.tag))).toEqual(['code', ' and ', 'b']);
    const a = items[1].children[0] as El;
    expect(a.tag).toBe('a');
    expect(a.attrs.href).toBe('https://example.com');
    // Not a link: only http(s) addresses become one.
    expect(out[2].children).toEqual(['See javascript:alert(1)']);
  });
  it('keeps fenced code as it is', () => {
    const out = markdown('```\n# not a heading\n```') as unknown as El[];
    expect(out[0].tag).toBe('pre');
    expect(out[0].textContent).toBe('# not a heading');
  });
  it('allows only https release pages', () => {
    expect(safeHref('https://github.com/x/y/releases/tag/v1')).toBe('https://github.com/x/y/releases/tag/v1');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('http://example.com')).toBeNull();
    expect(safeHref(null)).toBeNull();
  });
});
