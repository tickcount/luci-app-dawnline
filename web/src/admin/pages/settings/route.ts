// Where Settings is, as its address says it (?p=): the router's own sections
// are shown one at a time and `p` names the one on screen. Pure.

import { ROUTER_SECTIONS } from '../../shell/routes';

/** The router's own sections, each a view of its own. */
export type RouterPart = (typeof ROUTER_SECTIONS)[number];

/** The section a query names; none, or one that does not exist: Updates. */
export function partOf(query: string): RouterPart {
  const p = new URLSearchParams(query).get('p') ?? '';
  return (ROUTER_SECTIONS as readonly string[]).includes(p) ? (p as RouterPart) : 'updates';
}
