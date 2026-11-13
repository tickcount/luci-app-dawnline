import { describe, expect, it } from 'vitest';
import { plainOrg, plainWhere } from '../src/shared/org';

describe('plainOrg', () => {
  it('leaves the legal form out, before or after the name', () => {
    expect(plainOrg('PJSC Rostelecom')).toBe('Rostelecom');
    expect(plainOrg('ПАО Ростелеком')).toBe('Ростелеком');
    expect(plainOrg('Example Networks LLC')).toBe('Example Networks');
    expect(plainOrg('Hetzner Online GmbH')).toBe('Hetzner Online');
  });

  it('drops the quotes around what is left', () => {
    expect(plainOrg('ООО «Ромашка»')).toBe('Ромашка');
  });

  it('keeps a name that is nothing but a legal form, and plain names', () => {
    expect(plainOrg('LLC')).toBe('LLC');
    expect(plainOrg('MegaFon')).toBe('MegaFon');
  });
});

describe('plainWhere', () => {
  it('plains the operator after the city only', () => {
    expect(plainWhere('Krasnodar · PJSC Rostelecom')).toBe('Krasnodar · Rostelecom');
    expect(plainWhere('Moscow')).toBe('Moscow');
  });
});
