// Settings › New people: what a person added from now on starts with, shown
// on a sample of one: their device limit as that many slots with its stepper
// beside them (pre-filled in Add a person) and the name their device has at
// home. Under the sample what every device gets: its hostname at home
// (name.person.<domain>), the domain, and the DNS that takes over for
// Home-only devices that use home names while the tunnel is down. Changing
// that DNS rewrites those devices' configurations: ⟳N, asked first.

import { h } from '../../../../portal/dom';
import { closeSheet, openSheet } from '../../../../portal/ui/sheet';
import { fill, fmt } from '../../../../shared/i18n';
import { switchRow, textRow } from '../../../ui/edit-rows';
import { face } from '../../../ui/face';
import { glass } from '../../../ui/glass';
import { card, section } from '../../../ui/section';
import { stepper } from '../../../ui/stepper';
import { errorText, notify } from '../../../ui/toast';
import { domainHelp, fallbackDnsHelp } from '../../../netcheck';
import { askView } from '../../../flows/ask';
import { fallbackRefetch } from '../../../system/model';
import type { RouterCtx } from './ctx';
import { put } from './save';
import { refill } from '../../../ui/reshape';

/** Slots drawn before the rest is a number. */
const SLOTS = 8;
/** The kinds the first slots show: a phone, a computer, then tablets. */
const KINDS = ['phone', 'computer', 'tablet'];

/** The fallback DNS as its row shows it: none, the stored one, or the default. */
function fallbackOf(y: RouterCtx): string {
  const raw = y.set.settings.home_dns_fallback ?? '';
  if (raw === 'none') return '';
  return raw || String((y.set.effective as { home_dns_fallback?: string }).home_dns_fallback ?? '');
}

/** The sample person: a face, what their device is called at home, the limit's stepper and its slots. */
function sample(y: RouterCtx, limit: number, domain: string, hostnames: boolean): HTMLElement {
  const slots = h('div', { class: 'st-np-slots', 'aria-hidden': 'true' });
  // a slot that comes blurs in, one that goes fades where it stood (ui/reshape.ts)
  const draw = (n: number) =>
    refill(slots, [
      ...Array.from({ length: Math.min(n, SLOTS) }, (_x, i) =>
        h('span', { class: 'st-np-slot' }, glass(KINDS[Math.min(i, KINDS.length - 1)], 'grey')),
      ),
      ...(n > SLOTS ? [h('span', { class: 'st-np-more num' }, `+${n - SLOTS}`)] : []),
    ]);
  draw(limit);
  const host = h('span', { class: 'namechip st-np-host' }, h('span', {}, 'phone.myata'), h('span', { class: 'faint' }, `.${domain}`));
  return h(
    'div',
    { class: 'st-np' },
    face(_('New person')),
    h(
      'div',
      { class: 'st-np-t' },
      h('b', {}, _('New person')),
      h('span', {}, hostnames ? fill(_('at home their device is seen as %s'), host) : _('device names in the home network are off')),
    ),
    h(
      'div',
      { class: 'st-np-lim' },
      h('span', { class: 'st-np-ll' }, _('Devices per person')),
      stepper(
        {
          value: limit,
          label: _('Devices per person'),
          min: 1,
          max: 32,
          // the slots follow the press, and go back if the router refuses
          change: async (n) => {
            draw(n);
            const ok = await put(y, { default_device_limit: String(n) });
            if (!ok) draw(limit);
            return ok;
          },
        },
        y.write,
      ),
    ),
    slots,
  );
}

/** The fallback DNS, asked first when devices fetch their configuration again after it. */
function fallbackRow(y: RouterCtx): HTMLElement {
  const fb = fallbackOf(y);
  const re = fallbackRefetch(y.st);
  return textRow(
    {
      label: _('Fallback DNS'),
      value: fb || _('None'),
      start: fb,
      mono: !!fb,
      numeric: true,
      plain: true,
      re,
      mode: { empty: _('None'), placeholder: _('none'), says: _('An IPv4 address; empty: none'), on: !fb },
      hint: fb ? _('Home-only devices that use home names ask it while the tunnel is down.') : fallbackDnsHelp('').text,
      refuse: (v) => (fallbackDnsHelp(v).bad ? fallbackDnsHelp(v).text : null),
      ask: (v) => {
        const run = async () => {
          await y.save({ home_dns_fallback: v });
        };
        if (!re) return void run().catch((e) => notify(errorText(e), 'error', 10000));
        openSheet(() =>
          askView({
            icon: 'refresh',
            tone: 'orange',
            title: fmt(_('Fallback DNS: %s?'), v || _('none')),
            text: [
              fmt(
                N_(
                  re,
                  '%s device keeps asking the old DNS until it fetches its configuration again. Its connection is not interrupted.',
                  '%s devices keep asking the old DNS until they fetch their configuration again. Their connection is not interrupted.',
                ),
                re,
              ),
            ],
            action: _('Change'),
            cls: 'warn',
            run: async () => {
              await run();
              closeSheet();
            },
          }),
        );
      },
    },
    y.write,
  );
}

export function defaultsSection(y: RouterCtx): HTMLElement {
  const s = y.set.settings;
  const hostnames = !!(y.set.effective as { hostnames?: boolean }).hostnames;
  const limit = Number(s.default_device_limit) || 3;
  const domain = s.domain || 'lan';
  return section(
    {
      id: 'defaults',
      icon: 'newperson',
      title: _('New people'),
      aside: h('span', { class: 'kt-sx-st' }, h('span', {}, _('Pre-filled when you add someone.'))),
    },
    card(
      sample(y, limit, domain, hostnames),
      switchRow(
        {
          title: _('Device hostnames'),
          sub: fmt(_('Seen at home as %s'), `phone.myata.${domain}`),
          on: hostnames,
          icon: 'lan',
          flip: (on) => put(y, { hostnames: on ? '1' : '0' }),
        },
        y.write,
      ),
      textRow(
        {
          label: _('Domain'),
          value: domain,
          start: s.domain ?? '',
          mono: true,
          plain: true,
          mode: { empty: 'lan', placeholder: 'lan', says: _('Lowercase letters, digits, dashes and dots; empty: lan'), on: !s.domain },
          refuse: (v) => (domainHelp(v).bad ? domainHelp(v).text : null),
          save: async (v) => {
            await y.save({ domain: v });
            return v || 'lan';
          },
        },
        y.write,
      ),
      fallbackRow(y),
    ),
  );
}
