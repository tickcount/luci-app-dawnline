import { beforeAll, describe, expect, it } from 'vitest';
import { installFakeDom, text } from './fakedom';
import { csvCell, toCsv } from '../src/admin/events/csv';
import {
  adminName,
  adminSentence,
  categoryOf,
  changedText,
  daysOf,
  deviceChangedText,
  eventBy,
  isProblem,
  linkStatesText,
  linkStateText,
  logText,
  noteText,
  reasonText,
} from '../src/admin/events/model';
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
  it('renders portal and unattributed renames, including saved names of removed devices', () => {
    for (const by of ['portal', undefined] as const) {
      const event = ev({ type: 'device_changed', by, person: 'p1', device: 'd1', detail: 'renamed from Мяточька ПК' });
      expect(text(eventText({ people }, event))).toBe(
        by === 'portal'
          ? 'Person Myata renamed device Phone on their portal · was Мяточька ПК'
          : 'Device Myata · Phone renamed · was Мяточька ПК',
      );
      expect(text(eventText({ people: [] }, { ...event, pname: 'Myata', dname: 'Phone' }))).toBe(text(eventText({ people }, event)));
    }
  });
  it('omits the person only in their own activity and preserves the actor', () => {
    const st = { people };
    const rename = ev({ type: 'device_changed', by: 'portal', person: 'p1', device: 'd1', detail: 'renamed from Old' });
    expect(text(eventText(st, rename, 'p1'))).toBe('Device Phone renamed on the portal · was Old');
    expect(text(eventText(st, { ...rename, by: 'admin' }, 'p1'))).toBe('You renamed device Phone · was Old');
    expect(text(eventText(st, rename, 'another-person'))).toBe(text(eventText(st, rename)));
    expect(text(eventText(st, ev({ type: 'disconnect', person: 'p1', device: 'd1' }), 'p1'))).toBe('Device Phone went offline');
    expect(text(eventText(st, ev({ person: 'p1', device: 'd1', detail: '1.2.3.4' }), 'p1'))).toBe('Device Phone connected from 1.2.3.4');
    expect(text(eventText(st, ev({ type: 'roam', person: 'p1', device: 'd1', detail: '1 → 2' }), 'p1').slice(0, 3))).toBe(
      'Device Phone changed network ',
    );
    expect(text(eventText(st, ev({ type: 'expiring', person: 'p1', detail: '3 days' }), 'p1'))).toBe('Access ends in 3 days');
    expect(text(eventText(st, ev({ type: 'device_added', by: 'portal', person: 'p1', detail: 'Tablet' }), 'p1'))).toBe(
      'Device Tablet added on the portal',
    );
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

describe('a device’s link', () => {
  const people = [{ id: 'p1', name: 'Myata', devices: [{ id: 'd1', name: 'Phone' }] }] as unknown as Person[];
  const ev = (e: Partial<LogEvent>) => ({ ts: 1, person: 'p1', device: 'd1', ...e }) as LogEvent;
  it('says what its state means', () => {
    expect(linkStateText('trying')).toEqual({
      title: 'Unable to complete the handshake',
      line: 'The device’s network may be blocking the connection.',
    });
    expect(linkStateText('dropped')?.title).toBe('Handshake complete, but no data');
    expect(linkStateText('shared')?.title).toBe('On two devices at once');
    expect(linkStateText('unstable')?.title).toBe('Connection keeps dropping');
    expect(linkStateText('flowing')).toBeNull();
    expect(linkStatesText('trying, unstable')).toBe('Unable to complete the handshake, Connection keeps dropping');
    expect(linkStatesText('later')).toBe('later');
  });
  it('puts its failing and recovering into Activity', () => {
    expect(categoryOf('device_failing')).toBe('problems');
    expect(categoryOf('device_recovered')).toBe('problems');
    const st = { people };
    expect(text(eventText(st, ev({ type: 'device_failing', detail: 'trying, shared' })))).toBe(
      'Device Myata · Phone has a connection problem · Unable to complete the handshake, On two devices at once',
    );
    expect(text(eventText(st, ev({ type: 'device_recovered', detail: 'unstable' })))).toBe('Device Myata · Phone connects normally again');
  });
  it('names the link options the admin changed', () => {
    expect(deviceChangedText('mtu, keepalive, lan_bypass')).toBe('MTU, keep-alive, LAN Bypass');
    expect(deviceChangedText('something new')).toBe('something new');
    expect(text(eventText({ people }, ev({ type: 'device_changed', by: 'admin', detail: 'mtu' })))).toBe(
      'You changed device Phone of Myata · MTU',
    );
  });
});

describe('the router’s words', () => {
  it('puts the admin’s own changes into sentences', () => {
    expect(adminSentence('changed', 'server', 'Home')).toEqual({ text: 'You changed server %s', named: true });
    expect(adminSentence('cleared', null, 'the service log')).toEqual({ text: 'You cleared the service log', named: false });
    expect(adminSentence('reset traffic history', null, 'for Anna')).toEqual({ text: 'You reset traffic history for %s', named: true });
    expect(adminName('reset traffic history', 'for Anna')).toBe('Anna');
    expect(adminSentence('frobnicated', 'gizmo', 'x')).toBeNull();
  });
  it('reads the notes, the reasons and the days', () => {
    expect(noteText('port 8443, certificate')).toBe('port 8443, certificate');
    expect(noteText('3 events · people · older than 7 days')).toBe('3 events · People · older than 7 days');
    expect(noteText('12 entries older than 30 days')).toBe('12 entries, older than 30 days');
    expect(noteText('something new')).toBe('something new');
    expect(reasonText('data limit reached')).toBe('data limit reached');
    expect(daysOf('3 days')).toBe(3);
    expect(daysOf('1 day')).toBe(1);
    expect(daysOf('soon')).toBeNull();
    expect(changedText('device_limit, moved to Home')).toBe('device limit, moved to Home');
  });
});

describe('service log lines', () => {
  it('match their templates, values and older dashes kept', () => {
    const g = globalThis as unknown as { _: (s: string) => string };
    const was = g._;
    // A catalog that brackets what it knows.
    g._ = (s: string) => `[${s}]`;
    try {
      expect(logText('stopped unexpectedly')).toBe('[stopped unexpectedly]');
      expect(logText('updated · 0.9.0 → 0.10.0')).toBe('[updated · %s → %s]'.replace('%s', '0.9.0').replace('%s', '0.10.0'));
      expect(logText('are missing — loading them again')).toBe(
        '[%s - %s]'.replace('%s', '[are missing]').replace('%s', '[loading them again]'),
      );
      expect(logText("are missing - not repaired again (3 repairs didn't help)")).toBe(
        "[%s - not repaired again (%d repairs didn't help)]".replace('%s', '[are missing]').replace('%d', '3'),
      );
      expect(logText('updates available · Dawnline 0.11.0, 2 system packages')).toBe(
        '[updates available · %s]'.replace('%s', 'Dawnline 0.11.0, [%d system packages]'.replace('%d', '2')),
      );
      expect(logText('something the page never saw')).toBe('something the page never saw');
    } finally {
      g._ = was;
    }
  });
});
