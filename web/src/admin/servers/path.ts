// How a connection to a server goes, stage by stage (the concept's server
// path): the devices, the disguise, the way in (address and port), the tunnel,
// and then the internet or home. Each stage takes the Health checks that are
// about it, by their ids (health.uc: `<check>_<server id>` for a server's own,
// plain ids for the router's), and what the status says (the tunnel down, the
// router's public address changed, the home-like link failing). Pure: no DOM.

import type { HealthCheck, Server, Status } from '../../shared/types';
import { isIpv4 } from '../netcheck';

const STAGES = ['devices', 'disguise', 'entry', 'tunnel', 'internet', 'home'] as const;
export type StageId = (typeof STAGES)[number];

/** The Health checks of each stage: a server's own (with its id) and the router's (plain). */
const OWN: Record<StageId, string[]> = {
  devices: [],
  disguise: [],
  entry: ['ep', 'port', 'fw', 'reply'],
  tunnel: ['up', 'peers', 'subnet'],
  internet: ['home'],
  home: ['homenet', 'sites'],
};
const ROUTER: Record<StageId, string[]> = {
  devices: [],
  disguise: ['awg'],
  entry: [],
  tunnel: ['nft'],
  internet: ['policy'],
  home: ['resolver'],
};

export type StageState = 'ok' | 'warn' | 'bad' | 'off';

/** The stage a check is about on this server, or null: another server's, or not about a stage. */
export function stageOf(id: string, srv: string): StageId | null {
  for (const s of STAGES) if (ROUTER[s].includes(id) || OWN[s].some((k) => id === `${k}_${srv}`)) return s;
  return null;
}

/** The checks that did not pass, by stage (a skipped one is no finding). */
export function stageChecks(checks: HealthCheck[], srv: string): Record<StageId, HealthCheck[]> {
  const out = Object.fromEntries(STAGES.map((s) => [s, [] as HealthCheck[]])) as Record<StageId, HealthCheck[]>;
  for (const c of checks) {
    if (c.status !== 'warn' && c.status !== 'error') continue;
    const s = stageOf(c.id, srv);
    if (s) out[s].push(c);
  }
  return out;
}

/** The router's public IPv4 moved away from the one the server gives devices (a fixed IP, not a name). */
export const wanMoved = (st: Pick<Status, 'wan'>, srv: Server): boolean => !!st.wan && isIpv4(srv.endpoint) && srv.endpoint !== st.wan;

/**
 * Each stage's state: a server turned off is off along its way; otherwise the worst of its checks, and what the
 * status already says (a tunnel that does not run, a public address left behind, the home-like link failing).
 */
export function stageStates(
  st: Pick<Status, 'wan' | 'like_home'>,
  srv: Server,
  failed: Record<StageId, HealthCheck[]>,
): Record<StageId, StageState> {
  const out = {} as Record<StageId, StageState>;
  for (const s of STAGES) {
    if (!srv.enabled) {
      out[s] = 'off';
      continue;
    }
    const cs = failed[s];
    out[s] = cs.some((c) => c.status === 'error') ? 'bad' : cs.length ? 'warn' : 'ok';
  }
  if (!srv.enabled) return out;
  if (srv.blocked || !srv.up) out.tunnel = 'bad';
  if (wanMoved(st, srv) && out.entry === 'ok') out.entry = 'warn';
  if (srv.lan_like && st.like_home.error && out.internet === 'ok') out.internet = 'warn';
  return out;
}
