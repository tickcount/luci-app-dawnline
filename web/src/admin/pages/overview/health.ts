// Overview › Health (the anchor `health`, where the head's phrase and the old
// Health address lead): the router's checks as a visible list, nothing folded.
// The most pressing check that did not pass is the page's one notice, the
// other failing ones are rows under it, and every check that passed stays on
// the page by what it is about: a row for the router, one a server, one for
// the portal, each naming its checks in one quiet line (a skipped one
// fainter, why in its title) and counting them at its end. A cloud of two
// dozen ticked phrases that repeat the core's and the server's name told
// nothing apart (the owner, 2026-11-11). A failing
// check that a Settings section is about is a signal: the whole notice or row
// leads to that section, where its fix is (overview/model.ts fixPlace); only
// a check nothing in Settings is about keeps its fix here as a button, or its
// advice as its words (ownFix; flows/health-fix.ts runs it). The foot: the
// watchdog in one line (its repair today, the agent gone quiet, or that it
// had nothing to do) with its switch, and «Check again», which stays one button for the page's life, so its
// busy orb and the focus hold through the repaint its answer brings.
// A read-only login gets no fix buttons; the links and «Check again» stay.

import { refill } from '../../ui/reshape';
import { flipping } from '../../ui/edit-rows';
import type { HealthCheck } from '../../../shared/types';
import { api } from '../../api';
import { h } from '../../../portal/dom';
import { once } from '../../../portal/ui/feedback';
import { fmt, num, plural } from '../../../shared/i18n';
import { glass } from '../../ui/glass';
import { ic } from '../../ui/icons';
import { secHead } from '../../ui/page-head';
import { errorText, notify } from '../../ui/toast';
import { whenAt } from '../../events/clock';
import { fixLabel } from '../../servers/fixes';
import { focusInside } from '../../state/poller';
import { compRow } from '../../ui/comp-row';
import { checkGroups, checkList, fixPlace, ownFix, systemNews, type CheckGroup } from '../../overview/model';
import type { OverviewCtx } from './ctx';
import { flippedNow } from '../../../portal/ui/carry';

export interface HealthSection {
  el: HTMLElement;
  /** Draw the checks as they stand; a `quiet` (background) repaint leaves the list alone while the focus is in it. */
  /** Draw the checks; false: left as it was, a background repaint under the keyboard focus. */
  update(c: OverviewCtx, quiet: boolean): void | boolean;
}

const bad = (k: HealthCheck) => k.status === 'error';
const words = (k: HealthCheck) => [h('b', {}, k.problem ?? k.title), k.detail ? h('span', {}, k.detail) : null];

/** The way to where a check is fixed, said at its notice's or row's end (a phone: the chevron alone). */
const toFix = (): HTMLElement => h('span', { class: 'ov-fix' }, h('span', {}, _('Fix in Settings')), ic('chevron'));

/** A check's own fix as its button; null: none, or a read-only login. */
function fixButton(c: OverviewCtx, k: HealthCheck, servers: string[]): HTMLButtonElement | null {
  const fix = ownFix(k, servers);
  if (!c.write || !fix) return null;
  const b = h('button', { type: 'button', class: `btn ${bad(k) ? 'tint' : 'soft'} sm` }, h('span', {}, fixLabel(fix))) as HTMLButtonElement;
  b.addEventListener('click', () => void once(b, () => c.fix(fix)));
  return b;
}

/** The one notice: a link as a whole to the check's Settings section, or (nothing there is about it) its own fix. */
function notice(c: OverviewCtx, k: HealthCheck, servers: string[]): HTMLElement {
  const to = fixPlace(k, servers);
  const box = h(
    'div',
    { class: `notice ${bad(k) ? 'bad' : 'warn'}` },
    glass('pulse', bad(k) ? 'red' : 'orange'),
    // its own fix stands under its words: beside them it would squeeze them in the column
    h('div', { class: 't' }, ...words(k), to ? null : fixButton(c, k, servers)),
    to ? toFix() : null,
  );
  return to ? h('a', { class: 'notice-a', href: to }, box) : box;
}

/** A failing check as a row: the same, in the list. */
function row(c: OverviewCtx, k: HealthCheck, servers: string[]): HTMLElement {
  const to = fixPlace(k, servers);
  const kids = [h('span', { class: 'dg-m' }, ic(bad(k) ? 'x' : 'alert')), h('span', { class: 'chk-t' }, ...words(k))];
  return to
    ? h('a', { class: `chk ${k.status} ov-chk`, href: to }, ...kids, toFix())
    : h('div', { class: `chk ${k.status}` }, ...kids, fixButton(c, k, servers));
}

const GROUP_ICON = { router: 'router', server: 'server', portal: 'portal' } as const;
const GROUP_TONE = { ok: 'green', warn: 'orange', bad: 'red', off: 'grey' } as const;

/** What a group is about, as its row: its checks that passed named in one line, counted at the row's end. */
function groupRow(g: CheckGroup): HTMLElement {
  const title = g.kind === 'router' ? _('Router') : g.kind === 'portal' ? _('Personal portal') : (g.name ?? '');
  const names = g.passed.flatMap(({ check, title: t }, i) => [
    i ? ' · ' : '',
    // not the status as a class: `.skip` is the page's skip link (page.css)
    h('span', { class: check.status === 'skip' ? 'ov-idle' : null, title: check.detail || null }, t),
  ]);
  const count =
    g.tone === 'off'
      ? h('span', { class: 'ov-gn' }, _('off', 'server'))
      : h(
          'span',
          {
            class: `ov-gn num ${g.tone}-t`,
            title: plural(g.ok, '%s check passed', '%s checks passed'),
          },
          ic(g.tone === 'ok' ? 'check' : 'alert'),
          fmt(_('%s of %s'), num(g.ok), num(g.of)),
        );
  return compRow({
    icon: GROUP_ICON[g.kind],
    tone: GROUP_TONE[g.tone],
    title,
    // a server turned off: «off» at the row's end says why nothing of it ran
    line: names.length && g.tone !== 'off' ? names : undefined,
    acts: [count],
    cls: 'ov-grp',
  });
}

/** What passed, all of it on the page: a row for each thing the checks are about. */
function groups(c: OverviewCtx): HTMLElement | null {
  const gs = checkGroups(c.checks ?? [], c.st.servers);
  return gs.length ? h('div', { class: 'checks ov-groups' }, ...gs.map(groupRow)) : null;
}

/** The watchdog in one line; null: its state could not be read. */
function watchdogLine(c: OverviewCtx): HTMLElement | null {
  const wd = c.sl?.watchdog;
  if (!wd) return null;
  const news = systemNews(c.sl);
  const quiet = news?.kind === 'quiet';
  const text = quiet
    ? fmt(_('The agent has not checked in for %s min; cron restarts it after 5.'), num(news.minutes))
    : news
      ? fmt(_('The watchdog repaired %s %s.'), news.name, whenAt(news.ts, c.now(), c.st.tz))
      : wd.enabled
        ? _('The watchdog is on: nothing needed a repair today.')
        : _('The watchdog is off.');
  const kids = [
    quiet ? glass('pulse', 'orange') : glass('refresh', wd.enabled ? 'green' : 'grey'),
    h('span', { class: quiet ? 'warn-t' : null }, text),
  ];
  if (!c.write) return h('span', { class: 'ov-wd' }, ...kids);
  // its switch: this line is the watchdog's one home
  const sw = h(
    'button',
    {
      type: 'button',
      class: `swrow ov-wd ov-wd-sw${wd.enabled ? ' on' : ''}`,
      role: 'switch',
      'aria-checked': String(wd.enabled),
      'aria-label': _('Watchdog'),
      title: _('Looks every minute and repairs the tunnels and services it can. It never reboots the router.'),
    },
    ...kids,
    h('span', { class: 'sw' }),
  ) as HTMLButtonElement;
  sw.addEventListener('click', () => {
    if (sw.classList.contains('wait')) return;
    const on = !wd.enabled;
    sw.classList.toggle('on', on);
    sw.setAttribute('aria-checked', String(on));
    flippedNow(sw);
    void flipping(sw, () =>
      api
        .settingsUpdate({ watchdog: on ? '1' : '0' })
        .then(() => c.reload())
        .then(
          () => true,
          (e) => {
            notify(errorText(e), 'error', 10000);
            return false;
          },
        ),
    ).then((ok) => {
      if (ok) return;
      sw.classList.toggle('on', !on);
      sw.setAttribute('aria-checked', String(!on));
    });
  });
  return sw;
}

/** The checks still running, or the run the router did not answer. */
const running = (failed: boolean): HTMLElement =>
  h(
    'div',
    { class: 'checks' },
    h(
      'div',
      { class: 'chk run' },
      h('span', { class: 'dg-m' }, ic(failed ? 'alert' : 'clock')),
      h(
        'span',
        { class: 'chk-t' },
        h('b', {}, failed ? _('The checks did not run') : _('Running checks…')),
        h(
          'span',
          {},
          failed ? _('The router did not answer. Check again in a moment.') : _('DNS, ports, certificates: it takes a moment.'),
        ),
      ),
    ),
  );

function body(c: OverviewCtx, again: HTMLElement): HTMLElement[] {
  const foot = (first: HTMLElement | null) => h('div', { class: 'ov-hfoot' }, first, again);
  if (!c.checks)
    return [
      secHead(_('Health')),
      // nothing to press while the first run is on its way
      h('div', { class: 'card ov-checks' }, running(c.checksFailed), c.checksFailed ? foot(null) : null),
    ];
  const servers = c.st.servers.map((s) => s.id);
  const l = checkList(c.checks);
  const rows = l.failing.map((k) => row(c, k, servers));
  return [
    secHead(_('Health'), fmt(_('%s of %s passed'), num(l.ok), num(l.of))),
    ...(l.top ? [notice(c, l.top, servers)] : []),
    h('div', { class: 'card ov-checks' }, rows.length ? h('div', { class: 'checks' }, ...rows) : null, groups(c), foot(watchdogLine(c))),
  ];
}

export function healthSection(): HealthSection {
  const el = h('section', { class: 'ov-health', id: 'health' });
  let cur: OverviewCtx | null = null;
  const again = h(
    'button',
    { type: 'button', class: 'pill-link ov-again' },
    ic('refresh'),
    h('span', {}, _('Check again')),
  ) as HTMLButtonElement;
  const root = () => el.getRootNode() as Document | ShadowRoot;
  again.addEventListener(
    'click',
    () =>
      void once(again, async () => {
        await cur?.recheck();
      }).then(() => {
        // busy, the button could not hold the focus, and the repaint took it out and put it back: once it can be
        // pressed again the focus is on it, unless it went elsewhere meanwhile
        const a = root().activeElement;
        if (again.isConnected && (!a || a === document.body)) again.focus({ preventScroll: true });
      }),
  );
  return {
    el,
    update(c, quiet) {
      cur = c;
      const held = focusInside(again);
      // left as it is under the focus: the page draws it once the focus leaves (state/regions.ts drawn)
      if (quiet && !held && focusInside(el)) return false;
      // checks coming, going or changing their state unfold, fold and morph (ui/reshape.ts)
      refill(
        el,
        body(c, again).filter((x): x is HTMLElement => !!x),
      );
      if (held && again.isConnected) again.focus({ preventScroll: true });
    },
  };
}
