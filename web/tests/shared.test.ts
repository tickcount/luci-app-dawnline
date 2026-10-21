import { describe, expect, it } from 'vitest';
import { inflateSync } from 'node:zlib';
import { byDeviceState, bytes, daysLeft, initials, quotaText, slugify } from '../src/shared/format';
import { amneziaJson, base64Url, fromBase64Url, vpnKey, vpnQrText, withPrivateKey } from '../src/shared/vpnkey';
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
    expect(last.H1).toBe('11');
    expect(last.port).toBe(51830);
    expect(last.config).toContain('\r\n');
  });

  it('leaves S3 and S4 empty when the server sets none, so the app does not call the key version 2', () => {
    const last = (c: ClientConfig) => JSON.parse((amneziaJson(c, 'x') as any).containers[0].awg.last_config);
    expect(last(cfg).S3).toBe('');
    expect(last(cfg).S4).toBe('');
    expect(last(cfg).S1).toBe('20');
    const off = {
      ...cfg,
      amnezia: { ...cfg.amnezia, obfuscation: { jc: '0', jmin: '0', jmax: '0', s1: '0', s2: '0', h1: '1', h2: '2', h3: '3', h4: '4' } },
    };
    expect(last(off).S3).toBe('');
    expect(last(off).Jc).toBe('0');
    expect(last(off).I1).toBe('');
    const bal = { ...cfg, amnezia: { ...cfg.amnezia, obfuscation: { ...cfg.amnezia.obfuscation, s3: '24', s4: '8' } } };
    expect(last(bal).S3).toBe('24');
    expect(last(bal).S4).toBe('8');
  });

  it('gives the one DNS server as both, so the app adds none of its own', () => {
    const json = (dns: string[]) => amneziaJson({ ...cfg, amnezia: { ...cfg.amnezia, dns } }, 'x') as any;
    expect(json(['10.0.1.1'])).toMatchObject({ dns1: '10.0.1.1', dns2: '10.0.1.1' });
    expect(json(['10.0.1.1', '1.1.1.1'])).toMatchObject({ dns1: '10.0.1.1', dns2: '1.1.1.1' });
    // Home network only, without the home DNS: nothing to give.
    expect(json([]).dns1).toBeUndefined();
    expect(json([]).dns2).toBeUndefined();
  });

  it('passes the keep-alive through as the router sends it: a range on 3.1, a number before', () => {
    const awg = (persistent_keep_alive: string, obfuscation: Record<string, string>) =>
      (amneziaJson({ ...cfg, amnezia: { ...cfg.amnezia, persistent_keep_alive, obfuscation } }, 'x') as any).containers[0].awg;
    const max = awg('25-35', { ...cfg.amnezia.obfuscation, header_protection_key: 'HPK=' });
    expect(JSON.parse(max.last_config).persistent_keep_alive).toBe('25-35');
    expect(JSON.parse(max.last_config).HeaderProtectionKey).toBe('HPK=');
    expect(max.protocol_version).toBe('3.1');
    const bal = awg('25', cfg.amnezia.obfuscation);
    expect(JSON.parse(bal.last_config).persistent_keep_alive).toBe('25');
    expect(bal.protocol_version).toBe('2');
    expect(JSON.parse(awg('0', {}).last_config).persistent_keep_alive).toBe('0');
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

  it('puts the bare payload in the QR code: AmneziaVPN’s scanner does not drop vpn://', async () => {
    const key = await vpnKey(cfg, 'x');
    const qr = vpnQrText(key);
    expect(qr).toBe(key.slice(6));
    expect(qr).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(vpnQrText(qr)).toBe(qr);
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

describe('byDeviceState', () => {
  it('puts online first, then offline, not set up and turned off, keeping the order within each', () => {
    const d = (name: string, online: boolean, handshake: number, disabled = false) => ({ name, online, handshake, disabled });
    const list = [d('off', false, 5, true), d('new', false, 0), d('away1', false, 9), d('live', true, 10), d('away2', false, 3)];
    expect(byDeviceState(list).map((x) => x.name)).toEqual(['live', 'away1', 'away2', 'new', 'off']);
  });
});
