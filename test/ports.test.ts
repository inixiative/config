import { expect, test } from 'bun:test';
import registry from '../ports.json';
import { portConflicts, portsFor, projects } from '../src/ports';

test('every project gets its own ports, only zealot on the defaults, none shared', () => {
  expect(portConflicts()).toEqual([]);
  expect(new Set(Object.values(registry.projects)).size).toBe(projects.length);
});

test('a project port is the service default plus its block', () => {
  expect(portsFor('archive')).toMatchObject({ http: 4700, postgres: 6132 });
  expect(portsFor('kingdom')).toMatchObject({ web: 3200, api: 8200, postgres: 5632, redis: 6579 });
  expect(portsFor('monorepo')).toMatchObject({ web: 3300, postgres: 5732 });
  expect(portsFor('zealot')).toMatchObject({ web: 3000, api: 8000, postgres: 5432, redis: 6379 });
});

test('a project on block 0 is the only one on the defaults', () => {
  const others = projects.filter((project) => registry.projects[project] !== 0);
  for (const project of others)
    for (const [service, port] of Object.entries(portsFor(project)))
      expect(port).not.toBe(registry.services[service as keyof typeof registry.services]);
});
