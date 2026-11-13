// The People list as cards (card.ts): the notices over it (notices.ts), then from seven people the groups by the
// cards' own matrix (people/card.ts: needs a decision, online, everyone else, paused), each in its order; fewer
// people, or an order picked from the chip, are one stack. A grid of cards 264 px or wider, three across in LuCI's
// column, one on a phone; in «Needs a decision» the cards of a row are one height and their buttons stand on one
// line, elsewhere each card is its own height. A fresh answer draws the cards again only when something they say
// changed, never from under someone picking them or holding the keyboard's focus in them; cards that stay glide
// to their new places. The live speed of those online is the meter's, read once a second while one of their
// speeds is on screen. Nothing found, or nobody yet: the empty state names the reason and the way out.

import { morphValues, same, valuesOf } from '../../ui/reshape';
import type { LogEvent, Person } from '../../../shared/types';
import { h } from '../../../portal/dom';
import { SMOOTH, frozen, still, play } from '../../../portal/motion';
import { appear, fadeAway, look, morphInto, morphText, setText } from '../../../portal/ui/morph';
import { rateOf } from '../../../shared/format';
import { fmt, num } from '../../../shared/i18n';
import { glass } from '../../ui/glass';
import { secHead } from '../../ui/page-head';
import { emptyState } from '../../ui/empty';
import { focusInside, type Poller } from '../../state/poller';
import { LiveMeter } from '../../state/meter';
import { pollMeter } from '../../state/meterpoll';
import { routerDay } from '../../events/clock';
import { byAttention, cardParts, GROUPS, groupTitle, type Group, type Ranked } from '../../people/card';
import { byPerson, presence, type Presence } from '../../people/presence';
import { lastPlace, onlineAbove, sortOf, sortPeople } from '../../people/roster';
import type { Match } from '../../people/find';
import type { ActCtx } from '../../people/ctx';
import type { PeopleHost } from './host';
import { personCard, type CardsCtx, type Live } from './card';
import { paintNotices } from './notices';
import { keepPlace, putChildren } from '../../../portal/ui/put';

/** From this many people the list stands in groups; fewer are one stack in the order of attention. */
const GROUP_FROM = 7;

export interface CardsOpts {
  /** Someone is picking cards (pick.ts): they stay as they are. */
  picking(): boolean;
  /** Cards can be picked: each group's head offers «Select all». */
  pickable: boolean;
  reset(): void;
  add(): void;
  /** Narrow the list to the people a rollout waits on. */
  waiting(): void;
  acts: ActCtx;
}

/** What the list shows now. */
export interface CardsData {
  /** The people the filters and the search leave. */
  people: Person[];
  found: Map<string, Match | null>;
  words: string[];
  /** What was typed in the search. */
  query: string;
}

/**
 * The list drawn again without a blink (DESIGN.md › Repaint choreography); over 40 cards, at once. A card that stays
 * changes in place (portal morphInto, deep: its words morph, a part that came blurs in, one that went fades, its
 * height glides) and glides to its new place, width and opacity (FLIP on SMOOTH, both axes, across groups too); a group's head changes
 * in place the same way; a new card blurs in (`in, s.9, b6`, SMOOTH / 60, to its own opacity); a card no longer there fades where it
 * stood (out, b4, 180 EASE_IN).
 */
function flip(box: HTMLElement, change: () => void) {
  const items = () => [...box.querySelectorAll<HTMLElement>('.pp-card[data-id]')];
  const heads = () => [...box.querySelectorAll<HTMLElement>('.grp[data-g] > :first-child')];
  const box0 = box.getBoundingClientRect();
  const before = new Map(items().map((r) => [r.dataset.id!, [r, r.getBoundingClientRect(), look(r)] as const]));
  const heads0 = new Map(heads().map((x) => [x.parentElement!.dataset.g!, x]));
  change();
  const after = items();
  if (frozen()) {
    // the page stands still: a card built again is put where it stood, and only its values that changed morph
    for (const r of after) {
      const old = before.get(r.dataset.id!)?.[0];
      if (old && old !== r) morphValues(valuesOf(old), r);
    }
    return;
  }
  if (still() || !before.size || after.length > 40) return;
  // in place first (each measured where it stands now), then the places
  const refill = (old: HTMLElement, el: HTMLElement) => {
    // a card that says the same: only its place moves (no walk over its pieces)
    // (its live speed and line left out: the meter fills the new one at once)
    const said = (e: HTMLElement) => {
      const c = e.cloneNode(true) as HTMLElement;
      c.querySelectorAll('.pp-speed').forEach((x) => x.remove());
      return c.innerHTML;
    };
    if (same(said(old), said(el))) return;
    const kids = [...el.childNodes];
    putChildren(el, Array.from(old.childNodes));
    morphInto(el, kids, { deep: true });
  };
  for (const x of heads()) {
    const old = heads0.get(x.parentElement!.dataset.g!);
    if (old && old.className === x.className && old.textContent !== x.textContent) refill(old, x);
  }
  for (const r of after) {
    const was = before.get(r.dataset.id!);
    if (was) refill(was[0], r);
  }
  for (const r of after) {
    const was = before.get(r.dataset.id!);
    if (!was) {
      play(
        r,
        [
          { opacity: 0, transform: 'scale(.9)', filter: 'blur(6px)' },
          { opacity: getComputedStyle(r).opacity, transform: 'none', filter: 'blur(0px)' },
        ],
        { duration: SMOOTH.duration, delay: 60, easing: SMOOTH.easing, fill: 'backwards' },
      );
      continue;
    }
    before.delete(r.dataset.id!);
    const now = r.getBoundingClientRect();
    const dx = was[1].left - now.left;
    const dy = was[1].top - now.top;
    const o = +getComputedStyle(r).opacity;
    // its width (a group of another width) and its own opacity (into Paused, 50%) go with it
    const dw = Math.abs(was[1].width - now.width) > 0.5;
    const fades = Math.abs(was[2].opacity - o) > 0.01;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && !dw && !fades) continue;
    play(
      r,
      [
        { transform: `translate(${dx}px, ${dy}px)`, ...(dw && { width: `${was[1].width}px` }), ...(fades && { opacity: was[2].opacity }) },
        { transform: 'none', ...(dw && { width: `${now.width}px` }), ...(fades && { opacity: o }) },
      ],
      { duration: SMOOTH.duration, easing: SMOOTH.easing },
    );
  }
  for (const [el, at, shows] of before.values()) fadeAway(el, at, box, box0, shows);
}

export class Cards {
  /** The notices and the groups. */
  readonly el: HTMLElement;
  /** The groups and their cards: what pick.ts picks over. */
  readonly groups = h('div', { class: 'groups' });
  private notices = h('div', { class: 'pp-notices' });
  /** Everyone's last 8 days of the log (presence, when paused); null until read. */
  private events: LogEvent[] | null = null;
  private layout = '';
  private lives: Live[] = [];
  /** The devices whose speed shows already (its first words blur in; a repaint carries them). */
  private said = new Set<string>();
  private seen = new Set<Element>();
  private watch: IntersectionObserver;
  private meter = new LiveMeter();
  private poll: Poller<unknown>;
  private beat = 0;
  /**
   * The cards as they stand, by person: one is built again only when its person is another object (the
   * page keeps who did not change the same object) or what else it shows moved; the others keep their nodes,
   * with their live speed and line as they are.
   */
  private kept = new Map<string, { p: Person; key: string; el: HTMLElement; lives: Live[] }>();

  constructor(
    private host: PeopleHost,
    private o: CardsOpts,
  ) {
    this.el = h('div', { class: 'pp-list' }, this.notices, this.groups);
    this.watch = new IntersectionObserver((es) => {
      for (const e of es) {
        if (e.isIntersecting) this.seen.add(e.target);
        else this.seen.delete(e.target);
      }
    });
    // the meter only while a speed is on screen and the list is in the page
    this.poll = pollMeter(
      this.meter,
      () => this.el.isConnected && this.lives.length > 0 && this.seen.size > 0,
      () => this.tick(),
    );
  }

  /** Stop reading the meter (LuCI left the page). */
  stop() {
    this.poll.stop();
    this.watch.disconnect();
  }

  /** The log the cards read (everyone's, the last 8 days, oldest first). */
  take(events: LogEvent[]) {
    this.events = events;
  }

  /** Draw again whatever is there (the view came back from the map, the log came in). */
  forget() {
    this.layout = '';
  }

  /** The router's day a person was paused, from the log ('' when it is older than what was read). */
  private pausedAt(): Map<string, string> {
    const m = new Map<string, string>();
    for (const e of this.events ?? []) if (e.type === 'paused' && e.person) m.set(e.person, routerDay(e.ts, this.host.st().tz));
    return m;
  }

  paint(d: CardsData, quiet: boolean) {
    const host = this.host;
    const r = host.route();
    const st = host.st();
    const now = host.now();
    const t = { now, today: host.today() };
    const paused = this.pausedAt();
    const mine = this.events ? byPerson(this.events) : null;
    const press = new Map<string, Presence>();
    const ranked: Ranked[] = d.people.map((p) => {
      const srv = st.servers.find((s) => s.id === p.server);
      const place = lastPlace(p, st.geo);
      const parts = cardParts(p, srv, t, { pausedAt: paused.get(p.id), city: place?.city || place?.country || '' });
      if (mine && parts.presence) press.set(p.id, presence(p, srv, mine.get(p.id) ?? [], now, st.tz));
      return {
        p,
        parts,
        speed: p.rate?.[p.rate.length - 1]?.[2] ?? 0,
        week: p.devices.reduce((n, x) => n + x.spark.reduce((a, s) => a + s[0] + s[1], 0), 0),
        pausedAt: paused.get(p.id) ?? '',
      };
    });
    const s = sortOf(r.sort);
    const list = s ? sortPeople(d.people, s).map((p) => ranked.find((x) => x.p === p)!) : byAttention(ranked, t.today);
    const groups = GROUPS.map((g) => [g, list.filter((x) => x.parts.group === g)] as [Group, Ranked[]]).filter(([, xs]) => xs.length);
    const sections: [Group | 'all', Ranked[]][] = !s && list.length >= GROUP_FROM && groups.length > 1 ? groups : [['all', list]];
    const width = this.groups.clientWidth || this.el.clientWidth;
    /** What a person's card says that is not the person themself: where it stands in time, and what was searched. */
    const says = (x: Ranked) => [
      x.p.id,
      x.p.name,
      x.parts,
      x.p.online,
      x.p.month,
      x.p.quota_used,
      x.p.has_link,
      x.p.devices.map((v) => [
        v.id,
        v.name,
        v.kind,
        v.online,
        v.disabled,
        v.spark,
        v.link?.state,
        v.config_stale,
        Math.floor(v.handshake / 60),
      ]),
      press.get(x.p.id)?.since,
      Math.round((press.get(x.p.id)?.week ?? -1) / 3600),
      lastPlace(x.p, st.geo)?.city,
      // «Offline for 3 h» moves on with the clock
      x.p.online ? 0 : Math.floor((now - x.p.last_seen) / 3600),
    ];
    const key = JSON.stringify([
      sections.map(([g, xs]) => [g, xs.map(says)]),
      d.words,
      [...d.found].map(([id, m]) => [id, m?.device.id, m?.value]),
      Math.round(width / 40),
      st.people.length,
      st.servers.map((v) => [v.id, v.name, v.enabled]),
    ]);
    paintNotices(this.notices, st, { write: host.write, acts: this.o.acts, waiting: () => this.o.waiting() });
    // nothing to say anew; or someone is picking cards or has the keyboard in them: they stay as they are
    if (key === this.layout || (quiet && (this.o.picking() || focusInside(this.groups)))) return;
    const first = !this.layout;
    this.layout = key;
    const c: CardsCtx = { st: host.st, now: host.now, write: host.write, acts: this.o.acts };
    const all = () =>
      this.o.pickable
        ? h('button', { type: 'button', class: 'pill-link pk-all', tabindex: '-1' }, h('span', {}, _('Select all')))
        : undefined;
    // «Online» and the page's «N online» count the same people: those online who stand in another group are above
    const above = onlineAbove(
      list.map((x) => x.p),
      t,
    );
    const count = (g: Group, n: number) => (g === 'online' && above ? fmt(_('%s · %s more above'), num(n), num(above)) : num(n));
    const next = new Map<string, { p: Person; key: string; el: HTMLElement; lives: Live[] }>();
    const card = (x: Ranked, cw: number): HTMLElement => {
      const srv = st.servers.find((v) => v.id === x.p.server);
      const k = JSON.stringify([says(x), d.words, d.found.get(x.p.id)?.device.id, d.found.get(x.p.id)?.value, cw, srv?.name, srv?.enabled]);
      let it = this.kept.get(x.p.id);
      if (!it || it.p !== x.p || it.key !== k) {
        const lives: Live[] = [];
        const el = personCard(
          c,
          {
            p: x.p,
            parts: x.parts,
            pres: press.get(x.p.id) ?? null,
            place: lastPlace(x.p, st.geo),
            match: d.found.get(x.p.id) ?? null,
            words: d.words,
            width: cw,
          },
          lives,
        );
        it = { p: x.p, key: k, el, lives };
      }
      next.set(x.p.id, it);
      this.lives.push(...it.lives);
      return it.el;
    };
    const draw = () => {
      for (const l of this.lives) this.watch.unobserve(l.speed);
      this.lives = [];
      this.seen.clear();
      next.clear();
      if (!list.length) {
        this.kept = next;
        return void putChildren(this.groups, [this.empty(d.query)]);
      }
      putChildren(
        this.groups,
        sections.map(([g, xs]) => {
          // a list of one or two: the card that adds the next person stands in the grid
          const adds = g === 'all' && host.write && st.people.length <= 2 && xs.length === st.people.length;
          const n = xs.length + (adds ? 1 : 0);
          const cw = cardWidth(width, n);
          return h(
            'section',
            { class: 'grp', 'data-g': g },
            g === 'all' ? (all() ? h('div', { class: 'pp-allhead' }, all()!) : null) : secHead(groupTitle(g), count(g, xs.length), all()),
            h('div', { class: `pp-grid in-${g} n${Math.min(n, 4)}` }, ...xs.map((x) => card(x, cw)), adds ? this.addCard() : null),
          );
        }),
      );
      this.kept = next;
      for (const l of this.lives) this.watch.observe(l.speed);
      // devices that went offline: their speed blurs in again when they are back
      const on = new Set(this.lives.map((l) => l.ids.join()));
      for (const k of this.said) if (!on.has(k)) this.said.delete(k);
      this.beat = 0;
      this.tick();
    };
    // (the cards that stay are moved into the next groups as those are built: the page keeps its place over that)
    if (!first) return flip(this.groups, () => keepPlace(this.groups, draw));
    draw();
  }

  /** A new second of the meter: the lines slide each second, the words change every third (at once the first time). */
  private tick() {
    const at = Date.now();
    const words = this.beat % 3 === 0;
    for (const l of this.lives) {
      const s = this.meter.speed(null, at, l.ids);
      if (s.pts.length > 1) l.line.push(s.pts.map((p) => p[2]));
      if (!s.pts.length) continue;
      const text = `↓ ${rateOf(s.tx)}`;
      if (!l.speed.textContent) {
        setText(l.speed, text);
        // the first time it is said for these devices it blurs in with its line (a repaint that keeps them on
        // carries it as it stood)
        const key = l.ids.join();
        if (!this.said.has(key)) appear(l.speed.parentElement ?? l.speed);
        this.said.add(key);
      } else if (words && text !== l.speed.textContent) morphText(l.speed, text);
    }
    this.beat++;
  }

  private addCard(): HTMLElement {
    const b = h('button', { type: 'button', class: 'dev add pp-add' }, glass('plus', 'grey'), h('span', {}, _('Add person')));
    b.addEventListener('click', () => this.o.add());
    return b;
  }

  /** Why the list is empty, and the one way out of it. */
  private empty(query: string): HTMLElement {
    const host = this.host;
    const r = host.route();
    const any = host.st().people.length > 0;
    const q = query.trim();
    const why = q
      ? fmt(_('Nobody matches “%s”.'), q)
      : r.need
        ? _('Nobody waits for a new configuration.')
        : r.group === 'need'
          ? _('Nobody waits for a decision.')
          : r.group === 'paused'
            ? _('Nobody is paused.')
            : r.group === 'online'
              ? _('Nobody is online now.')
              : r.server && any
                ? _('Nobody on this server yet.')
                : _('Add someone and send them their personal link: they add their devices themselves.');
    const b = h(
      'button',
      { type: 'button', class: `btn ${any ? 'soft' : 'accent'} sm` },
      h('span', {}, any ? _('Reset the filters') : _('Add person')),
    );
    b.addEventListener('click', () => (any ? this.o.reset() : this.o.add()));
    return emptyState({
      icon: 'people',
      title: any ? _('Nothing found') : _('No people yet'),
      text: why,
      action: any || host.write ? b : null,
    });
  }
}

/** A card's width in a grid of `n` in a list `w` wide (people.css .pp-grid: 264 px or more, 10 apart; a phone: one). */
function cardWidth(w: number, n: number): number {
  const box = Math.min(w, n === 1 ? 440 : n === 2 ? 890 : w);
  if (w < 560) return box;
  const cols = Math.max(1, Math.min(n, Math.floor((box + 10) / 274)));
  return (box - 10 * (cols - 1)) / cols;
}
