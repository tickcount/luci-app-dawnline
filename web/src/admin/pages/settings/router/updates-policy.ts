// Settings › Updates: how it updates on its own, as a panel of its own (the owner, 2026-11-12: «заредизайни это и
// отдели в отдельную панель»): each choice stands open as the control that makes it — how often it checks and
// whether and when it installs as segmented tracks, the time of a scheduled run edited where it is said, what it
// installs as chips that toggle — then the previous version kept for Roll back and GitHub mirrors as switches. Every
// change waits for «Apply» as every setting does (y.save stages it). The latest updates and checks that found
// something are a panel of their own too («логи тоже в отдельную»).

import type { UpdateEvent, UpdatePolicy } from '../../../api';
import { h } from '../../../../portal/dom';
import { ago, duration } from '../../../../shared/format';
import { locale, plural } from '../../../../shared/i18n';
import { ic } from '../../../ui/icons';
import { switchRow } from '../../../ui/edit-rows';
import { carryOn } from '../../../../portal/ui/carry';
import { inlineEdit } from '../../../../portal/ui/inline-edit';
import { valuePick } from '../../../ui/measure';
import { cap, card } from '../../../ui/section';
import { errorText, notify } from '../../../ui/toast';
import { logUrl } from '../../../shell/routes';
import { timeHelp } from '../../../netcheck';
import { jobComponent } from '../../../updater/jobs';
import { checkChoice, checkValues, installChoice, installValues, type CheckChoice, type InstallChoice } from '../../../updater/policy';
import type { RouterCtx } from './ctx';
import { routerSaid } from '../../../failure';

/** A translation's name, by its language code. */
const translationName = (lang: string): string => (lang === 'ru' ? _('Russian translation') : lang);

/** A choice saved at once: what the row shows after it, or null (the toast says why). */
async function pick(y: RouterCtx, values: Record<string, string | string[]>, shown: string): Promise<string | null> {
  try {
    await y.save(values);
    return shown;
  } catch (e) {
    notify(errorText(e), 'error', 10000);
    return null;
  }
}

/** A line of the panel: its name and a note under it, the control at its end (under it on a narrow page). */
function line(title: string, note: Node | string | null, control: Node | null, more: Node | null = null): HTMLElement {
  return h(
    'div',
    { class: 'pol-l' },
    h('span', { class: 'pol-t' }, h('b', {}, title), note ? h('span', { class: 'pol-n' }, note) : null),
    control ? h('span', { class: 'pol-c' }, control) : null,
    more,
  );
}

/**
 * A choice of a few as a pill that opens their list (ui/measure.ts valuePick). Not a track: the words of five
 * intervals do not fit beside a line's name in every language, and squeezed it into a column a word wide (the
 * owner, 2026-11-12, of the Russian page: «лучше сделать а-ля дроп-даун»).
 */
function choice<T extends string>(y: RouterCtx, label: string, items: Record<T, string>, on: T, pick: (id: T) => void): HTMLElement {
  return valuePick<T>({
    label,
    value: items[on],
    options: (Object.keys(items) as T[]).map((id) => ({ id, label: items[id] })),
    on,
    pick,
    write: y.write,
    pill: true,
  });
}

/** How it updates on its own: a panel. */
export function policyPanel(y: RouterCtx): HTMLElement {
  const p = (y.set.effective as { updates?: UpdatePolicy }).updates ?? y.upd.policy;
  const checks: Record<CheckChoice, string> = {
    off: _('Off', 'updates'),
    '6h': _('Every 6 h'),
    '12h': _('Every 12 h'),
    '1d': _('Daily'),
    '7d': _('Weekly'),
  };
  const installs: Record<InstallChoice, string> = { off: _('By hand'), immediate: _('As soon as found'), scheduled: _('At a set time') };
  const targets: Record<UpdatePolicy['targets'][number], string> = {
    app: 'Dawnline',
    amneziawg: 'AmneziaWG',
    packages: _('System packages'),
  };
  const install = installChoice(p);

  // the time of a scheduled run, edited where the line says it
  let when: HTMLElement | null = null;
  if (p.auto && p.mode === 'scheduled') {
    const t = h(
      'button',
      { type: 'button', class: 'pol-time mono', disabled: !y.write || null, 'aria-label': _('Time') },
      p.time,
      y.write ? ic('edit') : null,
    );
    // the whole sentence, the time put where its own words have it
    const [before, after = ''] = _('Runs within an hour after %s (router time).').split('%s');
    // how to finish an edit, or why not, goes on a line of its own: the sentence (and the field in it) stays
    const hint = h('span', { class: 'pol-n', hidden: true });
    const say = (text: string | null, bad = false) => {
      hint.hidden = !text;
      hint.textContent = text ?? '';
      hint.classList.toggle('bad-t', bad);
    };
    if (y.write)
      t.addEventListener('click', () =>
        inlineEdit(t, {
          label: _('Time'),
          start: p.time,
          plain: true,
          max: 5,
          refuse: (v) => (timeHelp(v).bad ? timeHelp(v).text : null),
          commit: (v) => void pick(y, { update_time: v }, v),
          say,
        }),
      );
    when = h('span', { class: 'pol-w' }, h('span', { class: 'pol-n' }, before, t, after), hint);
  }

  // what it installs: chips that toggle, the warning beside AmneziaWG's
  let what: HTMLElement | null = null;
  if (p.auto) {
    const ids = Object.keys(targets) as UpdatePolicy['targets'];
    const chips = ids.map((id) => {
      const on = p.targets.includes(id);
      // built again once the pick is staged: it turns from what the one pressed showed (ui/carry.ts)
      return carryOn(
        `upd-target:${id}`,
        h(
          y.write ? 'button' : 'span',
          {
            type: y.write ? 'button' : null,
            class: `chipb${on ? ' on' : ''}`,
            'aria-pressed': String(on),
            onclick: y.write
              ? () =>
                  void pick(
                    y,
                    { update_targets: on ? p.targets.filter((x) => x !== id) : ids.filter((x) => x === id || p.targets.includes(x)) },
                    '',
                  )
              : null,
          },
          targets[id],
        ),
        on,
      );
    });
    what = line(
      _('What it installs'),
      p.targets.includes('amneziawg')
        ? h('span', { class: 'warn-t' }, _('A new AmneziaWG module restarts every tunnel.'))
        : _('AmneziaWG is off by default: a new kernel module restarts every tunnel.'),
      null,
      h('span', { class: 'pol-chips' }, ...chips),
    );
  }

  return card(
    cap(_('Automatic updates')),
    h(
      'div',
      { class: 'pol' },
      line(
        _('Check for new versions'),
        _('In the background; the components above say what it found.'),
        choice(y, _('Check for new versions'), checks, checkChoice(p), (v) => void pick(y, checkValues(v), checks[v])),
      ),
      line(
        _('Install what it finds'),
        when ?? (install === 'off' ? _('You install from the rows above.') : _('As soon as a check finds it.')),
        choice(y, _('Install what it finds'), installs, install, (v) => void pick(y, installValues(v), installs[v])),
      ),
      what,
    ),
    switchRow(
      {
        title: _('Keep the previous version'),
        sub: _('Saves the replaced Dawnline or AmneziaWG package on flash, so Roll back works without internet. Under 1 MB.'),
        on: p.keep,
        icon: 'backup',
        flip: async (on) => (await pick(y, { update_keep: on ? '1' : '0' }, '')) != null,
      },
      y.write,
    ),
    switchRow(
      {
        title: _('GitHub mirrors'),
        sub: _('When GitHub is unreachable, download through mirrors. Checksums are still verified.'),
        on: p.mirrors,
        icon: 'github',
        flip: async (on) => (await pick(y, { update_mirrors: on ? '1' : '0' }, '')) != null,
      },
      y.write,
    ),
  );
}

/** A finding as the history keeps it: a component and version, or "2 system packages". */
function itemText(item: string): string {
  const n = /^(\d+) system packages?$/.exec(item)?.[1];
  return n ? plural(Number(n), '%s system package', '%s system packages') : item;
}

function compName(comp: string): string {
  if (comp === 'app') return 'Dawnline';
  if (comp === 'amneziawg') return 'AmneziaWG';
  return comp === 'pkgs' ? _('System packages') : _('Components');
}

/**
 * One past update or finding as a row: its mark in its tone, what it was about (a component and its versions, what
 * a check found) as the row's name, how it came about under it (by you or by itself, how long it took, why it
 * failed), how long ago at the row's end.
 */
function histRow(y: RouterCtx, e: UpdateEvent): HTMLElement {
  const comp = compName(jobComponent(e.component ?? 'app'));
  let tone = 'ok';
  let icon = 'check';
  let name: (Node | string)[];
  let line: string;
  if (e.kind === 'found') {
    tone = 'found';
    icon = 'download';
    // the router's words, kept in the history ("Dawnline 0.3.3", "2 system packages")
    name = [(e.items ?? []).map(itemText).join(', ')];
    line = e.auto ? _('found by the automatic check') : _('found by a check');
  } else if (e.state === 'failed') {
    tone = 'bad';
    icon = 'x';
    name = [comp];
    line = [e.kind === 'install' ? _('the update failed') : _('the check failed'), routerSaid(e.error) ?? ''].filter(Boolean).join(' · ');
  } else if (/^app:(lang:|nolang$)/.test(e.component ?? '')) {
    const lang = /^app:lang:(.+)$/.exec(e.component ?? '')?.[1];
    name = [lang ? translationName(lang) : _('Translation')];
    line = lang ? _('added by you') : _('removed by you');
  } else {
    // the versions in mono, the one it left quieter than the one it came to
    const moved = e.from && e.to && e.from !== e.to;
    name = [
      comp,
      moved
        ? h('span', { class: 'hist-v mono' }, h('span', {}, e.from!), h('i', { 'aria-hidden': 'true' }, '→'), e.to!)
        : e.to
          ? h('span', { class: 'hist-v mono' }, e.to)
          : '',
    ];
    line = [e.auto ? _('automatically') : _('by you'), e.took == null ? '' : e.took < 60 ? _('under a minute') : duration(e.took)]
      .filter(Boolean)
      .join(' · ');
  }
  return h(
    'div',
    { class: `hist ${tone}` },
    h('span', { class: 'dg-m' }, ic(icon)),
    h('span', { class: 'hist-t' }, h('b', {}, ...name), h('span', { class: 'hist-l' }, line)),
    h('span', { class: 'hist-w num', title: new Date(e.ts * 1000).toLocaleString(locale()) }, ago(e.ts, y.upd.now)),
  );
}

/** The latest updates and findings: a panel with its caption and the way to all of them in the Log, then the rows on one list (none yet: nothing). */
export function latestUpdates(y: RouterCtx): HTMLElement | null {
  const hist = (y.upd.history ?? []).slice(0, 5);
  if (!hist.length) return null;
  return card(
    cap(_('Latest'), h('a', { class: 'pill-link', href: logUrl({ kind: 'system' }) }, h('span', {}, _('All in Log')), ic('chevron'))),
    h('div', { class: 'hists-l' }, ...hist.map((e) => histRow(y, e))),
  );
}
