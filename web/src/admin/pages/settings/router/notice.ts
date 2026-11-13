// A new version of Dawnline, as the notice at the top of Settings' Updates
// section: its version, the first point of its notes, when it installs on
// its own, What's new and Update now. The update itself runs in the sheet,
// as every updater job does (flows/operation.ts); while one is under way the
// notice steps aside and Dawnline's row says so, with the way into its sheet
// (updates-rows.ts). The page owns the one instance (its slot is handed to
// updates.ts) and calls `sync` on every answer.

import { api, type UpdatesStatus } from '../../../api';
import { h } from '../../../../portal/dom';
import { refill } from '../../../ui/reshape';
import { fmt } from '../../../../shared/i18n';
import { glass } from '../../../ui/glass';
import { autoInstalls } from '../../../updater/policy';
import { whatsNew } from '../../../flows/whats-new';
import { shortPoint } from '../../../system/model';

export class UpdateNotice {
  /** The notice's slot: it holds the notice's margin and clips it while its height glides. */
  readonly el = h('div', { class: 'notice-slot st-upd-notice' });
  /** The first point of each version's notes (fetched once; null while it comes, '' when there is none). */
  private points = new Map<string, string | null>();
  /** What the notice was last drawn from (drawn again when a version's notes arrive). */
  private last: [UpdatesStatus, boolean] | null = null;

  /** `update`: start Dawnline's update in its sheet. */
  constructor(private update: () => void) {}

  /** The notice for what the router says now: a new version waiting, or nothing (none while a job runs). */
  sync(u: UpdatesStatus, canStart: boolean) {
    this.last = [u, canStart];
    const a = u.check?.components?.app;
    if (!a?.update || !a.latest || u.job?.state === 'running') return this.show(null);
    const tag = a.tag || a.latest;
    const latest = a.latest;
    const point = this.point(tag);
    const p = u.policy;
    const when = autoInstalls(p, 'app')
      ? p.mode === 'scheduled'
        ? fmt(_('It installs on its own at %s.'), p.time)
        : _('It installs on its own soon.')
      : '';
    this.show(
      this.notice(
        fmt(_('Dawnline %s is out'), latest),
        [point && !/[.!?…]$/.test(point) ? `${point}.` : point, when].filter(Boolean).join(' '),
        [
          this.btn('soft', _('What’s new'), () => whatsNew('app', tag, fmt(_('What’s new in Dawnline %s'), latest))),
          canStart ? this.btn('accent', _('Update now'), () => this.update()) : null,
        ],
      ),
    );
  }

  private btn(cls: string, label: string, run: () => void): HTMLElement {
    return h('button', { type: 'button', class: `btn ${cls} sm`, onclick: run }, h('span', {}, label));
  }

  /** The first point of `tag`'s notes, fetched once; the notice is drawn again when it comes. */
  private point(tag: string): string {
    if (this.points.has(tag)) return this.points.get(tag) ?? '';
    this.points.set(tag, null);
    void api
      .updatesNotes('app', tag, '')
      .then((r) => {
        const first = (r.body ?? '')
          .split('\n')
          .map((l) => /^\s*[-*+]\s+(.*)$/.exec(l)?.[1])
          .find((x): x is string => !!x);
        this.points.set(tag, first ? shortPoint(first) : '');
        if (first && this.last) this.sync(...this.last);
      })
      .catch(() => this.points.set(tag, ''));
    return '';
  }

  private notice(title: string, line: string, acts: (Node | null)[]): HTMLElement {
    return h(
      'div',
      { class: 'notice upd has-act', role: 'status' },
      glass('update', 'blue'),
      h('div', { class: 't' }, h('b', {}, title), line ? h('span', {}, line) : null),
      h('div', { class: 'n-acts' }, ...acts),
    );
  }

  /**
   * Put `n` in the slot (null: none): one that comes blurs in, one that goes fades where it stood, one that changes
   * changes in place, and the slot glides to its new height (ui/reshape.ts).
   */
  private show(n: HTMLElement | null) {
    const was = this.el.firstElementChild as HTMLElement | null;
    if (!n && !was) return;
    if (n && was && n.className === was.className && n.textContent === was.textContent) return;
    refill(this.el, n ? [n] : []);
  }
}
