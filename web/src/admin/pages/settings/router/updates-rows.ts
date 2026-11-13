// Settings › Updates: the components as rows of one list. Dawnline (its
// update, another version, reinstall, roll back, translation), AmneziaWG
// (its build, update, roll back, translation) and the system packages
// Dawnline adds (one row; a feature missing its packages gets a row of its
// own with Install). Each has its ⋯ with the rest (What's new, other
// versions, reinstall, roll back, check, GitHub). Every job runs in the
// sheet (flows/operation.ts); one under way stands in its component's row,
// which opens its sheet again.

import type { UpdateComponent } from '../../../api';
import { h } from '../../../../portal/dom';
import { openMenu, type MenuItem } from '../../../../portal/ui/menu';
import { ago } from '../../../../shared/format';
import { fmt, locale, plural } from '../../../../shared/i18n';
import { glass } from '../../../ui/glass';
import { ic } from '../../../ui/icons';
import { knob } from '../../../ui/page-head';
import { jobComponent, jobTitle, runningComponent } from '../../../updater/jobs';
import { followOperation } from '../../../flows/operation';
import { whatsNew } from '../../../flows/whats-new';
import { versionsSheet } from '../../../flows/versions';
import { awgBuildSheet, restartsText } from '../../../flows/awg-build';
import { installSheet } from '../../../flows/install';
import { packagesSheet, sysItems } from '../../../flows/packages';
import type { RouterCtx } from './ctx';
import { routerSaid } from '../../../failure';

/** The ⋯ of a component's row. */
function more(label: string, items: () => (MenuItem | null)[]): HTMLButtonElement {
  const k = knob('more', label);
  k.addEventListener('click', () => openMenu(k, items(), label));
  return k;
}

type RowTone = 'blue' | 'grey' | 'orange' | 'red';

/**
 * A component's mark by where it stands: blue on its latest version (or newer, a build of its own), orange when a
 * newer one is out, grey before it was ever checked.
 */
const versionTone = (c: UpdateComponent | undefined): RowTone =>
  c?.update ? 'orange' : c?.status === 'latest' || c?.status === 'dev' ? 'blue' : 'grey';

/** A component's row: its glass, name and line, then its controls. */
function row(icon: string, tone: RowTone, name: string, line: string, tail: (Node | null)[], cls = ''): HTMLElement {
  return h(
    'div',
    { class: `chk comp${cls ? ` ${cls}` : ''}` },
    glass(icon, tone),
    h('span', { class: 'chk-t' }, h('b', {}, name), h('span', {}, line)),
    ...tail,
  );
}

/** The job running for `comp` now, if any (its row shows it and follows it in the sheet). */
function running(y: RouterCtx, comp: string): HTMLButtonElement | null {
  const j = y.upd.job;
  if (j?.state !== 'running') return null;
  const of = runningComponent(j);
  const mine =
    of === comp || of === 'all' || (j.action !== 'check' && (j.component ?? '').split(' ').some((x) => jobComponent(x) === comp));
  if (!mine) return null;
  const b = h(
    'button',
    { type: 'button', class: 'btn tint sm run' },
    h('span', {}, j.action === 'check' ? _('Checking…') : _('Updating…')),
  ) as HTMLButtonElement;
  b.addEventListener('click', () => followOperation(j, jobTitle(j), () => void y.reload()));
  return b;
}

/** A job may start: this login may change things and no other job runs. */
export const startable = (y: RouterCtx): boolean => y.write && !y.busy();

function appRow(y: RouterCtx, a: UpdateComponent | undefined): HTMLElement {
  const u = y.upd;
  const kept = u.kept?.app;
  const tag = a?.update && a.tag ? a.tag : u.version;
  const notes = () => whatsNew('app', tag, fmt(_('What’s new in Dawnline %s'), tag.replace(/^v/, '')));
  const line = a?.error
    ? (routerSaid(a.error) ?? '')
    : a?.update
      ? fmt(_('Now %s. Updating restarts the service for a few seconds; tunnels stay up.'), u.version)
      : a?.status === 'dev'
        ? fmt(_('Newer than the release (%s)'), a.latest ?? '')
        : a
          ? fmt(_('Latest version · checked %s'), ago(u.check?.time ?? 0, u.now))
          : _('Not checked yet');
  const run = running(y, 'app');
  const act = run
    ? run
    : a?.update && startable(y)
      ? h(
          'button',
          { type: 'button', class: 'btn accent sm', onclick: () => y.op({ what: 'app', title: _('Updating Dawnline') }) },
          h('span', {}, _('Update')),
        )
      : h('button', { type: 'button', class: 'pill-link', onclick: notes }, h('span', {}, _('What’s new')), ic('chevron', 'i pl-chev'));
  const ru = (u.translations ?? []).includes('ru');
  const menu = more(_('Dawnline: more'), () => [
    // what to read; then what is run or changed; then what replaces the version in use (warn), last
    { label: _('What’s new'), icon: 'file', run: notes },
    {
      label: _('Other versions'),
      icon: 'archive',
      run: () =>
        versionsSheet(
          u.version,
          (t) => y.op({ what: `app@${t}`, title: fmt(_('Installing Dawnline %s'), t.replace(/^v/, '')) }),
          !y.write ? 'view' : y.busy() ? 'busy' : 'yes',
        ),
    },
    { label: _('Open on GitHub'), icon: 'github', run: () => window.open(`https://github.com/${u.repo}`, '_blank', 'noopener') },
    ...(startable(y)
      ? [
          null,
          { label: _('Check Dawnline'), icon: 'refresh', run: () => y.op({ what: 'check:app', title: _('Checking Dawnline') }) },
          {
            label: ru ? _('Remove the Russian translation') : _('Add the Russian translation'),
            icon: 'globe',
            sub: _('LuCI pages for Dawnline'),
            run: () =>
              y.op({
                what: ru ? 'app:nolang' : 'app:lang:ru',
                title: ru ? _('Removing the Russian translation') : _('Adding the Russian translation'),
              }),
          },
          null,
          {
            label: fmt(_('Reinstall %s'), u.version),
            icon: 'reset',
            tone: 'warn' as const,
            run: () => y.op({ what: 'app:reinstall', title: _('Reinstalling Dawnline') }),
          },
          kept
            ? {
                label: fmt(_('Roll back to %s'), kept.version),
                icon: 'archive',
                tone: 'warn' as const,
                run: () => y.op({ what: 'app:rollback', title: _('Rolling back Dawnline') }),
              }
            : null,
        ]
      : []),
  ]);
  return row(
    'dawnline',
    versionTone(a),
    a?.update && a.latest ? `Dawnline ${a.latest}` : `Dawnline ${u.version}`,
    line,
    [act, menu],
    a?.error ? 'warn' : '',
  );
}

function awgRow(y: RouterCtx, w: UpdateComponent | undefined): HTMLElement {
  const u = y.upd;
  const missing = u.needs?.awg ?? [];
  const installed = missing.length ? null : (w?.installed ?? null);
  const cur = w?.current ?? null;
  const src = cur ? w?.sources?.[cur] : undefined;
  const kept = u.kept?.amneziawg;
  const ru = !!w?.ru;
  const reread = () => void y.reload();
  const again = (what: string, title: string, ask: string, action: string) =>
    y.op({
      what,
      title,
      ask: { icon: 'amneziawg', tone: 'orange', title: ask, text: [restartsText(u.tunnels ?? [])], action, cls: 'warn' },
    });
  const line = !installed
    ? missing.length
      ? fmt(_('missing %s'), missing.join(', '))
      : _('not installed')
    : [src ? fmt(_('The %s build'), src.label) : '', installed, w?.release ? fmt(_('%s build'), w.release) : '']
        .filter(Boolean)
        .join(' · ');
  const run = running(y, 'amneziawg');
  const act = run
    ? run
    : !installed && startable(y)
      ? h('button', { type: 'button', class: 'btn tint sm', onclick: () => installSheet('awg', [], reread) }, h('span', {}, _('Install')))
      : w?.update && installed && cur && startable(y)
        ? h(
            'button',
            {
              type: 'button',
              class: 'btn accent sm',
              onclick: () =>
                again(
                  `amneziawg:${cur}${ru ? ':ru' : ''}`,
                  _('Updating AmneziaWG'),
                  fmt(_('Update AmneziaWG to %s?'), w.latest ?? ''),
                  _('Update'),
                ),
            },
            h('span', {}, fmt(_('Update to %s'), w.latest ?? '')),
          )
        : null;
  const menu = more(_('AmneziaWG: more'), () => [
    // what to read; then what is run or changed; then what replaces the build in use (warn), last
    w?.release
      ? {
          label: _('What’s new'),
          icon: 'file',
          run: () => whatsNew('amneziawg', w.release!, fmt(_('What’s new in the %s build'), src?.label ?? 'AmneziaWG'), cur ?? 'slava'),
        }
      : null,
    {
      label: _('Open on GitHub'),
      icon: 'github',
      run: () => window.open(`https://github.com/${src?.repo ?? 'Slava-Shchipunov/awg-openwrt'}`, '_blank', 'noopener'),
    },
    null,
    startable(y)
      ? {
          label: _('Check AmneziaWG'),
          icon: 'refresh',
          run: () =>
            y.op({
              what: 'check:amneziawg',
              title: _('Checking AmneziaWG'),
              // found one: its button updates the build in use, in the same sheet
              update: (st) => {
                const x = st.check?.components?.amneziawg;
                return x?.update && x.current && x.installed
                  ? { what: `amneziawg:${x.current}${x.ru ? ':ru' : ''}`, title: _('Updating AmneziaWG'), done: reread }
                  : null;
              },
            }),
        }
      : null,
    startable(y) && w ? { label: _('Change the build'), icon: 'amneziawg', run: () => awgBuildSheet(u, w, installed, reread) } : null,
    ...(startable(y) && installed && cur
      ? [
          {
            label: ru ? _('Remove the Russian translation') : _('Add the Russian translation'),
            icon: 'globe',
            sub: _('LuCI pages for AmneziaWG'),
            run: () =>
              y.op({
                what: `amneziawg:${cur}${ru ? '' : ':ru'}`,
                title: ru ? _('Removing the Russian translation') : _('Adding the Russian translation'),
                ask: {
                  icon: 'amneziawg',
                  tone: 'orange',
                  title: ru ? _('Remove the Russian translation?') : _('Add the Russian translation?'),
                  text: [restartsText(u.tunnels ?? [])],
                  action: ru ? _('Remove') : _('Add'),
                  cls: 'warn',
                },
              }),
          },
          null,
          {
            label: _('Reinstall this build'),
            icon: 'reset',
            tone: 'warn' as const,
            run: () => again(`amneziawg:${cur}${ru ? ':ru' : ''}`, _('Reinstalling AmneziaWG'), _('Reinstall AmneziaWG?'), _('Reinstall')),
          },
          kept
            ? {
                label: fmt(_('Roll back to %s'), kept.version),
                icon: 'archive',
                tone: 'warn' as const,
                run: () =>
                  again(
                    'amneziawg:rollback',
                    _('Rolling back AmneziaWG'),
                    fmt(_('Roll back AmneziaWG to %s?'), kept.version),
                    _('Roll back'),
                  ),
              }
            : null,
        ]
      : []),
  ]);
  return row(
    'amneziawg',
    // not there: nothing connects
    !installed ? 'red' : versionTone(w),
    installed && w?.gen ? `AmneziaWG ${w.gen}` : 'AmneziaWG',
    line,
    [act, menu],
    !installed ? 'warn' : '',
  );
}

/** The system packages: one row, and a row with Install for each feature in use that misses its packages. */
function pkgRows(y: RouterCtx, p: UpdateComponent | undefined): HTMLElement[] {
  const u = y.upd;
  const pkgs = p?.pkgs ?? {};
  const items = sysItems().filter((it) => (it.feature === 'home' ? u.home : u.portal));
  const reread = () => void y.reload();
  const out: HTMLElement[] = [];
  const have: string[] = [];
  const upd: string[] = [];
  for (const it of items) {
    const present = it.pkgs.filter((x) => pkgs[x]?.installed);
    const lacks = u.needs?.[it.feature] ?? it.pkgs.filter((x) => !pkgs[x]?.installed);
    if (lacks.length) {
      out.push(
        row(
          it.icon,
          it.optional ? 'grey' : 'orange',
          it.title,
          it.optional ? `${it.sub} · ${_('not installed')}` : fmt(_('missing %s'), lacks.join(', ')),
          [
            startable(y)
              ? h(
                  'button',
                  {
                    type: 'button',
                    class: `btn ${it.optional ? 'soft' : 'tint'} sm`,
                    onclick: () => installSheet(it.feature, lacks, reread),
                  },
                  h('span', {}, _('Install')),
                )
              : null,
          ],
          it.optional ? '' : 'warn',
        ),
      );
      continue;
    }
    have.push(it.title);
    for (const x of present) {
      if (pkgs[x]?.latest || pkgs[x]?.with?.length) upd.push(x);
    }
  }
  const n = new Set(upd).size;
  const line = [
    have.length ? fmt(_('In use: %s'), new Intl.ListFormat(locale(), { type: 'conjunction' }).format(have)) : _('None in use'),
    p?.error ? (routerSaid(p.error) ?? '') : !p ? _('not checked yet') : n ? plural(n, '%s update', '%s updates') : _('up to date'),
  ].join(' · ');
  const run = running(y, 'pkgs');
  const act = run
    ? run
    : n && startable(y)
      ? h(
          'button',
          {
            type: 'button',
            class: 'btn accent sm',
            onclick: () =>
              y.op({
                what: `pkgs:${[...new Set(upd)].join(',')}`,
                title: _('Updating system packages'),
                ask: {
                  icon: 'openwrt',
                  tone: 'blue',
                  title: _('Update the system packages?'),
                  text: [fmt(_('%s from the OpenWrt feeds. Services that use them restart for a moment.'), [...new Set(upd)].join(', '))],
                  action: _('Update'),
                  cls: 'accent',
                },
              }),
          },
          h('span', {}, _('Update')),
        )
      : null;
  const menu = more(_('System packages: more'), () => [
    // what to read, then what is run
    { label: _('Packages and versions'), icon: 'file', run: () => packagesSheet(items, pkgs) },
    {
      label: _('Open the OpenWrt package list'),
      icon: 'open',
      run: () => window.open('https://openwrt.org/packages/start', '_blank', 'noopener'),
    },
    null,
    startable(y)
      ? {
          label: _('Check system packages'),
          icon: 'refresh',
          run: () => y.op({ what: 'check:packages', title: _('Checking system packages') }),
        }
      : null,
  ]);
  if (items.length) out.unshift(row('openwrt', n ? 'blue' : 'grey', _('System packages'), line, [act, menu], p?.error ? 'warn' : ''));
  return out;
}

/** The components' list: Dawnline, AmneziaWG, the system packages and the features that miss theirs. */
export function componentRows(y: RouterCtx): HTMLElement {
  const all = y.upd.check?.components ?? {};
  return h('div', { class: 'checks' }, appRow(y, all.app), awgRow(y, all.amneziawg), ...pkgRows(y, all.packages));
}
