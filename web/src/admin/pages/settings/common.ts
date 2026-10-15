// Settings: what every card shares — the card frame, a card that can be
// rebuilt on its own, and the page interface the cards use.

import type { PortalInfo, SettingsData } from '../../api';
import { E } from '../../e';

export type CardId = 'portal' | 'defaults' | 'map' | 'updates' | 'logs' | 'backups' | 'danger';

/** What a card gets from the Settings page. */
export interface SettingsHost {
  /** The settings as last loaded or saved. */
  readonly d: SettingsData;
  /** Portal addresses and checks (slow: they arrive after the page shows). */
  readonly portal: PortalInfo | null;
  /** Fills the portal card on screen with fresh `portal` without touching what was typed. */
  portalFill?: (p: PortalInfo) => void;
  /** Save `values`; afterwards only `card` is rebuilt (the others keep what was typed). */
  save(values: Record<string, string | string[]>, ok: string, card: CardId): Promise<void>;
  /** Load the settings again and rebuild `card` (every card when not given). */
  reload(card?: CardId): Promise<void>;
  /** The backups list again (and, after a restore, everything). */
  loadBackups(all?: boolean): Promise<void>;
}

/** A card that can be rebuilt in place from the current settings. */
export interface Card {
  el: HTMLElement;
  refresh(): void;
}

export function mountCard(build: () => HTMLElement): Card {
  const c: Card = {
    el: build(),
    refresh() {
      const n = build();
      c.el.replaceWith(n);
      c.el = n;
    },
  };
  return c;
}

/** A dl-setsec card with its id (for ?section=…), title, body and footer; `head` goes next to the title. */
export function section(
  id: string,
  title: string,
  body: (Node | string)[],
  foot: Node[],
  extra = '',
  head: (Node | string)[] = [],
): HTMLElement {
  return E('section', { class: `dl-setsec ${extra}`, id: `dl-set-${id}` }, [
    E('div', { class: 'dl-setsec-body' }, [
      head.length
        ? E('div', { class: 'dl-setsec-head' }, [E('h3', {}, title), E('span', { class: 'dl-spacer' }), ...head])
        : E('h3', {}, title),
      ...body,
    ]),
    foot.length ? E('div', { class: 'dl-setsec-foot' }, foot) : '',
  ]);
}
