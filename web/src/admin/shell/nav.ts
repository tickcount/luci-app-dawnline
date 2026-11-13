// The page's own section row (owner decision: no LuCI tabs; LuCI's menu
// keeps one Dawnline item and its section nodes have no titles): the
// portal's segmented track with words, one link per section (routes.ts), the
// current one on its pill: Overview · Log · Settings (a server's people,
// places and settings are its own page's, behind Overview). A link, not a
// tab: each section is a LuCI view of its own. Each page puts the row in its
// own host; a move from one page of Dawnline's to another keeps the row that
// stands (shell/pages.ts) and its pill stretches to the section, as a track's
// does (ui/tabs.ts).

import { h } from '../../portal/dom';
import { pillOn, pillTo } from '../ui/tabs';
import { SECTIONS, here, href, sectionOf, sectionPlace, type Place, type Section } from './routes';

const sectionLabel = (s: Section): string => ({ overview: _('Overview'), log: _('Log'), settings: _('Settings') })[s];

/** One track of links; `on`: the current one's index (-1: none). */
function track(items: { label: string; to: string }[], on: number, label: string): HTMLElement {
  const pill = h('span', { class: 'nav-pill', 'aria-hidden': 'true' });
  const el = h(
    'div',
    { class: 'navtabs', role: 'list', 'aria-label': label },
    pill,
    ...items.map((it, i) =>
      h('a', { class: `nav-a${i === on ? ' on' : ''}`, href: it.to, role: 'listitem', 'aria-current': i === on ? 'page' : null }, it.label),
    ),
  );
  // The edges fade only where more is hidden; the current link scrolled into view (a phone).
  const edges = () => {
    el.classList.toggle('more-start', el.scrollLeft > 1);
    el.classList.toggle('more-end', el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  };
  el.addEventListener('scroll', edges, { passive: true });
  // the pill on the current link once laid out, and again when the row's width changes
  const place = () => {
    const cur = el.querySelector<HTMLElement>(':scope > .nav-a.on');
    el.classList.toggle('pilled', !!cur?.offsetWidth);
    if (cur) pillOn(pill, cur);
  };
  addEventListener(
    'resize',
    () => {
      edges();
      place();
    },
    { passive: true },
  );
  requestAnimationFrame(() => {
    const cur = el.querySelector<HTMLElement>(':scope > .nav-a.on');
    if (cur && el.scrollWidth > el.clientWidth) el.scrollLeft = Math.max(0, cur.offsetLeft - (el.clientWidth - cur.offsetWidth) / 2);
    edges();
    place();
  });
  return el;
}

/** The section row for the page at `at` (default: this one). */
export function navRow(at = here()): HTMLElement {
  const cur = sectionOf(at.view, at.query ?? '');
  return h(
    'nav',
    { class: 'dl-nav', 'aria-label': _('Dawnline') },
    track(
      SECTIONS.map((s) => ({ label: sectionLabel(s), to: href(sectionPlace(s)) })),
      cur ? SECTIONS.indexOf(cur) : -1,
      _('Dawnline'),
    ),
  );
}

/**
 * The row `nav` that stands, for the page at `at`: its pill stretches to that page's section (none of them: the
 * pill goes).
 */
export function markSection(nav: HTMLElement, at: Place) {
  const cur = sectionOf(at.view, at.query ?? '');
  const on = cur ? SECTIONS.indexOf(cur) : -1;
  const track = nav.querySelector<HTMLElement>('.navtabs');
  const pill = track?.querySelector<HTMLElement>(':scope > .nav-pill');
  if (!track || !pill) return;
  const links = [...track.querySelectorAll<HTMLElement>(':scope > .nav-a')];
  const was = links.findIndex((a) => a.classList.contains('on'));
  links.forEach((a, i) => {
    a.classList.toggle('on', i === on);
    if (i === on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const to = links[on];
  track.classList.toggle('pilled', !!to);
  if (!to) return;
  if (was < 0) pillOn(pill, to);
  else if (was !== on) pillTo(pill, to);
}
