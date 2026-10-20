// Components → the Dawnline block: version, what the update brings, its
// settings at a glance, every release to install (Versions) and the admin's
// translation.

import { E } from '../../e';
import { api, type UpdateComponent } from '../../api';
import { button, iconButton } from '../../ui/button';
import { confirmDialog } from '../../ui/modal';
import { errorText, notify } from '../../ui/toast';
import { input, sw } from '../../ui/controls';
import { pill } from '../../ui/badges';
import { icon } from '../../../shared/icons';
import { ago, duration, fmtDay } from '../../../shared/format';
import { fmt, plural } from '../../../shared/i18n';
import { whatsNew } from '../../updater/notes';
import type { ComponentsPage, MenuEntry } from './index';

/** How often Settings → Updates checks, by its interval id. */
function checksEvery(interval: string): string {
  const t: Record<string, string> = {
    '6h': _('checks every 6 h'),
    '12h': _('checks every 12 h'),
    '1d': _('checks daily'),
    '7d': _('checks weekly'),
  };
  return t[interval] ?? t['1d'];
}

/** A release date (GitHub gives a timestamp). */
const released = (d: string | null | undefined) => (d ? fmtDay(d) : '');

/**
 * One change as a short line: the part before "; " or ": " when that says
 * enough, else the first 90 characters at a word boundary.
 */
function short(p: string): string {
  const head = /^(.{20,}?)(?:;\s|:\s)/.exec(p)?.[1];
  if (head) return head;
  if (p.length <= 90) return p;
  return `${p.slice(0, 90).replace(/[\s,;:]+\S*$/, '')}…`;
}

export function hero(page: ComponentsPage, a: UpdateComponent | undefined): HTMLElement {
  const st = page.st;
  const pol = st.policy;
  const kept = st.kept?.app;
  const tag = a?.update && a.tag ? a.tag : st.version;
  const notesOf = (t: string) => () => whatsNew('app', t, fmt(_('What’s new in Dawnline %s'), t.replace(/^v/, '')));
  // What the offered release brings, or what the installed one brought when it is the latest.
  const items = a?.tag && (a.update || a.status === 'latest') ? bullets(page, a.tag, a.update ? st.version : '') : null;
  const ptag = a?.tag ?? tag;
  const nextCheck =
    pol.check && st.auto?.check ? st.auto.check + ({ '6h': 6, '12h': 12, '1d': 24, '7d': 168 }[pol.interval] ?? 24) * 3600 : 0;
  const side = (label: string, value: (Node | string)[]) =>
    E('div', { class: 'dl-stack gap4' }, [E('span', { class: 'dl-metric-label' }, label), E('span', { class: 'dl-comp-side-v' }, value)]);
  const menu: (MenuEntry | null)[] = [
    { label: _('What’s new'), ic: 'file', run: notesOf(tag) },
    { label: _('Open on GitHub'), ic: 'globe', run: () => window.open(`https://github.com/${st.repo}`, '_blank', 'noopener') },
    null,
    {
      label: fmt(_('Reinstall %s'), st.version),
      ic: 'reset',
      warn: true,
      run: () => page.op('app:reinstall', _('Reinstalling Dawnline'), st.version),
    },
    kept
      ? {
          label: fmt(_('Roll back to %s'), kept.version),
          ic: 'archive',
          warn: true,
          run: async () => {
            if (
              await confirmDialog(
                fmt(_('Roll back to Dawnline %s?'), kept.version),
                fmt(_('The copy kept on the router replaces %s. A backup of the settings is made first.'), st.version),
                _('Roll back'),
              )
            )
              void page.op('app:rollback', _('Rolling back Dawnline'), st.version);
          },
        }
      : null,
  ];
  return E('section', { class: 'dl-panel flush dl-comp-hero' }, [
    E('div', { class: 'dl-comp-hero-main' }, [
      E('div', { class: 'dl-comp-hero-head' }, [
        E('span', { class: 'dl-group-ic' }, icon('sunrise')),
        E('b', { class: 'dl-comp-name' }, 'Dawnline'),
        page.state('app', a, a?.latest ?? ''),
        E('span', { class: 'dl-spacer' }),
        page.round(() => page.op('check:app', _('Checking Dawnline'), st.version), menu, true),
      ]),
      // Version, what it is, and the update: one line.
      E('div', { class: 'dl-comp-verrow' }, [
        E('div', { class: 'dl-stack' }, [
          E('div', { class: 'dl-comp-big' }, [
            st.version,
            a?.update
              ? E('small', {}, `→ ${a.latest}`)
              : a?.status === 'dev' && a.latest
                ? E('small', { class: 'dl-faint' }, fmt(_('release %s'), a.latest))
                : '',
          ]),
          E(
            'span',
            { class: 'dl-faint dl-comp-meta' },
            a?.error
              ? ''
              : a?.update
                ? a.published
                  ? fmt(_('released %s'), released(a.published))
                  : ''
                : a?.status === 'dev'
                  ? _('ahead of the latest release')
                  : a
                    ? [_('latest release'), a.published ? fmt(_('released %s'), released(a.published)) : ''].filter(Boolean).join(' · ')
                    : _('not checked yet'),
          ),
        ]),
      ]),
      // Three points at most; the rest is one click away.
      items?.items.length
        ? E('div', { class: 'dl-stack gap4' }, [
            E(
              'ul',
              { class: 'dl-comp-bullets' },
              items.items.map((b) => E('li', {}, b)),
            ),
            items.total > items.items.length
              ? E(
                  'button',
                  { type: 'button', class: 'dl-linkbtn dl-comp-more', click: notesOf(ptag) },
                  plural(items.total - items.items.length, '+%s more in What’s new', '+%s more in What’s new'),
                )
              : '',
          ])
        : '',
      a?.error ? E('p', { class: 'dl-sub dl-comp-lead dl-upd-bad' }, a.error) : '',
      // The update and its notes; without an update What's new stays in ⋯.
      a?.update
        ? E('div', { class: 'dl-comp-btns' }, [
            button(_('Update now'), () => page.op('app', _('Updating Dawnline'), st.version), 'positive', { disabled: page.busy }),
            button(_('What’s new'), notesOf(tag)),
          ])
        : '',
      versions(page),
      translation(page),
    ]),
    E('div', { class: 'dl-comp-hero-side' }, [
      side(_('Source'), [icon('globe'), E('a', { href: `https://github.com/${st.repo}`, target: '_blank', rel: 'noopener' }, st.repo)]),
      side(_('Auto-update'), [
        pol.auto ? pill('ok', _('On')) : pill('', _('Off')),
        E(
          'span',
          { class: 'dl-muted' },
          pol.auto
            ? pol.mode === 'immediate'
              ? _('as soon as found')
              : fmt(pol.interval === '7d' ? _('weekly at %s') : _('daily at %s'), pol.time)
            : pol.check
              ? checksEvery(pol.interval)
              : _('checks off'),
        ),
      ]),
      side(
        _('Last check'),
        st.check
          ? [
              ago(st.check.time, st.now),
              nextCheck > st.now ? E('span', { class: 'dl-faint' }, `· ${fmt(_('next in %s'), duration(nextCheck - st.now))}`) : '',
            ]
          : [_('Never')],
      ),
      side(
        _('Rollback'),
        kept
          ? [E('span', { class: 'dl-mono' }, kept.version), E('span', { class: 'dl-faint' }, _('kept on flash'))]
          : [E('span', { class: 'dl-muted' }, pol.keep ? _('Kept after the next update') : _('Off'))],
      ),
    ]),
  ]);
}

/**
 * The first points of what a release brings (fetched once per tag): the
 * release notes' list, else the commits since `from` (or the release's own commit).
 */
function bullets(page: ComponentsPage, tag: string, from: string): { items: string[]; total: number } | null {
  if (page.notes.has(tag)) return page.notes.get(tag) ?? null;
  page.notes.set(tag, null);
  const clean = (x: string) => x.replace(/\*\*|`|\[([^\]]+)\]\([^)]*\)/g, (_m, t) => t ?? '').trim();
  void (async () => {
    const body = (await api.updatesNotes('app', tag, '').catch(() => null))?.body ?? '';
    let pts = body
      .split('\n')
      .map((l) => /^\s*[-*+]\s+(.*)$/.exec(l)?.[1])
      .filter((x): x is string => !!x);
    if (!pts.length) pts = (await api.updatesChanges(from, tag).catch(() => null))?.items ?? [];
    const out = { items: pts.slice(0, 3).map((x) => short(clean(x))), total: pts.length };
    page.notes.set(tag, out);
    if (out.items.length && page.root.isConnected) page.paint();
  })();
  return null;
}

/** A translation's name, by its language code. */
export function translationName(lang: string): string {
  return lang === 'ru' ? _('Russian translation') : lang;
}

/**
 * The admin's translation, switched like AmneziaWG's: luci-i18n-dawnline-ru
 * from the release of the installed version (the updater installs and
 * removes it, then LuCI's web server restarts to read it).
 */
function translation(page: ComponentsPage): HTMLElement {
  const ru = (page.st.translations ?? []).includes('ru');
  const s = sw(ru, translationName('ru'), (v) => {
    void page.op(
      v ? 'app:lang:ru' : 'app:nolang',
      v ? _('Adding the Russian translation') : _('Removing the Russian translation'),
      page.st.version,
    );
  });
  s.disabled = page.busy;
  const fold = E('details', { class: 'dl-params dl-comp-fold', open: page.langOpen ? 'open' : null }, [
    E('summary', {}, [
      icon('chevron'),
      E('span', {}, _('Translation')),
      E('span', { class: 'dl-sub' }, ru ? _('Russian') : _('English only')),
    ]),
    E('div', { class: 'dl-params-body' }, [
      E('div', { class: 'dl-list' }, [
        E('div', { class: 'dl-row' }, [
          E('span', { class: 'dl-row-main dl-stack' }, [
            E('b', {}, translationName('ru')),
            E('span', { class: 'dl-sub' }, _('LuCI pages for Dawnline')),
          ]),
          E('span', { class: 'dl-comp-bact' }, s),
        ]),
      ]),
    ]),
  ]);
  fold.addEventListener('toggle', () => (page.langOpen = (fold as HTMLDetailsElement).open));
  return fold;
}

function versions(page: ComponentsPage): HTMLElement {
  const body = E('div', { class: 'dl-params-body' });
  const fold = E('details', { class: 'dl-params dl-comp-vers', open: page.versOpen ? 'open' : null }, [
    E('summary', {}, [icon('chevron'), E('span', {}, _('Versions')), E('span', { class: 'dl-sub' }, _('install any release'))]),
    body,
  ]);
  fold.addEventListener('toggle', () => {
    page.versOpen = (fold as HTMLDetailsElement).open;
    if (page.versOpen) void paintVersions(page, body);
  });
  if (page.versOpen) void paintVersions(page, body);
  return fold;
}

async function paintVersions(page: ComponentsPage, body: HTMLElement) {
  const tag = input('', { placeholder: _('Tag, e.g. 0.3.1'), class: 'cbi-input-text dl-mono', 'aria-label': _('Release tag') });
  const installTag = (t: string) => {
    t = t.trim();
    if (!/^v?[0-9][0-9A-Za-z.+~-]{0,40}$/.test(t)) return notify(_('Enter a release tag like 0.3.1'), 'warning');
    void install(page, t);
  };
  tag.addEventListener('keydown', (ev: KeyboardEvent) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      installTag(tag.value);
    }
  });
  const head = E('div', { class: 'dl-comp-tag' }, [
    tag,
    button(_('Install'), () => installTag(tag.value), 'neutral', { disabled: page.busy }),
  ]);
  const pageNo = page.versPage;
  const turn = (d: number) => {
    page.versPage = Math.max(1, page.versPage + d);
    void paintVersions(page, body);
  };
  const pager = (more: boolean) =>
    E('div', { class: 'dl-comp-pager' }, [
      E('button', { type: 'button', class: 'dl-linkbtn', disabled: pageNo <= 1 ? 'disabled' : null, click: () => turn(-1) }, _('← Newer')),
      E('span', { class: 'dl-faint' }, fmt(_('Page %s'), pageNo)),
      E('button', { type: 'button', class: 'dl-linkbtn', disabled: more ? null : 'disabled', click: () => turn(1) }, _('Older →')),
    ]);
  let rows = page.versCache.get(pageNo);
  if (!rows) {
    dom.content(body, [head, E('p', { class: 'dl-muted dl-loading' }, _('Loading versions…'))]);
    try {
      rows = (await api.updatesReleases(pageNo)).releases;
    } catch (e) {
      // Not kept: opening the list again, or Try again, asks once more.
      if (pageNo !== page.versPage || !body.isConnected) return;
      dom.content(body, [
        head,
        E('div', { class: 'dl-row-actions' }, [
          E('span', { class: 'dl-muted' }, fmt(_('Failed to load versions: %s'), errorText(e))),
          button(_('Try again'), () => paintVersions(page, body)),
        ]),
        pager(false),
      ]);
      return;
    }
    page.versCache.set(pageNo, rows);
    if (pageNo !== page.versPage || !body.isConnected) return;
  }
  if (!rows.length)
    return dom.content(body, [
      head,
      E('p', { class: 'dl-muted' }, pageNo > 1 ? _('No more versions.') : _('No versions found.')),
      pager(false),
    ]);
  const cur = page.st.version;
  dom.content(body, [
    head,
    ...rows.map((r) => {
      const v = r.tag.replace(/^v/, '');
      return E('div', { class: 'dl-comp-ver' }, [
        E('span', { class: 'dl-mono' }, v),
        E('span', { class: 'dl-sub' }, released(r.published)),
        r.prerelease ? pill('warn', _('Pre-release')) : '',
        E(
          'span',
          { class: 'dl-comp-ic' },
          iconButton('file', _('What’s new'), () => whatsNew('app', r.tag, fmt(_('What’s new in Dawnline %s'), v))),
        ),
        v === cur ? pill('ok', _('Installed')) : button(_('Install'), () => install(page, r.tag), 'neutral', { disabled: page.busy }),
      ]);
    }),
    pager(rows.length >= 5),
  ]);
}

/** A release by tag; going back asks first (settings written by a newer version may not carry over). */
async function install(page: ComponentsPage, tag: string) {
  const v = tag.replace(/^v/, '');
  const older = v.localeCompare(page.st.version, undefined, { numeric: true }) < 0;
  if (
    older &&
    !(await confirmDialog(
      fmt(_('Install Dawnline %s?'), v),
      fmt(
        _('It is older than %s. A backup of the settings is made first; restore it from Settings if something looks wrong.'),
        page.st.version,
      ),
      _('Install'),
    ))
  )
    return;
  void page.op(`app@${tag}`, fmt(_('Installing Dawnline %s'), v), page.st.version);
}
