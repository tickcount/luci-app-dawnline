// Settings → Map & locations.

import { E } from '../../e';
import { button } from '../../ui/button';
import { isOn, sw } from '../../ui/controls';
import { row } from '../../ui/layout';
import { section, type SettingsHost } from './common';

export function mapCard(host: SettingsHost): HTMLElement {
  const eff = host.d.effective as Record<string, any>;
  const gOn = sw(eff.geo_enabled, 'Locations');
  const prov = E('select', { class: 'cbi-input-select' }, [
    E('option', { value: 'ipwho.is', selected: eff.geo_provider !== 'ipapi.co' ? 'selected' : null }, 'ipwho.is (fallback: ipapi.co)'),
    E('option', { value: 'ipapi.co', selected: eff.geo_provider === 'ipapi.co' ? 'selected' : null }, 'ipapi.co (fallback: ipwho.is)'),
  ]) as HTMLSelectElement;
  return section(
    'map',
    'Map & locations',
    [
      E('div', { class: 'dl-setrow head' }, [
        E('span', { class: 'dl-muted' }, 'Show where people connect from on the Overview and person pages, at city level.'),
        gOn,
      ]),
      row('Provider', prov),
    ],
    [
      E(
        'span',
        { class: 'dl-sub' },
        'The router sends each new client IP to the provider once and caches the city. Map tiles load in your browser from CARTO; people never see the map.',
      ),
      button('Save', () => host.save({ geo_enabled: isOn(gOn) ? '1' : '0', geo_provider: prov.value }, 'Saved', 'map'), 'positive'),
    ],
  );
}
