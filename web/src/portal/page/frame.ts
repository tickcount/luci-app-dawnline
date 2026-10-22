// The page's frame: no navbar. The page fades out under the screen's top and
// bottom edges (the top fade only once it scrolls, so the breadcrumb at rest
// stays crisp), and opens with a breadcrumb: the Dawnline mark, the place (the
// server's name) and the person, then the language and this page's code. The
// content goes in `body`, which holds its height while a fold near the page's
// foot takes the scroll down with it (`holdFoot`).

import { h, ic, markup } from '../dom';
import { EASE_OUT, SOFT, play } from '../motion';
import { placeName, state } from '../state';
import { closePageCode, showPageCode } from '../flows/page-code';
import { pickPill, type PickPill } from '../ui/pick';
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

/**
 * The page keeps its height while something in it takes a shorter shape (an
 * access row folding): with no scroll anchoring (base.css), a page scrolled
 * near its foot would drop to its new end on the frame that shape is measured.
 * Held at what the scroll needs, it lets go once the new shape is known (what
 * this returns), on an ease that never overshoots, so the scroll follows the
 * fold down frame by frame and stops at the new foot. Still tall enough, it
 * lets go at once.
 */
export function holdFoot(): () => void {
  const body = bodyEl;
  if (!body) return () => {};
  // Read as it stands (a hold still letting go included), then taken over.
  const r = body.getBoundingClientRect();
  // Tall enough for the page's foot to stay at the bottom of the screen: the scroll and the screen, less what is
  // above the body and under it.
  const need = innerHeight - r.top - (document.documentElement.scrollHeight - scrollY - r.bottom);
  body.getAnimations().forEach((a) => a.cancel());
  body.style.minHeight = `${need}px`;
  return () => {
    const last = body.lastElementChild;
    const end = last ? last.getBoundingClientRect().bottom - body.getBoundingClientRect().top : 0;
    body.style.minHeight = '';
    if (end < need - 0.5)
      play(body, [{ minHeight: `${need}px` }, { minHeight: `${end}px` }], { duration: SOFT.duration, easing: EASE_OUT });
  };
}

/** One card in place of the page (the link gone, nothing loaded, access paused): it and the breadcrumb sit in the middle of the screen. */
export function single(on: boolean) {
  pageEl?.classList.toggle('single', on);
}

// Each language's flag, a disc (styles/pick.css): the Union Jack for English, the tricolour for Russian.
const FLAGS: Record<string, string> = {
  en:
    '<svg viewBox="15 0 30 30" aria-hidden="true"><path fill="#012169" d="M0 0h60v30H0z"/>' +
    '<path stroke="#fff" stroke-width="6" d="M0 0l60 30M60 0L0 30"/><path stroke="#c8102e" stroke-width="2" d="M0 0l60 30M60 0L0 30"/>' +
    '<path stroke="#fff" stroke-width="10" d="M30 0v30M0 15h60"/><path stroke="#c8102e" stroke-width="6" d="M30 0v30M0 15h60"/></svg>',
  ru:
    '<svg viewBox="0 0 30 30" aria-hidden="true"><path fill="#fff" d="M0 0h30v10H0z"/><path fill="#0039a6" d="M0 10h30v10H0z"/>' +
    '<path fill="#d52b1e" d="M0 20h30v10H0z"/></svg>',
};
const flag = (code: string) => h('span', { class: 'flag' }, FLAGS[code] ? markup(FLAGS[code]) : null);

/**
 * The language: its flag, its code and a chevron; the popup under it lists the languages by their own names. One
 * pill for the visit, put back each time the breadcrumb is drawn, so a pick morphs its code after the page redraws.
 */
let langPill: PickPill<string> | null = null;
function langPicker(): HTMLElement {
  langPill ??= pickPill({
    cls: 'cr-lang',
    label: () => _('Language'),
    options: LANGS.map((l) => ({ value: l.code, label: () => l.name, lead: () => flag(l.code) })),
    value: lang(),
    short: (c) => c.toUpperCase(),
    prefer: 'below',
    pick: (c) => setLang(c),
  });
  langPill.show(lang());
  return langPill.el;
}

/**
 * This page's code for another device: one knob for the visit, as the language's pill, so a card open from it
 * (flows/page-code.ts) stays where it is as the page redraws.
 */
let qr: HTMLElement | null = null;
function qrKnob(): HTMLElement {
  qr ??= h(
    'button',
    { type: 'button', class: 'knob cr-qr', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: () => showPageCode(qr!) },
    ic('qr'),
  );
  qr.setAttribute('aria-label', _('Open on another device'));
  return qr;
}

/**
 * The breadcrumb: the place, then the person (none when the link stopped
 * working); at its end, the language and this page's code for another
 * device, on the page itself only (not over a card: paused, link gone,
 * nothing loaded).
 */
/** Who is told the breadcrumb was drawn again (the demo adds its chip and GitHub link to it: demo/crumbs.ts). */
const drawnCrumbs: (() => void)[] = [];
export const onCrumbs = (fn: () => void) => void drawnCrumbs.push(fn);

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
    ...(p && !card ? [qrKnob()] : []),
  );
  // No knob to fold back into: the card goes with it.
  if (!qr?.isConnected) closePageCode(true);
  drawnCrumbs.forEach((f) => f());
}
