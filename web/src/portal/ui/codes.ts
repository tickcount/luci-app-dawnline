// What goes to another device: a QR code and the words that go with it, and a
// link as text with Copy and Share. Codes follow the theme: the night look
// (light dots on black) on a dark one, the same dots dark on white on a light
// one, redrawn in place when the system's theme changes. A dense code (an
// AmneziaVPN key) fills its row; the sheet widens for it (ui/sheet.ts). A code
// too long for a camera gives its place to a stand-in (the device's set-up link).

import { denseQr, qrSvg, scannable } from '../../shared/qr';
import { h, ic, markup } from '../dom';
import { EASE_IN, EASE_OUT, SMOOTH, play } from '../motion';
import { placeName } from '../state';
import { copy } from './feedback';

const LIGHT = matchMedia('(prefers-color-scheme: light)');
const look = () => (LIGHT.matches ? 'day' : 'night');

/** The code for `text` in the theme's look, tagged with what it says. */
function drawn(text: string): SVGSVGElement {
  const svg = markup(qrSvg(text, 3, true, look())) as SVGSVGElement;
  svg.dataset.qr = text;
  return svg;
}

/** The box shows `svg` (or is about to): its size, and the sheet's width, follow that code. */
function holds(box: HTMLElement, svg: SVGSVGElement) {
  box.dataset.qr = svg.dataset.qr;
  box.classList.toggle('dense', denseQr(svg.dataset.qr!));
  box.classList.toggle('light', LIGHT.matches);
  // The modules across: how wide the sheet must be for a camera to read it.
  box.dataset.mods = String(svg.viewBox.baseVal.width);
}

export function qrBox(text: string, big = false): HTMLElement {
  const box = h('div', { class: `qrbox${big ? ' big' : ''}` });
  const svg = drawn(text);
  box.append(svg);
  holds(box, svg);
  return box;
}

// Each code is redrawn in the other look where it stands: a cross-fade under way carries on.
LIGHT.addEventListener('change', () =>
  document.querySelectorAll<HTMLElement>('.qrbox[data-qr]').forEach((b) => {
    b.querySelectorAll<SVGSVGElement>(':scope > svg[data-qr]').forEach((s) => s.replaceChildren(...drawn(s.dataset.qr!).childNodes));
    b.classList.toggle('light', LIGHT.matches);
  }),
);

/** Where an element's fade stands now, mid-fade included. */
function now(el: Element): Keyframe {
  const s = getComputedStyle(el);
  return { opacity: s.opacity, filter: s.filter === 'none' ? 'blur(0px)' : s.filter };
}

export interface CodeRow {
  el: HTMLElement;
  /** Another code in the same place: it comes in over the old one, which then goes; new words too, if given (else they stay, to change in place). */
  swap(next: string, words?: Node[]): void;
}

/** What a code row shows instead of a code a camera cannot read: another code, and words that say why (made each time it shows). */
export interface StandIn {
  text: string;
  words: () => Node[];
}

/**
 * A code and its words: side by side, or a dense code full width with the
 * words under it. With a stand-in, a code too long to scan shows the stand-in
 * and its words; the row's own words come back with a code that fits.
 */
export function codeRow(text: string, words: Node[], standIn?: StandIn): CodeRow {
  const instead = (t: string) => !!standIn && !scannable(t);
  let own = words;
  let out = instead(text);
  const box = qrBox(out ? standIn!.text : text);
  let shown = h('div', { class: 'words' }, out ? standIn!.words() : own);
  const side = h('div', { class: 'side' }, shown);
  const el = h('div', { class: `coderow${box.classList.contains('dense') ? ' stacked' : ''}` }, box, side);
  /**
   * Another code in the box: it comes in under the one showing, which lies over
   * it and goes after it, so the place is never empty. Nothing on screen changes
   * its place in the stack: the codes lie in the box in the order they paint (the
   * one in flow first, under the rest). A swap under way carries on from where
   * each code stands; a code turned back to fades up again where it lies, what
   * lies over it going, and what lies under it goes once it shows whole. A code
   * of the other size (dense or not) takes the box from its size on screen to its
   * own on SMOOTH, the codes in it scaling with it, while the sheet glides the
   * rest (glide() in ui/sheet.ts).
   */
  let sizing: Animation | null = null;
  /** The codes on their way out: a later swap leaves their fade as it is. */
  const going = new WeakSet<Element>();
  const cross = (code: string) => {
    const svgs = [...box.querySelectorAll<SVGSVGElement>(':scope > svg')];
    const op = new Map(svgs.map((s) => [s, +getComputedStyle(s).opacity]));
    const cs = getComputedStyle(box);
    const r0 = box.getBoundingClientRect();
    // Its corners as they look now: a resize under way scales them with the box.
    const round0 = parseFloat(cs.borderTopLeftRadius) * new DOMMatrix(cs.transform).a;
    const neu = svgs.find((s) => s.dataset.qr === code) ?? drawn(code);
    const at = svgs.indexOf(neu);
    // A new code goes under them all; one still in the box stays where it lies.
    if (at < 0) box.prepend(neu);
    const over = svgs.slice(at + 1).filter((s) => !going.has(s));
    const under = svgs.slice(0, Math.max(0, at));
    const fades = [neu, ...over].flatMap((s) => s.getAnimations());
    going.delete(neu);
    holds(box, neu);
    el.classList.toggle('stacked', box.classList.contains('dense'));
    const o0 = op.get(neu) ?? 0;
    play(neu, [{ opacity: o0 }, { opacity: 1 }], { duration: 200 * (1 - o0), easing: EASE_OUT }).onfinish = () => {
      // Whole: what lies under it, hidden now, goes, and it takes the box's flow under what still fades over it.
      under.forEach((s) => s.remove());
      neu.classList.remove('old');
    };
    // What lies over it goes from how it shows, where it lies (the code that showed, over the new one); one already going goes on.
    over.forEach((s) => {
      s.classList.add('old');
      going.add(s);
      play(s, [{ opacity: op.get(s)! }, { opacity: 0 }], {
        duration: 220 * op.get(s)!,
        delay: 110,
        easing: EASE_IN,
        fill: 'both',
      }).onfinish = () => s.remove();
    });
    fades.forEach((a) => a.cancel());
    sizing?.cancel();
    sizing = null;
    const r1 = box.getBoundingClientRect();
    const sx = r0.width / r1.width;
    const sy = r0.height / r1.height;
    // Not on screen (a folded row): nothing to watch move.
    if (r0.width && r1.width && (Math.abs(sx - 1) > 0.005 || Math.abs(sy - 1) > 0.005))
      sizing = play(
        box,
        [
          { transform: `scale(${sx}, ${sy})`, transformOrigin: '0 0', borderRadius: `${round0 / sx}px` },
          { transform: 'none', transformOrigin: '0 0', borderRadius: getComputedStyle(box).borderTopLeftRadius },
        ],
        { duration: SMOOTH.duration, easing: SMOOTH.easing },
      );
  };
  return {
    el,
    swap(next, nextWords) {
      if (nextWords) own = nextWords;
      const was = out;
      out = instead(next);
      const code = out ? standIn!.text : next;
      // The same code for another app (AmneziaWG and WireGuard take one file): only the words change.
      if (box.dataset.qr !== code) cross(code);
      // The stand-in's words stay while they say the same (they may follow what it stands in for); the row's own
      // come back with a code that fits.
      let put = out ? standIn!.words() : (nextWords ?? (was ? own : null));
      if (out && was && put!.map((n) => n.textContent).join('') === shown.textContent) put = null;
      if (!put) return;
      const oldWords = shown;
      // From where they stand: words still coming in (a pick right after a pick) go from there.
      const from = now(oldWords);
      const fades = oldWords.getAnimations();
      shown = h('div', { class: 'words' }, put);
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
      play(oldWords, [from, { opacity: 0, filter: 'blur(3px)' }], { duration: 200, delay: 90, easing: EASE_IN, fill: 'both' }).onfinish =
        () => oldWords.remove();
      fades.forEach((a) => a.cancel());
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
      {
        type: 'button',
        class: 'knob',
        'aria-label': _('Copy the link'),
        onclick: (ev: Event) => copy(url, _('Link copied'), ev.currentTarget),
      },
      ic('copy'),
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
  );
}
