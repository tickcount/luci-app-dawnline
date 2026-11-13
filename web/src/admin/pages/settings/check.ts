// Settings › Check a path, the last section of a server's scroll: who reaches
// what on this server, by kind of access, from its rules (servers/reach.ts);
// then, for a login that may (access_check is write-only), a path checked on
// the router: from a device of this server (or an address) to an address and
// port at home, each rule on the way in order, green as far as it lets the
// path through, the first that stops it in red (the device panel's diagnosis
// track). From and to are fields that pick from a list as they are typed in
// (ui/combo.ts): a device by its name or its person's, a home service by its
// name; an address typed is taken as it is. The tool stands open; a repaint
// leaves it alone while it is typed in.

import { h } from '../../../portal/dom';
import { once } from '../../../portal/ui/feedback';
import { accessLabel } from '../../../shared/format';
import { fmt, plural } from '../../../shared/i18n';
import { api, type AccessCheck } from '../../api';
import { combo } from '../../ui/combo';
import { ic } from '../../ui/icons';
import { refill } from '../../ui/reshape';
import { errorText } from '../../ui/toast';
import { card, section } from '../../ui/section';
import { whoReaches, type Reach } from '../../servers/reach';
import type { ServerCtx } from './ctx';

/** One kind of access in words: its internet, what of home, the router, each other. */
function reachWords(r: Reach): string {
  const internet = { direct: _('internet directly'), home: _('internet like a home device'), own: _('internet on their own connection') }[
    r.internet
  ];
  const home = r.home
    ? r.home
        .map((k) => ({ all: _('all home networks'), some: _('the home networks their pages pick'), services: _('home services only') })[k])
        .join(' / ')
    : _('no home');
  const router = r.router === 'dns' ? _('the router’s DNS') : _('the router');
  const each = { no: _('not each other'), yes: _('each other'), circle: _('each other in circles') }[r.each];
  return [internet, home, router, each].join(' · ');
}

/** The result: the verdict, then the rules in order, as far as the first that stops it. */
function result(r: AccessCheck): HTMLElement {
  const stop = r.steps.findIndex((s) => !s.ok);
  return h(
    'div',
    { class: 'chk-out' },
    h(
      'p',
      { class: `chk-v ${r.ok ? 'ok-t' : 'bad-t'}` },
      h('b', {}, r.ok ? _('Allowed') : _('Blocked')),
      ' · ',
      r.ok ? _('Every step lets it through') : fmt(_('Stops at step %s of %s'), stop + 1, r.steps.length),
    ),
    h(
      'ol',
      { class: 'dg' },
      ...r.steps.map((s) =>
        h(
          'li',
          { class: `dg-s ${s.ok ? 'ok' : 'bad'}` },
          h('span', { class: 'dg-m' }, ic(s.ok ? 'check' : 'x')),
          h('div', { class: 'dg-t' }, h('b', {}, s.title), s.detail ? h('span', {}, s.detail) : null),
        ),
      ),
    ),
  );
}

function checkBody(c: ServerCtx): (Node | null)[] {
  const reach = whoReaches(c.st.people, c.srv);
  const who = h(
    'div',
    { class: 'reach' },
    ...reach.map((r) =>
      h(
        'div',
        { class: 'reach-r' },
        h('b', {}, accessLabel(r.access), h('i', { class: 'num' }, ` · ${plural(r.people, '%s person', '%s people')}`)),
        h('span', {}, reachWords(r)),
      ),
    ),
  );
  const note = h('p', { class: 'desc' }, _('Paused, ended and over-the-limit people reach nothing.'));
  if (!c.write) return [who, note];
  // from: a device of this server (found by its name or its person's), or an address typed; to: a home service,
  // or an address and port typed. Both are fields that pick from their list as they are typed in (ui/combo.ts).
  const kind = (k: string | undefined) => (k === 'computer' || k === 'tablet' || k === 'router' ? k : 'phone');
  const devs = c.st.people
    .filter((p) => p.server === c.srv.id)
    .flatMap((p) => p.devices.map((d) => ({ id: d.id, label: d.name, sub: p.name, icon: kind(d.kind), says: `${d.name} · ${p.name}` })))
    .sort((a, b) => a.sub.localeCompare(b.sub) || a.label.localeCompare(b.label));
  const svcs = c.st.services.map((s) => {
    const addr = s.ports.length ? `${s.address}:${s.ports[0]}` : s.address;
    return { id: addr, label: s.name, sub: addr, icon: 'terminal' };
  });
  const out = h('div', { class: 'chk-res' });
  const run = h('button', { type: 'button', class: 'btn tint chk-go' }, ic('route'), h('span', {}, _('Check'))) as HTMLButtonElement;
  const go = () =>
    once(run, async () => {
      const f = from.value();
      const t = to.value();
      if (!f.text || !t.text) return void (!f.text ? from : to).input.focus();
      try {
        // a device goes by its id, a service by its address; anything else as it is typed
        refill(out, [result(await api.accessCheck(f.id ?? f.text, t.id ?? t.text))]);
      } catch (e) {
        refill(out, [h('p', { class: 'desc bad-t' }, errorText(e))]);
      }
    });
  const from = combo({
    label: _('From'),
    placeholder: _('A device, or 10.0.1.11'),
    items: devs,
    pick: devs[0]?.id,
    enter: () => void go(),
  });
  const to = combo({
    label: _('To'),
    placeholder: svcs.length ? _('A home service, or 192.168.1.10:445') : _('An address and port, like 192.168.1.10:445'),
    items: svcs,
    enter: () => void go(),
  });
  run.addEventListener('click', () => void go());
  return [
    who,
    note,
    h(
      'div',
      { class: 'chk-path' },
      h('span', { class: 'sv-t' }, _('Does a home service not open? Check the path to it.')),
      // the path as it runs: from, the way, to, then the press that walks it
      h('div', { class: 'chk-way' }, from.el, h('i', { class: 'chk-dots', 'aria-hidden': 'true' }), to.el, run),
    ),
    out,
  ];
}

export function checkSection(c: ServerCtx): HTMLElement {
  return section(
    { id: 'check', icon: 'route', title: _('Check a path'), aside: h('span', { class: 'kt-sx-st off' }, c.srv.name) },
    card(...checkBody(c)),
  );
}
