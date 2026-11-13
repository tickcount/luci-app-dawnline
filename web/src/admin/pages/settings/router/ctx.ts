// What Settings' router-wide sections (Updates, Personal portal, New people,
// History and storage, Backups, Remove Dawnline) read: the router's answers
// (status, settings, updates, backups), the slower ones once they arrive
// (the Health checks, the portal's addresses), and what they may ask of the
// page. Built by the Settings page on every answer.

import type { HealthCheck, Status } from '../../../../shared/types';
import type { Backup, PortalInfo, SettingsData, UpdatesStatus } from '../../../api';
import type { Operation } from '../../../flows/operation';

export interface RouterCtx {
  st: Status;
  set: SettingsData;
  upd: UpdatesStatus;
  backups: Backup[];
  /** The Health checks (null: not read yet, or this login could not). */
  checks: HealthCheck[] | null;
  /** The addresses the router found for the portal, and the portal's own checks (null: not read yet). */
  portal: PortalInfo | null;
  /** This login may change things (shell/role.ts). */
  write: boolean;
  /** The router's clock now (seconds). */
  now(): number;
  /**
   * Values of settings_update a section asks to save: they wait for «Apply» in the dock, and the section is drawn
   * with them over the router's answer (system/draft.ts). The router's reason for a refusal comes on «Apply».
   */
  save(values: Record<string, string | string[]>): Promise<void>;
  /** Read everything again now (after a change made here or in a sheet). */
  reload(): Promise<void>;
  /** Run a Health check's fix (an install in its sheet, a restart asked first), then the checks come back with it. */
  fix(fix: string): Promise<void>;
  /** An updater job is running (another cannot start). */
  busy(): boolean;
  /**
   * An updater job in the sheet, Dawnline's own included; the page reads the router again after it. Refused with a
   * toast while one runs.
   */
  op(o: Omit<Operation, 'done'>): void;
}
