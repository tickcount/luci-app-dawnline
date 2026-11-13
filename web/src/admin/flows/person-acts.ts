// What a person's one action does (people/lines.ts Act), from a row of People
// or the head of their panel, and the other one-tap changes: pausing and
// resuming, a new end date. A reversible change (extend, more data, resume,
// pause, a server turned on) is made at once and said in a toast with Undo
// (shell/toast.ts, the owner's decision): no question first. What is not one
// tap opens its flow: an invite, a move, a device's set-up, adding a device;
// advice for a device's network is copied to send. The page reads the router
// again after each (its rows morph to what is true now). The action's button
// is drawn here too, the same in a row and in a head.

import type { Person, Server } from '../../shared/types';
import { api, type PersonPatch } from '../api';
import { h } from '../../portal/dom';
import { fmt, num } from '../../shared/i18n';
import { errorText, notify } from '../ui/toast';
import { copyText } from '../ui/files';
import { ic } from '../ui/icons';
import { say } from '../shell/toast';
import { peopleAt, personUrl } from '../shell/routes';
import { visit } from '../shell/visit';
import { monthOn, shortDay, type Act } from '../people/lines';
import { otherNetAdvice } from '../people/diagnosis';
import type { ActCtx } from '../people/ctx';
import { showSetup } from './setup';
import { addDevice } from './add-device';
import { openInvite } from './invite';
import { movePerson } from './move-person';

/** An action's button; its whole label in its title (a device's long name may be cut, a narrow list shows the icon alone). */
export function actButton(a: Act, cls = 'tint sm'): HTMLButtonElement {
  return h(
    'button',
    { type: 'button', class: `btn ${cls}`, 'data-act': a.id, title: a.label, 'aria-label': a.label },
    ic(a.icon),
    h('span', {}, a.label),
  ) as HTMLButtonElement;
}

/** A change saved at once; false when the router refused (said in a toast). */
async function save(id: string, patch: PersonPatch): Promise<boolean> {
  try {
    await api.personUpdate(id, patch);
    return true;
  } catch (e) {
    notify(errorText(e), 'error', 10000);
    return false;
  }
}

/** Change `p` now, say `done` with Undo (which puts `back` and says `undone`), and draw it. */
async function oneTap(c: ActCtx, p: Person, patch: PersonPatch, back: PersonPatch, done: string, undone: string): Promise<void> {
  if (!(await save(p.id, patch))) return;
  void c.reload();
  say(done, {
    undo: () =>
      void save(p.id, back).then((ok) => {
        if (ok) void c.reload();
      }),
    undone,
  });
}

/** Pause or resume: one tap, undone from its toast. */
export function pause(c: ActCtx, p: Person, paused: boolean): Promise<void> {
  return paused
    ? oneTap(c, p, { paused: true }, { paused: false }, fmt(_('%s is paused'), p.name), _('Pause lifted'))
    : oneTap(c, p, { paused: false }, { paused: true }, fmt(_('%s: access resumed'), p.name), fmt(_('%s is paused again'), p.name));
}

/** A new end date by one tap ('' = none), undone from its toast. */
export function setEnd(c: ActCtx, p: Person, expires: string): Promise<void> {
  return oneTap(
    c,
    p,
    { expires },
    { expires: p.expires },
    expires ? fmt(_('%s: access until %s'), p.name, shortDay(expires)) : fmt(_('%s: access with no end date'), p.name),
    _('End date as it was'),
  );
}

/** A server turned on: one tap, undone from its toast (a person's action, People's notice over the list). */
export async function serverOn(c: ActCtx, s: Server): Promise<void> {
  const set = async (on: boolean) => {
    try {
      await api.serverUpdate(s.id, { enabled: on ? '1' : '0' });
      return true;
    } catch (e) {
      notify(errorText(e), 'error', 10000);
      return false;
    }
  };
  if (!(await set(true))) return;
  void c.reload();
  say(fmt(_('Server %s turned on'), s.name), {
    undo: () => void set(false).then((ok) => void (ok && c.reload())),
    undone: fmt(_('Server %s turned off again'), s.name),
  });
}

/** Run a person's one action. */
export async function runAct(a: Act, p: Person, c: ActCtx): Promise<void> {
  const st = c.st();
  const d = a.device ? p.devices.find((x) => x.id === a.device) : undefined;
  switch (a.id) {
    case 'extend':
      return setEnd(c, p, monthOn(p, c.today()));
    case 'bonus':
      return oneTap(
        c,
        p,
        { bonus_gb: String((p.bonus_gb || 0) + (a.gb ?? 10)) },
        { bonus_gb: p.bonus_gb ? String(p.bonus_gb) : '' },
        fmt(_('%s: +%s GB until the reset'), p.name, num(a.gb ?? 10)),
        _('Limit as it was'),
      );
    case 'resume':
      if (!a.extend) return pause(c, p, false);
      return oneTap(
        c,
        p,
        { paused: false, expires: monthOn(p, c.today()) },
        { paused: true, expires: p.expires },
        fmt(_('%s: access until %s'), p.name, shortDay(monthOn(p, c.today()))),
        fmt(_('%s is paused again'), p.name),
      );
    case 'enable': {
      const s = st.servers.find((x) => x.id === p.server);
      return s ? serverOn(c, s) : undefined;
    }
    case 'limit':
      if (c.limit) c.limit(p);
      else visit(personUrl(p.id, 'traffic'));
      return;
    case 'server':
      return movePerson({ person: p, st, moved: () => void c.reload() });
    case 'invite':
      return openInvite({
        person: p,
        server: st.servers.find((s) => s.id === p.server)?.name ?? '',
        changed: () => void c.reload(),
      });
    case 'show':
      if (d) await showSetup({ person: p, device: d, now: c.now, done: () => void c.reload() });
      void c.reload();
      return;
    case 'tell':
      if (d) void copyText(otherNetAdvice(d), _('Advice copied: send it to them'));
      return;
    // what they asked for on their own page: answered in the device's dialog
    case 'answer':
      return visit(a.device ? peopleAt({ server: p.server, id: p.id, device: a.device }) : personUrl(p.id));
    case 'add-device':
      addDevice({
        person: p,
        server: st.servers.find((s) => s.id === p.server),
        now: c.now,
        added: () => void c.reload(),
        people: st.people,
        servers: st.servers,
      });
      return;
  }
}
