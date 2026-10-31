// Components → Activity: the latest updates, and checks that found something.

import type { UpdateEvent } from '../../api';
import { E } from '../../e';
import { icon } from '../../../shared/icons';
import { ago, duration } from '../../../shared/format';
import { fill, locale, plural } from '../../../shared/i18n';
import { jobComponent } from '../../updater/jobs';
import { translationName } from './hero';
import type { ComponentsPage } from './index';

function compName(comp: string): string {
  if (comp === 'app') return 'Dawnline';
  if (comp === 'amneziawg') return 'AmneziaWG';
  return comp === 'pkgs' ? _('System packages') : _('Components');
}

/** A finding as the history keeps it: a component and version, or "2 system packages". */
function itemText(item: string): string {
  const n = /^(\d+) system packages?$/.exec(item)?.[1];
  return n ? plural(Number(n), '%s system package', '%s system packages') : item;
}

export function activity(page: ComponentsPage): HTMLElement {
  const st = page.st;
  const row = (e: UpdateEvent) => {
    const comp = jobComponent(e.component ?? 'app');
    const who = E('b', {}, compName(comp));
    let tone = 'ok',
      ic = 'check',
      text: (Node | string)[];
    if (e.kind === 'found') {
      tone = 'accent';
      ic = 'download';
      // The items are the router's words, kept in the history ("Dawnline 0.3.3", "2 system packages").
      text = fill(
        e.auto ? _('%s found by the automatic check') : _('%s found by a check'),
        E('b', {}, (e.items ?? []).map(itemText).join(', ')),
      );
    } else if (e.state === 'failed') {
      tone = 'bad';
      ic = 'x';
      text = [...fill(e.kind === 'install' ? _('%s update failed') : _('%s check failed'), who), e.error ? ` · ${e.error}` : ''];
    } else if (/^app:(lang:|nolang$)/.test(e.component ?? '')) {
      // The admin's translation, added or removed in Components.
      const lang = /^app:lang:(.+)$/.exec(e.component ?? '')?.[1];
      text = lang ? fill(_('%s added by you'), E('b', {}, translationName(lang))) : [_('Translation removed by you')];
    } else {
      const ver = e.from && e.to && e.from !== e.to ? `${e.from} → ${e.to}` : (e.to ?? '');
      text = [
        ...(ver
          ? fill<Node | string>(e.auto ? _('%s %s automatically') : _('%s %s by you'), who, ver)
          : fill(e.auto ? _('%s updated automatically') : _('%s updated by you'), who)),
        e.took ? ` · ${duration(e.took)}` : '',
      ];
    }
    return E('div', { class: 'dl-row' }, [
      E('span', { class: `dl-ev-tile ev ${tone}` }, icon(ic)),
      E('span', { class: 'dl-row-main' }, text),
      E('span', { class: 'dl-faint dl-nowrap', title: new Date(e.ts * 1000).toLocaleString(locale()) }, ago(e.ts, st.now)),
    ]);
  };
  const h = st.history ?? [];
  return E('section', { class: 'dl-panel flush' }, [
    E('div', { class: 'dl-panel-head pad' }, [
      E('h3', {}, _('Activity')),
      E('span', { class: 'dl-spacer' }),
      E('a', { href: `${L.url('admin/services/dawnline/diagnostics')}?tab=log` }, _('All in Log →')),
    ]),
    h.length
      ? E('div', {}, h.slice(0, 8).map(row))
      : E('p', { class: 'dl-sub dl-comp-empty' }, _('Updates, and checks that found something, show up here.')),
  ]);
}
