// Settings → Map & locations.

import { E } from '../../e';
import { button } from '../../ui/button';
import { isOn, sw } from '../../ui/controls';
import { row } from '../../ui/layout';
import { fmt } from '../../../shared/i18n';
import { section, type SettingsHost } from './common';

export function mapCard(host: SettingsHost): HTMLElement {
  const eff = host.d.effective as Record<string, any>;
  const gOn = sw(eff.geo_enabled, _('Locations'));
  const prov = E('select', { class: 'cbi-input-select' }, [
    E(
      'option',
      { value: 'ipwho.is', selected: eff.geo_provider !== 'ipapi.co' ? 'selected' : null },
      fmt(_('%s (fallback: %s)'), 'ipwho.is', 'ipapi.co'),
    ),
    E(
      'option',
      { value: 'ipapi.co', selected: eff.geo_provider === 'ipapi.co' ? 'selected' : null },
      fmt(_('%s (fallback: %s)'), 'ipapi.co', 'ipwho.is'),
    ),
  ]) as HTMLSelectElement;
  return section(
    'map',
    _('Map & locations'),
    [
      E('div', { class: 'dl-setrow head' }, [
        E('span', { class: 'dl-muted' }, _('Show where people connect from on the Overview and person pages, at city level.')),
        gOn,
      ]),
      row(_('Provider'), prov),
    ],
    [
      E(
        'span',
        { class: 'dl-sub' },
        _(
          'The router sends each new client IP to the provider once and caches the city. Map tiles load in your browser from CARTO; people never see the map.',
        ),
      ),
      button(_('Save'), () => host.save({ geo_enabled: isOn(gOn) ? '1' : '0', geo_provider: prov.value }, _('Saved'), 'map'), 'positive'),
    ],
  );
}
