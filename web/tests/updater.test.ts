import { beforeAll, describe, expect, it } from 'vitest';
import { El, installFakeDom } from './fakedom';
import { checkVerdict, isOurJob, jobComponent, verText } from '../src/admin/updater/jobs';
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
  it('sums up a check', () => {
    const st = (components: Record<string, unknown>) => ({ check: { time: 1, components } }) as unknown as UpdatesStatus;
    expect(checkVerdict(st({ app: { update: true, installed: '0.3.0', latest: '0.3.1' } }), 'app')).toEqual({
      tone: 'acc',
      text: 'Update available: Dawnline 0.3.1',
      update: '0.3.1',
    });
    expect(checkVerdict(st({ app: {}, amneziawg: {}, packages: { updates: 2 } }), 'all').text).toBe('Update available: 2 system packages');
    expect(checkVerdict(st({ app: { error: 'GitHub is unreachable' } }), 'app')).toEqual({ tone: 'warn', text: 'GitHub is unreachable' });
    expect(checkVerdict(st({ app: { status: 'dev', latest: '0.3.0' } }), 'app').text).toContain('newer than the release');
    expect(checkVerdict(st({ app: {}, amneziawg: {}, packages: {} }), 'all')).toEqual({ tone: 'ok', text: 'Everything is up to date' });
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
