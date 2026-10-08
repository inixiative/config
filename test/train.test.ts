import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseCommandLine, UsageError } from '../src/args';
import { loadManifest, packageRoot } from '../src/lib';

const manifest = loadManifest();
const cli = join(import.meta.dir, '..', 'src', 'cli.ts');

const write = (path: string, body: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`);
};

const run = (cwd: string, ...command: string[]) => {
  const result = Bun.spawnSync(command, { cwd, stdout: 'pipe', stderr: 'pipe' });
  return { status: result.exitCode, stdout: result.stdout.toString().trim() };
};

const realGit = Bun.which('git') ?? 'git';

/** A committed repo on `main`; `repo` adds a GitHub origin, as consumers are found by it. */
const repo = (dir: string, files: Record<string, unknown>, origin?: string) => {
  for (const [path, body] of Object.entries(files)) write(join(dir, path), body);
  run(dir, realGit, 'init', '-q', '-b', 'main');
  if (origin) run(dir, realGit, 'remote', 'add', 'origin', `git@github.com:${origin}.git`);
  run(dir, realGit, 'add', '-A');
  run(dir, realGit, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
};

/**
 * The agentic lane plus its consumers, every package ahead of npm and every consumer pinned to
 * an old range: a real train would publish, bump, re-lock, commit and branch in each.
 */
const agenticRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'inixiative-train-'));
  const next = (name: string) => {
    const [major, minor] = (manifest.agentic?.[name] ?? '0.0.0').split('.');
    return `${major}.${Number(minor) + 1}.0`;
  };
  const pkg = (name: string, extra: Record<string, unknown> = {}) => ({
    name,
    version: next(name),
    ...extra,
  });
  repo(join(root, 'signet'), { 'package.json': pkg('@inixiative/signet') });
  repo(join(root, 'archive'), { 'package.json': pkg('@inixiative/archive') });
  repo(join(root, 'agent-session'), { 'package.json': pkg('@inixiative/agent-session') });
  repo(join(root, 'foundry'), {
    'package.json': {
      name: '@inixiative/foundry-monorepo',
      private: true,
      workspaces: ['packages/*'],
    },
    'packages/core/package.json': pkg('@inixiative/foundry-core'),
    'packages/foundry/package.json': pkg('@inixiative/foundry', {
      dependencies: { '@inixiative/foundry-core': 'workspace:*' },
    }),
  });
  const consumer = { dependencies: { '@inixiative/signet': '^0.0.1' } };
  repo(
    join(root, 'kingdom'),
    { 'package.json': { name: 'kingdom', private: true, ...consumer } },
    'inixiative/kingdom',
  );
  repo(
    join(root, 'oracle'),
    { 'package.json': { name: 'oracle', private: true, ...consumer } },
    'inixiative/oracle',
  );
  repo(
    join(root, 'template'),
    { 'package.json': { name: 'template', private: true } },
    'inixiative/template',
  );
  return root;
};

/**
 * Every process the train can reach for side effects — npm, bun, git, gh — is shimmed on PATH
 * and logged. git's read-only calls pass through to the real binary; fetch is a no-op so the
 * test never touches the network.
 */
const shimmedPath = (): { path: string; log: string } => {
  const bin = mkdtempSync(join(tmpdir(), 'inixiative-train-bin-'));
  const log = join(bin, 'calls.log');
  writeFileSync(log, '');
  const shim = (name: string, body: string) => {
    write(join(bin, name), `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`);
    chmodSync(join(bin, name), 0o755);
  };
  shim('npm', 'exit 1');
  shim('gh', 'exit 1');
  shim('bun', 'exit 1');
  shim('git', `if [ "$1" = fetch ]; then exit 0; fi\nexec "${realGit}" "$@"`);
  return { path: `${bin}:${process.env.PATH}`, log };
};

const train = (...args: string[]) => {
  const { path, log } = shimmedPath();
  const result = Bun.spawnSync([process.execPath, cli, 'train', ...args], {
    env: { ...process.env, PATH: path },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  return {
    status: result.exitCode,
    out: `${result.stdout.toString()}${result.stderr.toString()}`,
    calls: readFileSync(log, 'utf8').split('\n').filter(Boolean),
  };
};

const snapshot = (dirs: string[]) =>
  dirs.map((dir) => ({
    dir,
    head: run(dir, realGit, 'rev-parse', 'HEAD').stdout,
    branch: run(dir, realGit, 'rev-parse', '--abbrev-ref', 'HEAD').stdout,
    status: run(dir, realGit, 'status', '--porcelain').stdout,
  }));

describe('train --dry-run', () => {
  test('plans the release without installing, writing, committing, publishing or pushing', () => {
    const root = agenticRoot();
    const repos = ['signet', 'archive', 'agent-session', 'foundry', 'kingdom', 'oracle'].map(
      (name) => join(root, name),
    );
    const own = ['versions.json', 'package.json'].map((file) => join(packageRoot, file));
    const before = snapshot(repos);
    const ownBefore = own.map((file) => readFileSync(file, 'utf8'));

    const { out, calls } = train(root, '--lane=agentic', '--dry-run', '--push');

    expect(out).toContain('dry run: nothing is installed, written, committed, published or pushed');
    expect(out).toContain(`would publish @inixiative/signet@`);
    expect(out).toContain(`would publish @inixiative/foundry@`);
    expect(out).toContain('would re-lock kingdom and run its check');
    expect(out).toContain('would create review branch train/ecosystem-sync-');
    expect(out).toContain('would publish @inixiative/config@');
    expect(out).toContain('dry run complete');

    const mutating = calls.filter((call) =>
      /^(npm publish|npm pack|bun |gh |git (commit|add|push|merge|switch|checkout|reset|stash))/.test(
        call,
      ),
    );
    expect(mutating).toEqual([]);
    expect(snapshot(repos)).toEqual(before);
    expect(own.map((file) => readFileSync(file, 'utf8'))).toEqual(ownBefore);
  });

  test('an unknown flag stops the train before it touches anything', () => {
    const root = agenticRoot();
    const { status, out, calls } = train(root, '--lane=agentic', '--dryrun');
    expect(status).toBe(2);
    expect(out).toContain("Unknown option '--dryrun'");
    expect(calls).toEqual([]);
  });
});

describe('parseCommandLine', () => {
  test('reads train flags', () => {
    expect(parseCommandLine(['train', '/root', '--lane=agentic', '--dry-run'])).toMatchObject({
      command: 'train',
      positionals: ['/root'],
      lane: 'agentic',
      dryRun: true,
      push: false,
    });
  });

  test('a flag belongs to its command only', () => {
    expect(() => parseCommandLine(['sync', '--push'])).toThrow(UsageError);
    expect(() => parseCommandLine(['check', '--dry-run'])).toThrow(UsageError);
    expect(() => parseCommandLine(['scan', '--force'])).toThrow(UsageError);
    expect(parseCommandLine(['sync', '--force', '--no-install'])).toMatchObject({
      force: true,
      noInstall: true,
    });
  });

  test('rejects unknown commands, lanes and presets', () => {
    expect(() => parseCommandLine(['publish'])).toThrow(UsageError);
    expect(() => parseCommandLine(['train', '--lane=everything'])).toThrow(UsageError);
    expect(() => parseCommandLine(['check', '--preset=vue'])).toThrow(UsageError);
  });
});
