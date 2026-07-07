import { beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(import.meta.dir, '..');
const fixtures = join(import.meta.dir, 'fixtures');

const run = (command: string[], cwd: string) => {
  const result = spawnSync(command[0], command.slice(1), { cwd, encoding: 'utf8' });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
};

const bin = (fixture: string, name: string) =>
  join(fixtures, fixture, 'node_modules', '.bin', name);

const must = (command: string[], cwd: string, label: string) => {
  const result = run(command, cwd);
  if (result.status !== 0) throw new Error(`${label} failed: ${result.output}`);
};

beforeAll(() => {
  must(['bun', 'run', 'build'], repoRoot, 'build');
  must(['bun', 'pm', 'pack', '--ignore-scripts'], repoRoot, 'pack');
  const tarball = readdirSync(repoRoot).find(
    (name) => name.endsWith('.tgz') && name !== 'config.tgz',
  );
  if (tarball) renameSync(join(repoRoot, tarball), join(repoRoot, 'config.tgz'));
  for (const fixture of ['consumer-node', 'consumer-react']) {
    rmSync(join(fixtures, fixture, 'node_modules'), { recursive: true, force: true });
    rmSync(join(fixtures, fixture, 'bun.lock'), { force: true });
    must(['bun', 'install'], join(fixtures, fixture), `bun install in ${fixture}`);
  }
}, 240000);

describe('consumer-node resolves shared configs from node_modules', () => {
  test('tsc typechecks through @inixiative/config/tsconfig/base.json', () => {
    const result = run([bin('consumer-node', 'tsc'), '--noEmit'], join(fixtures, 'consumer-node'));
    expect(result.output.trim()).toBe('');
    expect(result.status).toBe(0);
  });

  test('biome lints through @inixiative/config/biome/base.json', () => {
    const result = run(
      [bin('consumer-node', 'biome'), 'check', 'src'],
      join(fixtures, 'consumer-node'),
    );
    expect(result.status).toBe(0);
  });
});

describe('consumer-react resolves shared configs from node_modules', () => {
  test('tsc typechecks tsx through @inixiative/config/tsconfig/react.json', () => {
    const result = run(
      [bin('consumer-react', 'tsc'), '--noEmit'],
      join(fixtures, 'consumer-react'),
    );
    expect(result.output.trim()).toBe('');
    expect(result.status).toBe(0);
  });

  test('biome lints through base + react overlay', () => {
    const result = run(
      [bin('consumer-react', 'biome'), 'check', 'src'],
      join(fixtures, 'consumer-react'),
    );
    expect(result.status).toBe(0);
  });
});
