// A server's disguise parameters as people read them: grouped by what they do,
// a plain line per group, and the lines a configuration carries. The header
// protection key stays out of the status (read-only logins can read it): it is
// said to be there, and each device's file has it. Pure: no DOM.

import { fmt, num } from '../../shared/i18n';

/** `.conf` names of the parameters, in file order. */
const CONF: [string, string][] = [
  ['jc', 'Jc'],
  ['jmin', 'Jmin'],
  ['jmax', 'Jmax'],
  ['s1', 'S1'],
  ['s2', 'S2'],
  ['s3', 'S3'],
  ['s4', 'S4'],
  ['h1', 'H1'],
  ['h2', 'H2'],
  ['h3', 'H3'],
  ['h4', 'H4'],
  ['i1', 'I1'],
  ['i2', 'I2'],
  ['i3', 'I3'],
  ['i4', 'I4'],
  ['i5', 'I5'],
  ['header_protection_key', 'HeaderProtectionKey'],
  ['content_padding_addition', 'ContentPaddingAddition'],
  ['rekey_after_time', 'RekeyAfterTime'],
  ['rekey_timeout', 'RekeyTimeout'],
  ['reject_after_time', 'RejectAfterTime'],
  ['keepalive_timeout', 'KeepaliveTimeout'],
  ['max_handshake_attempts', 'MaxHandshakeAttempts'],
  ['random_trailers', 'RandomTrailers'],
  ['disable_cookies', 'DisableCookies'],
];

export interface ParamGroup {
  title: string;
  text: string;
  /** Its parameters as [.conf name, value]; the key's value is a word. */
  items: [string, string][];
}

const present = (o: Record<string, string>, hpk: boolean) => (k: string) =>
  k === 'header_protection_key' ? hpk : o[k] != null && o[k] !== '';

/** How many parameters the server has. */
export const paramCount = (o: Record<string, string>, hpk: boolean): number => CONF.filter(([k]) => present(o, hpk)(k)).length;

/** The parameters by what they do; groups with none left out. */
export function paramGroups(o: Record<string, string>, hpk: boolean): ParamGroup[] {
  const has = present(o, hpk);
  const jc = Number(o.jc || 0);
  const group = (title: string, text: string, ks: string[]): ParamGroup => ({
    title,
    text,
    items: CONF.filter(([k]) => ks.includes(k) && has(k)).map(([k, n]) => [n, k === 'header_protection_key' ? _('set', 'key') : o[k]]),
  });
  return [
    group(
      _('Junk packets'),
      jc
        ? fmt(
            N_(jc, '%s random packet of %s–%s bytes before each handshake.', '%s random packets of %s–%s bytes before each handshake.'),
            num(jc),
            o.jmin,
            o.jmax,
          )
        : _('No junk packets.'),
      ['jc', 'jmin', 'jmax'],
    ),
    group(_('Padding'), _('Random bytes in front of handshake, cookie and data packets, so their sizes do not match WireGuard.'), [
      's1',
      's2',
      's3',
      's4',
    ]),
    group(_('Packet types'), _('The values that replace WireGuard’s recognisable message types.'), ['h1', 'h2', 'h3', 'h4']),
    group(
      _('Signatures'),
      (o.i1 ?? '').includes('0x8580') ? _('A first packet shaped like a DNS answer.') : _('Extra packets sent before the handshake.'),
      ['i1', 'i2', 'i3', 'i4', 'i5'],
    ),
    group(_('Protection'), _('AmneziaWG 3.1: encrypted headers, random tails and extra padding on data packets.'), [
      'header_protection_key',
      'content_padding_addition',
      'random_trailers',
      'disable_cookies',
    ]),
    group(_('Timing'), _('Handshake and key timers vary within these ranges instead of WireGuard’s fixed values.'), [
      'rekey_after_time',
      'rekey_timeout',
      'reject_after_time',
      'keepalive_timeout',
      'max_handshake_attempts',
    ]),
  ].filter((g) => g.items.length);
}

/** The parameters as configuration lines (the key left out: each device's file has it). */
export const paramsConf = (o: Record<string, string>): string =>
  CONF.filter(([k]) => k !== 'header_protection_key' && o[k] != null && o[k] !== '')
    .map(([k, n]) => `${n} = ${o[k]}`)
    .join('\n');
