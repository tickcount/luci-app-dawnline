import { beforeAll, describe, expect, it } from 'vitest';
import { installFakeDom, text } from './fakedom';
import { csvCell, toCsv } from '../src/admin/events/csv';
import { categoryOf, eventBy, isProblem } from '../src/admin/events/model';
import { eventText } from '../src/admin/events/render';
import type { LogEvent, Person } from '../src/shared/types';

beforeAll(installFakeDom);

describe('csv', () => {
  it('quotes and defuses formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\r\nbreak')).toBe('"line\r\nbreak"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tx')).toBe("'\tx");
    expect(csvCell(null)).toBe('');
    expect(csvCell(5)).toBe('5');
  });
  it('builds a table', () => {
    expect(toCsv(['a', 'b'] as const, [{ a: 1, b: 'x,y' }])).toBe('a,b\n1,"x,y"');
  });
});

describe('events', () => {
  const people = [{ id: 'p1', name: 'Myata', devices: [{ id: 'd1', name: 'Phone' }] }] as unknown as Person[];
  const ev = (e: Partial<LogEvent>) => ({ ts: 1, type: 'connect', ...e }) as LogEvent;
  it('knows who did it', () => {
    expect(eventBy(ev({ type: 'person_added' }))).toBe('admin');
    expect(eventBy(ev({ type: 'device_added', detail: 'Phone (portal)' }))).toBe('portal');
    expect(eventBy(ev({ type: 'connect' }))).toBeNull();
    expect(eventBy(ev({ type: 'connect', by: 'admin' }))).toBe('admin');
  });
  it('sorts events into categories and problems', () => {
    expect(categoryOf('roam')).toBe('connections');
    expect(categoryOf('portal_blocked')).toBe('problems');
    expect(categoryOf('something_new')).toBe('problems');
    expect(isProblem({ ts: 1, sys: { ts: 1, src: 'awg', level: 'down', msg: '' } })).toBe(true);
    expect(isProblem({ ts: 1, ev: ev({ type: 'connect' }) })).toBe(false);
  });
  it('says what happened', () => {
    const st = { people };
    expect(text(eventText(st, ev({ person: 'p1', device: 'd1', detail: '1.2.3.4', where: 'Berlin' })))).toBe(
      'Device Myata · Phone connected from 1.2.3.4 · Berlin',
    );
    expect(text(eventText(st, ev({ type: 'device_added', by: 'admin', person: 'p1', detail: 'Laptop' })))).toBe(
      'You added device Laptop for Myata',
    );
    expect(text(eventText(st, ev({ type: 'device_changed', by: 'admin', person: 'p1', device: 'd1', detail: 'renamed from Old' })))).toBe(
      'You renamed device Phone of Myata · was Old',
    );
    // Removed since: the name from the time of the event.
    expect(text(eventText(st, ev({ type: 'disconnect', person: 'gone', pname: 'Anna', dname: 'Tablet', device: 'x' })))).toBe(
      'Device Anna · Tablet went offline',
    );
    expect(
      text(eventText(st, ev({ type: 'roam', person: 'p1', device: 'd1', detail: '10.0.0.2 → 5.6.7.8', hosts: { '10.0.0.2': 'nas' } }))),
    ).toBe('Device Myata · Phone changed network nas (10.0.0.2) → 5.6.7.8');
  });
});
