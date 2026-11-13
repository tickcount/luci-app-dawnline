import { beforeAll, describe, expect, it } from 'vitest';
import {
  SECTIONS,
  deviceUrl,
  href,
  logUrl,
  peopleAt,
  peopleUrl,
  personUrl,
  placesUrl,
  sectionOf,
  healthUrl,
  serverUrl,
  settingsUrl,
  sectionPlace,
  withCloseUp,
} from '../src/admin/shell/routes';
import { follow, listOf, parseRoute, routeQuery } from '../src/admin/people/route';
import { target } from '../src/admin/shell/redirects';
import { partOf } from '../src/admin/pages/settings/route';

beforeAll(() => {
  Object.assign(globalThis, { L: { url: (p: string) => `/cgi-bin/luci/${p}` } });
});

describe('sections', () => {
  it('knows the section of every view', () => {
    expect(SECTIONS).toEqual(['overview', 'log', 'settings']);
    expect(sectionOf('log', '')).toBe('log');
    expect(sectionOf('activity', '')).toBe('log');
    // a server's page stands behind Overview: its own view, and People (a person, a device, Places) inside its frame
    expect(sectionOf('server', '')).toBe('overview');
    expect(sectionOf('server', 'server=s1&p=core')).toBe('overview');
    expect(sectionOf('people', '')).toBe('overview');
    expect(sectionOf('people', 'view=map&device=d1')).toBe('overview');
    expect(sectionOf('person', 'id=p1&device=d1')).toBe('overview');
    expect(sectionOf('device', 'id=d1')).toBe('overview');
    expect(sectionOf('places', 'sheet=places&device=d1')).toBe('overview');
    // Settings: the router's own sections; the old System page leads there
    expect(sectionOf('settings', '')).toBe('settings');
    expect(sectionOf('settings', 'p=backups')).toBe('settings');
    expect(sectionOf('system', 'open=updates')).toBe('settings');
    expect(sectionOf('updates', '')).toBe('settings');
    // Overview, and Dawnline's own menu item (an alias of it); Health is Overview's now
    expect(sectionOf('overview', '')).toBe('overview');
    expect(sectionOf('dawnline', '')).toBe('overview');
    expect(sectionOf('health', '')).toBe('overview');
    expect(sectionOf('system', 'open=health')).toBe('overview');
    expect(sectionOf('diagnostics', '')).toBe('overview');
    expect(sectionOf('diagnostics', 'tab=log')).toBe('log');
    expect(sectionOf('elsewhere', '')).toBeNull();
  });

  it('opens every section on a page that lights its tab', () => {
    expect(SECTIONS[0]).toBe('overview');
    for (const s of SECTIONS) {
      const p = sectionPlace(s);
      expect(sectionOf(p.view, p.query ?? '')).toBe(s);
    }
    expect(sectionPlace('settings')).toEqual({ view: 'settings' });
  });
});

describe('addresses', () => {
  it('builds them with L.url; a person, a device and places are People with the old query names', () => {
    const at = '/cgi-bin/luci/admin/services/dawnline/';
    expect(href({ view: 'log' })).toBe(`${at}log`);
    expect(href({ view: 'settings', query: 'p=entry' })).toBe(`${at}settings?p=entry`);
    expect(personUrl('p 1')).toBe(`${at}people?id=p+1`);
    expect(personUrl('p1', 'traffic')).toBe(`${at}people?id=p1&s=traffic`);
    expect(deviceUrl('d&2')).toBe(`${at}people?device=d%262`);
    expect(deviceUrl('d1', 'setup')).toBe(`${at}people?device=d1&sheet=setup`);
    expect(placesUrl()).toBe(`${at}people?view=map`);
    expect(placesUrl({ person: 'p1' })).toBe(`${at}people?view=map&id=p1`);
    expect(placesUrl({ server: 's1' })).toBe(`${at}people?view=map&server=s1`);
    expect(placesUrl({ device: 'd1' })).toBe(`${at}people?device=d1&sheet=places`);
    expect(peopleUrl('s1')).toBe(`${at}people?server=s1`);
    expect(peopleUrl('s1', 'config')).toBe(`${at}people?server=s1&need=config`);
    expect(peopleUrl()).toBe(`${at}people`);
    expect(peopleAt({ view: 'map', device: 'd1', range: '7d' })).toBe(`${at}people?view=map&device=d1&range=7d`);
    expect(logUrl({ device: 'd1' })).toBe(`${at}log?device=d1`);
    expect(logUrl({ kind: 'problems' })).toBe(`${at}log?kind=problems`);
    expect(logUrl()).toBe(`${at}log`);
    expect(logUrl({ kind: 'problems', day: 'yesterday' })).toBe(`${at}log?kind=problems&day=yesterday`);
    expect(logUrl({ server: 's1', q: '176.59' })).toBe(`${at}log?server=s1&q=176.59`);
    // a server's page: its Overview, a part of its settings, its people and places (the People view in its frame)
    expect(serverUrl()).toBe(`${at}server`);
    expect(serverUrl('s1')).toBe(`${at}server?server=s1`);
    expect(serverUrl('s1', 'core')).toBe(`${at}server?server=s1&p=core`);
    expect(serverUrl('s1', 'people')).toBe(`${at}people?server=s1`);
    expect(serverUrl('s1', 'places')).toBe(`${at}people?view=map&server=s1`);
    // where something is set: a router's section in Settings, a stage of a server's path on the server's page
    expect(settingsUrl('backups')).toBe(`${at}settings?p=backups`);
    expect(settingsUrl('backups', 's1')).toBe(`${at}settings?p=backups`);
    expect(settingsUrl()).toBe(`${at}server`);
    expect(settingsUrl(undefined, 's1')).toBe(`${at}server?server=s1`);
    expect(settingsUrl('home', 's1')).toBe(`${at}server?server=s1&p=network&s=home`);
    expect(settingsUrl('entry')).toBe(`${at}server?p=general&s=entry`);
    expect(settingsUrl('disguise', 's2')).toBe(`${at}server?server=s2&p=core&s=disguise`);
    expect(settingsUrl('check', 's1')).toBe(`${at}server?server=s1&s=check`);
    expect(healthUrl()).toBe(`${at}overview?s=health`);
  });
});

describe('the People route', () => {
  it('reads an address and writes it back the same', () => {
    expect(parseRoute('')).toEqual(listOf({}));
    expect(routeQuery(parseRoute('id=p1&group=need&sort=-traffic'))).toBe('id=p1&group=need&sort=-traffic');
    expect(routeQuery(parseRoute('range=7d&view=map&server=s1'))).toBe('view=map&server=s1&range=7d');
    // a device's panel takes the person's place
    expect(parseRoute('id=p1&device=d1')).toMatchObject({ id: undefined, device: 'd1' });
    expect(routeQuery({ id: 'p1', device: 'd1' })).toBe('device=d1');
    // what is not a value of its key is dropped
    expect(parseRoute('view=grid&group=all&need=1&range=year')).toEqual(listOf({}));
    // the old ?add=1 asks for the Add sheet
    expect(parseRoute('add=1').sheet).toBe('add');
    expect(parseRoute('device=d1&sheet=setup').sheet).toBe('setup');
  });

  it('opens a link to an object beside the list as it stands, and takes a link to a view whole', () => {
    const cur = parseRoute('view=map&server=s1&range=7d&id=p1');
    expect(routeQuery(follow(cur, parseRoute('device=d1')))).toBe('view=map&device=d1&server=s1&range=7d');
    expect(routeQuery(follow(cur, parseRoute('id=p2&s=term')))).toBe('view=map&id=p2&server=s1&range=7d&s=term');
    // the way back to the list: the panel shuts, the list stays
    expect(routeQuery(follow(cur, parseRoute('')))).toBe('view=map&server=s1&range=7d');
    expect(routeQuery(follow(parseRoute('group=need&id=p1'), parseRoute('view=map&id=p1')))).toBe('view=map&id=p1');
    expect(routeQuery(follow(parseRoute('id=p1'), parseRoute('server=s2')))).toBe('server=s2');
  });
});

describe('redirects', () => {
  it('sends old addresses on', () => {
    expect(target('activity', '')).toEqual({ view: 'log' });
    expect(target('diagnostics', 'tab=log')).toEqual({ view: 'log' });
    // Diagnostics and Health are Overview's health checks
    const health = { view: 'overview', query: 's=health' };
    expect(target('health', '')).toEqual(health);
    expect(target('diagnostics', '')).toEqual(health);
    expect(target('diagnostics', 'tab=health')).toEqual(health);
    expect(target('system', 'open=health')).toEqual(health);
    // Components and the System page's rows are the router's own sections of Settings
    expect(target('updates', '')).toEqual({ view: 'settings', query: 'p=updates' });
    expect(target('system', '')).toEqual({ view: 'settings', query: 'p=updates' });
    expect(target('system', 'open=portal')).toEqual({ view: 'settings', query: 'p=portal' });
    expect(target('system', 'open=backups')).toEqual({ view: 'settings', query: 'p=backups' });
    expect(target('system', 'open=history')).toEqual({ view: 'settings', query: 'p=history' });
    expect(target('system', 'open=remove')).toEqual({ view: 'settings', query: 'p=remove' });
    expect(target('system', 'open=nonsense')).toEqual({ view: 'settings', query: 'p=updates' });
    // Settings keeps the router's sections: its old queries are sent on, and a server's path (it was Settings'
    // own) goes to the server's page
    expect(target('settings', '')).toBeNull();
    expect(target('settings', 'p=portal')).toBeNull();
    expect(target('settings', 'p=nonsense')).toBeNull();
    expect(target('settings', 'p=portal&server=s1')).toEqual({ view: 'settings', query: 'p=portal' });
    expect(target('settings', 'server=s1')).toEqual({ view: 'server', query: 'server=s1' });
    expect(target('settings', 'p=home&server=s1')).toEqual({ view: 'server', query: 'server=s1&p=network&s=home' });
    expect(target('settings', 'p=entry')).toEqual({ view: 'server', query: 'p=general&s=entry' });
    expect(target('settings', 'p=rollout&server=s2')).toEqual({ view: 'server', query: 'server=s2&s=rollout' });
    expect(target('settings', 'section=backups')).toEqual({ view: 'settings', query: 'p=backups' });
    expect(target('settings', 'section=map')).toEqual({ view: 'settings', query: 'p=history' });
    expect(target('settings', 'tab=map')).toEqual({ view: 'settings', query: 'p=history' });
    expect(target('settings', 'section=logs')).toEqual({ view: 'settings', query: 'p=history' });
    expect(target('settings', 'section=danger')).toEqual({ view: 'settings', query: 'p=remove' });
    expect(target('settings', 'section=portal')).toEqual({ view: 'settings', query: 'p=portal' });
    expect(target('settings', 'tab=general')).toEqual({ view: 'settings', query: 'p=updates' });
    // a server's People section is People, filtered to that server; its old filters are the groups now
    expect(target('server', 'server=s1&section=people&filter=online')).toEqual({ view: 'people', query: 'server=s1' });
    expect(target('server', 'section=people')).toEqual({ view: 'people', query: undefined });
    // the server's page is a page of its own; its old rows (?open=) and the Servers page's sections before them
    // (?section=) are parts of it
    expect(target('server', '')).toBeNull();
    expect(target('server', 'server=s2')).toBeNull();
    expect(target('server', 'server=s2&p=core')).toBeNull();
    expect(target('server', 'server=s1&open=home')).toEqual({ view: 'server', query: 'server=s1&p=network&s=home' });
    expect(target('server', 'open=check')).toEqual({ view: 'server', query: 's=check' });
    expect(target('server', 'open=nonsense')).toEqual({ view: 'server', query: undefined });
    expect(target('server', 'server=s1&section=connection')).toEqual({ view: 'server', query: 'server=s1&p=general&s=entry' });
    expect(target('server', 'section=access')).toEqual({ view: 'server', query: 'p=network&s=home' });
    expect(target('server', 'server=s2&section=awg')).toEqual({ view: 'server', query: 'server=s2&p=core&s=disguise' });
    expect(target('server', 'section=tunnel')).toEqual({ view: 'server', query: 'p=network&s=tunnel' });
    expect(target('server', 'section=advanced')).toEqual({ view: 'server', query: 'p=core&s=devices' });
    expect(target('server', 'server=s1&section=overview')).toEqual({ view: 'server', query: 'server=s1' });
    expect(target('server', 'section=overview')).toEqual({ view: 'server', query: undefined });
    // Overview is a page of its own again
    expect(target('overview', 'server=s1')).toBeNull();
    expect(target('overview', '')).toBeNull();
  });

  it('sends a person, a device and Places into People, keeping the query names', () => {
    expect(target('person', 'id=p1')).toEqual({ view: 'people', query: 'id=p1' });
    expect(target('person', 'id=p+1&open=traffic')).toEqual({ view: 'people', query: 'id=p+1&s=traffic' });
    expect(target('person', 'id=p1&open=networks')).toEqual({ view: 'people', query: 'id=p1&s=reach' });
    // the devices row is the panel's first block: nothing to scroll to
    expect(target('person', 'id=p1&open=devices')).toEqual({ view: 'people', query: 'id=p1' });
    expect(target('person', 'id=p1&add=1')).toEqual({ view: 'people', query: 'id=p1&sheet=add' });
    // older still: a person's page with a device's drawer open
    expect(target('person', 'id=p1&device=d+1')).toEqual({ view: 'people', query: 'device=d+1' });
    expect(target('person', '')).toEqual({ view: 'people', query: undefined });
    expect(target('device', 'id=d1')).toEqual({ view: 'people', query: 'device=d1' });
    expect(target('device', 'id=d1&sheet=setup')).toEqual({ view: 'people', query: 'device=d1&sheet=setup' });
    expect(target('device', 'id=d1&sheet=places&device=d1')).toEqual({ view: 'people', query: 'device=d1&sheet=places' });
    expect(target('places', '')).toEqual({ view: 'people', query: 'view=map' });
    expect(target('places', 'person=p1')).toEqual({ view: 'people', query: 'view=map&id=p1' });
    expect(target('places', 'server=s1')).toEqual({ view: 'people', query: 'view=map&server=s1' });
    expect(target('places', 'person=p1&sheet=places&device=d1')).toEqual({ view: 'people', query: 'device=d1&sheet=places' });
  });

  it('leaves pages of their own alone', () => {
    expect(target('log', '')).toBeNull();
    expect(target('settings', 'p=updates')).toBeNull();
    expect(target('server', 'server=s1&p=network&s=home')).toBeNull();
    expect(target('overview', 's=health')).toBeNull();
    expect(target('people', 'id=p1')).toBeNull();
    expect(target('people', 'view=map')).toBeNull();
  });
});

describe('the close-up in the address', () => {
  it('adds and takes away sheet=places&device=, keeping what the page had', () => {
    const at = 'http://r/cgi-bin/luci/admin/services/dawnline/';
    expect(withCloseUp(`${at}overview`, 'd1')).toBe('/cgi-bin/luci/admin/services/dawnline/overview?sheet=places&device=d1');
    expect(withCloseUp(`${at}overview?sheet=places&device=d1`, null)).toBe('/cgi-bin/luci/admin/services/dawnline/overview');
    expect(withCloseUp(`${at}log?device=d1&sheet=places`, null)).toBe('/cgi-bin/luci/admin/services/dawnline/log?device=d1');
    expect(withCloseUp(`${at}log?device=d1`, 'd1')).toBe('/cgi-bin/luci/admin/services/dawnline/log?device=d1&sheet=places');
    // on People ?device= is the open panel: it stays when the close-up shuts
    expect(withCloseUp(`${at}people?view=map&device=d1`, 'd1')).toBe(
      '/cgi-bin/luci/admin/services/dawnline/people?view=map&device=d1&sheet=places',
    );
    expect(withCloseUp(`${at}people?view=map&device=d1&sheet=places`, null)).toBe(
      '/cgi-bin/luci/admin/services/dawnline/people?view=map&device=d1',
    );
  });

  it("keeps a person's page theirs: all their devices, or the one picked as pick=", () => {
    const at = 'http://r/cgi-bin/luci/admin/services/dawnline/';
    expect(withCloseUp(`${at}people?id=p1`, null, true)).toBe('/cgi-bin/luci/admin/services/dawnline/people?id=p1&sheet=places');
    expect(withCloseUp(`${at}people?id=p1&sheet=places`, 'd2', true)).toBe(
      '/cgi-bin/luci/admin/services/dawnline/people?id=p1&sheet=places&pick=d2',
    );
    expect(withCloseUp(`${at}people?id=p1&sheet=places&pick=d2`, null, true)).toBe(
      '/cgi-bin/luci/admin/services/dawnline/people?id=p1&sheet=places',
    );
    // closed: back to the person's page
    expect(withCloseUp(`${at}people?id=p1&sheet=places&pick=d2`, null)).toBe('/cgi-bin/luci/admin/services/dawnline/people?id=p1');
  });
});

describe('the Settings route', () => {
  it('names one of the router’s sections; none, or one that does not exist: Updates', () => {
    for (const p of ['updates', 'portal', 'defaults', 'history', 'backups', 'remove']) expect(partOf(`p=${p}`)).toBe(p);
    expect(partOf('')).toBe('updates');
    expect(partOf('p=tunnel&server=s2')).toBe('updates');
    expect(partOf('p=health')).toBe('updates');
  });
});
