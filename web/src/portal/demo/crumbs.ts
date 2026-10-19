// What the demo adds to the breadcrumb: the scenario chip right after the path,
// and a GitHub pill just before the page's QR knob (at the end where there is
// none: a card alone). On a phone the pill would crowd out the names, so it
// gives way to a button in the scenario drawer (demo.css). The portal redraws
// the breadcrumb with the page and knows nothing of either, so both go back in
// place after each redraw.

import { h, ic } from '../dom';
import { REPO } from './data';
import { scenarioChip } from './picker';
import type { DemoRouter } from './router';

export function mountCrumbs(router: DemoRouter) {
  const app = document.getElementById('app')!;
  const chip = scenarioChip(router);
  const gh = h(
    'a',
    { class: 'dm-gh', href: REPO, target: '_blank', rel: 'noopener', 'aria-label': 'Dawnline on GitHub' },
    ic('github'),
    h('span', {}, 'GitHub'),
  );
  // Our own insertions call this again: by then both are in place and nothing moves.
  const keep = () => {
    const crumbs = app.querySelector('.crumbs');
    const path = crumbs?.querySelector('.cr-path');
    if (!crumbs || !path) return;
    if (path.nextElementSibling !== chip) path.after(chip);
    const qr = crumbs.querySelector('.cr-qr');
    if (qr && qr.previousElementSibling !== gh) qr.before(gh);
    else if (!qr && crumbs.lastElementChild !== gh) crumbs.append(gh);
  };
  new MutationObserver(keep).observe(app, { childList: true, subtree: true });
  keep();
}
