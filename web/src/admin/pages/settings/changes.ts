// A server's changes that wait to be applied, as Settings keeps them
// (servers/pending.ts is the model): every change of how the server works
// waits, the dock at the window's foot counts them (pending-dock.ts), and
// «Apply» makes them: when devices fetch their configuration again after
// them it asks once first, naming all of them (flows/server-change.ts); when
// none does, «Apply» is the whole confirmation. Every field goes in ONE
// server_update, then the calls that are not fields (the disguise, the
// interfaces' choice). What the router refused still waits.
//
// The router-wide settings (the portal, new people, updates, history) wait in
// the same dock (system/draft.ts is their model): no section of Settings
// saves on a press. They go in ONE settings_update with the same «Apply».

import { api, type SettingsData, type UpdatePolicy } from '../../api';
import { settingsCount, stageSettings, type SettingsDraft } from '../../system/draft';
import { fmt, plural } from '../../../shared/i18n';
import { say } from '../../shell/toast';
import { errorText, notify } from '../../ui/toast';
import { fieldsPatch, netPatch, stage, stagedOf, summary, unstage, type ChangeKind, type Staged } from '../../servers/pending';
import { askChanges, fetches } from '../../flows/server-change';
import type { MeshMode } from '../../../shared/types';
import type { ServerCtx } from './ctx';
import { saveInterfaces } from './networks';
import { pendingDock } from './pending-dock';

export interface ChangesHost {
  /** The picked server's context now (null: no server). */
  ctx(): ServerCtx | null;
  /** Read the router again (after anything was made on it). */
  reload(): Promise<void>;
  /** Draw the sections again (a change began or stopped waiting). */
  repaint(): void;
  /** Every change was applied: the rollout's strip is what to look at now. */
  applied(): void;
  /** The column the sections stand in: the dock sits over it. */
  column(): HTMLElement | null;
  /** The router-wide settings as the router has them, and the updater's policy (what a staged value is compared with). */
  settings?(): { set: SettingsData; upd?: UpdatePolicy } | null;
  /** The router took the staged settings: its answer, before the page reads everything again. */
  tookSettings?(set: SettingsData): void;
}

export class Changes {
  private list: Staged[] = [];
  /** «Apply» is being made (a second press waits for it). */
  private busy = false;
  private dock = pendingDock({ apply: () => void this.apply(), cancel: () => this.drop(), column: () => this.host.column() });

  constructor(private host: ChangesHost) {}

  /** The router-wide settings that wait (system/draft.ts). */
  private router: SettingsDraft = {};

  get count(): number {
    return this.list.length + settingsCount(this.router);
  }

  /** The router-wide settings that wait: the page draws the router's answer with them over it. */
  get settingsDraft(): SettingsDraft {
    return this.router;
  }

  /** Router-wide settings asked to be saved: they wait for «Apply» (one put back to what the router has stops waiting). */
  stageSettings(values: SettingsDraft) {
    const base = this.host.settings?.();
    if (!base) return;
    this.router = stageSettings(this.router, base.set, values, base.upd);
    this.host.repaint();
  }

  /** What waits, for a part's key (it is drawn again when this moves). */
  get all(): readonly Staged[] {
    return this.list;
  }

  staged(kind: ChangeKind): Staged | undefined {
    return stagedOf(this.list, kind);
  }

  unstage(kind: ChangeKind) {
    this.list = unstage(this.list, kind);
    this.host.repaint();
  }

  /** Let every change go without a repaint (the server they were made on is no longer the one on screen). */
  forget() {
    this.list = [];
  }

  /** «Cancel»: every field goes back to what the router has. */
  drop() {
    this.list = [];
    this.router = {};
    this.host.repaint();
  }

  /** Everything is let go without a repaint (the page is left). */
  leave() {
    this.list = [];
    this.router = {};
  }

  /** The dock follows what waits. */
  sync() {
    const c = this.host.ctx();
    const s = c ? summary(this.list, c.st.people, c.srv.id) : summary([], [], '');
    this.dock.sync({ ...s, changes: s.changes + settingsCount(this.router) });
  }

  /** A change of the server: it waits for «Apply», whatever it rewrites (the owner's rule: nothing by one press). */
  change(s: Staged) {
    if (!this.host.ctx()) return;
    this.list = stage(this.list, s);
    this.host.repaint();
  }

  /** Make `list` on the router, then read it again. Rejects with the router's reason; `left` holds what was not made by then. */
  private async commit(list: Staged[], left: Staged[] = []) {
    const c = this.host.ctx();
    if (!c) return;
    left.splice(0, left.length, ...list);
    const made = (of: (x: Staged) => boolean) => left.splice(0, left.length, ...left.filter((x) => !of(x)));
    try {
      const patch = fieldsPatch(list);
      if (patch) await api.serverUpdate(c.srv.id, patch);
      made((x) => !!x.values);
      const preset = list.find((x) => x.preset)?.preset;
      if (preset) await api.serverObfuscation(c.srv.id, preset);
      made((x) => !!x.preset);
      const net = netPatch(list);
      if (net) {
        if (!c.ifs) throw new Error(_('Loading interfaces…'));
        // the interfaces' choice carries who sees whom too: the one just saved, not the one read before it
        await saveInterfaces(c.srv.id, c.ifs, patch?.mesh ? { ...net, mesh: patch.mesh as MeshMode } : net);
      }
      made((x) => !!x.net);
      // the networks behind routers: a call a router, each applied by the router in full
      for (const x of list) for (const [id, nets] of Object.entries(x.behind ?? {})) await api.deviceNetworks(id, nets);
      made((x) => !!x.behind);
    } finally {
      // whatever was taken before a refusal is on the router now: the page shows it
      await this.host.reload();
    }
  }

  /** «Apply»: one rollout after one question naming every change; no question when no device fetches anything. */
  private async apply() {
    const c = this.host.ctx();
    const list = c ? this.list : [];
    const router = this.router;
    const n = list.length + settingsCount(router);
    if (!n) return;
    const s = c ? summary(list, c.st.people, c.srv.id) : summary([], [], '');
    const run = async () => {
      // the router's own settings first: refused, nothing of the server's was touched yet
      if (settingsCount(router)) {
        const set = await api.settingsUpdate(router);
        this.router = {};
        this.host.tookSettings?.(set);
        if (!list.length) await this.host.reload();
      }
      if (!list.length) return;
      const left: Staged[] = [];
      this.list = [];
      try {
        await this.commit(list, left);
      } catch (e) {
        // what the router did not take still waits
        this.list = left;
        this.host.repaint();
        throw e;
      }
    };
    const applied = plural(n, '%s change applied', '%s changes applied');
    if (!s.refetch.n && !s.refetch.fresh) {
      if (this.busy) return;
      this.busy = true;
      try {
        await run();
        say(applied);
      } catch (e) {
        notify(errorText(e), 'error', 10000);
      } finally {
        this.busy = false;
      }
      return;
    }
    if (!(await askChanges(list, s, run))) return;
    say(fmt(_('%s · %s'), applied, fetches(s.refetch.n)));
    this.host.applied();
  }
}
