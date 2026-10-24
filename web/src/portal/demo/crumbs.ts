// What the demo adds to the page: "Demo" (it opens the scenarios) and a link to
// GitHub, one split pill. Wide, the pill stands in the breadcrumb just before the
// page's language. On a phone the breadcrumb has no room for it, so it is a dock
// of its own at the bottom right, in <body>, outside the page: the page's
// entrance and a scenario's swap move the page with a transform and a filter,
// which would carry a fixed child along and leave its glass undrawn until they
// end. Over a card alone (no language) only the chip, right after the place, and
// no dock. The portal redraws the breadcrumb with the page and says when
// (onCrumbs), so the pill goes back in place after each redraw; a language
// change makes all of it again in it.

import { h, ic } from '../dom';
import { onLang } from '../i18n';
import { EASE_OUT, play } from '../motion';
import { onCrumbs } from '../page/frame';
import { REPO } from './data';
import { scenarioPicker } from './picker';
import type { DemoRouter } from './router';

export function mountCrumbs(router: DemoRouter) {
  const app = document.getElementById('app')!;
  const open = scenarioPicker(router);
  const demo = (cls: string) =>
    h('button', { type: 'button', class: cls, 'aria-haspopup': 'dialog', onclick: open }, h('span', {}, _('Demo')), ic('chevron', 'i'));
  const github = (cls: string) =>
    h('a', { class: cls, href: REPO, target: '_blank', rel: 'noopener', 'aria-label': _('Dawnline on GitHub') }, ic('github'));
  const make = () => ({
    chip: demo('dm-chip'),
    gh: github('dm-gh'),
    dock: h('div', { class: 'dm-dock' }, demo('dm-dock-demo'), github('dm-dock-gh')),
  });
  let { chip, gh, dock } = make();
  let first = true;
  const keep = () => {
    const crumbs = app.querySelector('.crumbs');
    const path = crumbs?.querySelector('.cr-path');
    if (!crumbs || !path) return;
    const lang = crumbs.querySelector('.cr-lang');
    chip.classList.toggle('split', !!lang);
    if (!lang) {
      gh.remove();
      dock.remove();
      if (path.nextElementSibling !== chip) path.after(chip);
      return;
    }
    if (lang.previousElementSibling !== gh || gh.previousElementSibling !== chip) lang.before(chip, gh);
    if (dock.isConnected) return;
    document.body.append(dock);
    // It rises from under the screen's edge (with the page's first wave, the first time), on a transform alone:
    // Safari leaves a backdrop blur undrawn while the element's opacity is animating, and it would pop in at the end.
    play(dock, [{ transform: 'translateY(calc(100% + 64px))' }, { transform: 'none' }], {
      duration: 620,
      delay: first ? 260 : 0,
      easing: EASE_OUT,
      fill: 'backwards',
    });
    first = false;
  };
  // Each time the page draws its breadcrumb again (a repaint, the language changed).
  onCrumbs(keep);
  keep();
  // The page has redrawn its breadcrumb in the new language by now (main.ts listens first).
  onLang(() => {
    const was = dock;
    chip.remove();
    gh.remove();
    ({ chip, gh, dock } = make());
    if (was.isConnected) was.replaceWith(dock);
    keep();
  });
}
