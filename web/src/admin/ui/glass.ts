// Glass icons for the pages: the portal's shapes (portal/ui/glass.ts),
// plus the objects the admin has a picture for and the portal does not,
// drawn the same way (portal glassOf). A picture draws the thing its place
// names, and one picture has one meaning (DESIGN.md › Glass icon catalogue);
// a named product (Dawnline, AmneziaWG, WireGuard, OpenWrt, GitHub) wears
// its own mark.

import { glass as portalGlass, glassOf, markShape, onPane, type GlassShape, type Tone } from '../../portal/ui/glass';
import { MARK_SHAPES } from '../../shared/mark';

const MORE: Record<string, GlassShape> = {
  // Dawnline's own: the sun over the horizon, a wide, low shape, grown to read at a row's 28 px
  dawnline: onPane(() => MARK_SHAPES, 0.5),
  // those that come with the stylesheet's module (style-module.ts) or are among the shared icons
  amneziawg: markShape('amneziawg'),
  wireguard: markShape('wireguard'),
  openwrt: markShape('openwrt'),
  github: markShape('github'),
};

/** The shapes the stylesheet's module brings (ui/glass-shapes.ts), added when it comes (shell/style.ts). */
export function addGlass(more: Record<string, GlassShape>) {
  Object.assign(MORE, more);
}

/** The portal's shapes the admin names by what they are here: the personal portal is a page in a browser window. */
const AS: Record<string, string> = { portal: 'browser' };

/** A glass icon: the admin's own shape where it has one, else the portal's. */
export function glass(name: string, tone: Tone = 'grey', cls = 'gi'): Element {
  const g = MORE[name];
  return g ? glassOf(g, tone, cls) : portalGlass(AS[name] ?? name, tone, cls);
}
