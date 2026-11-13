// A device as a dialog over its person's page (IA-3), composed as a dialog, not as its page poured into columns:
//   - the head is the sheet's title row: the glass, the name (Sheet title), its facts, and its actions on one line
//     with ×;
//   - «Connection» runs across the whole dialog and says it all: whether it is online and since when, what broke
//     when something did (one line under that), the period's strip. The connection's way is not drawn (the owner:
//     «сделай это заместо панели выше с подключением»), nor the diagnosis' steps («лишняя инфа»), nor a fix button
//     («убери кнопку»);
//   - under it two columns with one job each: on the left what the device does (its link over the period, traffic,
//     places), on the right what it is set up with (its own MTU and keep-alive, its addresses; the
//     configuration itself is «Show set-up» in the head) and its latest events;
//   - on the sheet's surface a block is a field tile: no card around tiles, block heads a size down (16/22).
// «Map and replay» and «Show set-up» are steps of the same dialog: the view changes in place and its head gets the
// way back to the device.
// A phone: the dialog is the portal's drawer at the window's height, one column.

import type { LogEvent, Status } from '../../../shared/types';
import { api } from '../../api';
import { h } from '../../../portal/dom';
import { fmt } from '../../../shared/i18n';
import { closeSheet, glide, go, head, onClosed, onLeave, openSheet, sub, type View } from '../../../portal/ui/sheet';
import { DevicePanel } from '../../pages/people/device';
import type { PeopleHost } from '../../pages/people/host';
import { loadMaps, type MapKit } from '../../shell/maps';
import { afterOpen } from '../../shell/sheets';
import { loadQr } from '../../shell/qr';
import { setupView } from '../../flows/setup';
import { tabs } from '../../ui/tabs';
import { ic } from '../../ui/icons';
import { openMenu, type MenuItem } from '../../../portal/ui/menu';
import { layer } from '../../../portal/ui/layer';
import { DEVICE_NAME_MAX } from '../../../shared/format';
import { deviceNameHelp } from '../../netcheck';
import { say } from '../../shell/toast';
import { notify } from '../../ui/toast';
import { askView, type Ask } from '../../flows/ask';
import { toggleDevice } from '../../flows/device-acts';
import { newKeys } from '../../flows/new-keys';
import { editableTitle, renameTitle, type RenameTitle } from '../../ui/rename-title';
import { glideWidths } from '../../ui/sheet-width';
import type { Span } from '../../places/render';
import { putChildren } from '../../../portal/ui/put';

const SPANS: Span[] = ['24h', '7d', '30d'];
const SPAN: Record<Span, number> = { '24h': 86400, '7d': 7 * 86400, '30d': 30 * 86400 };
const spanLabel = (s: Span) => ({ '24h': _('24h'), '7d': _('7 days'), '30d': _('30 days') })[s];
const spanWords = (s: Span) => ({ '24h': _('last 24 hours'), '7d': _('last 7 days'), '30d': _('last 30 days') })[s];

/** The dialog opens by this long after it is asked for, whatever is still on its way (ms). */
const OPENS_BY = 700;

export class DeviceDialog {
  private panel: DevicePanel;
  private dead = false;
  /** The dialog is on screen. */
  private opened: Promise<void>;
  private shown = false;

  constructor(
    readonly id: string,
    private host: PeopleHost,
    private closed: () => void,
  ) {
    const panel = (this.panel = new DevicePanel(id, host, () => closeSheet()));
    const el = panel.el;
    el.querySelector('.kt-pbar')?.remove();
    // «Connection» across the dialog; then two columns: what it does (traffic, places) and what it is set up with
    // (the set-up, the latest events). The blocks are the panel's own; only where they stand is the dialog's
    // (server.css: .dv-grid).
    const blocks = el.querySelector<HTMLElement>('.kt-blocks')!;
    const pick = (c: string) => blocks.querySelector<HTMLElement>(`:scope > ${c}`);
    putChildren(blocks, [
      pick('.b-link')!,
      pick('.b-traffic')!,
      pick('.b-places')!,
      h('div', { class: 'dv-side' }, pick('.b-conf'), pick('.b-log')),
    ]);
    blocks.classList.add('dv-grid');
    // One fact, one place (the owner read every repeat out: the state three times over, «last time» beside
    // «offline for», «outdated» beside «needs a new configuration»). The panel draws its parts again on every
    // change, so the dialog puts them right each time (all of it idempotent):
    //   - «Connection» says whether it is online and since when (the timeline's own value) over the period's
    //     strip, its period track at the state's end; the block has no title over it (its state names it);
    //   - the way is not drawn; what it alone said when something broke (the diagnosis' first break: «Needs a new
    //     configuration», «Access ended…») is a line of «Connection», under its state. Where it connects from is
    //     Places';
    //   - «Show set-up» is always the head's button; the head's facts carry no state.
    const tidy = () => {
      const link = el.querySelector<HTMLElement>('.card.link');
      const way = link?.querySelector<HTMLElement>(':scope > .way');
      if (!link || !way) return;
      const acts = el.querySelector<HTMLElement>('.kt-phead .ph-acts');
      // A router its owner asked for has no set-up to show: nothing is given out before it is taken (a
      // configuration shown now would connect nowhere), so the head has no «Show set-up» for it.
      const waits = !!this.dev()?.d.waiting;
      if (waits) acts?.querySelectorAll(':scope > .btn').forEach((b) => b.remove());
      else if (acts && !acts.querySelector(':scope > .btn'))
        acts.prepend(h('button', { type: 'button', class: 'btn soft' }, ic('qr'), h('span', {}, _('Show set-up'))));
      const lt = link.querySelector<HTMLElement>(':scope > .lt');
      // what broke, in the state's own tone (nothing when it is online or simply not connected)
      const said = way.querySelector('.way-text b')?.textContent ?? '';
      // one that never connected is said by the state itself («It has not connected yet»): not a line under it too
      const cause = way.classList.contains('done') || said === _('Not connected') || said === _('It has never connected') ? '' : said;
      const val = lt?.querySelector<HTMLElement>('.lt-val');
      let line = lt?.querySelector<HTMLElement>('.dv-cause') ?? null;
      if (!cause) line?.remove();
      else if (val) {
        if (!line) val.after((line = h('span', { class: 'dv-cause' })));
        const cls = `dv-cause${val.classList.contains('bad-t') ? ' bad-t' : ''}`;
        if (line.className !== cls) line.className = cls;
        if (line.textContent !== cause) line.textContent = cause;
      }
      editableTitle(() => this.renameOpts());
    };
    tidy();
    new MutationObserver(tidy).observe(el, { childList: true, subtree: true, characterData: true });
    // its places' rows and «Map and replay», and «Show set-up» in its head: steps of this dialog
    el.addEventListener(
      'click',
      (e) => {
        const t = e.target as HTMLElement;
        if (t.closest('.pp-pl-go, .pp-dplaces')) {
          e.stopImmediatePropagation();
          e.preventDefault();
          this.step('places');
        } else if (t.closest('.kt-phead .ph-acts > .btn')) {
          e.stopImmediatePropagation();
          this.step('setup');
        }
      },
      true,
    );
    // the ⋯ menu in the dialog's own order (below); the panel's own asks for it by name
    (panel as unknown as { menu(a: HTMLElement): void }).menu = (a) => this.menu(a);
    const view = (): View => ({ el: h('div', { class: 'view dv' }, el), label: el.getAttribute('aria-label') ?? '' });
    // The dialog opens whole (the owner, 2026-11-12: «может чтобы не анимировать все по отдельности подождать пока все
    // внутри модалки прогрузится?»): its panel reads its log, its configuration and its places first, which takes a
    // moment on a router, and the dialog opens with all of it in place, so nothing lands in it after. A router that
    // is slow does not hold it back for long: it opens by OPENS_BY all the same, and what is late then goes to its
    // place as a panel's late parts do (the panel's paint).
    const open = () => {
      if (this.dead) return;
      this.shown = true;
      openSheet(view);
      const sheet = (layer() as ParentNode).querySelector<HTMLElement>('.sheet-root .sheet');
      const stopWidths = sheet ? glideWidths(sheet) : () => undefined;
      onClosed(() => {
        this.dead = true;
        stopWidths();
        panel.destroy();
        this.closed();
      });
    };
    this.opened = Promise.race([panel.ready, new Promise<void>((r) => setTimeout(r, OPENS_BY))]).then(open);
  }

  /** Shut it: the sheet when it is open, else the opening that was on its way. */
  close() {
    if (this.shown) return closeSheet();
    if (this.dead) return;
    this.dead = true;
    this.panel.destroy();
    this.closed();
  }

  fresh(quiet: boolean) {
    if (!this.dead) this.panel.fresh(quiet);
  }

  private dev() {
    const p = this.host.st().people.find((x) => x.devices.some((d) => d.id === this.id));
    const d = p?.devices.find((x) => x.id === this.id);
    return p && d ? { p, d } : null;
  }

  /** The name is changed where it stands, as on the portal's card (kit/rename-title.ts). */
  private renameOpts(): RenameTitle | null {
    const x = this.dev();
    const head = this.panel.el.querySelector<HTMLElement>('.kt-phead .ph');
    if (!x || !head || !this.host.write) return null;
    return {
      head,
      name: x.d.name,
      label: fmt(_('Rename %s'), x.d.name),
      refuse: (v) => {
        if (!v) return _('Give the device a name.');
        const r = deviceNameHelp(
          v,
          x.p.devices.filter((o) => o.id !== x.d.id).map((o) => o.name),
        );
        return r.bad ? r.text : null;
      },
      save: async (v) => {
        await api.deviceUpdate(this.id, v.slice(0, DEVICE_NAME_MAX));
        await this.host.reload();
        say(fmt(_('Renamed: %s'), v));
      },
    };
  }

  /**
   * The ⋯ menu, calm to grave: the name; what resets something of the device (its traffic, its keys); what stops it
   * (off in warn, then Remove in bad, last). «Show set-up» is the head's own button, not said here again. A
   * question is a step of the dialog: Cancel leads back to the device.
   */
  private menu(anchor: HTMLElement) {
    const x = this.dev();
    if (!x) return;
    const { p, d } = x;
    const reload = () => void this.host.reload();
    const acts = { device: d, reload };
    // a router that waits for an answer has no traffic, no keys and nothing to turn off yet: its name and its removal
    const all = (items: (MenuItem | null)[]) => (d.waiting ? [items[0], null, items[items.length - 1]] : items);
    openMenu(
      anchor,
      all([
        { label: _('Rename'), icon: 'edit', run: () => this.renameOpts() && renameTitle(this.renameOpts()!) },
        null,
        {
          label: _('Reset traffic'),
          icon: 'reset',
          run: () =>
            this.ask({
              icon: 'chart',
              tone: 'red',
              title: fmt(_('Reset traffic history for %s?'), d.name),
              text: [
                fmt(_("Clears %s's daily and monthly traffic history. Their person's totals and data limit are not changed."), d.name),
              ],
              action: _('Reset'),
              cls: 'red',
              run: async () => {
                await api.usageClear('device', d.id);
                stepBack();
                say(_('Traffic history reset'));
                reload();
              },
            }),
        },
        {
          label: _('New keys'),
          icon: 'key',
          run: () =>
            newKeys({
              person: p,
              device: d,
              server: this.host.st().servers.find((s) => s.id === p.server),
              now: this.host.now,
              made: reload,
              setup: { done: reload },
            }),
        },
        null,
        d.disabled
          ? { label: _('Turn on'), icon: 'play', run: () => void toggleDevice(acts, false) }
          : { label: _('Turn off'), icon: 'pause', tone: 'warn', run: () => void toggleDevice(acts, true) },
        {
          label: _('Remove'),
          icon: 'trash',
          tone: 'bad',
          run: () =>
            this.ask({
              icon: 'trash',
              tone: 'red',
              title: fmt(_('Remove %s?'), d.name),
              text: [_('Its configuration stops working at once. It can be added again here or on the portal.')],
              action: _('Remove'),
              cls: 'red',
              run: async () => {
                await api.deviceDelete(d.id);
                closeSheet();
                notify(fmt(_('%s removed'), d.name), 'success', 3000);
                reload();
              },
            }),
        },
      ]),
      d.name,
    );
  }

  /** A question as a step of the dialog: its Cancel leads back to the device instead of closing everything. */
  private ask(o: Ask) {
    go(() => {
      const v = askView(o);
      const cancel = v.el.querySelector<HTMLElement>('.btnrow > .btn.soft');
      const mine = h('button', { type: 'button', class: 'btn soft', onclick: stepBack }, cancel?.textContent ?? _('Cancel'));
      cancel?.replaceWith(mine);
      return v;
    });
  }

  /** A step further inside the dialog: the map with the replay, or the set-up. */
  step(what?: string) {
    if (!what) return;
    // a step of a dialog that is on screen
    if (!this.shown) return void this.opened.then(() => !this.dead && this.step(what));
    const st = this.host.st();
    const p = st.people.find((x) => x.devices.some((d) => d.id === this.id));
    const d = p?.devices.find((x) => x.id === this.id);
    if (!p || !d) return;
    if (what === 'places' && st.geo.enabled) void loadMaps().then((kit) => go(() => mapStep(kit, st, p.id, this.id)));
    else if (what === 'setup' && this.host.write)
      void Promise.all([api.deviceConfig(this.id), loadQr().catch(() => undefined)]).then(([cfg]) =>
        go(() => {
          const v = setupView({ person: p, device: d, now: this.host.now }, cfg, null);
          // inside a flow: the head gets the way back
          v.el.querySelector('.vhead')?.replaceWith(head(v.label, { back: true }));
          v.el.classList.add('dv-step');
          return v;
        }),
      );
  }
}

/** One step back in the open sheet (the sheet keeps its own way back for its head's knob: pressed here). */
function stepBack() {
  head('', { back: true }).querySelector<HTMLElement>('.knob')?.click();
}

/** The device's places as a step of its dialog: the map with the replay's plate on the left, the period and the
 *  places with their strips on the right; the head leads back to the device. */
function mapStep(kit: MapKit, first: Status, pid: string, id: string): View {
  const st = first;
  const p = st.people.find((x) => x.id === pid)!;
  const d = p.devices.find((x) => x.id === id)!;
  const narrow = !matchMedia('(min-width: 760px)').matches;
  let range: Span = '30d';
  const map = new kit.ConnectionMap({ openPerson: () => undefined, openDevice: () => undefined }, range, narrow ? 240 : 468);
  const places = new kit.PlacesView(map, range, { geo: st.geo, now: st.now, person: p, device: d, events: null });
  const title = fmt(_('Where it has been · %s'), d.name);
  const subEl = sub(`${p.name} · ${spanWords(range)}`);
  const rows = h('div', { class: 'lp-rows' }, places.el);
  const track = tabs(
    SPANS.map((s) => ({ id: s, label: spanLabel(s) })),
    range,
    (r) => {
      range = r;
      glide(() => places.setRange(r));
      subEl.textContent = `${p.name} · ${spanWords(r)}`;
    },
    { cls: 'range', label: _('Period') },
  );
  const el = h(
    'div',
    { class: 'view dvm' },
    head(title, { back: true }),
    subEl,
    h(
      'div',
      { class: 'dplaces dvm-cols' },
      h('div', { class: 'map-box dl-dmap' }, map.el, places.controls),
      h('div', { class: 'dvm-side' }, track.el, rows),
    ),
  );
  let dead = false;
  void (async () => {
    const ev = await api.events(5000, undefined, st.now - SPAN['30d'] - 1, id).then(
      (r) => r.events,
      () => [] as LogEvent[],
    );
    if (dead) return;
    glide(() => places.update({ events: ev }));
    await afterOpen();
    await new Promise((r) => setTimeout(r, 420));
    if (dead || !el.isConnected) return;
    // (the map fades in by itself once it has drawn: map.ts mount)
    await map.mount(places.mapData());
  })();
  onLeave(() => {
    dead = true;
    setTimeout(() => {
      places.destroy();
      map.destroy();
    }, 460);
  });
  return { el, label: title };
}
