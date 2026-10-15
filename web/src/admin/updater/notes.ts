// "What's new" for a release: Dawnline by tag, or the AmneziaWG build's release.

import { E } from '../e';
import { api } from '../api';
import { icon } from '../../shared/icons';
import { fmtDay } from '../../shared/format';
import { button } from '../ui/button';
import { cancelButton, modal } from '../ui/modal';
import { copyText } from '../ui/files';
import { errorText } from '../ui/toast';
import { forRouter, markdown, safeHref } from './markdown';

export async function whatsNew(component: 'app' | 'amneziawg', tag: string, title: string, build?: string) {
  const body = E('div', { class: 'dl-notes' }, E('p', { class: 'dl-muted dl-loading' }, 'Loading release notes…'));
  const meta = E('div', { class: 'dl-op-head' });
  let text = '';
  modal(
    title,
    [meta, body],
    [button([icon('copy'), ' Copy'], () => copyText(text, 'Release notes copied')), ' ', cancelButton('Close')],
    'wide',
  );
  try {
    const r = await api.updatesNotes(component, tag, build ?? '');
    text = forRouter(r.body || '');
    const href = safeHref(r.url);
    dom.content(meta, [
      r.published ? E('span', { class: 'dl-pill' }, fmtDay(r.published)) : '',
      r.prerelease ? E('span', { class: 'dl-pill warn' }, 'Pre-release') : '',
      E('span', { class: 'dl-spacer' }),
      href ? E('a', { href, target: '_blank', rel: 'noopener', class: 'dl-linkbtn' }, ['On GitHub ', icon('open')]) : '',
    ]);
    dom.content(body, text.trim() ? markdown(text) : E('p', { class: 'dl-muted' }, 'This release has no notes.'));
  } catch (e) {
    dom.content(body, E('p', { class: 'dl-muted' }, errorText(e)));
  }
}
