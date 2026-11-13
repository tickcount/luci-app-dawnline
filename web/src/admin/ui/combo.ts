// A field that picks from a list as it is typed in (a device among forty, a
// home service), or takes what is typed when the list has no such thing (an
// address). The portal's field with its name inside; under it the admin's
// list of choices (ui/list-drop.ts: the same glass and rows), narrowed to
// what is typed. The keyboard stays in the field: the arrows walk the rows,
// Return takes the one they stand on, Escape shuts the list. A press on the
// field's chevron opens the whole list. No browser datalist: its popup and
// its arrow are the system's and cannot be drawn.

import { h } from '../../portal/dom';
import { appear, EDGE, GAP, opened, vanish } from '../../portal/ui/drop';
import { layer } from '../../portal/ui/layer';
import { ic } from './icons';
import { composing } from '../../shared/keys';

export interface ComboItem {
  id: string;
  label: string;
  sub?: string;
  icon?: string;
  /** What the field says once this is picked, when its row's words alone would not tell it apart («iPad · Vika»). */
  says?: string;
}

export interface Combo {
  el: HTMLElement;
  input: HTMLInputElement;
  /** The item picked (its words stand in the field untouched), and what the field says. */
  value(): { id: string | null; text: string };
}

export function combo(o: {
  label: string;
  placeholder: string;
  items: ComboItem[];
  /** The item picked at first. */
  pick?: string;
  /** What is typed is an address: mono. */
  mono?: boolean;
  /** Return with the list shut. */
  enter?(): void;
}): Combo {
  const said = (x: ComboItem) => x.says ?? x.label;
  let picked = o.items.find((x) => x.id === o.pick) ?? null;
  const input = h('input', {
    type: 'text',
    value: picked ? said(picked) : '',
    placeholder: o.placeholder,
    'aria-label': o.label,
    role: 'combobox',
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    autocomplete: 'off',
    autocapitalize: 'none',
    autocorrect: 'off',
    spellcheck: 'false',
    'data-1p-ignore': true,
  }) as HTMLInputElement;
  const lead = h('span', { class: 'kt-cb-ic', 'aria-hidden': 'true' });
  const key = h('button', { type: 'button', class: 'kt-cb-k', tabindex: '-1', 'aria-label': o.label }, ic('chevron'));
  const el = h('label', { class: `field kt-cb${o.mono ? ' mono' : ''}` }, h('span', { class: 'kt-cb-l' }, o.label), lead, input, key);
  const draw = () => {
    lead.replaceChildren(...(picked?.icon ? [ic(picked.icon)] : []));
    lead.hidden = !picked?.icon;
    el.classList.toggle('picked', !!picked);
  };
  draw();

  let pop: HTMLElement | null = null;
  let rows: HTMLElement[] = [];
  let shown: ComboItem[] = [];
  let at = -1;
  let release: (() => boolean) | null = null;
  const mark = () => rows.forEach((r, i) => r.classList.toggle('on', i === at));
  const take = (it: ComboItem) => {
    picked = it;
    input.value = said(it);
    draw();
    close();
  };
  const place = () => {
    if (!pop) return;
    const k = el.getBoundingClientRect();
    const w = Math.min(Math.max(k.width, 248), 420, innerWidth - EDGE * 2);
    pop.style.width = `${w}px`;
    const room = Math.max(innerHeight - k.bottom - GAP - EDGE, k.top - GAP - EDGE);
    (pop.firstElementChild as HTMLElement).style.maxHeight = `${Math.max(120, Math.min(room, 288))}px`;
    const ht = pop.offsetHeight;
    const left = Math.max(EDGE, Math.min(k.left, innerWidth - EDGE - w));
    const below = k.bottom + GAP + ht <= innerHeight - EDGE || k.top - GAP - ht < EDGE;
    Object.assign(pop.style, {
      left: `${left + scrollX}px`,
      top: `${(below ? k.bottom + GAP : k.top - GAP - ht) + scrollY}px`,
      transformOrigin: `24px ${below ? 0 : ht}px`,
    });
  };
  /** The list for what is typed (`all`: every item, whatever the field says). */
  const fill = (all: boolean) => {
    const t = input.value.trim().toLocaleLowerCase();
    shown =
      all || !t || (picked && said(picked) === input.value)
        ? o.items
        : o.items.filter((x) => `${x.label} ${x.sub ?? ''}`.toLocaleLowerCase().includes(t));
    if (!shown.length) return close();
    rows = shown.map((it, i) => {
      const b = h(
        'div',
        { role: 'option', 'aria-selected': String(it === picked), class: `mi${it === picked ? ' picked' : ''}` },
        it === picked ? ic('check') : it.icon ? ic(it.icon) : h('span', { class: 'i kt-ld-none', 'aria-hidden': 'true' }),
        h('span', { class: 'mi-b' }, h('span', { class: 'mi-l' }, it.label), it.sub ? h('span', { class: 'mi-s' }, it.sub) : null),
      );
      // the press must not take the focus out of the field
      b.addEventListener('pointerdown', (e) => e.preventDefault());
      b.addEventListener('click', () => take(it));
      b.addEventListener('pointermove', () => {
        if (at === i) return;
        at = i;
        mark();
      });
      return b;
    });
    at = Math.max(0, picked ? shown.indexOf(picked) : 0);
    const inner = h('div', { class: 'kt-ld-in' }, h('div', { class: 'pop-grp' }, ...rows));
    const body = h('div', { class: 'pop-body kt-ld-body' }, inner);
    if (pop) pop.replaceChildren(body);
    else {
      pop = h('div', { class: 'pop drop kt-ld kt-cb-pop', role: 'listbox', 'aria-label': o.label }, body);
      layer().append(pop);
      place();
      appear(pop);
      release = opened(pop, el, close);
      input.setAttribute('aria-expanded', 'true');
      addEventListener('scroll', away, true);
    }
    place();
    mark();
    rows[at]?.scrollIntoView({ block: 'nearest' });
  };
  // the page scrolled under the list: it would stay where the field was
  const away = (e: Event) => {
    if (pop && !e.composedPath().includes(pop)) close(true);
  };
  function close(now = false) {
    if (!pop) return;
    const p = pop;
    pop = null;
    rows = [];
    release?.();
    release = null;
    removeEventListener('scroll', away, true);
    input.setAttribute('aria-expanded', 'false');
    if (now || !el.isConnected) p.remove();
    else vanish(p);
  }
  input.addEventListener('input', () => {
    // typed over: the field says what is typed now, not the item
    if (picked && input.value !== said(picked)) {
      picked = null;
      draw();
    }
    fill(false);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!pop) return fill(true);
      at = Math.max(0, Math.min(rows.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)));
      mark();
      rows[at]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && !composing(e)) {
      e.preventDefault();
      if (pop && shown[at]) take(shown[at]);
      else o.enter?.();
    }
  });
  input.addEventListener('blur', () => close());
  key.addEventListener('pointerdown', (e) => e.preventDefault());
  key.addEventListener('click', (e) => {
    e.preventDefault();
    input.focus({ preventScroll: true });
    if (pop) close();
    else fill(true);
  });
  return {
    el,
    input,
    value: () => {
      const text = input.value.trim();
      // typed in full: the item of that name, when there is exactly one
      const same = picked ? [picked] : o.items.filter((x) => said(x).toLocaleLowerCase() === text.toLocaleLowerCase());
      return { id: same.length === 1 ? same[0].id : null, text };
    },
  };
}
