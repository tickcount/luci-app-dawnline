// What goes to another device: a QR code and the words that go with it, and a
// link as text with Copy and Share. Codes follow the theme: the night look
// (light dots on black) on a dark one, the same dots dark on white on a light
// one, redrawn in place when the system's theme changes. A dense code (an
// AmneziaVPN key) fills its row; the sheet widens for it (ui/sheet.ts).

import { denseQr, qrSvg } from '../../shared/qr';
import { h, ic } from '../dom';
import { EASE_IN, EASE_OUT, play } from '../motion';
import { placeName } from '../state';
import { copy } from './feedback';

const LIGHT = matchMedia('(prefers-color-scheme: light)');
const look = () => (LIGHT.matches ? 'day' : 'night');

function paint(box: HTMLElement, text: string) {
  box.dataset.qr = text;
  box.classList.toggle('dense', denseQr(text));
  box.classList.toggle('light', LIGHT.matches);
  box.innerHTML = qrSvg(text, 3, true, look());
  // The modules across: how wide the sheet must be for a camera to read it.
  box.dataset.mods = String((box.firstElementChild as SVGSVGElement | null)?.viewBox.baseVal.width ?? 0);
}

export function qrBox(text: string, big = false): HTMLElement {
  const box = h('div', { class: `qrbox${big ? ' big' : ''}` });
  paint(box, text);
  return box;
}

LIGHT.addEventListener('change', () =>
  document.querySelectorAll<HTMLElement>('.qrbox[data-qr]').forEach((b) => {
    // Mid cross-fade a box holds two codes: the old one goes, the new one is drawn again.
    b.querySelector('svg.old')?.remove();
    paint(b, b.dataset.qr!);
  }),
);

export interface CodeRow {
  el: HTMLElement;
  /** Another code in the same place: it comes in over the old one, which then goes; new words too, if given (else they stay, to change in place). */
  swap(next: string, words?: Node[]): void;
}

/** A code and its words: side by side, or a dense code full width with the words under it. */
export function codeRow(text: string, words: Node[]): CodeRow {
  const box = qrBox(text);
  let shown = h('div', { class: 'words' }, words);
  const side = h('div', { class: 'side' }, shown);
  const el = h('div', { class: `coderow${box.classList.contains('dense') ? ' stacked' : ''}` }, box, side);
  return {
    el,
    swap(next, nextWords) {
      // The same code for another app (AmneziaWG and WireGuard take one file): only the words change.
      const oldSvg = box.dataset.qr === next ? null : box.querySelector('svg');
      if (oldSvg) {
        paint(box, next);
        el.classList.toggle('stacked', box.classList.contains('dense'));
        const newSvg = box.querySelector('svg')!;
        oldSvg.classList.add('old');
        box.appendChild(oldSvg);
        // The new code comes in first, the old one goes after it: the place is never empty.
        play(newSvg, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: EASE_OUT });
        play(oldSvg, [{ opacity: 1 }, { opacity: 0 }], { duration: 220, delay: 110, easing: EASE_IN, fill: 'forwards' }).onfinish = () =>
          oldSvg.remove();
      }
      if (!nextWords) return;
      const oldWords = shown;
      shown = h('div', { class: 'words' }, nextWords);
      side.appendChild(shown);
      oldWords.classList.add('old');
      play(
        shown,
        [
          { opacity: 0, filter: 'blur(3px)' },
          { opacity: 1, filter: 'blur(0px)' },
        ],
        { duration: 220, easing: EASE_OUT },
      );
      play(
        oldWords,
        [
          { opacity: 1, filter: 'blur(0px)' },
          { opacity: 0, filter: 'blur(3px)' },
        ],
        { duration: 200, delay: 90, easing: EASE_IN, fill: 'forwards' },
      ).onfinish = () => oldWords.remove();
    },
  };
}

/** A link as text with Copy and, where the browser has one, the share sheet. */
export function linkRow(url: string): HTMLElement {
  const share = typeof navigator.share === 'function';
  return h(
    'div',
    { class: 'linkrow' },
    h('span', { class: 'mono' }, url.replace(/^https?:\/\//, '')),
    h(
      'button',
      { type: 'button', class: 'knob', 'aria-label': 'Copy the link', onclick: (ev: Event) => copy(url, 'Link copied', ev.currentTarget) },
      ic('copy'),
    ),
    share
      ? h(
          'button',
          {
            type: 'button',
            class: 'knob',
            'aria-label': 'Share the link',
            onclick: () => navigator.share({ url, title: placeName() }).catch(() => undefined),
          },
          ic('share'),
        )
      : null,
  );
}
