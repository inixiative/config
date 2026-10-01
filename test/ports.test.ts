import { expect, test } from 'bun:test';
import registry from '../ports.json';
import { portConflicts, portsFor, projects } from '../src/ports';

test('every project gets its own ports, none on a default and none shared', () => {
  expect(portConflicts()).toEqual([]);
  expect(new Set(Object.values(registry.projects)).size).toBe(projects.length);
});

test('a project port is the service default plus its block', () => {
  expect(portsFor('archive')).toMatchObject({ http: 4700, postgres: 6132 });
  expect(portsFor('kingdom')).toMatchObject({ web: 3200, api: 8200, postgres: 5632, redis: 6579 });
});
