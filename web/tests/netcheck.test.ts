import { describe, expect, it } from 'vitest';
import { parseCidr, portalPortHelp, portHelp, rangeHelp, rangeOf, subnetOf } from '../src/admin/netcheck';

const nets = [
  { name: 'lan', cidr: '10.0.1.0/24' },
  { name: 'loopback', cidr: '127.0.0.0/8' },
  { name: 'wan', cidr: '109.173.124.0/23' },
  { name: 'guest', cidr: '192.168.0.0/16' },
];

describe('netcheck', () => {
  it('parses subnets like the router', () => {
    expect(parseCidr('10.10.10.5/24')).toEqual({ net: 0x0a0a0a00, size: 256 });
    expect(parseCidr('10.10.10.0/31')).toBeNull();
    expect(parseCidr('10.10.300.0/24')).toBeNull();
    expect(parseCidr('10.10.10.0')).toBeNull();
  });

  it('converts between a range and its subnet', () => {
    expect(rangeOf('10.77.0.0/24')).toBe('10.77.0');
    expect(subnetOf(' 10.77.0 ')).toBe('10.77.0.0/24');
  });

  it('explains the device addresses', () => {
    expect(rangeHelp('10.10.10', nets, '10.77.0')).toEqual({
      text: 'Devices get 10.10.10.2 – 10.10.10.254, the router 10.10.10.1.',
      bad: false,
    });
    expect(rangeHelp('10.0.1', nets, '10.77.0')).toEqual({ text: 'lan already uses 10.0.1.x. Try 10.77.0.', bad: true });
    expect(rangeHelp('192.168.5', nets, '10.77.0').text).toBe('guest already uses 192.168.0.0/16. Try 10.77.0.');
    expect(rangeHelp('10.77.0', [{ name: 'Home', cidr: '10.77.0.0/24' }], '10.77.0').text).toBe('Home already uses 10.77.0.x.');
  });

  it('wants a private range of three numbers', () => {
    expect(rangeHelp('8.8.8', nets, '').text).toBe('Use a private range: 10.x.x, 172.16–31.x or 192.168.x.');
    expect(rangeHelp('172.32.0', nets, '').bad).toBe(true);
    expect(rangeHelp('172.31.0', nets, '').bad).toBe(false);
    expect(rangeHelp('10.10', nets, '').text).toBe('Three numbers, like 10.77.0.');
    expect(rangeHelp('10.10.10.0', nets, '').bad).toBe(true);
    expect(rangeHelp('10.10.256', nets, '').bad).toBe(true);
  });

  it('says who holds a port', () => {
    const taken = [
      { from: 53, to: 53, who: 'dnsmasq on this router' },
      { from: 4000, to: 4100, who: 'port forward “Game”' },
    ];
    expect(portHelp(4500, taken, 'Free.')).toEqual({ text: 'Free.', bad: false });
    expect(portHelp(53, taken, '').text).toBe('Used by dnsmasq on this router. Choose another port.');
    expect(portHelp(4050, taken, '').text).toBe('Used by port forward “Game”. Choose another port.');
    expect(portHelp(0, taken, '').text).toBe('Use a port from 1 to 65535.');
    expect(portHelp(Number.NaN, taken, '').bad).toBe(true);
  });

  it('checks the portal port and the next one for IP links', () => {
    const taken = [{ from: 8444, to: 8444, who: 'nginx on this router' }];
    expect(portalPortHelp(8443, taken, false)).toEqual({ text: 'HTTPS on this port, opened on WAN.', bad: false });
    expect(portalPortHelp(8443, taken, true).text).toBe(
      'Links on IP addresses also need 8444, used by nginx on this router. Choose another port.',
    );
    expect(portalPortHelp(9443, taken, true)).toEqual({ text: 'HTTPS here, plain HTTP for links on IP addresses on 9444.', bad: false });
    expect(portalPortHelp(8444, taken, false).bad).toBe(true);
  });
});

import {
  chars,
  circleNameHelp,
  dnsHelp,
  domainHelp,
  expiresHelp,
  fallbackDnsHelp,
  hostHelp,
  ipv4Help,
  keepaliveHelp,
  limitHelp,
  mtuHelp,
  nameHelp,
  portsHelp,
  quotaHelp,
  timeHelp,
  titleHelp,
  urlHelp,
} from '../src/admin/netcheck';
import { date, daysLeft } from '../src/shared/format';

describe('field helps', () => {
  it('counts characters like the router', () => {
    expect(chars('Мама')).toBe(4);
    expect(nameHelp('ЙЦУКЕНГШЩЗХЪФЫВАПРОЛДЖЭЯЧ').bad).toBe(false);
    expect(nameHelp('a'.repeat(49)).bad).toBe(true);
    expect(nameHelp('Bob "B"').bad).toBe(true);
    expect(nameHelp('  ').bad).toBe(true);
    expect(nameHelp('Phone', ['phone']).text).toContain('already exists');
    expect(circleNameHelp('x'.repeat(33)).bad).toBe(true);
  });
  it('explains the public address', () => {
    expect(hostHelp('https://vpn.example.com').text).toContain('Leave out https://');
    expect(hostHelp('vpn.example.com:4500').text).toContain('without a port');
    expect(hostHelp('vpn.example.com', 4500)).toEqual({ text: 'Devices connect to vpn.example.com:4500.', bad: false });
    expect(hostHelp('2001:db8::1', 4500).text).toBe('Devices connect to [2001:db8::1]:4500.');
    expect(hostHelp('', 4500).bad).toBe(true);
    expect(hostHelp('', 4500, 'Empty = the portal address.').bad).toBe(false);
    expect(hostHelp('bad_host!').bad).toBe(true);
  });
  it('checks DNS, MTU, keep-alive', () => {
    expect(dnsHelp('', '10.77.0.1').bad).toBe(false);
    expect(dnsHelp('1.1.1.1, foo', '10.77.0.1').text).toContain('“foo” is not an IP address');
    expect(dnsHelp('1.1.1.1 8.8.8.8', '10.77.0.1').text).toContain('1.1.1.1 and 8.8.8.8');
    expect(mtuHelp('', { computer: 1368, phone: 1280 }).text).toContain('1368');
    expect(mtuHelp('1200', { computer: 1368, phone: 1280 }).bad).toBe(true);
    expect(mtuHelp('1400', { computer: 1368, phone: 1280 }).text).toContain('phones and tablets 1280');
    expect(keepaliveHelp('601').bad).toBe(true);
    expect(keepaliveHelp('0').bad).toBe(false);
  });
  it('checks limits, quota and dates', () => {
    expect(limitHelp('0').bad).toBe(true);
    expect(limitHelp('33').bad).toBe(true);
    expect(limitHelp('2', 4).text).toContain('Already has 4');
    expect(quotaHelp('').bad).toBe(false);
    expect(quotaHelp('100001').bad).toBe(true);
    expect(quotaHelp('50').text).toContain('Paused after 50 GB');
    expect(expiresHelp('2026-10-13', '2026-10-14', daysLeft, date).bad).toBe(true);
    expect(expiresHelp('2026-10-14', '2026-10-14', daysLeft, date).text).toContain('ends today');
    expect(expiresHelp('2026-10-20', '2026-10-14', daysLeft, date).text).toContain('ends in 7 days');
  });
  it('checks services, portal and settings fields', () => {
    expect(ipv4Help('10.0.1.300').bad).toBe(true);
    expect(ipv4Help('10.0.1.5', () => false).text).toContain('not in any home network');
    expect(portsHelp('445, 5000').text).toBe('Ports 445, 5000.');
    expect(portsHelp('70000').bad).toBe(true);
    expect(urlHelp('vpn.example.com').bad).toBe(true);
    expect(urlHelp('https://example.com/x').bad).toBe(false);
    expect(titleHelp('x'.repeat(65)).bad).toBe(true);
    expect(domainHelp('').bad).toBe(false);
    expect(domainHelp('').text).toContain('phone.myata.lan');
    expect(domainHelp('Home.LAN').text).toBe('Lowercase only.');
    expect(domainHelp('home.lan').text).toContain('phone.myata.home.lan');
    expect(fallbackDnsHelp('abc').bad).toBe(true);
    expect(timeHelp('4:00').bad).toBe(false);
    expect(timeHelp('24:00').bad).toBe(true);
  });
});
