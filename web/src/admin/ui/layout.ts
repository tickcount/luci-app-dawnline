// Layout pieces: a labelled setting row, a settings card, a titled group, a
// "missing package" row, LuCI's callout and an SVG holder.

import type { Child } from '../luci.d';
import { E } from '../e';
import { icon } from '../../shared/icons';

/** Label and help on the left, the control on the right. */
export function row(label: string, control: Node, help?: string): HTMLElement {
  return E('div', { class: 'dl-setrow' }, [
    E('div', { class: 'dl-stack' }, [E('span', { class: 'dl-setrow-label' }, label), help ? E('span', { class: 'dl-sub' }, help) : '']),
    E('div', { class: 'dl-setrow-ctl' }, control),
  ]);
}

/**
 * A row whose help line follows its input: `help` says what the value gives,
 * or what is wrong (red, the input marked too). Callers that change what the
 * help depends on call `refresh()`.
 */
export function liveRow(
  label: string,
  el: HTMLInputElement,
  help: () => { text: string; bad: boolean },
  control: Node = el,
): HTMLElement & { refresh: () => void; help: () => { text: string; bad: boolean } } {
  const r = row(label, control, ' ') as HTMLElement & { refresh: () => void; help: () => { text: string; bad: boolean } };
  const sub = r.querySelector('.dl-sub') as HTMLElement;
  const paint = () => {
    const h = help();
    sub.textContent = h.text;
    sub.classList.toggle('bad', h.bad);
    el.classList.toggle('cbi-input-invalid', h.bad);
  };
  el.addEventListener('input', paint);
  r.refresh = paint;
  r.help = help;
  paint();
  return r;
}

/**
 * liveRow for a dialog field (LuCI's cbi-value layout: label beside the
 * control, the help under the label as on the cards). Same contract: `help`
 * repaints on input, `refresh()` when something else changes.
 */
export function liveField(
  label: string,
  el: HTMLInputElement | HTMLSelectElement,
  help: () => { text: string; bad: boolean },
  control: Node = el,
): HTMLElement & { refresh: () => void; help: () => { text: string; bad: boolean } } {
  const sub = E('div', { class: 'dl-sub' });
  const r = E('div', { class: 'cbi-value dl-live' }, [
    E('div', { class: 'cbi-value-title' }, [E('label', {}, label), sub]),
    E('div', { class: 'cbi-value-field' }, control),
  ]) as HTMLElement & { refresh: () => void; help: () => { text: string; bad: boolean } };
  const paint = () => {
    const h = help();
    sub.textContent = h.text;
    sub.classList.toggle('bad', h.bad);
    el.classList.toggle('cbi-input-invalid', h.bad);
  };
  el.addEventListener('input', paint);
  el.addEventListener('change', paint);
  r.refresh = paint;
  r.help = help;
  paint();
  return r;
}

/** The first problem among live rows (their help as it stands), or null: what refuses a Save. */
export function firstBad(
  rows: { help?: () => { text: string; bad: boolean } }[],
  helps: (() => { text: string; bad: boolean })[] = [],
): string | null {
  for (const r of rows) {
    const h = r.help?.();
    if (h?.bad) return h.text;
  }
  for (const f of helps) {
    const h = f();
    if (h.bad) return h.text;
  }
  return null;
}

/** A section card with its own footer (Save etc.). */
export function card(title: string, body: (Node | string)[], foot: (Node | string)[], extra = ''): HTMLElement {
  return E('section', { class: `dl-setsec ${extra}` }, [
    E('div', { class: 'dl-setsec-body' }, [title ? E('h3', {}, title) : '', ...body]),
    foot.length ? E('div', { class: 'dl-setsec-foot' }, foot) : '',
  ]);
}

/** A titled group inside a settings card: icon, title and a short line, then its rows separated by hairlines. */
export function group(ic: string, title: string, sub: string, items: (Node | string)[]): HTMLElement {
  return E('div', { class: 'dl-group' }, [
    E('div', { class: 'dl-group-head' }, [
      E('span', { class: 'dl-group-ic' }, icon(ic)),
      E('span', { class: 'dl-stack' }, [E('b', {}, title), sub ? E('span', { class: 'dl-sub' }, sub) : '']),
    ]),
    E(
      'div',
      { class: 'dl-group-body' },
      items.filter((x) => x !== ''),
    ),
  ]);
}

/** Something missing, shown where its feature is used: icon tile, title and a line, then its actions. */
export function needRow(ic: string, tone: '' | 'bad' | 'warn', title: string, sub: Child, actions: Child): HTMLElement {
  return E('div', { class: `dl-row dl-need-row ${tone}` }, [
    tone ? E('span', { class: 'dl-need-ic' }, icon(ic)) : icon(ic),
    E('span', { class: 'dl-row-main dl-stack' }, [E('b', {}, title), E('span', { class: 'dl-sub' }, sub)]),
    actions,
  ]);
}

export function callout(tone: 'ok' | 'warn' | 'error' | 'info', children: Child): HTMLElement {
  const cls = { ok: 'success', warn: 'warning', error: 'error', info: 'notice' }[tone];
  return E('div', { class: `alert-message ${cls}` }, children);
}

/** Trusted SVG markup (charts, QR codes) in a div. */
export function svg(markup: string, cls = ''): HTMLElement {
  const el = E('div', { class: cls });
  el.innerHTML = markup;
  return el;
}
