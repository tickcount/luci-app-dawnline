// LuCI module `dawnline.style`: the pages' stylesheet (styles/shadow/index.css:
// the portal's own, then the admin's parts, made fit for a Shadow DOM by the
// build), as text, apart from the pages' code (main.ts) so neither file grows
// past the size the router serves comfortably uncompressed. Every view loads
// it alongside its data (shell/style.ts); LuCI fetches it once and caches it
// like every module.
//
// It also brings the pictures a page draws as soon as it stands, wanted exactly when the stylesheet is and too
// large for the pages' module, which is close to its budget: the admin's own glass shapes (ui/glass-shapes.ts), its
// line icons (ui/line-icons.ts) and the marks among them (AmneziaWG's on every server's glass and in Settings ›
// Updates, OpenWrt's on the system packages, WireGuard's on a router's own tunnel: about 8 KB).

import css from './styles/shadow/index.css';
import { LOGOS } from '../shared/logos';
import { SHAPES as glass } from './ui/glass-shapes';
import { LINES } from './ui/line-icons';

const icons = { ...LINES, amneziawg: LOGOS.amneziawg, wireguard: LOGOS.wireguard, openwrt: LOGOS.openwrt };

export { css, icons, glass };
