// What the admin's device flows ask (add a device, new keys), on the portal's
// own form parts (portal/flows/device-form.ts: the kind tiles, the LAN Bypass
// switch) in the admin's voice: the portal speaks to the device's owner
// ("your local network"), the admin sets up someone else's device.

import type { Person, Server } from '../../shared/types';
import { lanSwitch } from '../../portal/flows/device-form';
import { homeOf } from '../../shared/format';

/** LAN Bypass as the admin sees it: the device's own local network, its home networks excepted. */
export function adminLan(p: Person, srv: Server | undefined, on: boolean, onChange: (on: boolean) => void): HTMLElement {
  const row = lanSwitch(on, homeOf(p, srv), onChange);
  const said = row.querySelector<HTMLElement>('.sw-t > .sw-sub:not(.sw-note)');
  if (said) said.textContent = _('The device’s local network stays reachable while connected.');
  return row;
}
