import { describe, expect, it } from 'vitest';
import type { SettingsData, UpdatePolicy } from '../src/admin/api';
import { draftSections, settingsCount, stageSettings, withDraft } from '../src/admin/system/draft';

const upd = {
  check: true,
  interval: '1d',
  auto: false,
  mode: 'night',
  time: '04:00',
  targets: ['app'],
  keep: true,
  mirrors: false,
} as unknown as UpdatePolicy;
const set = (): SettingsData =>
  ({
    settings: { portal_redirect: '', domain: '', home_dns_fallback: '', portal_enabled: '' },
    effective: {
      portal_enabled: true,
      portal_port: 8443,
      portal_host: 'vpn.example',
      portal_alt: ['b.example'],
      hostnames: true,
      geo_enabled: false,
      updates: upd,
    },
    services: [],
    cert: null,
    tcp_taken: [],
    geo_cached: 0,
    logs: {
      policy: {
        keep_days: 30,
        max: 5000,
        categories: ['connections', 'people', 'problems'],
        persist: 'hourly',
        usage_days: 90,
        usage_months: 12,
      },
    },
  }) as unknown as SettingsData;

describe('router-wide settings that wait', () => {
  it('stages a value and lets go of one put back, whatever shape the router keeps it in', () => {
    const s = set();
    let d = stageSettings({}, s, { portal_port: '8444', geo_enabled: '1', log_keep_days: '7', update_auto: '1' });
    expect(d).toEqual({ portal_port: '8444', geo_enabled: '1', log_keep_days: '7', update_auto: '1' });
    expect(settingsCount(d)).toBe(4);
    expect([...draftSections(d)].sort()).toEqual(['history', 'portal', 'updates']);
    d = stageSettings(d, s, { portal_port: '8443', geo_enabled: '0', log_keep_days: '30', update_auto: '0' });
    expect(d).toEqual({});
    // a switch that is on by default (nothing stored) is not a change when turned on
    expect(stageSettings({}, s, { portal_enabled: '1' })).toEqual({});
    expect(stageSettings({}, s, { portal_enabled: '0' })).toEqual({ portal_enabled: '0' });
    // the categories are a set, the portal's addresses a list whose first is the main one
    expect(stageSettings({}, s, { log_category: ['problems', 'people', 'connections'] })).toEqual({});
    expect(stageSettings({}, s, { portal_host: 'b.example', portal_alt: ['vpn.example'] })).toEqual({
      portal_host: 'b.example',
      portal_alt: ['vpn.example'],
    });
    expect(stageSettings({}, s, { portal_host: 'vpn.example', portal_alt: ['b.example'] })).toEqual({});
    expect(stageSettings({}, s, { domain: 'home' })).toEqual({ domain: 'home' });
  });

  it('draws the router’s answer with what waits over it, each value where its section reads it', () => {
    const s = set();
    expect(withDraft(s, {})).toBe(s);
    const p = withDraft(s, {
      portal_port: '8444',
      portal_enabled: '0',
      portal_redirect: 'https://example.org',
      log_category: ['problems'],
      log_max: '1000',
      update_auto: '1',
      update_targets: ['app', 'packages'],
      domain: 'home',
    });
    expect(p.effective).toMatchObject({ portal_port: 8444, portal_enabled: false });
    expect(p.settings).toMatchObject({ portal_redirect: 'https://example.org', domain: 'home', portal_port: '8444' });
    expect(p.logs.policy).toMatchObject({ categories: ['problems'], max: 1000, keep_days: 30 });
    expect((p.effective.updates as UpdatePolicy).auto).toBe(true);
    expect((p.effective.updates as UpdatePolicy).targets).toEqual(['app', 'packages']);
    // the answer itself is not touched
    expect(s.effective.portal_port).toBe(8443);
    expect(s.logs.policy.categories).toHaveLength(3);
    expect(upd.auto).toBe(false);
  });

  it('falls back to the updater’s own policy when the settings do not carry one', () => {
    const s = set();
    delete (s.effective as { updates?: unknown }).updates;
    expect(stageSettings({}, s, { update_keep: '1' }, upd)).toEqual({});
    expect(stageSettings({}, s, { update_keep: '0' }, upd)).toEqual({ update_keep: '0' });
    expect((withDraft(s, { update_keep: '0' }, upd).effective.updates as UpdatePolicy).keep).toBe(false);
  });
});
