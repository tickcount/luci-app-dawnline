import { describe, expect, it } from 'vitest';

import { homeOf, netsLabel } from '../src/shared/format';
import type { Person, Server } from '../src/shared/types';

describe('home networks a LAN Bypass device still sends home', () => {
  it('reads a /24 as its first three numbers', () => {
    expect(netsLabel(['10.0.1.0/24'])).toBe('10.0.1.x');
    expect(netsLabel(['192.168.1.0/24', '10.8.0.0/16'])).toBe('192.168.1.x, 10.8.0.0/16');
    expect(netsLabel([])).toBe('');
  });

  it('takes the server home networks a person with home and internet access reaches', () => {
    const srv = {
      home: [
        { dev: 'br-lan', nets: ['10.0.1.0/24'] },
        { dev: 'br-iot', nets: ['10.0.9.0/24'] },
      ],
    } as Server;
    const p = (o: Partial<Person>) => ({ access: 'both', ...o }) as Person;
    expect(homeOf(p({}), srv)).toEqual(['10.0.1.0/24', '10.0.9.0/24']);
    expect(homeOf(p({ home_nets: ['br-iot'] }), srv)).toEqual(['10.0.9.0/24']);
    expect(homeOf(p({ access: 'internet' }), srv)).toEqual([]);
    expect(homeOf(p({ access: 'lan' }), srv)).toEqual([]);
    expect(homeOf(p({}), undefined)).toEqual([]);
  });
});
