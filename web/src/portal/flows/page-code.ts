// This page on another device: a dropdown from the breadcrumb's QR knob (ui/drop.ts: placed, coming and going and
// shut as every dropdown is), the page's link as a code for a phone's camera, and under it Copy link (it says
// Copied for a moment) and Share where the system has it.

import { h, ic } from '../dom';
import { placeName, pageUrl } from '../state';
import { qrBox } from '../ui/codes';
import { appear, closeDrop, EDGE, GAP, opened, vanish } from '../ui/drop';
import { copy } from '../ui/feedback';

/** The card open now, to shut at once when its knob goes with the breadcrumb. */
let open: ((now?: boolean) => void) | null = null;

export const closePageCode = (now = false) => open?.(now);

export function showPageCode(knob: HTMLElement) {
  if (knob.getAttribute('aria-expanded') === 'true') return closeDrop();
  const url = pageUrl();
  const share = typeof navigator.share === 'function';
  const card = h(
    'div',
    { class: 'pc-card drop', role: 'dialog', 'aria-label': _('Open on another device') },
    qrBox(url, true),
    h(
      'div',
      { class: 'pc-row' },
      h(
        'button',
        {
          type: 'button',
          class: 'pc-copy',
          'aria-label': _('Copy the link'),
          onclick: (e: Event) => copy(url, _('Link copied'), e.currentTarget),
        },
        ic('link'),
        h('span', { class: 'lbl' }, _('Copy link')),
      ),
      share
        ? h(
            'button',
            {
              type: 'button',
              class: 'knob',
              'aria-label': _('Share the link'),
              onclick: () => navigator.share({ url, title: placeName() }).catch(() => undefined),
            },
            ic('share'),
          )
        : null,
    ),
  );
  document.body.append(card);
  // Under the knob where it fits, else over it; centred on it inside the screen's edge, growing from its side.
  const r = knob.getBoundingClientRect();
  const w = card.offsetWidth;
  const ht = card.offsetHeight;
  const mid = r.left + r.width / 2;
  const left = Math.max(EDGE, Math.min(mid - w / 2, innerWidth - EDGE - w));
  const below = r.bottom + GAP + ht <= innerHeight - EDGE || r.top - GAP - ht < EDGE;
  const top = below ? r.bottom + GAP : r.top - GAP - ht;
  Object.assign(card.style, {
    left: `${left + scrollX}px`,
    top: `${top + scrollY}px`,
    transformOrigin: `${mid - left}px ${below ? 0 : ht}px`,
  });
  appear(card);
  const release = opened(card, knob, close);
  open = close;

  function close(instant = false) {
    if (!release()) return;
    if (open === close) open = null;
    if (instant) card.remove();
    else vanish(card);
  }
}
