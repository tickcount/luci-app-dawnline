// Settings → Defaults: devices per person, device hostnames, fallback DNS.

import { E } from '../../e';
import { button } from '../../ui/button';
import { input, isOn, sw } from '../../ui/controls';
import { firstBad, liveRow } from '../../ui/layout';
import { notify } from '../../ui/toast';
import { domainHelp, fallbackDnsHelp, limitHelp } from '../../netcheck';
import { section, type SettingsHost } from './common';

export function defaultsCard(host: SettingsHost): HTMLElement {
  const s = host.d.settings;
  const eff = host.d.effective as Record<string, any>;
  const limit = input(s.default_device_limit, { placeholder: '3', inputmode: 'numeric', class: 'cbi-input-text dl-w-port' });
  const hn = sw(eff.hostnames, 'Device hostnames');
  const domain = input(s.domain, { placeholder: 'lan', class: 'cbi-input-text dl-w-port' });
  const fallback = input(s.home_dns_fallback === 'none' ? '' : s.home_dns_fallback || eff.home_dns_fallback || '', {
    placeholder: 'None',
    inputmode: 'decimal',
    class: 'cbi-input-text dl-w-ip dl-mono',
  });
  const limitRow = liveRow('Devices per person', limit, () => {
    // Empty keeps the default (the router stores nothing then).
    if (!limit.value.trim()) return { text: 'The default, 3. Pre-filled when you add someone.', bad: false };
    const h = limitHelp(limit.value);
    return h.bad ? h : { text: 'Pre-filled when you add someone.', bad: false };
  });
  const domainRow = liveRow(
    'Device hostnames',
    domain,
    () => domainHelp(domain.value),
    E('div', { class: 'dl-hostport' }, [hn, E('span', { class: 'dl-faint dl-mono' }, 'phone.myata.'), domain]),
  );
  const fallbackRow = liveRow('Fallback DNS', fallback, () => {
    const h = fallbackDnsHelp(fallback.value);
    return h.bad ? h : { text: `For Home-only devices using home names: ${h.text}`, bad: false };
  });
  return section(
    'defaults',
    'New people',
    [limitRow, domainRow, fallbackRow],
    [
      E('span'),
      button(
        'Save',
        () => {
          const bad = firstBad([limitRow, domainRow, fallbackRow]);
          if (bad) {
            notify(bad, 'warning');
            return;
          }
          return host.save(
            {
              default_device_limit: limit.value,
              hostnames: isOn(hn) ? '1' : '0',
              domain: domain.value,
              home_dns_fallback: fallback.value,
            },
            'Saved',
            'defaults',
          );
        },
        'positive',
      ),
    ],
  );
}
