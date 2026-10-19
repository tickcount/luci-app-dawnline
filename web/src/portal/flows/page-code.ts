// This page on another device: from the breadcrumb, its link as a code for a
// phone's camera, and the link itself to copy or share.

import { h } from '../dom';
import { pageUrl } from '../state';
import { linkRow, qrBox } from '../ui/codes';
import { head, openSheet, sub } from '../ui/sheet';

export function showPageCode() {
  openSheet(() => {
    const url = pageUrl();
    const el = h(
      'div',
      { class: 'view' },
      head('Open on another device'),
      sub('Point its camera at the code: this page opens there.'),
      qrBox(url, true),
      linkRow(url),
    );
    return { el, label: 'Open on another device' };
  });
}
