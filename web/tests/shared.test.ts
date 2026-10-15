import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { bytes, daysLeft, initials, quotaText, slugify } from '../src/shared/format';
import { amneziaJson, base64Url, fromBase64Url, vpnKey, withPrivateKey } from '../src/shared/vpnkey';
import type { ClientConfig } from '../src/shared/types';

const cfg: ClientConfig = {
  name: 'Phone',
  person: 'Myata',
  server: 'Home',
  filename: 'myata-phone.conf',
  conf: '[Interface]\nPrivateKey = AAA=\nAddress = 10.77.0.2/32\n\n[Peer]\nPublicKey = BBB=\n',
  has_private_key: true,
  amnezia: {
    host: 'vpn.example.com',
    port: 51830,
    mtu: '1380',
    dns: ['10.0.1.1'],
    allowed_ips: ['0.0.0.0/0', '::/0'],
    client_ip: '10.77.0.2',
    client_priv_key: 'AAA=',
    client_pub_key: 'CCC=',
    psk_key: 'DDD=',
    server_pub_key: 'BBB=',
    persistent_keep_alive: '25',
    obfuscation: { jc: '4', jmin: '70', jmax: '120', s1: '20', s2: '30', h1: '11', h2: '22', h3: '33', h4: '44' },
  },
};

describe('format', () => {
  it('formats bytes', () => {
    expect(bytes(0)).toBe('0 B');
    expect(bytes(1536)).toBe('1.5 KB');
    expect(bytes(5 * 1073741824)).toBe('5.0 GB');
  });
  it('makes initials and slugs', () => {
    expect(initials('myata')).toBe('MY');
    expect(initials('Anna Maria Lee')).toBe('AL');
    expect(slugify('Ünïcode  Name!')).toBe('unicode-name');
  });
  it('describes quotas', () => {
    expect(quotaText(1073741824, 0, 'month')).toBe('1.0 GB this month');
    expect(quotaText(1073741824, 50, 'month')).toBe('1.0 GB of 50 GB this month');
    expect(quotaText(0, 10, 'total')).toBe('0 B of 10 GB');
  });
  it('counts days left', () => {
    const now = new Date(2026, 9, 14, 12).getTime();
    expect(daysLeft('2026-10-14', now)).toBe(1);
    expect(daysLeft('2026-10-20', now)).toBe(7);
    expect(daysLeft('2026-10-01', now)).toBeLessThan(0);
    expect(daysLeft('', now)).toBeNull();
  });
});

describe('vpn:// keys', () => {
  it('round-trips base64url', () => {
    const b = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
    expect(Array.from(fromBase64Url(base64Url(b)))).toEqual(Array.from(b));
  });

  it('builds the AmneziaVPN structure', () => {
    const j = amneziaJson(cfg, 'Home · Myata · Phone') as any;
    expect(j.defaultContainer).toBe('amnezia-awg');
    expect(j.dns1).toBe('10.0.1.1');
    const last = JSON.parse(j.containers[0].awg.last_config);
    expect(last.Jc).toBe('4');
    expect(last.S3).toBe('0');
    expect(last.H1).toBe('11');
    expect(last.port).toBe(51830);
    expect(last.config).toContain('\r\n');
  });

  it('produces a qCompress payload AmneziaVPN can read', async () => {
    const key = await vpnKey(cfg, 'x');
    expect(key.startsWith('vpn://')).toBe(true);
    const raw = fromBase64Url(key.slice(6));
    const len = new DataView(raw.buffer).getUint32(0, false);
    const json = inflateSync(Buffer.from(raw.slice(4))).toString('utf8');
    expect(json.length).toBe(len);
    expect(JSON.parse(json).hostName).toBe('vpn.example.com');
  });

  it('substitutes a browser-held private key', () => {
    const c = withPrivateKey(
      { ...cfg, has_private_key: false, conf: cfg.conf.replace('AAA=', '<private key stays on your device>') },
      'ZZZ=',
    );
    expect(c.conf).toContain('PrivateKey = ZZZ=');
    expect(c.amnezia.client_priv_key).toBe('ZZZ=');
  });
});
