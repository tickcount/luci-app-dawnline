// The section rail of a page with many parts (Settings): every section as a
// link, the current one on the rail's one highlight; a section that is not
// fine carries an alert in its tone. The page says what a pick
// does (swap the view on screen). Narrower than 840 px of the page the rail
// is a jump menu: a sticky pill «Sections» (with how many sections are not
// fine) that opens every section in a list, the current one checked (its
// state as the line under it).

import { h } from '../../portal/dom';
import { glass } from './glass';
import { ic } from './icons';
import { openList, type ListItem } from './list-drop';
import { onNavigate } from './nav';

type RailTone = 'ok' | 'warn' | 'bad' | 'off';

export interface RailItem {
  id: string;
  /** Glass shape on the rail, line icon in the jump menu. */
  icon: string;
  line: string;
  title: string;
  /** Its state in a few words, under the title. */
  value?: string;
  tone?: RailTone;
  href: string;
}

export interface RailGroup {
  label: string;
  items: RailItem[];
}

export interface Rail {
  el: HTMLElement;
  /** The jump pill of a narrow page. */
  jump: HTMLElement;
  set(groups: RailGroup[]): void;
  /** The current section (the highlight glides there). */
  current(id: string): void;
}

const toneOf = (t?: RailTone) => (t === 'bad' ? 'red' : t === 'warn' ? 'orange' : 'grey');
const alarms = (t?: RailTone): t is 'warn' | 'bad' => t === 'warn' || t === 'bad';
const toneWords = (t: 'warn' | 'bad') => (t === 'bad' ? _('Not working') : _('Needs attention'));

/** `label`: what the sections are of («Settings' sections»); `go`: a section picked on the rail or in the jump menu. */
export function rail(label: string, go: (id: string) => void): Rail {
  let groups: RailGroup[] = [];
  let cur = '';
  const hl = h('span', { class: 'kt-rl-hl', 'aria-hidden': 'true' });
  const el = h('nav', { class: 'kt-rl', 'aria-label': label }, hl);
  const jumpAl = h('span', { class: 'kt-rl-ja' });
  const jump = h(
    'button',
    { type: 'button', class: 'kt-rl-jump', 'aria-haspopup': 'menu', 'aria-expanded': 'false' },
    ic('log'),
    h('span', {}, _('Sections')),
    jumpAl,
    ic('chevron', 'i kt-rl-jc'),
  );
  const links = new Map<string, HTMLElement>();
  const all = () => groups.flatMap((g) => g.items);

  // The highlight glides from link to link (the stylesheet, as a menu's does); the first time it stands on one
  // (the rail just came on screen) it is there at once: there is nowhere to glide from.
  let stood = false;
  const place = () => {
    const a = links.get(cur);
    if (!a || !a.offsetHeight) {
      stood = false;
      return void (hl.style.opacity = '0');
    }
    hl.classList.toggle('glides', stood);
    if (!stood) void hl.offsetHeight;
    stood = true;
    hl.style.opacity = '1';
    hl.style.transform = `translateY(${a.offsetTop}px)`;
    hl.style.height = `${a.offsetHeight}px`;
  };

  const link = (it: RailItem) => {
    const cls = ['kt-rl-i', it.tone && it.tone !== 'ok' ? it.tone : '', it.id === cur ? 'on' : ''];
    const a = h(
      'a',
      {
        class: cls.filter(Boolean).join(' '),
        href: it.href,
        'data-id': it.id,
        'aria-current': it.id === cur ? 'location' : null,
        // a state that does not fit its line is read whole here
        title: it.value ? `${it.title} · ${it.value}` : null,
      },
      h('span', { class: 'kt-rl-ic' }, glass(it.icon, it.id === cur && toneOf(it.tone) === 'grey' ? 'blue' : toneOf(it.tone))),
      h(
        'span',
        { class: 'kt-rl-t' },
        h('b', {}, it.title),
        it.value ? h('span', { class: `kt-rl-v${alarms(it.tone) ? ` ${it.tone}-t` : ''}` }, it.value) : null,
      ),
      alarms(it.tone) ? h('span', { class: `kt-rl-al ${it.tone}-t`, title: toneWords(it.tone) }, ic('alert')) : null,
    );
    a.addEventListener('click', (e) => {
      const m = e as MouseEvent;
      if (m.button !== 0 || m.metaKey || m.ctrlKey || m.shiftKey || m.altKey) return;
      e.preventDefault();
      go(it.id);
    });
    links.set(it.id, a);
    return a;
  };

  const set = (g: RailGroup[]) => {
    groups = g;
    links.clear();
    // the highlight stays where it is in the page (taken out and put back, it would stand on its link at once: a
    // node just put in has nowhere to glide from); only the links are drawn again
    for (const c of Array.from(el.children)) if (c !== hl) c.remove();
    el.append(
      ...g.map((grp) => h('div', { class: 'kt-rl-g' }, h('span', { class: 'kt-rl-l' }, grp.label), ...grp.items.map((it) => link(it)))),
    );
    const bad = all().filter((x) => alarms(x.tone));
    jumpAl.replaceChildren(...(bad.length ? [ic('alert'), String(bad.length)] : []));
    jumpAl.className = `kt-rl-ja${bad.some((x) => x.tone === 'bad') ? ' bad-t' : bad.length ? ' warn-t' : ''}`;
    requestAnimationFrame(place);
  };

  const current = (id: string) => {
    if (id === cur) return;
    const was = cur;
    cur = id;
    for (const [k, a] of links) {
      const on = k === id;
      a.classList.toggle('on', on);
      if (on) a.setAttribute('aria-current', 'location');
      else a.removeAttribute('aria-current');
    }
    // the glass of a section that is fine lights blue while it is the current one
    for (const k of [was, id]) {
      const it = all().find((x) => x.id === k);
      const a = links.get(k);
      if (it && a && toneOf(it.tone) === 'grey') a.querySelector('.kt-rl-ic')?.replaceChildren(glass(it.icon, k === id ? 'blue' : 'grey'));
    }
    place();
  };

  // every section in a list under the pill (it scrolls where a phone is too short for it)
  jump.addEventListener('click', () => {
    const items: (ListItem | null)[] = [];
    groups.forEach((g, gi) => {
      if (gi) items.push(null);
      for (const it of g.items)
        items.push({
          id: it.id,
          label: it.title,
          icon: it.line,
          on: it.id === cur,
          sub: it.value ?? (alarms(it.tone) ? toneWords(it.tone) : undefined),
          tone: alarms(it.tone) ? it.tone : undefined,
        });
    });
    openList(jump, items, label, (id) => go(id), { max: 640, role: 'menu' });
  });
  addEventListener('resize', place, { passive: true });
  const off = onNavigate(() => {
    removeEventListener('resize', place);
    off();
  });

  return { el, jump, set, current };
}

/** The nearest box that scrolls an element (Outline: #maincontent), or the window. */
export function scrollerOf(el: HTMLElement): HTMLElement | Window {
  let n: Node | null = el;
  while (n) {
    if (n instanceof ShadowRoot) n = n.host;
    else if (n instanceof HTMLElement) {
      const o = getComputedStyle(n).overflowY;
      if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight + 1 && n !== document.documentElement && n !== document.body)
        return n;
      n = n.parentNode;
    } else n = n.parentNode;
  }
  return window;
}

/**
 * What sticks to the top of the page's scroller sticks under that scroller's own top padding (Outline's
 * #maincontent has one), and rows would show through the gap above it: the padding is published as --sc-pad, and
 * the sticky parts take it off their `top`.
 */
export function publishScrollPad(page: HTMLElement) {
  requestAnimationFrame(() => {
    const sc = scrollerOf(page);
    const pad = sc instanceof Window ? 0 : parseFloat(getComputedStyle(sc).paddingTop) || 0;
    page.style.setProperty('--sc-pad', `${pad}px`);
  });
}
