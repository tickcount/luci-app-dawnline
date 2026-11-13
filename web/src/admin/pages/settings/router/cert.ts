// The portal's certificate as a term: how many days it has left, said large
// in the state's tone, beside what it is and until when, a 6 px bar of what
// is left of the term (the measure's bar, ui/measure.ts), its file in mono,
// and its actions at the block's end. Read-only as a picture: what changes
// the certificate is in its buttons. Only the portal's section draws one
// (people's terms are widgets/term.ts, with their calendar).

import { h, type Kid } from '../../../../portal/dom';
import { num } from '../../../../shared/i18n';
import { certPart } from '../../../system/model';

interface CertTerm {
  /** Days left; null: no end to count to (self-signed, no certificate). */
  days: number | null;
  /** What it is: Let's Encrypt, your files, self-signed. */
  title: string;
  /** Until when, or why there is nothing to count. */
  line: Kid;
  /** Its file on the router. */
  file?: string;
  /** It ends soon, or browsers warn about it. */
  warn?: boolean;
  /** In the number's place when there is none. */
  none: string;
  act?: Kid;
}

export function certTerm(o: CertTerm): HTMLElement {
  const part = certPart(o.days);
  const left = o.days == null ? null : Math.max(0, o.days);
  const fill = h('i', {});
  if (part != null) fill.style.width = `${part * 100}%`;
  return h(
    'div',
    { class: `st-cert${o.warn ? ' warn' : ''}` },
    h(
      'div',
      { class: 'st-cert-n' },
      left == null
        ? h('b', { class: 'st-cert-none', 'aria-hidden': 'true' }, o.none)
        : [h('b', { class: 'num' }, num(left)), h('span', {}, N_(left, 'day', 'days'))],
    ),
    h(
      'div',
      { class: 'st-cert-b' },
      h('b', {}, o.title),
      h('span', { class: 'st-cert-l' }, o.line),
      part == null ? null : h('div', { class: `kt-lm-bar st-cert-bar${o.warn ? ' warn' : ''}`, 'aria-hidden': 'true' }, fill),
      o.file ? h('span', { class: 'st-cert-f', title: o.file }, o.file) : null,
    ),
    o.act ? h('div', { class: 'st-cert-a' }, o.act) : null,
  );
}
