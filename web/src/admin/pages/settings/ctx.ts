// What the sections of a server's path read: the router's answer and the
// server in it, its Health checks by stage, its interfaces, the service log,
// the changes that wait to be applied, and what they may ask of the page.
// Built by index.ts on every answer.

import type { HealthCheck, Server, Status } from '../../../shared/types';
import type { InterfacesData, ServiceLogEntry } from '../../api';
import type { StageId, StageState } from '../../servers/path';
import type { ChangeKind, Staged } from '../../servers/pending';

export interface ServerCtx {
  st: Status;
  srv: Server;
  /** The Health checks (null: not read yet, or this login could not). */
  checks: HealthCheck[] | null;
  /** The checks that did not pass, by stage, and each stage's state. */
  failed: Record<StageId, HealthCheck[]>;
  states: Record<StageId, StageState>;
  /** Its interfaces (null: not read yet). */
  ifs: InterfacesData | null;
  log: ServiceLogEntry[];
  /** This login may change things (shell/role.ts). */
  write: boolean;
  /** The router's clock now (seconds). */
  now(): number;
  /** server_update with these values at once (its name, turning it on), then the page reads the router again. */
  update(values: Record<string, unknown>): Promise<void>;
  /** A change of how the server works: it waits with the others for «Apply» at the page's foot (servers/pending.ts). */
  change(s: Staged): void;
  /** The change of this kind that waits, if any: its field shows it. */
  staged(kind: ChangeKind): Staged | undefined;
  /** Take the waiting change of this kind back (its field returned to what the server has). */
  unstage(kind: ChangeKind): void;
  /** Read everything again now (after a change made elsewhere on the page). */
  reload(): Promise<void>;
  /** Run a Health check's fix, then read the checks again. */
  fix(fix: string): Promise<void>;
  /** The page's newest context (a sheet left open outlives the drawing that opened it). */
  current(): ServerCtx;
}
