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
