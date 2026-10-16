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
