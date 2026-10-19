// A device's QR code, in the portal's round look: light dots on black on the
// dark theme, the same dots dark on white on a light one (shared/qr.ts).

import { qrSvg } from '../../shared/qr';
import { svg } from './layout';
import { isDark } from './theme';

export function qrCode(text: string): HTMLElement {
  const dark = isDark();
  return svg(qrSvg(text, 3, true, dark ? 'night' : 'day'), `dl-qr${dark ? '' : ' light'}`);
}
