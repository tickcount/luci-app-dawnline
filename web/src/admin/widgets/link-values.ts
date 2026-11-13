// The two numbers every configuration of a server carries (Settings › Devices), each as the thing it is instead of a text row
// with a pencil:
//   MTU: a size on a scale. Automatic is the scale's own state (the «Auto» key lit, the knob hollow where automatic
//        stands, a ghost where phones get theirs); dragging the knob or typing the number sets one by hand, «Auto»
//        gives it back. The values worth knowing are marked and named under the track.
//   Keep-alive: an interval people pick from a few (off, 15, 25, 60 s), so a track of them, and «Own» for another;
//        one line says what the picked one means.
// Both wait for «Apply» as the page's other changes do (ctx.change); the line under each says what waits.

import { h } from '../../portal/dom';
import { morphText, setText, textOf } from '../../portal/ui/morph';
import { fmt } from '../../shared/i18n';
import { shake } from '../../shared/shake';
import { reMark } from '../ui/edit-rows';
import { tabs } from '../ui/tabs';
import { keepaliveHelp, mtuHelp } from '../netcheck';
import { refetchOf } from '../servers/pending';
import type { ServerCtx } from '../pages/settings/ctx';
import { range } from '../ui/range';
import { composing } from '../../shared/keys';
import { putChildren } from '../../portal/ui/put';

/** The control to give the keyboard back to after the page drew the change (a staged change repaints the part). */
let refocus = '';
const focusBack = (key: string, el: HTMLElement) => {
  if (refocus !== key) return;
  refocus = '';
  requestAnimationFrame(() => el.focus({ preventScroll: true }));
};

/** The MTU's number as words, by its key: the one node a block drawn again takes over (see mtuBlock). */
const numbers = new Map<string, HTMLElement>();

const waits = (now: string): string => fmt(_('Not applied yet. Now: %s'), now);

function mtuBlock(c: ServerCtx): HTMLElement {
  const srv = c.srv;
  const staged = c.staged('mtu');
  const now = srv.mtu ? String(srv.mtu) : '';
  const set = staged ? String(staged.values?.mtu ?? '') : now;
  const auto = !set;
  const autoWords = fmt(_('Automatic: %s, phones %s'), srv.mtus.computer, srv.mtus.phone);
  const stage = (v: string, from: string) => {
    refocus = from;
    if (v === now) return c.unstage('mtu');
    const shown = v || _('automatic');
    c.change({ kind: 'mtu', value: shown, label: fmt(_('MTU: %s'), shown), values: { mtu: v } });
  };
  const bad = h('span', { class: 'kt-lv-bad', role: 'alert' });
  const input = h('input', {
    class: 'kt-lv-in num',
    type: 'text',
    inputmode: 'numeric',
    maxlength: '4',
    value: auto ? String(srv.mtus.computer) : set,
    'aria-label': 'MTU',
    disabled: c.write ? null : '',
  }) as HTMLInputElement;
  // The number as it is read: the field's own text is an input's, which cannot change letter by letter, so at rest
  // the same number stands over it as words, and those morph as the slider moves (the owner, 2026-11-12: «морф
  // текста нужен на элементах где изменяются данные по типу MTU числа при изменении слайдера»). Typed in, the
  // field shows its own text. The words are one node for as long as the block is on screen: a change is staged the
  // moment the slider is let go (a click on the track, an arrow key), which draws the block again, and a morph
  // just begun goes on in the node it began in instead of being cut off («mtu морфится только если слайдер
  // зажимать»). Keyed: what a repaint changed itself (Auto pressed) morphs from what stood there (Parts.put).
  const key = `mtu:${srv.id}`;
  let shown = numbers.get(key);
  if (!shown?.isConnected)
    numbers.set(key, (shown = h('span', { class: 'kt-lv-show num', 'aria-hidden': 'true', 'data-t': key }, input.value)));
  else if (textOf(shown) !== input.value) setText(shown, input.value);
  const words = shown;
  input.addEventListener('input', () => setText(words, input.value));
  const typed = () => {
    const v = input.value.trim();
    if (v === (auto ? String(srv.mtus.computer) : set)) return;
    const r = mtuHelp(v, srv.mtus);
    if (r.bad || !v) {
      bad.textContent = _('From 1280 to 1500.');
      shake(input);
      return;
    }
    stage(v, 'mtu-in');
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !composing(e)) typed();
    if (e.key === 'Escape') {
      input.value = auto ? String(srv.mtus.computer) : set;
      setText(words, input.value);
      bad.textContent = '';
      input.blur();
    }
  });
  input.addEventListener('blur', typed);
  input.addEventListener('focus', () => input.select());
  const autoKey = h(
    'button',
    { type: 'button', class: `kt-lv-auto${auto ? ' on' : ''}`, 'aria-pressed': String(auto), disabled: c.write ? null : '' },
    _('Auto'),
  );
  autoKey.addEventListener('click', () => !auto && stage('', 'mtu-auto'));
  const marks = [
    { at: 1280, label: _('mobile networks') },
    ...(srv.mtus.computer > 1300 && srv.mtus.computer < 1400 ? [{ at: srv.mtus.computer, label: _('auto') }] : []),
    { at: 1420, label: 'WireGuard' },
    { at: 1500, label: 'Ethernet' },
  ];
  const slider = range({
    label: 'MTU',
    min: 1280,
    max: 1500,
    step: 10,
    value: auto ? srv.mtus.computer : Number(set),
    idle: auto,
    ghost: auto ? srv.mtus.phone : null,
    marks,
    write: c.write,
    keep: `mtu:${srv.id}`,
    input: (v) => {
      input.value = String(v);
      if (textOf(words) !== input.value) morphText(words, input.value);
      bad.textContent = '';
    },
    commit: (v) => stage(String(v), 'mtu'),
  });
  focusBack('mtu', slider);
  focusBack('mtu-in', input);
  focusBack('mtu-auto', autoKey);
  return h(
    'div',
    { class: `kt-lv${staged ? ' waits' : ''}` },
    h(
      'div',
      { class: 'kt-lv-h' },
      h('b', {}, 'MTU'),
      h('span', { class: 'kt-lv-e' }, reMark(refetchOf('mtu', srv.id, c.st.people)), autoKey),
    ),
    h(
      'div',
      { class: 'kt-lv-v' },
      h('span', { class: 'kt-lv-num' }, input, words),
      auto
        ? h(
            'span',
            { class: 'kt-lv-u' },
            _('computers and routers'),
            h('i', {}, '·'),
            h('b', { class: 'num' }, String(srv.mtus.phone)),
            ` ${_('phones')}`,
          )
        : h('span', { class: 'kt-lv-u' }, _('bytes, every device')),
      bad,
    ),
    slider,
    h(
      'p',
      { class: `kt-lv-say${staged ? ' warn-t' : ''}` },
      staged
        ? waits(now || autoWords)
        : _('The size of a packet in the tunnel. Lower it when pages hang or the link drops on a mobile network.'),
    ),
  );
}

const PRESETS = [0, 15, 25, 60];

function keepBlock(c: ServerCtx, own: { open: boolean }, redraw: () => void): HTMLElement {
  const srv = c.srv;
  const staged = c.staged('keepalive');
  const now = String(srv.keepalive);
  const raw = staged ? String(staged.values?.keepalive ?? '') : now;
  const v = raw === '' ? 25 : Number(raw);
  const words = (n: number) => (n ? fmt(_('%s s'), n) : _('Off', 'keep-alive'));
  const stage = (s: string, from: string) => {
    refocus = from;
    if (s === now) return c.unstage('keepalive');
    c.change({ kind: 'keepalive', value: words(Number(s)), label: fmt(_('Keep-alive: %s'), words(Number(s))), values: { keepalive: s } });
  };
  const isOwn = own.open || !PRESETS.includes(v);
  const track = tabs<string>(
    [
      ...PRESETS.map((n) => ({ id: String(n), label: words(n) })),
      { id: 'own', label: isOwn && !PRESETS.includes(v) ? fmt(_('Own: %s'), words(v)) : _('Own') },
    ],
    isOwn ? 'own' : String(v),
    (id) => {
      if (id === 'own') {
        own.open = true;
        refocus = 'ka-in';
        return redraw();
      }
      own.open = false;
      // back from «Own» onto the value in use: nothing to stage, the field just goes
      if (id === raw) return redraw();
      stage(id, 'ka');
    },
    { cls: 'kt-lv-track', label: _('Keep-alive'), keep: `keepalive:${srv.id}` },
  );
  if (!c.write) track.el.setAttribute('aria-disabled', 'true');
  const bad = h('span', { class: 'kt-lv-bad', role: 'alert' });
  const input = h('input', {
    class: 'kt-lv-in sm num',
    type: 'text',
    inputmode: 'numeric',
    maxlength: '3',
    value: PRESETS.includes(v) ? '' : String(v),
    placeholder: '45',
    'aria-label': _('Seconds'),
  }) as HTMLInputElement;
  const typed = () => {
    const t = input.value.trim();
    if (!t || t === raw) return;
    if (keepaliveHelp(t).bad) {
      bad.textContent = _('Use 0–600 seconds.');
      shake(input);
      return;
    }
    own.open = !PRESETS.includes(Number(t));
    stage(String(Number(t)), 'ka');
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && !composing(e) && typed());
  input.addEventListener('blur', typed);
  focusBack('ka-in', input);
  focusBack('ka', track.el.querySelector<HTMLElement>('.on') ?? track.el);
  return h(
    'div',
    { class: `kt-lv${staged ? ' waits' : ''}` },
    h(
      'div',
      { class: 'kt-lv-h' },
      h('b', {}, _('Keep-alive')),
      h('span', { class: 'kt-lv-e' }, reMark(refetchOf('keepalive', srv.id, c.st.people))),
    ),
    track.el,
    isOwn ? h('div', { class: 'kt-lv-own' }, input, h('span', { class: 'kt-lv-u' }, _('seconds, up to 600')), bad) : null,
    h(
      'p',
      { class: `kt-lv-say${staged ? ' warn-t' : ''}` },
      staged
        ? waits(words(srv.keepalive))
        : v
          ? fmt(
              _('A device sends a packet every %s s: it stays reachable from home behind its network’s NAT. A little battery on phones.'),
              v,
            )
          : _('A device is silent while it has nothing to send: behind NAT it may not be reachable from home until it speaks first.'),
    ),
  );
}

/** Both blocks, in a box that draws the keep-alive again when «Own» opens (nothing staged yet). */
export function linkValues(c: ServerCtx): HTMLElement {
  const own = { open: false };
  const keepBox = h('div', { class: 'kt-lv-box' });
  const draw = () => putChildren(keepBox, [keepBlock(c, own, draw)]);
  draw();
  return h('div', { class: 'kt-lvs' }, mtuBlock(c), keepBox);
}
