// LuCI module `dawnline.qr`: the QR code generator (shared/qr.ts with the
// qrcode-generator library, about 21 KB), apart from the pages' module
// (main.ts) so that one stays under its budget. A code is drawn only inside
// a sheet (a device's set-up, an invite), which asks the router first: the
// module is loaded on demand alongside that answer (shell/qr.ts: L.require).
// It also brings the AmneziaVPN mark the set-up sheet's app picker draws,
// the only place the pages draw it (about 4 KB; AmneziaWG's comes with the
// stylesheet, style-module.ts). It is pure: no state of the pages', nothing
// to hand in.

import { qrSvg } from '../shared/qr';
import { LOGOS } from '../shared/logos';

/** The app's mark the set-up sheet draws (its app picker): the pages add it to their icons (shell/qr.ts). */
const logos = { amnezia: LOGOS.amnezia };

export { qrSvg, logos };
