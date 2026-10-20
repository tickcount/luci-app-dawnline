import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { catalogOf, parsePo, pluralForms, writePo, type Po } from '../i18n/po';
import { badTranslation, badText } from '../i18n/extract';
import { lmo, sfh } from '../i18n/lmo';
import { fill, fmt, lang, num, plural } from '../src/shared/i18n';

describe('po files', () => {
  const po: Po = {
    header: [
      ['Language', 'ru'],
      ['Plural-Forms', 'nplurals=3; plural=(n != 1);'],
    ],
    entries: [
      { id: 'Say "hi" \\ there', str: ['Скажи «привет»'], refs: ['web/src/a.ts', 'web/src/b.ts'] },
      { ctx: 'state', id: 'Off', str: ['Выкл.'], refs: [] },
      { id: '%s day', plural: '%s days', str: ['%s день', '%s дня', '%s дней'], refs: ['web/src/c.ts'] },
      { id: 'Untranslated', str: [''], refs: [] },
    ],
  };

  it('reads back what it writes', () => {
    const text = writePo(po);
    expect(text).toContain('msgid "Say \\"hi\\" \\\\ there"');
    expect(text).toContain('"Plural-Forms: nplurals=3; plural=(n != 1);\\n"');
    expect(parsePo(text)).toEqual(po);
    expect(pluralForms(po)).toBe(3);
  });

  it('joins continued strings and keeps unknown escapes as written', () => {
    const p = parsePo('msgid ""\nmsgstr ""\n"Language: ru\\n"\n\nmsgid "Long "\n"line"\nmsgstr "Длинная "\n"строка\\n"\n');
    expect(p.header).toEqual([['Language', 'ru']]);
    expect(p.entries[0]).toMatchObject({ id: 'Long line', str: ['Длинная строка\\n'] });
  });

  it('makes a lookup table of the translated entries only', () => {
    const c = catalogOf(po);
    expect(c.s).toEqual({ 'Say "hi" \\ there': 'Скажи «привет»', 'state\u0004Off': 'Выкл.' });
    expect(c.p).toEqual({ '%s day': ['%s день', '%s дня', '%s дней'] });
  });
});

describe('LMO catalogs', () => {
  it('match what LuCI’s po2lmo makes, byte for byte', () => {
    // po2lmo.lmo: the SDK's po2lmo run on po2lmo.po (context, plural forms, Cyrillic, a string left as it is).
    const po = parsePo(fs.readFileSync(new URL('./i18n/po2lmo.po', import.meta.url), 'utf8'));
    const want = fs.readFileSync(new URL('./i18n/po2lmo.lmo', import.meta.url));
    expect(Buffer.from(lmo(po)).equals(want)).toBe(true);
  });
  it('hash keys as LuCI looks them up', () => {
    // cbi.js: sfh("Save") is what the translations endpoint names "Save" by.
    expect(sfh(new TextEncoder().encode('Save')).toString(16).padStart(8, '0')).toBe('219966c7');
  });
});

describe('string checks', () => {
  it('refuses what LuCI could not look up again', () => {
    expect(badText('Fine text')).toBeNull();
    expect(badText(' lead')).toMatch(/starts or ends/);
    expect(badText('two  spaces')).toMatch(/two spaces/);
    expect(badText('a\nb')).toMatch(/newline/);
    expect(badText('')).toMatch(/empty/);
  });
  it('wants the placeholders of the English', () => {
    expect(badTranslation({ id: '%s of %s', str: ['%s из %s'], refs: [] })).toBeNull();
    expect(badTranslation({ id: '%s of %s', str: ['%s из'], refs: [] })).toMatch(/placeholders/);
    expect(badTranslation({ id: '%s day', plural: '%s days', str: ['%s день', '%s дня', 'дней'], refs: [] })).toMatch(/placeholders/);
    expect(badTranslation({ id: 'Line', str: ['Строка\\n'], refs: [] })).toMatch(/backslash/);
    expect(badTranslation({ id: 'A — b', str: ['А — б'], refs: [] })).toMatch(/em dash/);
    expect(badTranslation({ id: 'A — b', str: ['А - б'], refs: [] })).toBeNull();
  });
});

describe('formatting', () => {
  it('fills placeholders in order', () => {
    expect(fmt('%s of %d', 'a', 3)).toBe('a of 3');
    expect(fmt('100%% of %s', 'x')).toBe('100% of x');
    expect(fmt('%s and %s', 'one')).toBe('one and ');
  });
  it('puts elements into a sentence', () => {
    const link = { el: 'a' };
    expect(fill<unknown>('Install it in %s, then %s.', link, 'come back')).toEqual(['Install it in ', link, ', then ', 'come back', '.']);
    expect(fill('%s%% done', 5)).toEqual([5, '%', ' done']);
  });
  it('speaks English without a page language', () => {
    expect(lang()).toBe('en');
    expect(num(2000)).toBe('2,000');
    expect(num(1.5, 1)).toBe('1.5');
    expect(plural(1, '%s event', '%s events')).toBe('1 event');
  });
});

describe('the portal’s languages', () => {
  let i18n: typeof import('../src/portal/i18n');
  const store: Record<string, string> = {};

  beforeAll(async () => {
    Object.assign(globalThis, {
      document: { documentElement: { lang: '' } },
      localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => (store[k] = v) },
    });
    i18n = await import('../src/portal/i18n');
  });

  it('opens in the kept choice, else the browser’s first language it has', () => {
    expect(i18n.pickLang(null, ['ru-RU', 'en-US'])).toBe('ru');
    expect(i18n.pickLang(null, ['de-DE', 'ru'])).toBe('ru');
    expect(i18n.pickLang(null, ['de-DE', 'fr'])).toBe('en');
    expect(i18n.pickLang('en', ['ru-RU'])).toBe('en');
    expect(i18n.pickLang('xx', ['ru-RU'])).toBe('ru');
  });

  it('switches the page and keeps the choice', () => {
    i18n.addCatalog('ru', { s: { Hello: 'Привет' }, p: { '%s device': ['%s устройство', '%s устройства', '%s устройств'] } });
    i18n.setLang('ru');
    expect(lang()).toBe('ru');
    expect(store['dl.lang']).toBe('ru');
    expect(_('Hello')).toBe('Привет');
    expect(_('Not in the catalog')).toBe('Not in the catalog');
    expect([1, 2, 5, 11, 21, 22, 25, 111].map((n) => plural(n, '%s device', '%s devices'))).toEqual([
      '1 устройство',
      '2 устройства',
      '5 устройств',
      '11 устройств',
      '21 устройство',
      '22 устройства',
      '25 устройств',
      '111 устройств',
    ]);
    expect(num(2000)).toBe('2 000');
    i18n.setLang('en');
    expect(_('Hello')).toBe('Hello');
    expect(plural(2, '%s device', '%s devices')).toBe('2 devices');
  });

  it('picks plural forms by the formula its catalog declares', () => {
    const header = parsePo(fs.readFileSync(new URL('../src/portal/i18n/ru.po', import.meta.url), 'utf8')).header;
    const formula = header
      .find(([k]) => k === 'Plural-Forms')![1]
      .replace(/^.*plural=/, '')
      .replace(/;$/, '');
    const index = new Function('n', `return +(${formula});`) as (n: number) => number;
    i18n.addCatalog('ru', { s: {}, p: { probe: ['0', '1', '2'] } });
    i18n.setLang('ru', false);
    for (let n = 0; n <= 250; n++) expect(N_(n, 'probe', 'probes')).toBe(String(index(n)));
  });
});
