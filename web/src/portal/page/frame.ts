// The page's frame: no navbar. The page fades out under the screen's top and
// bottom edges (the top fade only once it scrolls, so the breadcrumb at rest
// stays crisp), and opens with a breadcrumb: the Dawnline mark, the place (the
// server's name) and the person, then the language and this page's code. The
// content goes in `body`.

import { h, ic, markup } from '../dom';
import { placeName, state } from '../state';
import { showPageCode } from '../flows/page-code';
import { openMenu } from '../ui/menu';
import { LANGS, lang, setLang } from '../i18n';

// The sun rises from behind the horizon once, on the visit's first paint.
const LOGO =
  '<svg class="logo" viewBox="0 0 24 24" aria-hidden="true"><defs><clipPath id="dl-sky"><rect width="24" height="17"/></clipPath></defs>' +
  '<g clip-path="url(#dl-sky)"><path class="sun" d="M3 15a9 9 0 0 1 18 0z"/></g><rect class="bar" x="2" y="17" width="20" height="2" rx="1"/></svg>';

let crumbsEl: HTMLElement | null = null;
let bodyEl: HTMLElement | null = null;
let pageEl: HTMLElement | null = null;

/** The frame, built once into #app; returns the slot the page's content goes in. */
export function frame(app: HTMLElement): HTMLElement {
  if (bodyEl) return bodyEl;
  crumbsEl = h('header', { class: 'crumbs' });
  bodyEl = h('div', { class: 'page-body' });
  app.replaceChildren(
    h('div', { class: 'edge-fade top', 'aria-hidden': 'true' }),
    h('div', { class: 'edge-fade bot', 'aria-hidden': 'true' }),
    (pageEl = h('main', { class: 'page' }, crumbsEl, bodyEl)),
  );
  const onScroll = () => document.body.classList.toggle('scrolled', scrollY > 2);
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  return bodyEl;
}

/** One card in place of the page (the link gone, nothing loaded, access paused): it and the breadcrumb sit in the middle of the screen. */
export function single(on: boolean) {
  pageEl?.classList.toggle('single', on);
}

/** The language: its code and a chevron; the menu lists the languages by their own names. */
function langPicker(): HTMLElement {
  const b = h(
    'button',
    { type: 'button', class: 'cr-lang', 'aria-label': _('Language'), 'aria-haspopup': 'menu', 'aria-expanded': 'false' },
    h('span', {}, lang().toUpperCase()),
    ic('chevron', 'i cr-down'),
  );
  b.addEventListener('click', () =>
    openMenu(
      b,
      LANGS.map((l) => ({ label: l.name, checked: l.code === lang(), run: () => l.code !== lang() && setLang(l.code) })),
    ),
  );
  return b;
}

/**
 * The breadcrumb: the place, then the person (none when the link stopped
 * working); at its end, the language and this page's code for another
 * device, on the page itself only (not over a card: paused, link gone,
 * nothing loaded).
 */
export function crumbs(gone = false, card = false) {
  if (!crumbsEl) return;
  const p = gone ? null : state()?.person;
  const place = h('span', { class: p ? '' : 'cur', 'aria-current': p ? null : 'page' }, placeName());
  crumbsEl.replaceChildren(
    h('span', { class: 'cr-mark' }, markup(LOGO)),
    h(
      'nav',
      { class: 'cr-path', 'aria-label': _('Breadcrumb') },
      place,
      p ? [ic('chevron'), h('span', { class: 'cur', 'aria-current': 'page' }, p.name)] : null,
    ),
    ...(card ? [] : [langPicker()]),
    ...(p && !card
      ? [h('button', { type: 'button', class: 'knob cr-qr', 'aria-label': _('Open on another device'), onclick: showPageCode }, ic('qr'))]
      : []),
  );
}
