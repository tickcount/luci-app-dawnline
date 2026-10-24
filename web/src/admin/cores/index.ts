// Tunnel cores by id. A server names its core (`core`, AmneziaWG when absent);
// the Server, device and person pages ask the registry instead of importing a
// core directly, so another core (VLESS/Xray) plugs in here.

import type { Server } from '../../shared/types';
import type { Core } from './common';
import { awg } from './awg';

export type { Core } from './common';

const CORES: Record<string, Core> = { awg };

/** The core of a server (or of the server a person is on). */
export function coreOf(srv?: Pick<Server, 'core'> | null): Core {
  return CORES[srv?.core || 'awg'] ?? awg;
}

/** The core of a person's server. */
export function coreFor(servers: Server[], serverId: string): Core {
  return coreOf(servers.find((s) => s.id === serverId));
}
