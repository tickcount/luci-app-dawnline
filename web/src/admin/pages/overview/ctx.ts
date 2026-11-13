// What Overview's parts read: the router's answer, the Health checks (null
// until the first run comes back), the service log with the watchdog, the
// router's clock, and what they may ask of the page (read again, run the
// checks again, run a check's own fix). Built by index.ts on every answer.

import type { HealthCheck, Status } from '../../../shared/types';
import type { ServiceLog } from '../../api';
import type { Today } from '../../people/lines';

export interface OverviewCtx {
  st: Status;
  /** The Health checks (null: not read yet, or this login could not). */
  checks: HealthCheck[] | null;
  /** The last run of the checks failed (the router did not answer it). */
  checksFailed: boolean;
  /** The service log and the watchdog (null: could not be read). */
  sl: ServiceLog | null;
  /** This login may change things (shell/role.ts). */
  write: boolean;
  /** The router's clock now (seconds). */
  now(): number;
  /** A server's speed to its devices as the live meter has it (bytes/s); null before it answered for it. */
  speedOf(id: string): number | null;
  /** The router's day and clock, for what is said about people. */
  today(): Today;
  /** Read the router again now (after a change made here). */
  reload(): Promise<void>;
  /** Run the Health checks again now and draw what they found. */
  recheck(): Promise<void>;
  /** Run a check's own fix (overview/model.ts ownFix); the checks come back with it. */
  fix(fix: string): Promise<void>;
}
