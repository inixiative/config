import { beforeAll, describe, expect, test } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { admits, discoverRepos, inspect, loadManifest, parseJsonc, topoOrder } from '../src/lib';

const manifest = loadManifest();
const fixtures = join(import.meta.dir, 'fixtures');

const clone = (fixture: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'inixiative-config-'));
  cpSync(join(fixtures, fixture), dir, { recursive: true });
  return dir;
};

beforeAll(() => {
  for (const fixture of ['consumer-node', 'consumer-react']) {
    rmSync(join(fixtures, fixture, 'bun.lock'), { force: true });
  }
});

const readPkg = (dir: string) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

const writePkg = (dir: string, pkg: Record<string, unknown>) =>
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);

describe('admits', () => {
  test('caret', () => {
    expect(admits('^2.10.0', '2.12.0')).toBe(true);
    expect(admits('^2.10.0', '2.6.0')).toBe(false);
    expect(admits('^2.10.0', '3.0.0')).toBe(false);
  });

  test('caret with zero major', () => {
    expect(admits('^0.3.0', '0.3.5')).toBe(true);
    expect(admits('^0.3.0', '0.4.0')).toBe(false);
  });

  test('exact, tilde, gte', () => {
    expect(admits('2.5.2', '2.5.2')).toBe(true);
    expect(admits('2.5.2', '2.5.3')).toBe(false);
    expect(admits('~2.5.0', '2.5.9')).toBe(true);
    expect(admits('~2.5.0', '2.6.0')).toBe(false);
    expect(admits('>=5.9.0', '6.0.3')).toBe(true);
  });

  test('union and unknown', () => {
    expect(admits('^18.0.0 || ^19.0.0', '19.1.0')).toBe(true);
    expect(admits('^18.0.0 || ^19.0.0', '20.0.0')).toBe(false);
    expect(admits('workspace:*', '1.0.0')).toBe(null);
  });
});

describe('parseJsonc', () => {
  test('strips comments and trailing commas without touching strings', () => {
    const parsed = parseJsonc(
      '{\n// comment\n"$schema": "https://biomejs.dev/x.json", /* block */\n"a": [1, 2,],\n}',
    );
    expect(parsed).toEqual({ $schema: 'https://biomejs.dev/x.json', a: [1, 2] });
  });
});

describe('check on clean fixtures', () => {
  test('consumer-node has no findings', () => {
    const { findings } = inspect(join(fixtures, 'consumer-node'), manifest);
    expect(findings).toEqual([]);
  });

  test('consumer-react has no findings', () => {
    const { findings } = inspect(join(fixtures, 'consumer-react'), manifest);
    expect(findings).toEqual([]);
  });
});

describe('discoverRepos', () => {
  test('matches ecosystem packages by name regardless of directory name', () => {
    const root = mkdtempSync(join(tmpdir(), 'inixiative-scan-'));
    mkdirSync(join(root, 'rules-checkout'));
    writeFileSync(
      join(root, 'rules-checkout', 'package.json'),
      '{"name": "@inixiative/json-rules"}',
    );
    mkdirSync(join(root, 'unrelated'));
    writeFileSync(join(root, 'unrelated', 'package.json'), '{"name": "something-else"}');
    mkdirSync(join(root, 'no-pkg'));

    const repos = discoverRepos(root, manifest);
    expect(repos.map((repo) => repo.name)).toEqual(['@inixiative/json-rules']);
    expect(repos[0].dir).toBe(join(root, 'rules-checkout'));
  });
});

describe('topoOrder', () => {
  test('orders repos so dependencies publish before dependents', () => {
    const root = mkdtempSync(join(tmpdir(), 'inixiative-train-'));
    const repo = (dirName: string, pkg: Record<string, unknown>) => {
      mkdirSync(join(root, dirName));
      writeFileSync(join(root, dirName, 'package.json'), JSON.stringify(pkg));
    };
    repo('builder', {
      name: '@inixiative/rules-builder',
      peerDependencies: { '@inixiative/json-rules': '^2.12.1' },
    });
    repo('rules', { name: '@inixiative/json-rules' });
    repo('trans', {
      name: '@inixiative/transitions',
      dependencies: { '@inixiative/permissions': '^0.3.0' },
    });
    repo('perms', { name: '@inixiative/permissions' });

    const order = topoOrder(root, manifest).map((entry) => entry.name);
    expect(order.indexOf('@inixiative/json-rules')).toBeLessThan(
      order.indexOf('@inixiative/rules-builder'),
    );
    expect(order.indexOf('@inixiative/permissions')).toBeLessThan(
      order.indexOf('@inixiative/transitions'),
    );
    expect(order).toHaveLength(4);
  });
});

describe('committed lockfile', () => {
  test('flags gitignored and untracked bun.lock in a git repo', () => {
    const dir = clone('consumer-node');
    const git = (args: string[]) =>
      Bun.spawnSync(['git', ...args], { cwd: dir, stdout: 'ignore', stderr: 'ignore' });
    git(['init']);
    writeFileSync(join(dir, 'bun.lock'), '{"packages": {}}');
    writeFileSync(join(dir, '.gitignore'), 'node_modules\nbun.lock\n');
    let messages = inspect(dir, manifest).findings.map((finding) => finding.message);
    expect(messages).toContainEqual(expect.stringContaining('bun.lock is gitignored'));

    writeFileSync(join(dir, '.gitignore'), 'node_modules\n');
    messages = inspect(dir, manifest).findings.map((finding) => finding.message);
    expect(messages).toContainEqual(expect.stringContaining('bun.lock untracked'));

    rmSync(join(dir, 'bun.lock'));
    messages = inspect(dir, manifest).findings.map((finding) => finding.message);
    expect(messages).toContainEqual(expect.stringContaining('bun.lock missing'));
  });
});

describe('lefthook standardization', () => {
  test('enforces lefthook dep, config stub, and prepare script in git repos', () => {
    const dir = clone('consumer-node');
    Bun.spawnSync(['git', 'init'], { cwd: dir, stdout: 'ignore', stderr: 'ignore' });

    const { findings, flush } = inspect(dir, manifest);
    const messages = findings.map((finding) => finding.message);
    expect(messages).toContainEqual(expect.stringContaining('lefthook missing'));
    expect(messages).toContainEqual(expect.stringContaining('lefthook.yml missing'));
    expect(messages).toContainEqual(expect.stringContaining('scripts.prepare missing'));

    for (const finding of findings) finding.fix?.();
    flush();

    const pkg = readPkg(dir);
    expect(pkg.devDependencies.lefthook).toBe('2.1.9');
    expect(pkg.scripts.prepare).toBe('lefthook install');
    expect(readFileSync(join(dir, 'lefthook.yml'), 'utf8')).toContain(
      'node_modules/@inixiative/config/lefthook/base.yml',
    );

    const residual = inspect(dir, manifest).findings.map((finding) => finding.message);
    expect(residual).not.toContainEqual(expect.stringContaining('lefthook'));
    expect(residual).not.toContainEqual(expect.stringContaining('prepare'));
  });

  test('replaces a divergent lefthook.yml with the extends stub', () => {
    const dir = clone('consumer-node');
    Bun.spawnSync(['git', 'init'], { cwd: dir, stdout: 'ignore', stderr: 'ignore' });
    writeFileSync(
      join(dir, 'lefthook.yml'),
      'pre-commit:\n  commands:\n    custom:\n      run: echo hi\n',
    );

    const { findings } = inspect(dir, manifest);
    const divergent = findings.find((finding) =>
      finding.message.includes('does not extend the shared hooks'),
    );
    expect(divergent).toBeDefined();
    divergent?.fix?.();
    expect(readFileSync(join(dir, 'lefthook.yml'), 'utf8')).toContain('lefthook/base.yml');
  });
});

describe('drift detection and sync', () => {
  test('detects and fixes toolchain, packageManager, latest, and ecosystem drift', () => {
    const dir = clone('consumer-node');
    const pkg = readPkg(dir);
    pkg.packageManager = 'bun@1.3.10';
    pkg.devDependencies.typescript = '^5.0.0';
    pkg.devDependencies['@types/bun'] = 'latest';
    pkg.devDependencies['@inixiative/json-rules'] = '~2.6.0';
    writePkg(dir, pkg);
    writeFileSync(join(dir, 'bun.lockb'), 'binary');

    const { findings, flush } = inspect(dir, manifest);
    const messages = findings.map((finding) => finding.message);
    expect(messages).toContainEqual(expect.stringContaining('typescript ^5.0.0 → 6.0.3'));
    expect(messages).toContainEqual(expect.stringContaining('packageManager bun@1.3.10'));
    expect(messages).toContainEqual(expect.stringContaining('"latest"'));
    expect(messages).toContainEqual(expect.stringContaining('does not admit blessed 2.12.1'));
    expect(messages).toContainEqual(expect.stringContaining('bun.lockb'));

    for (const finding of findings) finding.fix?.();
    flush();

    const after = inspect(dir, manifest);
    expect(after.findings).toEqual([]);

    const synced = readPkg(dir);
    expect(synced.devDependencies.typescript).toBe('6.0.3');
    expect(synced.devDependencies['@types/bun']).toBe('1.3.14');
    expect(synced.devDependencies['@inixiative/json-rules']).toBe('^2.12.1');
    expect(synced.packageManager).toBe('bun@1.3.14');
  });

  test('flags stale lockfile against declared range and blessed version', () => {
    const dir = clone('consumer-node');
    writeFileSync(
      join(dir, 'bun.lock'),
      '{\n"packages": {\n"@inixiative/json-rules": ["@inixiative/json-rules@2.6.0", "", {}, "sha"],\n}\n}',
    );
    const { findings } = inspect(dir, manifest);
    const stale = findings.filter((finding) => finding.kind === 'stale-lock');
    expect(stale).toHaveLength(1);
    expect(stale[0].message).toContain('locked at 2.6.0');
    expect(stale[0].message).toContain('stale lockfile');
  });

  test('requires biome even when absent and rewrites foreign tsconfig preserving overrides', () => {
    const dir = clone('consumer-node');
    const pkg = readPkg(dir);
    pkg.devDependencies['@biomejs/biome'] = undefined;
    writePkg(dir, JSON.parse(JSON.stringify(pkg)));
    writeFileSync(
      join(dir, 'tsconfig.json'),
      '{\n"compilerOptions": {\n"target": "ES2020",\n"declaration": true\n}\n}',
    );

    const { findings, flush } = inspect(dir, manifest);
    const messages = findings.map((finding) => finding.message);
    expect(messages).toContainEqual(expect.stringContaining('@biomejs/biome missing'));
    expect(messages).toContainEqual(expect.stringContaining('tsconfig.json extends (none)'));

    for (const finding of findings) finding.fix?.();
    flush();

    const tsconfig = parseJsonc(readFileSync(join(dir, 'tsconfig.json'), 'utf8'));
    expect(tsconfig.extends).toBe('@inixiative/config/tsconfig/base.json');
    expect((tsconfig.compilerOptions as Record<string, unknown>).declaration).toBe(true);
    expect(inspect(dir, manifest).findings).toEqual([]);
  });

  test('requires @inixiative/config itself', () => {
    const dir = clone('consumer-node');
    const pkg = readPkg(dir);
    pkg.devDependencies['@inixiative/config'] = undefined;
    writePkg(dir, JSON.parse(JSON.stringify(pkg)));

    const { findings, flush } = inspect(dir, manifest);
    const messages = findings.map((finding) => finding.message);
    expect(messages).toContainEqual(expect.stringContaining('@inixiative/config missing'));

    for (const finding of findings) finding.fix?.();
    flush();
    expect(readPkg(dir).devDependencies['@inixiative/config']).toMatch(/^\^\d/);
    expect(inspect(dir, manifest).findings).toEqual([]);
  });

  test('react preset inferred from react dependency', () => {
    const dir = clone('consumer-react');
    writeFileSync(join(dir, 'biome.json'), '{\n"linter": {"enabled": true}\n}');
    const { findings } = inspect(dir, manifest);
    const messages = findings.map((finding) => finding.message);
    expect(messages).toContainEqual(expect.stringContaining('biome/react.json'));
  });

  test('missing configs produce stubs', () => {
    const dir = clone('consumer-node');
    writeFileSync(join(dir, 'tsconfig.json'), '');
    writeFileSync(join(dir, 'biome.json'), '');
    const broken = inspect(dir, manifest);
    expect(broken.findings.length).toBeGreaterThan(0);
  });
});
