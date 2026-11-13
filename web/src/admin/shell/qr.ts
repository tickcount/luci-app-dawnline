// The QR generator's own LuCI module (qr-module.ts, `dawnline.qr`), loaded
// the first time a sheet draws a code and kept for the session (LuCI fetches
// it once, cached like every module). A sheet that will show a code asks for
// it while it waits for the router's answer (`loadQr()` beside the request),
// so the code is there when the sheet opens; `qrBox` holds the code's place
// until then. It brings the apps' marks too (the set-up sheet's app picker):
// a sheet that draws them waits for it.

import type * as Kit from '../qr-module';
import { h, markup } from '../../portal/dom';
import type { QrLook } from '../../shared/qr';
import { isDark } from '../ui/theme';
import { addIcons } from '../../shared/icons';
import { failureText } from '../failure';

type QrKit = typeof Kit;

let kit: Promise<QrKit> | null = null;

/** The generator; rejects with words for the page when it could not be loaded (it is asked again next time). */
export function loadQr(): Promise<QrKit> {
  kit ??= L.require('dawnline.qr').then(
    (m) => {
      addIcons((m as QrKit).logos);
      return m as QrKit;
    },
    () => {
      kit = null;
      throw new Error(_('Could not load the QR code. Reload the page to try again.'));
    },
  );
  return kit;
}

/** A large code in its box, in the theme's look; the box keeps its size while the generator is on its way. */
export function qrBox(text: string): HTMLElement {
  const dark = isDark();
  const look: QrLook = dark ? 'night' : 'day';
  const box = h('div', { class: `qrbox big${dark ? '' : ' light'}` });
  void loadQr().then(
    (k) => box.replaceChildren(markup(k.qrSvg(text, 3, true, look))),
    (e: unknown) => (box.title = failureText(e)),
  );
  return box;
}
