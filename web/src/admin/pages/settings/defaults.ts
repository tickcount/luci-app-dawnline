// Settings → Defaults: devices per person, device hostnames, fallback DNS.

import { E } from '../../e';
import { button } from '../../ui/button';
import { input, isOn, sw } from '../../ui/controls';
import { row } from '../../ui/layout';
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
  return section(
    'defaults',
    'Defaults',
    [
      row('Devices per person', limit, 'Pre-filled when you add someone.'),
      row(
        'Device hostnames',
        E('div', { class: 'dl-hostport' }, [hn, E('span', { class: 'dl-faint dl-mono' }, 'phone.myata.'), domain]),
        'Name devices in your home DNS.',
      ),
      row(
        'Fallback DNS',
        fallback,
        'For Home-only devices using home names: the second DNS server, used by the device when the tunnel is down. Empty = none.',
      ),
    ],
    [
      E('span'),
      button(
        'Save',
        () =>
          host.save(
            {
              default_device_limit: limit.value,
              hostnames: isOn(hn) ? '1' : '0',
              domain: domain.value,
              home_dns_fallback: fallback.value,
            },
            'Saved',
            'defaults',
          ),
        'positive',
      ),
    ],
  );
}
