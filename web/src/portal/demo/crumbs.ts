// What the demo adds to the breadcrumb: the scenario chip right after the path,
// and a GitHub pill just before the page's language picker (none over a card
// alone, which has no picker either). On a phone the pill would crowd out the names, so it
// gives way to a button in the scenario drawer (demo.css). The portal redraws
// the breadcrumb with the page and knows nothing of either, so both go back in
// place after each redraw; a language change makes both again in it.

import { h, ic } from '../dom';
import { onLang } from '../i18n';
import { REPO } from './data';
import { scenarioChip } from './picker';
import type { DemoRouter } from './router';

export function mountCrumbs(router: DemoRouter) {
  const app = document.getElementById('app')!;
  const make = () => ({
    chip: scenarioChip(router),
    gh: h(
      'a',
      { class: 'dm-gh', href: REPO, target: '_blank', rel: 'noopener', 'aria-label': _('Dawnline on GitHub') },
      ic('github'),
      h('span', {}, 'GitHub'),
    ),
  });
  let { chip, gh } = make();
  // Our own insertions call this again: by then both are in place and nothing moves.
  const keep = () => {
    const crumbs = app.querySelector('.crumbs');
    const path = crumbs?.querySelector('.cr-path');
    if (!crumbs || !path) return;
    if (path.nextElementSibling !== chip) path.after(chip);
    const lang = crumbs.querySelector('.cr-lang');
    if (lang && lang.previousElementSibling !== gh) lang.before(gh);
  };
  new MutationObserver(keep).observe(app, { childList: true, subtree: true });
  keep();
  // The page has redrawn its breadcrumb in the new language by now (main.ts listens first).
  onLang(() => {
    chip.remove();
    gh.remove();
    ({ chip, gh } = make());
    keep();
  });
}
