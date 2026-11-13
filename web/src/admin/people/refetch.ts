// ⟳N for a person's access: how many of their devices fetch their
// configuration again after a change (each enabled device that has connected
// and whose AllowedIPs or DNS the change rewrites, awg.uc allowed_ips and
// core.uc client_dns). Home only routes home networks and the router's DNS,
// so going to or from it rewrites every device; Internet ↔ both rewrites only
// the devices with LAN Bypass (the others carry everything either way). Pure.

import type { Person } from '../../shared/types';

/** The person's devices that would fetch again, for a change of these fields. */
export function refetchCount(p: Person, patch: { access?: Person['access']; dns_mode?: Person['dns_mode']; home_nets?: string[] }): number {
  const live = p.devices.filter((d) => d.handshake && !d.disabled);
  const access = patch.access ?? p.access;
  if (patch.access && patch.access !== p.access)
    return p.access === 'lan' || access === 'lan' ? live.length : live.filter((d) => d.lan_bypass).length;
  // The DNS only matters on Home only: the others keep the server's.
  if (patch.dns_mode && patch.dns_mode !== p.dns_mode) return access === 'lan' ? live.length : 0;
  if (patch.home_nets) return access === 'lan' ? live.length : access === 'both' ? live.filter((d) => d.lan_bypass).length : 0;
  return 0;
}
