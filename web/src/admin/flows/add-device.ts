// Adding a device for a person (the portal's add, in the admin's sheet): what
// it is, LAN Bypass, its name (one suggested by its kind, refused characters
// shaking the field, a taken name said in red), then its set-up with the wait
// for its first connection at the top (flows/setup.ts). Past the person's
// device limit the admin may still add one: the line under the title says so.

import type { Person, Server } from '../../shared/types';
import { api } from '../api';
import { h } from '../../portal/dom';
import { glide, go, head, openSheet, sub, type View } from '../../portal/ui/sheet';
import { once } from '../../portal/ui/feedback';
import { badLine } from '../../portal/ui/bad-line';
import { kindOf, kindTiles } from '../../portal/flows/device-form';
import { defaultName, fitName, PICKS, type KindPick } from '../../shared/format';
import { guardDeviceName } from '../../shared/name-guard';
import { shake } from '../../shared/shake';
import { fmt, num } from '../../shared/i18n';
import { errorText } from '../ui/toast';
import { ic } from '../ui/icons';
import { adminLan } from './device-form';
import { setupView, type SetupCtx } from './setup';
import { loadQr } from '../shell/qr';
import { behindRefetch, takenFor } from '../servers/behind';
import { reMark } from '../ui/edit-rows';
import { fold } from '../../portal/ui/fold';
import { glass } from '../ui/glass';
import { netValues } from '../widgets/net-values';
import { putChildren } from '../../portal/ui/put';

export interface AddCtx {
  person: Person;
  server?: Server;
  now: () => number;
  /** Once the device exists (the page reads the status again). */
  added?: (id: string) => void;
  setup?: Pick<SetupCtx, 'fresh' | 'done'>;
  /** Everyone on the router: what a new router's networks are held against, and who fetches again for them. */
  people?: Person[];
  /** Every server (their tunnels' networks are nobody's to have behind a router). */
  servers?: Server[];
}

function vAdd(c: AddCtx): View {
  const p = c.person;
  let pick: KindPick = 'mobile';
  let bypass = true;
  let typed = false;
  const taken = new Set(p.devices.map((d) => d.name.toLowerCase()));
  // The name a kind gives when none is typed: "Phone", then "Phone 2" (as the portal does).
  const suggest = (k: KindPick) => {
    const n = defaultName(kindOf(k));
    if (!taken.has(fitName(n).toLowerCase())) return fitName(n);
    for (let i = 2; i < 20; i++) if (!taken.has(fitName(n, ` ${i}`).toLowerCase())) return fitName(n, ` ${i}`);
    return fitName(n);
  };
  const input = h('input', { type: 'text', 'aria-label': _('Name'), autocomplete: 'off', 'data-1p-ignore': true }) as HTMLInputElement;
  const goBtn = h('button', { class: 'go ready', type: 'submit', 'aria-label': _('Add device') }, ic('arrow')) as HTMLButtonElement;
  const { el: err, say, unsay } = badLine();
  // A router's networks are typed with it. Here they are the admin's own to make, so nothing is asked: they are
  // saved with the device, and what that means for other devices is said under them.
  let nets: string[] = [];
  const srv = c.server;
  const refetch = srv && c.people ? behindRefetch(c.people, srv, [{ p, d: { id: '' } }]) : 0;
  const means = h(
    'p',
    { class: 'nb-ask-n pb-means', hidden: true },
    reMark(refetch),
    N_(refetch, 'device fetches its configuration again', 'devices fetch their configuration again'),
  );
  const line = h('span', { class: 'nb-say' });
  const values = h('span', { class: 'nb-inconf' });
  const held = takenFor(
    c.servers ?? (srv ? [srv] : []),
    (srv?.home ?? []).map((x) => ({ name: x.dev, nets: x.nets })),
    c.people ?? [],
    { id: '' },
  );
  const paintNets = () =>
    putChildren(values, [
      netValues({
        key: `behind:new:${p.id}`,
        nets,
        was: nets,
        taken: held,
        write: true,
        line,
        set: (next) =>
          glide(() => {
            nets = next;
            means.hidden = !nets.length || !refetch;
            paintNets();
          }),
      }),
      line,
    ]);
  paintNets();
  // the option row's own shape: its glass, its name and what it means, the values under the words they belong to
  const behind = h(
    'div',
    { class: 'pb-add' },
    glass('router', 'blue'),
    h(
      'span',
      { class: 'sw-t' },
      h('b', {}, _('Networks behind it')),
      h('span', { class: 'sw-sub' }, _('Devices at home reach them through it.')),
      values,
      means,
    ),
  );
  const behindFold = h('div', { class: 'pb-fold', hidden: true }, behind);
  let router = false;
  const kinds = kindTiles(PICKS, (k) => {
    pick = k;
    // the block is a router's: it opens with the kind and folds away with another
    if (router !== (kindOf(k) === 'router')) fold(behindFold, (router = kindOf(k) === 'router'));
    if (!typed) input.value = suggest(k);
    goBtn.classList.add('ready');
  });
  kinds.set(pick);
  input.value = suggest(pick);
  const form = h('form', { class: 'field', autocomplete: 'off' }, input, goBtn);
  guardDeviceName(
    input,
    () => form,
    (w) => (w ? say(w) : unsay()),
  );
  input.addEventListener('input', () => {
    typed = true;
    goBtn.classList.toggle('ready', !!input.value.trim());
    unsay();
  });
  const lan = adminLan(p, c.server, bypass, (on) => (bypass = on));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return shake(form);
    if (taken.has(name.toLowerCase())) {
      shake(form);
      return say(_('This person already has a device with this name.'));
    }
    void once(goBtn, async () => {
      try {
        // the QR generator and the apps' marks come while the router answers (shell/qr.ts)
        const kit = loadQr().catch(() => undefined);
        const r = await api.deviceCreate(p.id, name, kindOf(pick), bypass, kindOf(pick) === 'router' && nets.length ? nets : undefined);
        c.added?.(r.id);
        const st = await api.status(1).catch(() => null);
        const d = st?.people.find((x) => x.id === p.id)?.devices.find((x) => x.id === r.id);
        if (!d) return;
        await kit;
        go(() => setupView({ person: p, device: d, now: c.now, ...c.setup }, r.config, 'top'));
      } catch (er) {
        shake(form);
        say(errorText(er));
      }
    });
  });
  const free = p.device_limit - p.devices.length;
  const title = fmt(_('Add a device · %s'), p.name);
  const el = h(
    'div',
    { class: 'view' },
    head(title),
    sub(
      free > 0
        ? fmt(N_(p.device_limit, '%s of %s slot free', '%s of %s slots free'), num(free), num(p.device_limit))
        : fmt(_('Over the limit: on the portal they have %s, you can add more'), num(p.device_limit)),
    ),
    kinds.el,
    lan,
    behindFold,
    form,
    err,
  );
  return { el, label: title };
}

export const addDevice = (c: AddCtx) => openSheet(() => vAdd(c));
