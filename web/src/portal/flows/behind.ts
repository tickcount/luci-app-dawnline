// A person's own router and the networks behind it. A router is a whole place, not one more device, and it changes
// how the server works (routes, what others reach), so by the server's rule a person may only ask: adding a router
// is a request the admin takes or turns down, its networks typed with it (flows/add.ts), and a network added later
// is asked for the same way. Taking one away is the person's own to do at once: it only narrows what is reached.
// Where the admin said so, either is made at once (State.server.routers, .nets).
//
// The networks' sheet opens from the router's ⋯ menu and from the knob beside it that says something waits or was
// turned down. Nothing in the sheet is made by a press: what is typed or taken away is a draft until its one button
// sends it, and the sheet shut without it changes nothing.

import type { Device } from '../../shared/types';
import { declinedWords } from '../../shared/format';
import { fmt } from '../../shared/i18n';
import type { Taken } from '../../shared/nets';
import { ApiError, call } from '../api';
import { h, ic } from '../dom';
import { repaint, setState, state, type State } from '../state';
import { toast } from '../ui/feedback';
import { glass } from '../ui/glass';
import { netChips, type NetItem } from '../ui/net-chips';
import { closeSheet, head, openSheet, sub, type View } from '../ui/sheet';

/** A router asked for here that the admin has not answered: it cannot connect yet. */
export const isWaiting = (d: Device): boolean => d.kind === 'router' && !!d.waiting && !d.declined;

/** A router asked for here that the admin turned down: it stays to say why, until its owner removes it. */
export const isTurnedDown = (d: Device): boolean => d.kind === 'router' && !!d.waiting && !!d.declined;

/** The admin's reason as a clause after a colon, or nothing when none was given. */
const reason = (d: Device): string => (d.declined && d.declined !== 'plain' ? `: ${declinedWords(d.declined)}` : '');

/** Why a router asked for was turned down, in a sentence. */
export const turnedDownWords = (d: Device): string => `${_('The admin turned this router down')}${reason(d)}`;

/**
 * What a router's card says beside its ⋯ about what was asked of the admin (null: nothing): a network that waits
 * (a clock, in the pending tone), or one turned down (an alert, in the bad tone, with the reason). A router that
 * itself waits says so in its status line, which otherwise keeps saying what it always says.
 */
export function cardSignal(d: Device): { icon: string; bad: boolean; words: string } | null {
  if (d.kind !== 'router' || d.waiting) return null;
  if (d.ask?.length) return { icon: 'clock', bad: false, words: _('A network behind it waits for the admin') };
  const no = d.declined_nets ?? [];
  return no.length ? { icon: 'alert', bad: true, words: `${fmt(_('The admin turned %s down'), no.join(', '))}${reason(d)}` } : null;
}

/** The menu's line under «Networks behind it»: what there is, in a few words. */
export function behindSummary(d: Device): string {
  if (d.ask?.length) return _('Waiting for the admin');
  if (d.declined_nets?.length) return _('Turned down');
  return d.behind?.length ? d.behind.join(', ') : _('None');
}

/** A router's networks are worth naming only where home reaches the person's devices: not with the internet alone. */
export const netsMatter = (st: State): boolean => st.person.access !== 'internet';

/** What a network typed here must not share addresses with, as far as the page knows; `but`: the router itself. */
function takenHere(but?: Device): Taken[] {
  const st = state();
  return [
    ...(st?.server.home ?? []).map((n) => ({ cidr: n, who: _('a network at home') })),
    ...(st?.person.devices ?? [])
      .filter((d) => d.id !== but?.id)
      .flatMap((d) => (d.behind ?? []).map((n) => ({ cidr: n, who: fmt(_('behind your %s'), d.name) }))),
  ];
}

/** What is typed in a router's sheet and not sent yet, by device: shutting the sheet does not lose it. */
const drafts = new Map<string, { add: string[]; drop: Set<string> }>();

/** A router's networks: what works, what waits, what was turned down, and the one button that sends the changes. */
function view(d: Device): View {
  const title = fmt(_('Networks behind %s'), d.name);
  const asks = state()?.server.nets !== 'free';
  const draft = drafts.get(d.id) ?? drafts.set(d.id, { add: [], drop: new Set<string>() }).get(d.id)!;
  const left = (list: string[] | undefined) => (list ?? []).filter((n) => !draft.drop.has(n));
  const send = h('button', { type: 'button', class: 'btn accent block' }, h('span', {}, '')) as HTMLButtonElement;
  const sync = () => {
    send.disabled = !draft.add.length && !draft.drop.size;
    send.firstElementChild!.textContent = draft.add.length && asks ? _('Ask the admin') : _('Save');
  };
  const drop = (n: string) => did(() => draft.drop.add(n));
  const list = netChips({
    key: `pb:${d.id}`,
    taken: () => takenHere(d),
    items: () => [
      ...left(d.behind).map((n): NetItem => ({ n, look: 'is', x: { label: _('Remove'), run: () => drop(n) } })),
      ...left(d.ask).map((n): NetItem => ({
        n,
        look: 'asked',
        word: _('waits'),
        icon: 'clock',
        x: { label: _('Take the request back'), run: () => drop(n) },
      })),
      ...left(d.declined_nets).map((n): NetItem => ({
        n,
        look: 'bad',
        word: _('turned down'),
        x: { label: _('Clear'), run: () => drop(n) },
      })),
      // typed here, not sent yet
      ...draft.add.map((n): NetItem => ({
        n,
        look: 'is',
        x: { label: _('Remove'), run: () => did(() => draft.add.splice(draft.add.indexOf(n), 1)) },
      })),
    ],
    add: (n) => did(() => draft.add.push(n)),
    // why the admin turned something down, once, under the chips
    notes: () =>
      left(d.declined_nets).length && d.declined && d.declined !== 'plain'
        ? [h('p', { class: 'nb-state bad-t' }, ic('alert'), `${declinedWords(d.declined)}.`)]
        : [],
  });
  function did(make: () => void) {
    make();
    list.paint();
    sync();
  }
  const { el: err, say } = (() => {
    const el = h('p', { class: 'nb-say bad-t', hidden: true });
    return { el, say: (t: string) => ((el.hidden = false), void (el.textContent = t)) };
  })();
  send.addEventListener('click', async () => {
    const asked = draft.add.length > 0 && asks;
    send.disabled = true;
    try {
      const r = await call<{ state: State }>(`devices/${d.id}`, {
        action: 'networks',
        networks: [...left(d.behind), ...left(d.ask), ...draft.add],
        cleared: (d.declined_nets ?? []).filter((n) => draft.drop.has(n)),
      });
      drafts.delete(d.id);
      setState(r.state);
      // the router's card says what waits (the clock beside its ⋯): drawn again now
      repaint();
      closeSheet();
      toast(asked ? _('Asked: the admin decides') : _('Saved'));
    } catch (e) {
      // the router's own word (a network something has already): said here, the draft kept to be changed
      say(e instanceof ApiError || e instanceof Error ? e.message : String(e));
      sync();
    }
  });
  sync();
  const el = h(
    'div',
    { class: 'view' },
    head(title),
    sub(
      asks
        ? _('Devices at home reach these through the router. A new one is confirmed by the admin.')
        : _('Devices at home reach these through the router.'),
    ),
    list.el,
    err,
    send,
  );
  return { el, label: title };
}

export const openBehind = (d: Device) => openSheet(() => view(d));

/**
 * Adding a router (flows/add.ts): the networks behind it, typed with it. A block of the form in the option row's
 * place and shape: its glass, its name and what it means, then the chips. `nets` is the draft's own list.
 */
export function routerNets(nets: string[]): HTMLElement {
  const list = netChips({
    key: 'pb:new',
    taken: () => takenHere(),
    items: () =>
      nets.map((n): NetItem => ({ n, look: 'is', x: { label: _('Remove'), run: () => (nets.splice(nets.indexOf(n), 1), list.paint()) } })),
    add: (n) => (nets.push(n), list.paint()),
  });
  return h(
    'div',
    { class: 'pb-add' },
    glass('router', 'blue'),
    h(
      'span',
      { class: 'sw-t' },
      h('b', {}, _('Networks behind it')),
      h('span', { class: 'sw-sub' }, _('Devices at home reach them through it.')),
      list.el,
    ),
  );
}

/**
 * Where a device's set-up would open, a router's request stands. Not another view of the sheet: the form the request
 * was made in turns into this in place (flows/add.ts), so the sheet goes from one to the other in one move. These
 * are its parts: the glass, one line, the way out.
 */
export function sentParts(): HTMLElement[] {
  return [
    h('div', { class: 'pb-sent-g' }, glass('router', 'orange')),
    h('p', { class: 'pb-sent-t' }, _('The connection shows here once the admin confirms the router.')),
    h('button', { type: 'button', class: 'btn soft block', onclick: () => closeSheet() }, h('span', {}, _('Done'))),
  ];
}
