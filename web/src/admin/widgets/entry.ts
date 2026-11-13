// A server's way in (Settings › Address): the address and the UDP port devices connect to, and what the router knows about them.
// In place of one mono row with a state dot and two grey sentences under it:
//   the two values as what they are, two named cells of one address («Address» : «UDP port»), each edited where it
//   stands (ui/inline-edit.ts), with the copy knob at the block's end;
//   under them the router's verdicts as rows with a mark each (ok, warn, bad, still asking): where the address
//   points, whether anyone reached it from the internet and when, what the port means for networks. A row is a
//   fact with its proof at the row's end (the IP, «just now»), so three facts are read down one column of marks.
// While a value is typed the first row follows it (the router is asked 350 ms after the last key); a value that
// waits for «Apply» is drawn in warn and the line under the cells says what runs meanwhile.

import type { EndpointProbe } from '../api';
import type { PortHold } from '../netcheck';
import { api } from '../api';
import { h, type Kid } from '../../portal/dom';
import { ago } from '../../shared/format';
import { fmt } from '../../shared/i18n';
import { ic } from '../ui/icons';
import { reMark } from '../ui/edit-rows';
import { copyText } from '../ui/files';
import { inlineEdit, type Inline } from '../../portal/ui/inline-edit';
import { hostHelp, portHelp } from '../netcheck';
import { refetchOf } from '../servers/pending';
import type { ServerCtx } from '../pages/settings/ctx';
import { putChildren } from '../../portal/ui/put';

type Tone = 'ok' | 'warn' | 'bad' | 'wait' | 'plain';

interface Check {
  el: HTMLElement;
  set(tone: Tone, title: Kid, proof?: Kid): void;
}

function check(tone: Tone, title: Kid, proof?: Kid): Check {
  const mark = h('span', { class: 'kt-en-m', 'aria-hidden': 'true' });
  const t = h('b', {});
  const p = h('span', { class: 'kt-en-p' });
  const el = h('div', { class: 'kt-en-c' }, mark, t, p);
  const set = (tn: Tone, ti: Kid, pr?: Kid) => {
    el.className = `kt-en-c ${tn}`;
    putChildren(mark, tn === 'ok' ? [ic('check')] : tn === 'warn' || tn === 'bad' ? [ic('alert')] : []);
    putChildren(t, ti == null ? [] : [ti as Node | string]);
    putChildren(p, pr == null ? [] : [pr as Node | string]);
    p.hidden = pr == null;
  };
  set(tone, title, proof);
  return { el, set };
}

const refuse = (r: { text: string; bad: boolean }) => (r.bad ? r.text : null);

/** `setAddress`: a new address typed (the section stages it, with where the router says it points). */
export function entryBlock(c: ServerCtx, setAddress: (v: string) => void | Promise<void>): HTMLElement {
  const srv = c.srv;
  const portal = c.st.settings.portal_host;
  const addr = c.staged('address');
  const port = c.staged('port');
  const endpoint = addr ? String(addr.values?.endpoint ?? '') : srv.endpoint;
  const host = endpoint || portal || '';
  const portNow = port ? String(port.values?.port ?? srv.port) : String(srv.port);
  let holds: PortHold[] = [];
  if (c.write)
    void api
      .serverPorts(srv.id)
      .then((r) => (holds = r.udp_taken ?? []))
      .catch(() => undefined);

  /* the verdicts */
  const points = check('wait', _('Asking the router where it points…'));
  const tell = (r: EndpointProbe) => {
    const tone: Tone = r.status === 'error' ? 'bad' : r.status === 'warn' ? 'warn' : 'ok';
    // the common answer in a few words with its proof at the end; anything else in the router's own sentence
    if (r.here && tone === 'ok') points.set('ok', _('Points to this router'), h('span', { class: 'mono' }, r.ips[0] ?? r.wan ?? ''));
    else points.set(tone, r.text);
  };
  const reached = srv.reached
    ? check('ok', _('Reached from the internet'), ago(srv.reached, c.now()))
    : check('warn', _('Nobody has reached it from the internet yet'), _('try a phone on mobile data'));
  const portSays = (p: string) =>
    p === '4500'
      ? ([_('IPsec’s port'), _('most networks let it through')] as const)
      : ([fmt(_('UDP %s'), p), _('opened on the WAN firewall by itself')] as const);
  const ports = check('plain', ...portSays(portNow));
  let probe = 0;
  const ask = (to: string, after = 0) => {
    const mine = ++probe;
    if (!to || hostHelp(to).bad) return;
    setTimeout(() => {
      if (mine !== probe) return;
      void api
        .endpointProbe(to, srv.id, srv.port)
        .then((r) => mine === probe && tell(r))
        .catch(() => mine === probe && points.set('plain', _('The router did not answer where it points.')));
    }, after);
  };
  if (host) ask(host);
  else points.set('plain', _('The portal’s address is used.'));

  /* the two cells */
  const waits =
    addr || port ? fmt(_('Not applied yet. Now: %s'), `${srv.endpoint || portal || _('the portal’s address')}:${srv.port}`) : '';
  const line = h('p', { class: `kt-en-say${waits ? ' warn-t' : ''}` }, waits);
  line.hidden = !waits;
  const say = (text: string | null, bad = false) => {
    line.textContent = text ?? waits;
    line.className = `kt-en-say${bad ? ' bad-t' : text == null && waits ? ' warn-t' : ''}`;
    line.hidden = !line.textContent;
    // the edit ended without a change: the row says again where the address in use points
    if (text == null && host) ask(host);
  };
  const cell = (label: string, text: string, cls: string, e: Omit<Inline, 'say'>) => {
    const v = c.write
      ? h(
          'button',
          {
            type: 'button',
            class: `kt-en-v kt-ie-v mono ${cls}`,
            title: _('Change'),
            'aria-label': fmt('%s: %s. %s', label, text, _('Change')),
          },
          text,
        )
      : h('span', { class: `kt-en-v mono ${cls}` }, text);
    if (c.write) v.addEventListener('click', () => inlineEdit(v, { ...e, say }));
    return h('div', { class: `kt-en-cell ${cls.split(' ')[0]}` }, h('span', { class: 'kt-en-l' }, label), v);
  };
  // no address of its own: the portal's, and the cell's name says so (the value alone would look set by hand)
  const hostCell = cell(
    !endpoint && portal ? _('Address · the portal’s') : _('Address'),
    host || _('The portal’s address'),
    `en-host${host ? '' : ' quiet'}${addr ? ' waits' : ''}`,
    {
      label: _('Address for devices'),
      start: endpoint,
      placeholder: portal || _('the portal’s address'),
      plain: true,
      // emptied: the portal's address again, when the portal has one
      refuse: (v) => (!v && portal ? null : refuse(hostHelp(v))),
      commit: (v) => void setAddress(v),
      typing: (v) => ask(v || portal, 350),
    },
  );
  const portCell = cell(_('UDP port'), portNow, `en-port${port ? ' waits' : ''}`, {
    label: _('UDP port'),
    start: portNow,
    numeric: true,
    max: 5,
    refuse: (v) => (/^\d{1,5}$/.test(v) ? refuse(portHelp(Number(v), holds, '')) : _('UDP port must be 1-65535.')),
    commit: (v) =>
      v === String(srv.port)
        ? c.unstage('port')
        : c.change({ kind: 'port', value: v, label: fmt(_('UDP port: %s'), v), values: { port: v } }),
    typing: (v) => /^\d{1,5}$/.test(v) && ports.set('plain', ...portSays(v)),
  });
  const copy = host
    ? h(
        'button',
        {
          type: 'button',
          class: 'knob kt-en-copy',
          'aria-label': _('Copy address'),
          title: _('Copy address'),
          onclick: () => void copyText(`${host}:${portNow}`, _('Address copied')),
        },
        ic('copy'),
      )
    : null;
  return h(
    'div',
    { class: 'kt-en' },
    // the two values on the left; what a change costs (⟳N) and the copy knob at the block's right edge
    h(
      'div',
      { class: 'kt-en-a' },
      hostCell,
      h('span', { class: 'kt-en-sep mono', 'aria-hidden': 'true' }, ':'),
      portCell,
      h('span', { class: 'kt-en-end' }, reMark(refetchOf('address', srv.id, c.st.people)), copy),
    ),
    line,
    h('div', { class: 'kt-en-checks' }, points.el, reached.el, ports.el),
  );
}
