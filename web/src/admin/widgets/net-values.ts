// The networks behind a router as values in its row: each a chip edited where it stands (ui/inline-edit.ts, as the
// tunnel network is), its own × taking it away, the last chip adding another: no sheet, no form. What waits for
// «Apply» is in the pending tone, one taken away is struck until then (a press brings it back), and a network its
// owner asked for on their own page stands with its two answers in sight. The chips move as ui/chips-motion.ts says.

import { h } from '../../portal/dom';
import { fmt } from '../../shared/i18n';
import { BEHIND_MOST, netRefusal, normNet, tooMany, type Taken } from '../../shared/nets';
import { FIELD, carryChips, glide, said, settle, stood, type Stood } from '../../portal/ui/chips-motion';
import { ic } from '../ui/icons';
import { inlineEdit } from '../../portal/ui/inline-edit';

export interface NetValues {
  /** The row's name among the page's rows: the chips of its next drawing go on from this one's (ui/carry.ts). */
  key: string;
  /** The networks as the row shows them now (a list that waits for «Apply» included). */
  nets: string[];
  /** The networks the router has: what the shown ones are new or gone against. */
  was: string[];
  /** Asked for on its owner's page and not answered. */
  asked?: string[];
  /** Every network one typed here must not share addresses with, with whose it is. */
  taken: Taken[];
  write: boolean;
  /** The row's new list (a value typed, changed, taken away or brought back). */
  set(next: string[]): void;
  /** The answers to a network asked for: `refused` says why it cannot be taken as it is. Absent: it is only read. */
  ask?: { accept(net: string, refused: (why: string) => void): void; decline(at: HTMLElement, net: string): void };
  /** The line under the values: in red why one is refused; `rest`: what it says otherwise, and in which tone. */
  line: HTMLElement;
  rest?: string;
  restTone?: string;
}

/** A router's networks as values, each edited where it stands; the last one adds another. */
export function netValues(o: NetValues): HTMLElement {
  const { nets, was } = o;
  let rest = () => {
    o.line.textContent = o.rest ?? '';
    o.line.className = `nb-say${o.restTone ? ` ${o.restTone}-t` : ''}`;
    o.line.hidden = !o.rest;
  };
  rest();
  const box = h('span', { class: 'nb-nets' });
  const row = () => box.closest<HTMLElement>('.nb-row, .nb-inconf');
  /** How to finish what is typed, said beside the chips while a field is open. */
  const hint = h('span', { class: 'nb-hint' });
  /** While one is typed: where the row's pieces stand around the field, and how high the row stands with it. */
  let typing: { was: Stood; h: number } | null = null;
  const refuse = (t: string) => {
    o.line.hidden = false;
    o.line.className = 'nb-say bad-t';
    o.line.textContent = t;
    said(o.line);
    const r = row();
    if (r) glide(r, r.getBoundingClientRect().height);
  };
  const start = (btn: HTMLElement, i: number | null) => {
    const before = stood(box);
    const shown0 = row()?.getBoundingClientRect().height ?? 0;
    inlineEdit(btn, {
      label: _('Network'),
      start: i == null ? '' : nets[i],
      placeholder: '192.168.2.0/24',
      plain: true,
      max: 18,
      // an emptied one is taken away; a new one is one more of at most eight, and shares no address with what
      // something has (its own other networks among them)
      refuse: (v) =>
        v === '' && i != null
          ? null
          : ((i == null ? tooMany(nets.length + 1) : null) ??
            netRefusal(v, [
              ...o.taken,
              ...nets.filter((_n, j) => j !== i).map((n) => ({ cidr: n, who: _('this router’s other network') })),
            ])),
      commit: (v) => {
        // the chip that comes of this is what was typed here: it takes this place (ui/chips-motion.ts)
        box.dataset.typed = btn.dataset.k ?? '';
        const next = [...nets];
        if (i == null) next.push(normNet(v));
        else if (v === '') next.splice(i, 1);
        else next[i] = normNet(v);
        o.set(next);
      },
      say: (t, bad) => {
        const r = row();
        // as high as the row shows now (a glide under way included): whatever is said next, it goes on from there
        const shown = r?.getBoundingClientRect().height ?? 0;
        if (t == null) {
          // The field is the chip again (or the chip that adds): what was said goes, the row's pieces go back from
          // around the field and the row to its own height. A repaint that follows (a value taken) is told how high
          // the row stood, so the new one goes on from there too (carryChips). The row may stand lower by now (a
          // field that wrapped onto a line of its own on a narrow page): the height it had with the field was kept.
          const stoodAt = typing?.h ?? shown;
          hint.remove();
          rest();
          box.dataset.h = String(stoodAt);
          if (typing) {
            settle(box, typing.was);
            typing = null;
          }
          if (r) glide(r, stoodAt);
          return;
        }
        if (bad) {
          // why not: a line of its own under the chips, the row gliding open for it
          hint.remove();
          const other = o.line.hidden || o.line.textContent !== t;
          o.line.hidden = false;
          o.line.className = 'nb-say bad-t';
          o.line.textContent = t;
          if (other) said(o.line);
        } else {
          // how to finish: beside the chips, on their line, so nothing under them moves
          hint.textContent = t;
          if (!hint.isConnected) {
            box.append(hint);
            said(hint);
          }
        }
        if (r) {
          const to = glide(r, shown);
          if (typing) typing.h = to;
        }
      },
      // a field that grows as it is typed in may take a line of its own: the row goes there, and is that high
      typing: () => {
        const r = row();
        if (typing && r) typing.h = glide(r, r.getBoundingClientRect().height);
      },
    });
    // the field stands where the chip stood and keeps its name: its neighbours make room, the row its height
    const form = box.querySelector<HTMLElement>('form.kt-ie-f');
    if (form) {
      form.dataset.k = btn.dataset.k ?? '';
      form.dataset.s = btn.dataset.s ?? '';
      const layout = stood(box);
      settle(box, before);
      form.dataset.k = FIELD;
      const r = row();
      typing = { was: new Map([...layout].map(([k, p]) => [k === (btn.dataset.k ?? '') ? FIELD : k, p])), h: r ? glide(r, shown0) : 0 };
    }
  };
  // a network is a chip in two parts, as a filter's chip is (ui/filter-bar.ts): its address, pressed to change it
  // where it stands, and its own × that takes it away
  const values = nets.map((n, i) => {
    const fresh = !was.includes(n);
    if (!o.write)
      return h('span', { class: 'nb-chip mono nb-still', 'data-k': `n:${n}`, 'data-s': 'still' }, h('span', { class: 'nb-cb' }, n));
    const body = h(
      'button',
      { type: 'button', class: 'nb-cb', title: _('Change'), 'aria-label': fmt('%s: %s. %s', _('Network'), n, _('Change')) },
      n,
    );
    const x = h('button', { type: 'button', class: 'nb-cx', title: _('Remove'), 'aria-label': fmt(_('Remove %s'), n) }, ic('x'));
    const el = h(
      'span',
      { class: `nb-chip mono${fresh ? ' nb-waits' : ''}`, 'data-k': `n:${n}`, 'data-s': fresh ? 'waits' : 'is' },
      body,
      x,
    );
    body.addEventListener('click', () => start(el, i));
    x.addEventListener('click', () => o.set(nets.filter((_n, j) => j !== i)));
    return el;
  });
  // one taken away that still waits for «Apply»: struck, and a press brings it back to its place
  const gone = o.write
    ? was
        .filter((n) => !nets.includes(n))
        .map((n) => {
          const b = h(
            'button',
            {
              type: 'button',
              class: 'nb-chip mono nb-gone',
              'data-k': `n:${n}`,
              'data-s': 'gone',
              title: _('Bring it back'),
              'aria-label': fmt(_('Bring %s back'), n),
            },
            h('s', {}, n),
            ic('reset'),
          );
          b.addEventListener('click', () =>
            o.set([...was.filter((w) => w === n || nets.includes(w)), ...nets.filter((w) => !was.includes(w))]),
          );
          return b;
        })
    : [];
  let add: HTMLElement | null = null;
  if (o.write && nets.length < BEHIND_MOST) {
    const b = h(
      'button',
      { type: 'button', class: 'nb-chip nb-add', 'data-k': '#add', 'data-s': 'add' },
      ic('plus'),
      h('span', {}, nets.length || gone.length ? _('Network') : _('Network behind it')),
    );
    b.addEventListener('click', () => {
      b.classList.add('mono');
      start(b, null);
    });
    add = b;
    const back = rest;
    rest = () => {
      b.classList.remove('mono');
      back();
    };
  }
  // Asked for on its owner's page: the address with its two answers in sight. An answer is a decision, not a
  // setting: it is made at once and can be undone from its toast. A login that only reads sees what is asked.
  const asked = (o.asked ?? [])
    .filter((n) => !nets.includes(n))
    .map((n) => {
      const ask = o.ask;
      if (!o.write || !ask)
        return h(
          'span',
          { class: 'nb-chip mono nb-asked nb-still', 'data-k': `n:${n}`, 'data-s': 'asked' },
          h('span', { class: 'nb-cb' }, n),
        );
      const yes = h('button', { type: 'button', class: 'nb-cy', title: _('Accept'), 'aria-label': fmt(_('Accept %s'), n) }, ic('check'));
      const no = h('button', { type: 'button', class: 'nb-cx', title: _('Decline'), 'aria-label': fmt(_('Decline %s'), n) }, ic('x'));
      // it cannot be taken as it is: why, where the row says things; it stays asked, to be turned down
      yes.addEventListener('click', () => ask.accept(n, refuse));
      no.addEventListener('click', () => ask.decline(no, n));
      return h(
        'span',
        { class: 'nb-chip mono nb-asked', 'data-k': `n:${n}`, 'data-s': 'asked' },
        h('span', { class: 'nb-cb' }, n),
        yes,
        no,
      );
    });
  if (!values.length && !add && !gone.length && !asked.length)
    return h('span', { class: 'nb-nets' }, h('span', { class: 'nb-none' }, _('No network behind it')));
  // in the router's own order, one taken away keeping its place until «Apply»; then the new ones; then the one that adds
  const at = (n: string) => values[nets.indexOf(n)] ?? gone[was.filter((w) => !nets.includes(w)).indexOf(n)];
  box.append(...[...was.map(at), ...nets.filter((n) => !was.includes(n)).map(at), ...asked, add].filter((x): x is HTMLElement => !!x));
  carryChips(o.key, box);
  return box;
}
