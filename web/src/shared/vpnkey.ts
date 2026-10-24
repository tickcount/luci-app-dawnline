// AmneziaVPN `vpn://` keys: "vpn://" + base64url (no padding) of Qt's
// qCompress(JSON) — a 4-byte big-endian length followed by a zlib stream.
// AmneziaVPN also accepts plain JSON, used when CompressionStream is missing.

import type { ClientConfig } from './types';

/**
 * What a parameter the server does not set reads as. S3 and S4 stay empty: the
 * app names a key "AmneziaWG (version 2)" when either is there (awgVersionOf in
 * amnezia-client), and every platform skips an empty one.
 */
const DEFAULTS: Record<string, string> = {
  jc: '0',
  jmin: '0',
  jmax: '0',
  s1: '0',
  s2: '0',
  s3: '',
  s4: '',
  h1: '1',
  h2: '2',
  h3: '3',
  h4: '4',
  i1: '',
  i2: '',
  i3: '',
  i4: '',
  i5: '',
};

/** AmneziaWG 3.1 settings, under the names AmneziaVPN uses; only those that are set. */
const AWG3: Record<string, string> = {
  header_protection_key: 'HeaderProtectionKey',
  content_padding_addition: 'ContentPaddingAddition',
  rekey_after_time: 'RekeyAfterTime',
  rekey_timeout: 'RekeyTimeout',
  reject_after_time: 'RejectAfterTime',
  keepalive_timeout: 'KeepaliveTimeout',
  max_handshake_attempts: 'MaxHandshakeAttempts',
  random_trailers: 'RandomTrailers',
  disable_cookies: 'DisableCookies',
};

function awg3(o: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, name] of Object.entries(AWG3)) if (o[k] != null && o[k] !== '') out[name] = String(o[k]);
  return out;
}

export function amneziaJson(cfg: ClientConfig, description: string): Record<string, unknown> {
  const a = cfg.amnezia;
  const o = a.obfuscation ?? {};
  const v = (k: string) => (o[k] != null && o[k] !== '' ? String(o[k]) : DEFAULTS[k]);
  const host = a.host.replace(/^\[(.*)\]$/, '$1');
  const last = {
    H1: v('h1'),
    H2: v('h2'),
    H3: v('h3'),
    H4: v('h4'),
    I1: v('i1'),
    I2: v('i2'),
    I3: v('i3'),
    I4: v('i4'),
    I5: v('i5'),
    Jc: v('jc'),
    Jmin: v('jmin'),
    Jmax: v('jmax'),
    S1: v('s1'),
    S2: v('s2'),
    S3: v('s3'),
    S4: v('s4'),
    ...awg3(o),
    allowed_ips: a.allowed_ips,
    client_ip: a.client_ip,
    client_priv_key: a.client_priv_key,
    client_pub_key: a.client_pub_key,
    config: cfg.conf.replace(/\r?\n/g, '\r\n'),
    hostName: host,
    mtu: a.mtu,
    persistent_keep_alive: a.persistent_keep_alive,
    port: Number(a.port),
    psk_key: a.psk_key,
    server_pub_key: a.server_pub_key,
  };
  const out: Record<string, unknown> = {
    containers: [
      {
        container: 'amnezia-awg',
        awg: {
          isThirdPartyConfig: true,
          last_config: JSON.stringify(last),
          port: String(a.port),
          protocol_version: o.header_protection_key ? '3.1' : '2',
          transport_proto: 'udp',
        },
      },
    ],
    defaultContainer: 'amnezia-awg',
    description,
    hostName: host,
  };
  // Without a dns2 the app adds its own (Cloudflare by default), which bypasses the home DNS: one server goes in as both.
  if (a.dns[0]) {
    out.dns1 = a.dns[0];
    out.dns2 = a.dns[1] || a.dns[0];
  }
  return out;
}

export function base64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function qCompress(data: Uint8Array): Promise<Uint8Array | null> {
  // LuCI's module loader shadows some globals; always go through globalThis.
  const g = globalThis as unknown as { CompressionStream?: typeof CompressionStream; Blob: typeof Blob; Response: typeof Response };
  if (typeof g.CompressionStream === 'undefined') return null;
  try {
    const stream = new g.Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new g.CompressionStream('deflate'));
    const zlib = new Uint8Array(await new g.Response(stream).arrayBuffer());
    const out = new Uint8Array(4 + zlib.length);
    new DataView(out.buffer).setUint32(0, data.length, false);
    out.set(zlib, 4);
    return out;
  } catch {
    return null;
  }
}

export async function vpnKey(cfg: ClientConfig, description: string, compress = true): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(amneziaJson(cfg, description)));
  const packed = compress ? await qCompress(json) : null;
  return `vpn://${base64Url(packed ?? json)}`;
}

/**
 * The key as AmneziaVPN's scanner reads it: the payload without "vpn://". Its
 * QR import decodes the scanned text as base64 as it is (only the paste and
 * file imports drop the prefix), and v, p and n are base64 too: with the
 * prefix the payload shifts and the import fails.
 */
export const vpnQrText = (key: string): string => key.replace(/^vpn:\/\//, '');

/** The .conf with a browser-held private key substituted in. */
export function withPrivateKey(cfg: ClientConfig, priv: string): ClientConfig {
  return {
    ...cfg,
    has_private_key: true,
    conf: cfg.conf.replace(/^PrivateKey = .*$/m, `PrivateKey = ${priv}`),
    amnezia: { ...cfg.amnezia, client_priv_key: priv },
  };
}
