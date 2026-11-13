// A list of networks as chips on a person's own page (a router's networks in its sheet, and in the form that adds a
// router): each a chip with its own ×, in the look of what it is (one that works, one that waits for the admin, one
// the admin turned down), and the last chip adds another, typed where it stands (ui/inline-edit.ts). Nothing here
// talks to the router: the list is its owner's draft, and what a press means is the caller's. The chips move as
// ui/chips-motion.ts says, and the sheet glides to the list's height.

import { h, ic } from '../dom';
import { netRefusal, normNet, tooMany, type Taken } from '../../shared/nets';
import { FIELD, carryChips, said, settle, stood, type Stood } from './chips-motion';
import { inlineEdit } from './inline-edit';
import { glide as sheetGlide } from './sheet';

export interface NetItem {
  n: string;
  look: 'is' | 'asked' | 'bad';
  word?: string;
  icon?: string;
  /** Its ×: what it says and does. */
  x: { label: string; run(): void };
}

export interface NetChips {
  /** One per list on screen (the chips of a list drawn again go on from where they stood). */
  key: string;
  items(): NetItem[];
  /** A network typed and taken (as the router keeps it). */
  add(n: string): void;
  /** Lines under the chips that say a state. */
  notes?(): (HTMLElement | null)[];
  /** What a network typed here must not share addresses with, as far as the page knows. */
  taken(): Taken[];
}

/** A list of networks as chips, with the one that adds; `paint` draws it again after a change (the sheet glides). */
export function netChips(o: NetChips): { el: HTMLElement; paint(): void } {
  const holder = h('div', { class: 'pb' });
  const line = h('p', { class: 'nb-say' });
  line.hidden = true;
  /**
   * How high the list stands while a field is open. The sheet glides from what it measures when asked
   * (ui/sheet.ts glide), and the in-place field changes the layout by itself, before anyone can ask: so the list is
   * held at the height it stood at, and let go inside the sheet's glide, which then starts from what was on screen.
   */
  let stands = 0;
  const hold = (px: number) => void (holder.style.height = `${px}px`);
  const release = () => sheetGlide(() => void (holder.style.height = ''));
  /** The list is another height than it stood at: the sheet goes there. */
  const follow = () => {
    const now = holder.offsetHeight;
    if (now === stands) return;
    hold(stands);
    release();
    stands = now;
  };
  const paint = () => {
    holder.style.height = '';
    const items = o.items();
    const box = h('span', { class: 'nb-nets' });
    let typing: Stood | null = null;
    const add = h(
      'button',
      { type: 'button', class: 'nb-chip nb-add', 'data-k': '#add', 'data-s': 'add' },
      ic('plus'),
      h('span', {}, _('Network')),
    );
    add.addEventListener('click', () => {
      const before = stood(box);
      const h0 = holder.offsetHeight;
      add.classList.add('mono');
      inlineEdit(add, {
        label: _('Network'),
        start: '',
        placeholder: '192.168.2.0/24',
        plain: true,
        max: 18,
        refuse: (v) =>
          tooMany(items.filter((i) => i.look !== 'bad').length + 1) ??
          netRefusal(v, [
            ...o.taken(),
            ...items.filter((i) => i.look !== 'bad').map((i) => ({ cidr: i.n, who: _('already behind this router') })),
          ]),
        commit: (v) => {
          box.dataset.typed = '#add';
          o.add(normNet(v));
        },
        // a field that grows as it is typed in may take a line of its own: the sheet goes there
        typing: () => follow(),
        say: (t, bad) => {
          if (t == null) {
            // the field is the chip that adds again, and what was said goes: the sheet goes on from the height it
            // had with the field (a value taken draws the list again right after: that glide starts there too)
            add.classList.remove('mono');
            line.hidden = true;
            if (typing) settle(box, typing);
            typing = null;
            if (holder.offsetHeight !== stands) {
              hold(stands);
              queueMicrotask(() => holder.style.height && release());
            }
            return;
          }
          // how to finish is not said here (a sheet is narrow: the words would take a line of their own); why not is
          if (!bad) return;
          const shown = !line.hidden && line.textContent === t;
          line.hidden = false;
          line.className = 'nb-say bad-t';
          line.textContent = t;
          if (!shown) said(line);
          follow();
        },
      });
      const form = box.querySelector<HTMLElement>('form.kt-ie-f');
      if (form) {
        form.dataset.k = '#add';
        form.dataset.s = 'add';
        const layout = stood(box);
        settle(box, before);
        form.dataset.k = FIELD;
        typing = new Map([...layout].map(([k, p]) => [k === '#add' ? FIELD : k, p]));
      }
      // the field may stand lower than the chip did (a line of its own): the sheet goes there from where it stood
      stands = h0;
      follow();
    });
    box.append(
      ...items.map((i) =>
        h(
          'span',
          {
            class: `nb-chip mono${i.look === 'asked' ? ' nb-waits' : i.look === 'bad' ? ' nb-bad' : ''}`,
            'data-k': `n:${i.n}`,
            'data-s': i.look,
          },
          h('span', { class: 'nb-cb' }, i.icon ? ic(i.icon) : null, i.n, i.word ? h('span', { class: 'nb-word' }, i.word) : null),
          h(
            'button',
            { type: 'button', class: 'nb-cx', title: i.x.label, 'aria-label': `${i.x.label}: ${i.n}`, onclick: i.x.run },
            ic('x'),
          ),
        ),
      ),
      add,
    );
    carryChips(o.key, box);
    holder.replaceChildren(box, line, ...(o.notes?.() ?? []).filter((x): x is HTMLElement => !!x));
  };
  paint();
  return { el: holder, paint: () => sheetGlide(paint) };
}
