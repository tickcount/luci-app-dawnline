// What a router's owner asked for on their own page, answered: the router itself (it waits, unable to connect,
// until it is taken) or networks behind it. An answer is a decision, not a setting: it is made at once, said in a
// toast and undone from it («reopen»: the question stands again). Taken, the networks are checked by the router
// against everything they must not share addresses with, and its refusal names whose they are. Turned down, the
// owner reads why on their page, in the words picked here.
//
// The question stands in the device's dialog (askBlock) and in the server's Network section (its row); a device's
// card only leads to the dialog: a card is no place for a question.

import type { Declined, Device, Person, Server } from '../../shared/types';
import { h } from '../../portal/dom';
import { openMenu } from '../../portal/ui/menu';
import { declinedWords } from '../../shared/format';
import { fmt } from '../../shared/i18n';
import { api } from '../api';
import { asksOf, behindRefetch, routerAsks, wishOf } from '../servers/behind';
import { say } from '../shell/toast';
import { said } from '../../portal/ui/chips-motion';
import { reMark } from '../ui/edit-rows';
import { ic } from '../ui/icons';
import { errorText, notify } from '../ui/toast';

export interface Answer {
  p: Person;
  d: Device;
  /** The networks answered: one of a chip, or all that is asked. */
  nets: string[];
  /** The router itself is what is asked for (its networks come with it). */
  router: boolean;
  /** The page reads the router again. */
  changed(): void;
  /** The router was turned down: it is no device of the admin's lists any more (its dialog shuts). */
  gone?(): void;
}

/** The answer taken back: the question stands again, as its toast's Undo does it. */
function reopen(o: Answer) {
  api
    .deviceAnswer(o.d.id, 'reopen', undefined, o.router, o.nets)
    .then(o.changed)
    .catch((e) => notify(errorText(e), 'error'));
}

/**
 * Take what is asked for. Resolves with why it cannot be taken as it is (the router's words: a network that shares
 * addresses with one something has), or null once it is taken.
 */
export async function takeAsk(o: Answer): Promise<string | null> {
  try {
    await api.deviceAnswer(o.d.id, 'accept', undefined, undefined, o.router ? undefined : o.nets);
  } catch (e) {
    return errorText(e);
  }
  o.changed();
  say(o.router ? fmt(_('Router %s accepted'), o.d.name) : fmt(_('%s: %s accepted'), o.d.name, o.nets.join(', ')), {
    undo: () => reopen(o),
    undone: _('It is asked for again'),
  });
  return null;
}

/** Turn down what is asked for, with the reason its owner will read. */
async function declineAsk(o: Answer, reason: Declined) {
  try {
    await api.deviceAnswer(o.d.id, 'decline', reason, undefined, o.router ? undefined : o.nets);
  } catch (e) {
    return notify(errorText(e), 'error');
  }
  o.changed();
  if (o.router) o.gone?.();
  say(fmt(_('Declined: %s reads so on their page'), o.p.name), { undo: () => reopen(o), undone: _('It is asked for again') });
}

/** «Decline» asks one thing more, in a menu at its button: why, in the words the owner will read. */
export function declineMenu(at: HTMLElement, o: Answer) {
  const reasons: Declined[] = ['overlap', 'unneeded', 'talk'];
  openMenu(
    at,
    [
      ...reasons.map((r) => ({ label: declinedWords(r), icon: 'x', run: () => void declineAsk(o, r) })),
      null,
      { label: _('Without a reason'), icon: 'minus', run: () => void declineAsk(o, 'plain') },
    ],
    o.router ? o.d.name : o.nets.join(', '),
  );
}

/** What the admin should know before taking it, one line each. */
export function askWarnings(p: Person, d: Device, srv: Pick<Server, 'mesh'> | undefined, router: boolean, nets: boolean): string[] {
  return [
    // a router that sends everything into the tunnel brings its whole place's internet with it
    router && p.access !== 'lan' && !d.lan_bypass
      ? fmt(_('%s has Internet access: all of that place’s internet will go through this tunnel.'), p.name)
      : null,
    nets && srv?.mesh === 'off' ? _('Devices do not see each other on this server: only home devices will reach it.') : null,
  ].filter((x): x is string => !!x);
}

/**
 * What a device asks for, with its two answers: a router asked for is the whole of the question, its networks with
 * it; on a router that is a device already, the networks asked for since. Taken, it is made at once, with what that
 * means for other devices said in the block. Null: it asks for nothing.
 */
export function askBlock(o: {
  p: Person;
  d: Device;
  people: Person[];
  srv?: Server;
  write: boolean;
  changed(): void;
  gone?(): void;
}): HTMLElement | null {
  const { d, p } = o;
  const router = routerAsks(d);
  const nets = router ? wishOf(d) : asksOf(d);
  if (!router && !nets.length) return null;
  const answer: Answer = { p, d, nets, router, changed: o.changed, gone: o.gone };
  const refetch = o.srv && nets.length ? behindRefetch(o.people, o.srv, [{ p, d }]) : 0;
  const refused = h('span', { class: 'nb-say bad-t', hidden: true });
  const yes = h('button', { type: 'button', class: 'btn tint sm' }, ic('check'), h('span', {}, _('Accept'))) as HTMLButtonElement;
  const no = h('button', { type: 'button', class: 'btn soft sm' }, ic('x'), h('span', {}, _('Decline'))) as HTMLButtonElement;
  yes.addEventListener('click', async () => {
    yes.disabled = no.disabled = true;
    const bad = await takeAsk(answer);
    yes.disabled = no.disabled = false;
    if (!bad) return;
    refused.hidden = false;
    refused.textContent = bad;
    said(refused);
  });
  no.addEventListener('click', () => declineMenu(no, answer));
  return h(
    'div',
    { class: 'nb-ask' },
    h(
      'span',
      { class: 'nb-ask-t' },
      router
        ? fmt(_('%s asks to add this router'), p.name)
        : fmt(N_(nets.length, '%s asks for a network behind it', '%s asks for networks behind it'), p.name),
    ),
    nets.length
      ? h(
          'span',
          { class: 'nb-nets' },
          ...nets.map((n) => h('span', { class: 'nb-chip mono nb-asked nb-still' }, h('span', { class: 'nb-cb' }, n))),
        )
      : null,
    ...askWarnings(p, d, o.srv, router, nets.length > 0).map((w) => h('span', { class: 'nb-ask-w' }, ic('alert'), w)),
    refetch
      ? h(
          'span',
          { class: 'nb-ask-n' },
          reMark(refetch),
          N_(refetch, 'device fetches its configuration again', 'devices fetch their configuration again'),
        )
      : null,
    refused,
    o.write ? h('div', { class: 'nb-ask-b' }, yes, no) : null,
  );
}
