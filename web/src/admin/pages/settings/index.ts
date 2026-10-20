// Settings: section cards, each with its own Save (applied immediately). A
// save rebuilds only its own card, so what is typed in the others stays.

import type { Backup, PortalInfo, SettingsData } from '../../api';
import { E } from '../../e';
import { api } from '../../api';
import { attempt } from '../../ui/toast';
import { mountCard, type Card, type CardId, type SettingsHost } from './common';
import { portalCard } from './portal';
import { defaultsCard } from './defaults';
import { mapCard } from './map';
import { updatesCard } from './updates';
import { logsCard } from './logs';
import { backupsSection } from './backups';
import { dangerCard } from './danger';

export class SettingsPage implements SettingsHost {
  d!: SettingsData;
  root = E('div', { class: 'dl-settings-main' });
  backups: Backup[] = [];
  portal: PortalInfo | null = null;
  portalFill?: (p: PortalInfo) => void;
  portalSeq = 0;
  cards = {} as Record<CardId, Card>;

  load() {
    return api.settingsGet();
  }

  render(d: SettingsData): HTMLElement {
    this.d = d;
    this.cards = {
      portal: mountCard(() => portalCard(this)),
      defaults: mountCard(() => defaultsCard(this)),
      map: mountCard(() => mapCard(this)),
      updates: mountCard(() => updatesCard(this)),
      logs: mountCard(() => logsCard(this)),
      backups: mountCard(() => backupsSection(this.backups, (all) => this.loadBackups(all))),
      danger: mountCard(() => dangerCard()),
    };
    const order: CardId[] = ['portal', 'defaults', 'map', 'updates', 'logs', 'backups', 'danger'];
    dom.content(
      this.root,
      order.map((k) => this.cards[k].el),
    );
    this.loadBackups().then(() => {
      if (new URLSearchParams(location.search).get('section') === 'backups')
        document.getElementById('dl-set-backups')?.scrollIntoView({ block: 'start' });
    });
    void this.loadPortal();
    // ?section=updates (from Components) and the like: open at that card.
    const sec = new URLSearchParams(location.search).get('section');
    if (sec && sec !== 'backups') requestAnimationFrame(() => document.getElementById(`dl-set-${sec}`)?.scrollIntoView({ block: 'start' }));
    return E('div', {}, [E('div', { class: 'dl-pagehead' }, [E('h2', { class: 'dl-h1' }, _('Settings'))]), this.root]);
  }

  async save(values: Record<string, string | string[]>, ok: string, card: CardId) {
    const r = await attempt(() => api.settingsUpdate(values), ok);
    if (!r) return;
    this.d = r;
    this.cards[card].refresh();
    if (card === 'portal') void this.loadPortal();
  }

  /** Fetch the portal's addresses and checks; the newest answer wins. */
  async loadPortal() {
    const seq = ++this.portalSeq;
    const p = await api.portalInfo().catch(() => null);
    if (seq !== this.portalSeq) return;
    this.portal = p ?? this.portal ?? { candidates: [], checks: [] };
    this.portalFill?.(this.portal);
  }

  async loadBackups(all = false) {
    if (all) await this.reload();
    const r = await api.backupList().catch(() => null);
    if (!r) return;
    this.backups = r.backups;
    this.cards.backups?.refresh();
  }

  async reload(card?: CardId) {
    const d = await api.settingsGet().catch(() => null);
    if (!d) return;
    this.d = d;
    if (card) this.cards[card].refresh();
    else for (const c of Object.values(this.cards)) c.refresh();
    if (!card || card === 'portal') void this.loadPortal();
  }
}
