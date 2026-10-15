// Components → Activity: the latest updates, and checks that found something.

import type { UpdateEvent } from '../../api';
import { E } from '../../e';
import { icon } from '../../../shared/icons';
import { ago, duration } from '../../../shared/format';
import { jobComponent } from '../../updater/jobs';
import type { ComponentsPage } from './index';

const NAMES: Record<string, string> = { app: 'Dawnline', amneziawg: 'AmneziaWG', pkgs: 'System packages', all: 'Components' };

export function activity(page: ComponentsPage): HTMLElement {
  const st = page.st;
  const row = (e: UpdateEvent) => {
    const comp = jobComponent(e.component ?? 'app');
    const who = NAMES[comp] ?? 'Components';
    const how = e.auto ? 'automatically' : 'by you';
    let tone = 'ok',
      ic = 'check',
      text: (Node | string)[];
    if (e.kind === 'found') {
      tone = 'accent';
      ic = 'download';
      text = [E('b', {}, (e.items ?? []).join(', ')), ` found by ${e.auto ? 'the automatic check' : 'a check'}`];
    } else if (e.state === 'failed') {
      tone = 'bad';
      ic = 'x';
      text = [E('b', {}, who), ` ${e.kind === 'install' ? 'update' : 'check'} failed${e.error ? ` · ${e.error}` : ''}`];
    } else {
      const ver = e.from && e.to && e.from !== e.to ? ` ${e.from} → ${e.to}` : e.to ? ` ${e.to}` : '';
      text = [E('b', {}, who), `${ver} ${ver ? '' : 'updated '}${how}${e.took ? ` · ${duration(e.took)}` : ''}`.replace(/\s+/g, ' ')];
    }
    return E('div', { class: 'dl-row' }, [
      E('span', { class: `dl-ev-tile ev ${tone}` }, icon(ic)),
      E('span', { class: 'dl-row-main' }, text),
      E('span', { class: 'dl-faint dl-nowrap', title: new Date(e.ts * 1000).toLocaleString() }, ago(e.ts, st.now)),
    ]);
  };
  const h = st.history ?? [];
  return E('section', { class: 'dl-panel flush' }, [
    E('div', { class: 'dl-panel-head pad' }, [
      E('h3', {}, 'Activity'),
      E('span', { class: 'dl-spacer' }),
      E('a', { href: `${L.url('admin/network/dawnline/diagnostics')}?tab=log` }, 'All in Log →'),
    ]),
    h.length
      ? E('div', {}, h.slice(0, 8).map(row))
      : E('p', { class: 'dl-sub dl-comp-empty' }, 'Updates, and checks that found something, show up here.'),
  ]);
}
