// What the parts of a person's and a device's panel read (pages/people): the
// router's answer and the object in it, its events and days, and what they may
// ask of the page. Types only: built by the panels on every answer, read by
// their parts, the widgets (term, traffic, reach, the set-up card) and
// the one-tap actions (flows/person-acts.ts).

import type { ClientConfig, DayUsage, Device, LogEvent, Person, Server, Status } from '../../shared/types';
import type { PersonPatch, ServiceLogEntry } from '../api';

/** What a one-tap action needs of the page it is done on. */
export interface ActCtx {
  st(): Status;
  /** The router's day and clock. */
  today(): string;
  now(): number;
  /** Read the router again and draw what changed. */
  reload(): Promise<void>;
  /** The data limit for a whole term: where it is changed (their panel's Traffic block). */
  limit?(p: Person): void;
}

export interface PersonCtx {
  st: Status;
  p: Person;
  srv?: Server;
  /** Their events of the last 30 days, oldest first. */
  events: LogEvent[];
  /** Their traffic a day, the last 31 days (the router's days), oldest first. */
  days: DayUsage[];
  /** This login may change things (shell/role.ts). */
  write: boolean;
  /** The router's day. */
  today: string;
  /** The router's clock now (seconds). */
  now(): number;
  /**
   * Save a change at once and draw it; `said`: the toast. Resolves with whether the router took it (a refusal is
   * said in a toast too).
   */
  patch(patch: PersonPatch, said?: string): Promise<boolean>;
  /** The one-tap actions (flows/person-acts.ts). */
  acts: ActCtx;
}

export interface DeviceCtx {
  st: Status;
  p: Person;
  d: Device;
  srv?: Server;
  /** The device's and its person's events of the last 30 days, oldest first. */
  events: LogEvent[];
  system: ServiceLogEntry[];
  /** Its configuration as it stands (a look, not an issue), for its public key; null for a read-only login. */
  cfg: ClientConfig | null;
  /** This login may change things (shell/role.ts). */
  write: boolean;
  /** The router's clock now (seconds). */
  now(): number;
  /** Read the router again and draw what changed. */
  refresh(): Promise<void>;
}
