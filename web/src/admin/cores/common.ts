// What every tunnel core gives the admin (cores/index.ts holds the registry),
// what a core's settings card gets from the Server page, and that card's head.

import type { ClientConfig, Server, Status } from '../../shared/types';
import { E } from '../e';

/** What the Server page hands a core's settings card. */
export interface CoreCtx {
  st: Status;
  /** server_update with these values, then refresh. */
  save: (values: Record<string, unknown>, ok?: string) => Promise<void>;
  refresh: () => Promise<void>;
}

/** A tunnel core (AmneziaWG today): its name and the pieces of the admin that differ per core. */
export interface Core {
  id: string;
  /** "AmneziaWG": the server section, the address bar, the settings card. */
  label: string;
  /** Server → <label>: the core's own settings. */
  settingsCard(ctx: CoreCtx, srv: Server): HTMLElement;
  /** Overview: how the tunnel looks on the wire (the disguise tile). */
  overviewTile(srv: Server): HTMLElement;
  /** How a device connects: file / key / QR. */
  connectBlock(cfg: ClientConfig, initial?: 'file' | 'key' | 'qr'): Promise<HTMLElement>;
  /** What a QR code for the device carries. */
  qrText(cfg: ClientConfig): string;
  /** The key the device's app imports (⋯ → Copy key), with the menu label. */
  appKey?: { label: string; make(cfg: ClientConfig): Promise<string> };
  /** The config file the device imports, with the menu label. */
  file: { label: string; make(cfg: ClientConfig): { name: string; text: string } };
}

/** Name and a short line: the head of a core's settings card (the server's header already says whether it runs). */
export function coreHead(title: string, sub: string): HTMLElement {
  return E('div', { class: 'dl-corehead' }, [E('h3', {}, title), sub ? E('span', { class: 'dl-sub' }, sub) : '']);
}
