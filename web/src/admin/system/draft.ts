// The router-wide settings that wait to be applied (Settings: the portal, new
// people, updates, history). No section saves on a press: what it asks to
// save is staged here, the page draws the router's answer with the staged
// values over it (each where its section reads it: the settings as typed,
// the effective values, the log's policy, the update policy), the dock
// counts them with a server's own changes, and «Apply» sends them in ONE
// settings_update. A value put back to what the router has stops waiting.
// Pure: no DOM.

import type { SettingsData, UpdatePolicy } from '../api';

export type SettingsDraft = Record<string, string | string[]>;

/** The sections of Settings a staged key belongs to. */
export type DraftSection = 'portal' | 'updates' | 'history' | 'defaults';

/** Keys of the log's policy (SettingsData.logs.policy) by the setting that saves them. */
const LOG = {
  log_max: 'max',
  log_keep_days: 'keep_days',
  log_persist: 'persist',
  log_category: 'categories',
  usage_keep_days: 'usage_days',
  usage_keep_months: 'usage_months',
} as const;

/** Keys of the update policy (effective.updates) by the setting that saves them. */
const UPD = {
  update_check: 'check',
  update_interval: 'interval',
  update_auto: 'auto',
  update_mode: 'mode',
  update_time: 'time',
  update_targets: 'targets',
  update_keep: 'keep',
  update_mirrors: 'mirrors',
} as const;

/** Lists where the order says nothing (the others, the portal's addresses, are ordered: the first is the main one). */
const SETS = new Set(['log_category', 'update_targets']);

const has = <T extends object>(o: T, k: string): k is Extract<keyof T, string> => Object.prototype.hasOwnProperty.call(o, k);

/** A staged value as the router answers one of that kind (a switch is true or false, a count a number). */
const like = (was: unknown, v: string | string[]): unknown =>
  Array.isArray(v) ? v : typeof was === 'boolean' ? v === '1' : typeof was === 'number' ? Number(v) : v;

/** A value in the words settings_update takes. */
const text = (x: unknown, k: string): string =>
  Array.isArray(x) ? (SETS.has(k) ? [...x].sort() : x).join('\n') : typeof x === 'boolean' ? (x ? '1' : '0') : x == null ? '' : String(x);

const policyOf = (set: SettingsData, upd?: UpdatePolicy): UpdatePolicy | undefined =>
  (set.effective as { updates?: UpdatePolicy }).updates ?? upd;

/** Whether `v` is what the router has for `k` already. */
function same(set: SettingsData, k: string, v: string | string[], upd?: UpdatePolicy): boolean {
  const t = text(v, k);
  if (has(LOG, k)) return t === text(set.logs.policy[LOG[k]], k);
  if (has(UPD, k)) return t === text(policyOf(set, upd)?.[UPD[k]], k);
  const eff = set.effective[k];
  // a switch or a list: what is in effect is the truth (the stored value may be empty, meaning the default)
  if (typeof eff === 'boolean' || Array.isArray(eff)) return t === text(eff, k);
  if (k in set.settings) return t === text(set.settings[k], k);
  return eff !== undefined && t === text(eff, k);
}

/** `draft` with `values` over it, without what the router has already. */
export function stageSettings(draft: SettingsDraft, set: SettingsData, values: SettingsDraft, upd?: UpdatePolicy): SettingsDraft {
  const next: SettingsDraft = { ...draft, ...values };
  for (const k of Object.keys(next)) if (same(set, k, next[k], upd)) delete next[k];
  return next;
}

export const settingsCount = (d: SettingsDraft): number => Object.keys(d).length;

/** The section a staged key is set in. */
const sectionOf = (k: string): DraftSection =>
  k.startsWith('portal_') ? 'portal' : k.startsWith('update_') ? 'updates' : /^(log_|usage_|geo_)/.test(k) ? 'history' : 'defaults';

export const draftSections = (d: SettingsDraft): Set<DraftSection> => new Set(Object.keys(d).map(sectionOf));

/** The router's answer as the page draws it while `d` waits: every staged value where its section reads it. */
export function withDraft(set: SettingsData, d: SettingsDraft, upd?: UpdatePolicy): SettingsData {
  if (!settingsCount(d)) return set;
  const settings = { ...set.settings };
  const effective: Record<string, unknown> = { ...set.effective };
  const policy: Record<string, unknown> = { ...set.logs.policy };
  let updates: Record<string, unknown> | null = null;
  for (const [k, v] of Object.entries(d)) {
    if (has(LOG, k)) policy[LOG[k]] = like(policy[LOG[k]], v);
    else if (has(UPD, k)) {
      updates ??= { ...policyOf(set, upd) };
      updates[UPD[k]] = like(updates[UPD[k]], v);
    } else {
      if (!Array.isArray(v)) settings[k] = v;
      if (k in effective) effective[k] = like(effective[k], v);
    }
  }
  if (updates) effective.updates = updates;
  return { ...set, settings, effective, logs: { ...set.logs, policy: policy as SettingsData['logs']['policy'] } };
}
